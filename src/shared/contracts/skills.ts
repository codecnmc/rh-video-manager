import { z } from 'zod'

export const builtinSkillIdSchema = z.enum(['workbench-storyboard', 'workbench-h3-prompts', 'workbench-editing', 'workbench-mcp', 'jianying-draft-editor'])
export type BuiltinSkillId = z.infer<typeof builtinSkillIdSchema>
