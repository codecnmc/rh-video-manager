import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { WorkbenchDatabase } from '../src/main/infrastructure/database/workspace-repository.ts'
import { SqliteAssetRepository } from '../src/main/infrastructure/database/asset-repository.ts'
import { LibraryService } from '../src/main/modules/assets/application/library-service.ts'
import { mediaFileKind } from '../src/main/modules/assets/domain/media-file-kind.ts'
import type { AssetFiles } from '../src/main/modules/assets/ports/library.ts'
import type { ReferenceKind } from '../src/shared/contracts/references.ts'

function fixture() {
  const database = new WorkbenchDatabase(':memory:')
  const copied: ReferenceKind[] = []
  const discarded: string[] = []
  const files: AssetFiles = {
    localPath: async () => { throw new Error('不查询本地路径') },
    readImage: async () => { throw new Error('不读取图片') },
    import: async (id, name, kind) => {
      if (name === 'fail.mp4') throw new Error('复制失败')
      copied.push(kind)
      return { storedName: `${id}.${name.split('.').at(-1)!.toLowerCase()}`, name, size: 12 }
    },
    importImage: async () => { throw new Error('真实文件不经过截图导入') },
    discard: async (name) => { discarded.push(name) }, reveal: () => undefined, resolve: (name) => name
  }
  const library = new LibraryService(new SqliteAssetRepository(database.connection), files, randomUUID)
  const input = { projectId: null, categoryId: null, kind: 'auto' as const, tags: [], prompt: '', notes: '' }
  return { database, library, input, copied, discarded }
}

test('按大小写无关的扩展名识别视频和音频，不把目录名或无扩展名当类型', () => {
  assert.equal(mediaFileKind('D:\\素材\\片段.MP4'), 'video')
  assert.equal(mediaFileKind('/media/voice.WAV'), 'audio')
  assert.equal(mediaFileKind('music.m4a'), 'audio')
  assert.equal(mediaFileKind('image.JPEG'), 'image')
  for (const name of ['mp4', '.mp4', 'D:\\folder.mp4\\unknown', 'script.exe', 'file.mp4.exe']) {
    assert.throws(() => mediaFileKind(name), /格式不受支持/)
  }
})

test('图片视频音频混合批次按各自类型复制和落库，保持目标文件夹', async () => {
  const f = fixture()
  try {
    const folder = f.library.saveCategory({ id: null, name: '声音与视频', projectId: null, parentId: null })[0]!
    const imported = await f.library.importAuto({ ...f.input, categoryId: folder.id }, ['cover.PNG', 'clip.MP4', 'voice.wav', 'music.m4a'])
    assert.deepEqual(imported.map((asset) => asset.kind), ['image', 'video', 'audio', 'audio'])
    assert.deepEqual(f.copied, ['image', 'video', 'audio', 'audio'])
    assert.ok(imported.every((asset) => asset.categoryId === folder.id && asset.projectId === null))
    assert.equal(f.library.list().length, 4)
  } finally { f.database.close() }
})

test('未知格式在复制前拒绝，混合批次复制失败时回滚已复制文件且不落库', async () => {
  const f = fixture()
  try {
    assert.throws(() => f.library.importAuto(f.input, ['clip.mp4', 'bad.exe']), /格式不受支持/)
    assert.deepEqual(f.copied, [])
    await assert.rejects(f.library.importAuto(f.input, ['voice.wav', 'fail.mp4']), /复制失败/)
    assert.equal(f.discarded.length, 1)
    assert.deepEqual(f.library.list(), [])
    await assert.rejects(f.library.importAuto(f.input, Array.from({ length: 21 }, () => 'clip.mp4')), /1–20/)
    assert.equal(f.copied.length, 1)
  } finally { f.database.close() }
})
