import type { DatabaseSync } from 'node:sqlite'
import type { ProjectMetadata, ProjectRepository } from '../../modules/projects'
import { projectSchema } from '../../../shared/contracts/workspace'

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly database: DatabaseSync) {}

  list(): ProjectMetadata[] {
    return this.database.prepare('SELECT id, name, sample, video_groups FROM projects ORDER BY sort_order').all().map((row) => ({
      id: String(row.id), name: String(row.name), sample: row.sample === 1,
      videoGroups: projectSchema.shape.videoGroups.parse(JSON.parse(String(row.video_groups)))
    }))
  }

  upsert(project: ProjectMetadata, order: number): void {
    this.database.prepare(`INSERT INTO projects (id, name, sample, sort_order, video_groups) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, sample=excluded.sample, sort_order=excluded.sort_order, video_groups=excluded.video_groups`)
      .run(project.id, project.name, Number(project.sample), order, JSON.stringify(project.videoGroups ?? []))
  }
}
