import { cp, lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { BuiltinSkillFiles } from '../ports/builtin-skill-files'
import { builtinSkillIdSchema, type BuiltinSkillId } from '../../../../shared/contracts/skills'

export class LocalBuiltinSkillFiles implements BuiltinSkillFiles {
  constructor(private readonly source: string) {}
  codexSkillsDirectory() { return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'skills') }
  async copyTo(parent: string, id: BuiltinSkillId = 'workbench-storyboard'): Promise<string> {
    builtinSkillIdSchema.parse(id)
    const target = join(parent, id)
    try { await lstat(target); throw new Error(`目标已有 ${id}，未覆盖现有技能；请先另行备份或选择其他导出目录`) }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
    await mkdir(parent, { recursive: true })
    const staging = await mkdtemp(join(parent, `.${id}-`))
    try {
      await cp(join(this.source, id), join(staging, id), { recursive: true, force: false, errorOnExist: true })
      await rename(join(staging, id), target)
      return target
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
}
