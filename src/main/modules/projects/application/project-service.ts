import type { ProjectMetadata, ProjectRepository } from '../ports/project-repository'

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  list(): ProjectMetadata[] { return this.repository.list() }
  save(project: ProjectMetadata, order: number): void { this.repository.upsert(project, order) }
}
