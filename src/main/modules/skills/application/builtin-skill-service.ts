import type { BuiltinSkillFiles } from '../ports/builtin-skill-files'
import { builtinSkillIdSchema, type BuiltinSkillId } from '../../../../shared/contracts/skills'

export class BuiltinSkillService {
  constructor(private readonly files: BuiltinSkillFiles) {}
  installDirectory() { return this.files.codexSkillsDirectory() }
  install(id: BuiltinSkillId = 'workbench-storyboard') { return this.files.copyTo(this.installDirectory(), builtinSkillIdSchema.parse(id)) }
  exportTo(parent: string, id: BuiltinSkillId = 'workbench-storyboard') { return this.files.copyTo(parent, builtinSkillIdSchema.parse(id)) }
}
