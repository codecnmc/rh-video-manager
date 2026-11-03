"""Cross-process image request permits; no credentials or automatic retries."""

from contextlib import contextmanager
import json
import os
from pathlib import Path
import sqlite3
import uuid


class ConcurrencyPool:
    def __init__(self, path):
        self.path = Path(path)
        with self.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS permits (token TEXT PRIMARY KEY, "
                       "pid INTEGER NOT NULL, account_group TEXT NOT NULL, "
                       "global_limit INTEGER NOT NULL, group_limit INTEGER NOT NULL, "
                       "status_path TEXT NOT NULL, state TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS stopped_accounts "
                       "(account_group TEXT PRIMARY KEY)")

    @contextmanager
    def transaction(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            # 只在计数和分配额度时持有短事务，不锁住整批或网络请求。
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def reserve(self, limit, group, capacity, status_path):
        with self.transaction() as db:
            if db.execute("SELECT 1 FROM stopped_accounts WHERE account_group=?", (group,)).fetchone():
                return None, "account_stopped"
            rows = db.execute("SELECT account_group, global_limit, group_limit FROM permits").fetchall()
            # 并行进程配置不同时采用较小上限，防止另一份配置放大在途额度。
            global_limit = min([limit] + [row[1] for row in rows])
            group_rows = [row for row in rows if row[0] == group]
            group_limit = min([capacity] + [row[2] for row in group_rows])
            if len(rows) >= global_limit or len(group_rows) >= group_limit:
                return None, "capacity_full"
            token = uuid.uuid4().hex
            db.execute("INSERT INTO permits VALUES (?, ?, ?, ?, ?, ?, ?)",
                       (token, os.getpid(), group, limit, capacity, str(status_path), "reserved"))
            return token, "reserved"

    def finish(self, token, result):
        with self.transaction() as db:
            row = db.execute("SELECT account_group FROM permits WHERE token=?", (token,)).fetchone()
            if not row:
                return
            if result.get("stopAccount"):
                db.execute("INSERT OR IGNORE INTO stopped_accounts VALUES (?)", (row[0],))
            # 请求受理不明仍占额度；完成响应后的下载失败不代表远端仍在生成。
            if result["state"] in ("saved_unreviewed", "not_submitted", "accepted_output_unavailable"):
                db.execute("DELETE FROM permits WHERE token=?", (token,))
            else:
                db.execute("UPDATE permits SET state=? WHERE token=?", (result["state"], token))

    def snapshot(self):
        with self.transaction() as db:
            return {
                "permits": [dict(zip(("token", "pid", "accountGroup", "statusPath", "state"), row))
                            for row in db.execute("SELECT token, pid, account_group, status_path, state FROM permits")],
                "stoppedAccounts": [row[0] for row in db.execute("SELECT account_group FROM stopped_accounts")],
            }

    def reconcile(self):
        # 只根据已落盘的确定终态归还额度；不按 PID 消失或超时猜测远端结束。
        for permit in self.snapshot()["permits"]:
            try:
                record = json.loads(Path(permit["statusPath"]).read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if record.get("state") in ("saved_unreviewed", "not_submitted", "accepted_output_unavailable"):
                self.finish(permit["token"], record)

    def release_confirmed(self, token):
        with self.transaction() as db:
            if db.execute("DELETE FROM permits WHERE token=?", (token,)).rowcount != 1:
                raise ValueError("Unknown concurrency permit")

    def resume_confirmed(self, group):
        with self.transaction() as db:
            db.execute("DELETE FROM stopped_accounts WHERE account_group=?", (group,))
