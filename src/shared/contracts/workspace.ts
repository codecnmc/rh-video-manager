import { z } from 'zod'
import { videoDraftSchema } from './video'

export const episodeSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(100),
  script: z.string().max(200000)
})

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sample: z.boolean(),
  videoGroups: z.array(z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(100) })).max(200).optional(),
  episodes: z.array(episodeSchema).max(200),
  videoDrafts: z.array(videoDraftSchema).max(500).default([])
})

export const workspaceSchema = z.object({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  updatedAt: z.string(),
  projects: z.array(projectSchema).max(100)
})

export type Episode = z.infer<typeof episodeSchema>
export type Project = z.infer<typeof projectSchema>
export type Workspace = z.infer<typeof workspaceSchema>

export const saveWorkspaceSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  workspace: workspaceSchema
})

export type SaveWorkspace = z.infer<typeof saveWorkspaceSchema>

export const deleteWorkspaceEntitySchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  kind: z.enum(['project', 'episode', 'video']),
  projectId: z.string().uuid(),
  id: z.string().uuid()
})
export type DeleteWorkspaceEntity = z.infer<typeof deleteWorkspaceEntitySchema>

export const copyVideoDraftSchema = z.object({ expectedRevision: z.number().int().nonnegative(),
  projectId: z.string().uuid(), draftId: z.string().uuid() })
export type CopyVideoDraft = z.infer<typeof copyVideoDraftSchema>
