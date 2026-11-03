import type { BuiltinSkillId } from '../../../../shared/contracts/skills'

export interface BuiltinSkillFiles {
  copyTo(parent: string, id: BuiltinSkillId): Promise<string>
  codexSkillsDirectory(): string
}
