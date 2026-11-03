import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { storedTaskDiagnosticSchema, taskDiagnosticSchema, type TaskDiagnostic } from '../../../shared/contracts/task-diagnostics'

export class TaskDiagnostics {
  private writeFailed = false
  constructor(private readonly directory: string, private readonly maxBytes = 2 * 1024 * 1024) {}

  append(entry: TaskDiagnostic): void {
    try {
      const safe = taskDiagnosticSchema.parse(entry)
      mkdirSync(this.directory, { recursive: true })
      const current = join(this.directory, 'video-tasks.jsonl')
      const previous = join(this.directory, 'video-tasks.previous.jsonl')
      const line = `${JSON.stringify({ ...safe, at: new Date().toISOString() })}\n`
      // 只轮转本适配器的固定文件，最多保留两份；日志失败不得中断任务查询。
      if (existsSync(current) && statSync(current).size + Buffer.byteLength(line) > this.maxBytes) {
        if (existsSync(previous)) unlinkSync(previous)
        renameSync(current, previous)
      }
      appendFileSync(current, line, 'utf8')
      this.writeFailed = false
    } catch { this.writeFailed = true }
  }

  read(id: string): string {
    if (this.writeFailed) throw new Error('任务日志写入失败，请检查磁盘空间与目录权限')
    const lines: string[] = []
    for (const name of ['video-tasks.previous.jsonl', 'video-tasks.jsonl']) {
      const path = join(this.directory, name)
      if (!existsSync(path)) continue
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const parsed = storedTaskDiagnosticSchema.safeParse(JSON.parse(line) as unknown)
          if (parsed.success && parsed.data.id === id) lines.push(JSON.stringify(parsed.data))
        } catch { /* 忽略中断写入的残缺行，不导出未经校验内容。 */ }
      }
    }
    if (!lines.length) throw new Error('该任务暂无诊断日志，请先重新获取平台结果；历史日志无法补回')
    return `${lines.join('\n')}\n`
  }
}
