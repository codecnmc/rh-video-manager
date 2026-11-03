"""Offline permit tests: separate processes, no API calls or credentials."""

import concurrent.futures
import multiprocessing
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from image_concurrency import ConcurrencyPool


def reserve_in_process(args):
    path, group, limit, capacity, index = args
    return group, ConcurrencyPool(path).reserve(limit, group, capacity, f"missing-{index}.json")


class ConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "permits.sqlite3"
        self.pool = ConcurrencyPool(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_three_accounts_across_processes(self):
        work = [(str(self.path), f"account-{i % 3}", 6, 2, i) for i in range(12)]
        with concurrent.futures.ProcessPoolExecutor(
                max_workers=4, mp_context=multiprocessing.get_context("spawn")) as executor:
            results = list(executor.map(reserve_in_process, work))
        successful = [(group, token) for group, (token, _) in results if token]
        self.assertEqual(len(successful), 6)
        for group in ("account-0", "account-1", "account-2"):
            self.assertEqual(sum(row[0] == group for row in successful), 2)
        self.assertEqual(len(self.pool.snapshot()["permits"]), 6)
        for _, token in successful:
            self.pool.finish(token, {"state": "saved_unreviewed"})
        self.assertEqual(self.pool.snapshot()["permits"], [])

    def test_global_cap_and_reuse(self):
        first, _ = self.pool.reserve(2, "a", 2, "a.json")
        self.pool.reserve(2, "b", 2, "b.json")
        self.assertEqual(self.pool.reserve(2, "c", 2, "c.json")[1], "capacity_full")
        self.pool.finish(first, {"state": "saved_unreviewed"})
        self.assertIsNotNone(self.pool.reserve(2, "c", 2, "c.json")[0])

    def test_two_batches_actually_overlap(self):
        import image_batch
        barrier = threading.Barrier(6, timeout=10)
        module = Path(self.temp.name)
        providers = {f"p{i}": {"id": f"p{i}", "model": "offline-fake", "accountGroup": f"a{i}"}
                     for i in range(3)}
        groups = {f"a{i}": 2 for i in range(3)}
        jobs = [{"id": f"shot-{i}", "providerId": f"p{i}"} for i in range(3)]

        def fake_job(job, provider, directory):
            directory.mkdir()
            barrier.wait()
            record = {"id": job["id"], "providerId": provider["id"], "state": "saved_unreviewed", "files": []}
            image_batch.write_record(directory / "status.json", record)
            return record

        with patch.object(image_batch, "MODULE", module), patch.object(image_batch, "run_job", fake_job):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                batches = [executor.submit(image_batch.execute, 6, providers, groups, jobs, module / "output")
                           for _ in range(2)]
                self.assertEqual([batch.result(timeout=20) for batch in batches], [0, 0])
        self.assertEqual(len(list((module / "output").glob("image-batch-*"))), 2)
        self.assertEqual(ConcurrencyPool(module / ".image-concurrency.sqlite3").snapshot()["permits"], [])

    def test_unknown_stays_and_account_stop_is_shared(self):
        token, _ = self.pool.reserve(6, "a", 2, "a.json")
        self.pool.finish(token, {"state": "acceptance_unknown", "stopAccount": True})
        other_process_view = ConcurrencyPool(self.path)
        self.assertEqual(other_process_view.reserve(6, "a", 2, "b.json")[1], "account_stopped")
        self.assertEqual(len(other_process_view.snapshot()["permits"]), 1)
        other_process_view.resume_confirmed("a")
        other_process_view.release_confirmed(token)
        self.assertIsNotNone(self.pool.reserve(6, "a", 2, "c.json")[0])

    def test_reconcile_only_completed_records(self):
        import json
        status = Path(self.temp.name) / "status.json"
        token, _ = self.pool.reserve(6, "a", 2, status)
        status.write_text(json.dumps({"state": "submitting"}), encoding="utf-8")
        self.pool.reconcile()
        self.assertEqual(len(self.pool.snapshot()["permits"]), 1)
        status.write_text(json.dumps({"state": "saved_unreviewed"}), encoding="utf-8")
        self.pool.reconcile()
        self.pool.finish(token, {"state": "saved_unreviewed"})
        self.assertEqual(self.pool.snapshot()["permits"], [])


if __name__ == "__main__":
    unittest.main()
