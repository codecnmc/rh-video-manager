import type { Project } from '../../../../shared/contracts/workspace'

export type ProjectMetadata = Omit<Project, 'episodes' | 'videoDrafts'>

export interface ProjectRepository {
  list(): ProjectMetadata[]
  upsert(project: ProjectMetadata, order: number): void
}
