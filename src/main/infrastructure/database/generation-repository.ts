import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { videoDraftSchema } from '../../../shared/contracts/video'
import { previewSnapshotSchema } from '../../../shared/contracts/preview'
import type { GenerationRecord, GenerationRepository } from '../../modules/jobs'
import type { PreviewMedia } from '../../../shared/contracts/preview'

const recordSchema = z.object({
  id: z.string().uuid(), phase: z.enum(['preparing', 'submitting', 'accepted', 'uncertain', 'rejected']),
  createdAt: z.string().datetime(), draft: videoDraftSchema, preview: previewSnapshotSchema,
  previewDefinition: z.string().max(2 * 1024 * 1024).nullable(),
  previewDefinitionRecoveredAt: z.string().datetime().optional(),
  replacedTaskIds: z.array(z.string().uuid()).max(100).optional(),
  regenerationConfirmedAt: z.string().datetime().optional(),
  continuityRequest: z.object({ tailSeconds: z.number().int().min(1).max(5) }).optional(),
  references: z.array(z.object({ id: z.string().uuid(), draftId: z.string().uuid(), assetId: z.string().uuid(),
    kind: z.enum(['image', 'video', 'audio']), label: z.string().regex(/^<(Picture|Video|Audio) [1-9]\d*>$/),
    name: z.string().max(500), size: z.number().int().nonnegative() })).max(15)
}) satisfies z.ZodType<GenerationRecord>

export class SqliteGenerationRepository implements GenerationRepository {
  constructor(private readonly database: DatabaseSync,
    private readonly samplingFiles?: { save(id: string, media: PreviewMedia): PreviewMedia }) {}
  list(): GenerationRecord[] {
    return this.database.prepare('SELECT snapshot FROM generation_jobs ORDER BY created_at DESC, id').all()
      .map((row) => recordSchema.parse(JSON.parse(String(row.snapshot)) as unknown))
  }
  save(record: GenerationRecord): void {
    recordSchema.parse(record)
    if (this.samplingFiles && record.preview.sampling?.source.startsWith('data:')) {
      record = { ...record, preview: { ...record.preview, sampling: this.samplingFiles.save(record.id, record.preview.sampling) } }
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`INSERT INTO generation_jobs (id, created_at, snapshot) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot`).run(record.id, record.createdAt, JSON.stringify(record))
      const reference = this.database.prepare('INSERT OR IGNORE INTO generation_job_assets (job_id, asset_id) VALUES (?, ?)')
      for (const item of record.references) reference.run(record.id, item.assetId)
      if (record.preview.finalArchive?.status === 'ready' && record.preview.finalArchive.assetId) reference.run(record.id, record.preview.finalArchive.assetId)
      if (record.preview.continuityReference?.status === 'ready') {
        for (const id of [record.preview.continuityReference.videoAssetId, record.preview.continuityReference.frameAssetId]) {
          if (id) reference.run(record.id, id)
        }
      }
      this.database.exec('COMMIT')
    } catch (error) { this.database.exec('ROLLBACK'); throw error }
  }
}
