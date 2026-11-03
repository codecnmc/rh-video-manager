import { assetSchema, importAssetsSchema, savePromptAssetSchema, updateAssetSchema, saveCategorySchema, pasteAssetsSchema, moveAssetsSchema, replaceAssetFileSchema, resolveAssetPathSchema,
  type Asset, type AssetFilter, type ImportAssets, type SavePromptAsset, type UpdateAsset, type SaveCategory, type PasteAssets, type MoveAssets, type ReplaceAssetFile, type ResolveAssetPath, type AssetLocalPath } from '../../../../shared/contracts/assets'
import type { AssetFiles, AssetRecord, AssetRepository, DraftAssetFolder } from '../ports/library'
import { pastedImagesSchema, type PastedImage } from '../../../../shared/contracts/references'
import { generatedVideoName } from '../../../../shared/media-naming'
import { autoImportAssetsSchema, type AutoImportAssets } from '../../../../shared/contracts/assets'
import type { ReferenceKind } from '../../../../shared/contracts/references'
import { mediaFileKind } from '../domain/media-file-kind'
import { createHash } from 'node:crypto'

function pastedImageNames(title: string, images: PastedImage[], existingNames: string[]): string[] {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
    .slice(0, 120).replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '') || '未命名视频'
  const prefix = `${base}-图片-`
  let ordinal = 0
  for (const name of existingNames) {
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) continue
    const match = /^(\d+)\.(png|jpe?g|webp)$/i.exec(name.slice(prefix.length))
    const value = match ? Number(match[1]) : 0
    if (Number.isSafeInteger(value)) ordinal = Math.max(ordinal, value)
  }
  return images.map((image) => {
    ordinal += 1
    if (!Number.isSafeInteger(ordinal)) throw new Error('图片命名序号已达上限')
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[image.mimeType]
    return `${prefix}${String(ordinal).padStart(3, '0')}.${extension}`
  })
}

export class LibraryService {
  private queue: Promise<unknown> = Promise.resolve()
  private pendingImports = 0
  constructor(private readonly repository: AssetRepository, private readonly files: AssetFiles, private readonly id: () => string,
    private readonly ensureUnreferenced: (id: string) => void = () => undefined) {}
  private serial<T>(action: () => Promise<T>): Promise<T> {
    this.pendingImports += 1
    const result = this.queue.then(action).finally(() => { this.pendingImports -= 1 })
    this.queue = result.catch(() => undefined)
    return result
  }
  hasPendingImports(): boolean { return this.pendingImports > 0 }
  list(filter: AssetFilter = {}): Asset[] { return this.repository.list(filter) }
  get(id: string): Asset { return this.repository.get(id).asset }
  categories(projectId?: string | null) { return this.repository.categories(projectId) }
  private category(id: string | null, projectId?: string | null): void {
    if (id && !this.categories(projectId).some((item) => item.id === id)) throw new Error('素材分类不存在或不属于该项目')
  }
  saveCategory(input: SaveCategory) {
    const parsed = saveCategorySchema.parse(input)
    const categories = this.categories()
    const current = categories.find((item) => item.id === parsed.id)
    if (parsed.id && !current) throw new Error('文件夹不存在')
    const parentId = parsed.parentId === undefined ? current?.parentId ?? null : parsed.parentId
    const projectId = parsed.projectId === undefined
      ? current ? current.projectId : categories.find((item) => item.id === parentId)?.projectId ?? null
      : parsed.projectId
    if (current && current.projectId !== projectId) throw new Error('不能更改文件夹的项目归属')
    this.category(parentId, projectId)
    // 向上检查祖先，禁止把文件夹放进自身或自己的子孙目录。
    const visited = new Set<string>()
    let ancestor = parentId
    while (ancestor) {
      if (ancestor === parsed.id || visited.has(ancestor)) throw new Error('文件夹不能移动到自身或子文件夹内')
      visited.add(ancestor)
      ancestor = categories.find((item) => item.id === ancestor)?.parentId ?? null
    }
    if (categories.some((item) => item.projectId === projectId && item.id !== parsed.id && item.parentId === parentId && item.name.toLowerCase() === parsed.name.toLowerCase())) throw new Error('同级文件夹名称已存在')
    this.repository.saveCategory({ id: parsed.id ?? this.id(), name: parsed.name, parentId, projectId })
    return this.categories()
  }
  removeCategory(id: string) { this.repository.removeCategory(id); return this.categories() }
  moveCategory(id: string, parentId: string | null) {
    const current = this.categories().find((folder) => folder.id === id)
    if (!current) throw new Error('文件夹不存在')
    return this.saveCategory({ id, name: current.name, parentId })
  }
  registerGeneratedVideo(input: { id: string; projectId: string; title: string; prompt: string; jobId: string; storedName: string; size: number; submittedAt?: string }): Asset {
    if (input.storedName !== `${input.id}.mp4`) throw new Error('成片受管文件标识不正确')
    const existing = [false, true].flatMap((archived) => this.list({ projectId: input.projectId, archived })).find((asset) => asset.id === input.id)
    if (existing) {
      if (existing.kind !== 'video') throw new Error('成片素材标识冲突')
      return existing
    }
    let folder = this.categories(input.projectId).find((item) => item.parentId === null && item.name === '最终成片')
    if (!folder) folder = this.saveCategory({ id: null, name: '最终成片', parentId: null, projectId: input.projectId }).find((item) => item.projectId === input.projectId && item.parentId === null && item.name === '最终成片')
    if (!folder) throw new Error('成片文件夹创建失败')
    const now = new Date().toISOString()
    const asset = assetSchema.parse({ id: input.id, projectId: input.projectId, categoryId: folder.id, kind: 'video',
      name: generatedVideoName(input.title, input.jobId, input.submittedAt ?? now), size: input.size,
      tags: ['最终成片'], prompt: input.prompt, notes: `生成任务：${input.jobId}\n生成时间：${input.submittedAt ?? now}`, createdAt: now, updatedAt: now, archived: false })
    this.repository.save([{ asset, storedName: input.storedName }])
    return asset
  }
  registerGeneratedImage(input: { id: string; projectId: string | null; title: string; prompt: string; storedName: string; size: number; accountName: string; accountId: string; accountGroup: string; baseUrl: string; model: string; submittedAt: string }): Asset {
    if (!['png', 'jpg', 'webp'].some((extension) => input.storedName === `${input.id}.${extension}`)) throw new Error('生成图片文件标识不正确')
    const previous = this.list({ projectId: input.projectId }).concat(this.list({ projectId: input.projectId, archived: true })).find((asset) => asset.id === input.id)
    if (previous) {
      if (previous.kind !== 'image' || previous.imageGeneration?.taskId !== input.id || previous.imageGeneration.accountId !== input.accountId) throw new Error('生成图片标识冲突')
      return previous
    }
    let category = this.categories(input.projectId).find((item) => item.parentId === null && item.name === '生成图片')
    if (!category) category = this.saveCategory({ id: null, name: '生成图片', projectId: input.projectId, parentId: null })
      .find((item) => item.projectId === input.projectId && item.parentId === null && item.name === '生成图片')
    if (!category) throw new Error('生成图片文件夹创建失败')
    const now = new Date().toISOString()
    const asset = assetSchema.parse({ id: input.id, projectId: input.projectId, categoryId: category.id, kind: 'image',
      name: `${input.title.slice(0, 110)}-${input.id.slice(0, 8)}.${input.storedName.split('.').at(-1)}`, size: input.size,
      prompt: input.prompt, tags: ['生成图片'], notes: `生图任务：${input.id}\n生成账号：${input.accountName}\n账号 ID：${input.accountId}\n模型：${input.model}`,
      imageGeneration: { taskId: input.id, accountId: input.accountId, accountName: input.accountName, accountGroup: input.accountGroup,
        baseUrl: input.baseUrl, model: input.model, submittedAt: input.submittedAt },
      createdAt: now, updatedAt: now, archived: false })
    this.repository.save([{ asset, storedName: input.storedName }])
    return asset
  }
  registerContinuityAssets(input: { projectId: string; sourceAssetId: string; jobId: string; title: string; start: number; end: number;
    video: { id: string; storedName: string; size: number; kind: 'video' };
    frame: { id: string; storedName: string; size: number; kind: 'image' } }): { videoAssetId: string; frameAssetId: string } {
    const source = this.get(input.sourceAssetId)
    if (source.archived || source.projectId !== input.projectId || source.kind !== 'video') throw new Error('衔接源素材不属于当前项目')
    let folder = this.categories(input.projectId).find((item) => item.parentId === null && item.name === '连续镜头参考')
    if (!folder) folder = this.saveCategory({ id: null, name: '连续镜头参考', projectId: input.projectId, parentId: null })
      .find((item) => item.projectId === input.projectId && item.parentId === null && item.name === '连续镜头参考')
    if (!folder) throw new Error('衔接素材目录不存在')
    const existing = [...this.list({ projectId: input.projectId }), ...this.list({ projectId: input.projectId, archived: true })]
    const now = new Date().toISOString()
    const records = [input.video, input.frame].flatMap((file) => {
      const extension = file.kind === 'video' ? 'mp4' : 'jpg'
      if (file.storedName !== `${file.id}.${extension}`) throw new Error('衔接文件标识不正确')
      const previous = existing.find((asset) => asset.id === file.id)
      if (previous) {
        if (previous.archived || previous.kind !== file.kind) throw new Error('衔接素材已归档或标识冲突')
        return []
      }
      const asset = assetSchema.parse({ id: file.id, projectId: input.projectId, categoryId: folder.id, kind: file.kind,
        name: `${input.title.slice(0, 80)}-${file.kind === 'video' ? '尾段参考' : '最后帧'}-${input.jobId.slice(0, 8)}.${extension}`,
        size: file.size, tags: ['连续镜头参考'], prompt: '',
        notes: `生成任务：${input.jobId}\n源素材：${input.sourceAssetId}\n源区间：${input.start.toFixed(6)}–${input.end.toFixed(6)} 秒；视频无音轨，图片为源视频最后解码帧`,
        createdAt: now, updatedAt: now, archived: false })
      return [{ asset, storedName: file.storedName }]
    })
    if (records.length) this.repository.save(records)
    return { videoAssetId: input.video.id, frameAssetId: input.frame.id }
  }

  paste(input: PasteAssets): Promise<Asset[]> {
    const parsed = pasteAssetsSchema.parse(input)
    let categoryId = parsed.categoryId
    // 没有当前目录时统一收纳，避免剪贴板图片散落到根目录。
    if (!categoryId) {
      const existing = this.categories(parsed.projectId).find((folder) => folder.parentId === null && folder.name === '粘贴导入')
      if (!existing) this.saveCategory({ id: null, name: '粘贴导入', parentId: null, projectId: parsed.projectId })
      const folder = existing ?? this.categories(parsed.projectId).find((item) => item.parentId === null && item.name === '粘贴导入')
      if (!folder) throw new Error('粘贴文件夹创建失败')
      categoryId = folder.id
    }
    return this.importBatch({ projectId: parsed.projectId, categoryId, kind: 'image', tags: [], prompt: '', notes: '' },
      parsed.images.map((image) => (id) => this.files.importImage(id, image)), () => undefined,
      () => pastedImageNames('粘贴', parsed.images, parsed.projectId ? this.repository.names(parsed.projectId)
        : [false, true].flatMap((archived) => this.list({ projectId: null, archived }).map((asset) => asset.name))), undefined, undefined, true)
  }
  move(input: MoveAssets): Asset[] {
    const parsed = moveAssetsSchema.parse(input)
    this.category(parsed.categoryId)
    if (new Set(parsed.assets.map((asset) => asset.id)).size !== parsed.assets.length) throw new Error('移动列表包含重复素材')
    // 全部检查修订号后一次落库，不产生只移动部分素材的结果。
    const records = parsed.assets.map((item) => {
      const record = this.repository.get(item.id)
      this.category(parsed.categoryId, record.asset.projectId)
      if (record.asset.updatedAt !== item.expectedUpdatedAt) throw new Error('素材已更新，请刷新后重新选择')
      return { ...record, asset: assetSchema.parse({ ...record.asset, categoryId: parsed.categoryId,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(record.asset.updatedAt) + 1)).toISOString() }) }
    })
    this.repository.save(records)
    return records.map((record) => record.asset)
  }
  import(input: ImportAssets, paths: string[], authorize: () => void = () => undefined): Promise<Asset[]> {
    const parsed = importAssetsSchema.parse(input)
    return this.importBatch(parsed, paths.map((path) => (id) => this.files.import(id, path, parsed.kind)), authorize)
  }
  importAuto(input: AutoImportAssets, paths: string[], authorize: () => void = () => undefined): Promise<Asset[]> {
    const parsed = autoImportAssetsSchema.parse(input)
    // 整批先识别类型；文件大小和内容继续由原受管文件适配器校验，不信任浏览器 MIME。
    const kinds = paths.map(mediaFileKind)
    return this.importBatch({ ...parsed, kind: 'image' }, paths.map((path, index) => (id) => this.files.import(id, path, kinds[index]!)),
      authorize, undefined, undefined, kinds)
  }
  importImages(projectId: string, draftTitle: string, images: PastedImage[], authorize: () => void, draftId?: string): Promise<Asset[]> {
    const parsed = pastedImagesSchema.parse(images)
    return this.importBatch({ projectId, categoryId: null, tags: [], prompt: '', notes: '', kind: 'image' },
      parsed.map((image) => (id) => this.files.importImage(id, image)), authorize,
      () => pastedImageNames(draftTitle, parsed, this.repository.names(projectId)),
      draftId ? () => {
        const existing = this.repository.draftCategory(draftId)
        if (existing) return { draftId, category: existing }
        const base = draftTitle.trim().slice(0, 50).replace(/[\uD800-\uDBFF]$/, '') || '未命名视频'
        const categories = this.categories(projectId)
        let name = base
        let suffix = 1
        while (categories.some((item) => item.parentId === null && item.name.toLowerCase() === name.toLowerCase())) name = `${base} (${++suffix})`
        return { draftId, category: { id: this.id(), name, parentId: null, projectId } }
      } : undefined, undefined, true)
  }
  private importBatch(input: ImportAssets, importers: ((id: string) => ReturnType<AssetFiles['import']>)[],
    authorize: () => void, nameBatch?: () => string[], folderBatch?: () => DraftAssetFolder, kinds?: ReferenceKind[], deduplicateImages = false): Promise<Asset[]> {
    const parsed = importAssetsSchema.parse(input)
    if (importers.length < 1 || importers.length > 20) return Promise.reject(new Error('每次导入 1–20 个文件'))
    return this.serial(async () => {
      authorize()
      this.category(parsed.categoryId, parsed.projectId)
      const records: AssetRecord[] = []
      try {
        for (const importer of importers) {
          authorize()
          const id = this.id()
          const file = await importer(id)
          const now = new Date().toISOString()
          // 先登记受管文件，元数据校验失败时也能清理本批新复制文件。
          const record: AssetRecord = { storedName: file.storedName, asset: {
            ...parsed, kind: kinds?.[records.length] ?? parsed.kind, id, name: file.name, size: file.size, createdAt: now, updatedAt: now, archived: false
          } }
          records.push(record)
          record.asset = assetSchema.parse(record.asset)
        }
        authorize()
        // 文件写完后再分配名称，并在同一串行临界区立即落库，避免并发粘贴或重命名撞号。
        if (nameBatch) {
          const names = nameBatch()
          if (names.length !== records.length) throw new Error('素材命名数量不匹配')
          records.forEach((record, index) => { record.asset = assetSchema.parse({ ...record.asset, name: names[index] }) })
        }
        // 在文件复制结束后读取绑定，尊重期间发生的文件夹重命名和移动。
        const folder = folderBatch?.()
        if (folder) records.forEach((record) => { record.asset = assetSchema.parse({ ...record.asset, categoryId: folder.category.id }) })
        const result: Asset[] = []
        const fresh: AssetRecord[] = []
        const candidates = deduplicateImages ? this.list({ projectId: parsed.projectId }).filter((asset) => asset.kind === 'image' && !asset.archived) : []
        const fingerprints = new Map<string, string>()
        const fingerprint = async (record: AssetRecord) => {
          if (!record.storedName) throw new Error('图片受管文件不存在')
          const cached = fingerprints.get(record.storedName)
          if (cached) return cached
          const image = await this.files.readImage(record.storedName)
          const hash = createHash('md5').update(image.bytes).digest('hex')
          fingerprints.set(record.storedName, hash)
          return hash
        }
        for (const record of records) {
          let duplicate: Asset | undefined
          if (deduplicateImages) {
            const hash = await fingerprint(record)
            // 只复用当前授权范围内的有效素材；旧素材按实际文件计算，不信任名称。
            for (const asset of candidates.filter((asset) => asset.size === record.asset.size)) {
              const candidate = fresh.find((item) => item.asset.id === asset.id) ?? this.repository.get(asset.id)
              if (await fingerprint(candidate) === hash) { duplicate = asset; break }
            }
          }
          if (duplicate) {
            await this.files.discard(record.storedName!)
            record.storedName = null
            result.push(duplicate)
          } else {
            fresh.push(record)
            candidates.push(record.asset)
            result.push(record.asset)
          }
        }
        authorize()
        // 哈希读盘会让出事件循环；返回旧素材前重新确认它没有被归档、删除或替换。
        for (let index = 0; index < result.length; index += 1) {
          const asset = result[index]!
          if (fresh.some((record) => record.asset.id === asset.id)) continue
          const current = this.repository.get(asset.id).asset
          if (current.archived || current.updatedAt !== asset.updatedAt || current.projectId !== parsed.projectId) throw new Error('复用素材已变化，请重新粘贴')
          result[index] = current
        }
        if (fresh.length) this.repository.save(fresh, folder)
        return result
      } catch (error) {
        await Promise.all(records.map((record) => record.storedName ? this.files.discard(record.storedName) : Promise.resolve()))
        throw error
      }
    })
  }
  savePrompt(input: SavePromptAsset): Asset {
    const parsed = savePromptAssetSchema.parse(input)
    this.category(parsed.categoryId, parsed.projectId)
    if (!parsed.prompt.trim()) throw new Error('提示词不能为空')
    const now = new Date().toISOString()
    const asset = assetSchema.parse({ ...parsed, id: this.id(), kind: 'prompt', size: 0, createdAt: now, updatedAt: now, archived: false })
    this.repository.save([{ asset, storedName: null }])
    return asset
  }
  update(input: UpdateAsset): Asset {
    const parsed = updateAssetSchema.parse(input)
    const record = this.repository.get(parsed.id)
    this.category(parsed.categoryId, record.asset.projectId)
    if (record.asset.updatedAt !== parsed.expectedUpdatedAt) throw new Error('素材已被其他窗口或 MCP 更新，请关闭编辑器并重新打开')
    if (record.asset.kind === 'prompt' && !parsed.prompt.trim()) throw new Error('提示词不能为空')
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(record.asset.updatedAt) + 1)).toISOString()
    record.asset = assetSchema.parse({ ...record.asset, ...parsed, updatedAt })
    this.repository.save([record])
    return record.asset
  }
  replaceFile(input: ReplaceAssetFile, authorize: () => Promise<void> = async () => undefined): Promise<Asset> {
    const parsed = replaceAssetFileSchema.parse(input)
    return this.serial(async () => {
      await authorize()
      const check = () => {
        const record = this.repository.get(parsed.id)
        if (record.asset.kind !== 'image' || record.asset.archived || !record.storedName) throw new Error('仅支持替换未归档的图片素材')
        if (record.asset.updatedAt !== parsed.expectedUpdatedAt) throw new Error('素材已更新，请刷新后重新替换')
        this.ensureUnreferenced(parsed.id)
        return record
      }
      check()
      // 使用独立文件名，绝不覆盖仍被在途上传或历史版本持有的旧文件。
      const file = await this.files.import(this.id(), parsed.path, 'image')
      try {
        await authorize()
        const previous = check()
        const asset = assetSchema.parse({ ...previous.asset, size: file.size,
          updatedAt: new Date(Math.max(Date.now(), Date.parse(previous.asset.updatedAt) + 1)).toISOString() })
        this.repository.replaceFile({ asset, storedName: file.storedName }, parsed.expectedUpdatedAt)
        return asset
      } catch (error) {
        await this.files.discard(file.storedName)
        throw error
      }
    })
  }
  async readImage(id: string, expectedUpdatedAt: string, authorize: (asset: Asset) => Promise<void>) {
    const check = () => {
      const record = this.repository.get(id)
      if (record.asset.kind !== 'image' || record.asset.archived || !record.storedName) throw new Error('仅支持读取未归档图片')
      if (record.asset.updatedAt !== expectedUpdatedAt) throw new Error('素材已更新，请重新查询')
      return record
    }
    const original = check()
    await authorize(original.asset)
    const before = check()
    const image = await this.files.readImage(before.storedName!)
    // 异步读盘与授权后重查修订和文件标识，不能将旧文件作为新素材返回。
    await authorize(check().asset)
    const current = check()
    if (current.storedName !== before.storedName || image.bytes.byteLength !== current.asset.size) throw new Error('图片文件已变化')
    return { asset: current.asset, ...image }
  }
  async resolvePath(input: ResolveAssetPath, authorize: (asset: Asset) => Promise<void>): Promise<AssetLocalPath> {
    const parsed = resolveAssetPathSchema.parse(input)
    const check = () => {
      const record = this.repository.get(parsed.assetId)
      if (record.asset.archived || record.asset.kind === 'prompt' || !record.storedName) throw new Error('仅支持未归档的媒体素材')
      if (record.asset.updatedAt !== parsed.expectedUpdatedAt) throw new Error('素材已更新，请重新查询')
      return record
    }
    await authorize(check().asset)
    const before = check()
    const file = await this.files.localPath(before.storedName!)
    // 文件查询和项目授权均有异步边界；交付路径前再次核对，阻断撤权和替换。
    await authorize(check().asset)
    const current = check()
    if (current.storedName !== before.storedName || file.size !== current.asset.size) throw new Error('素材文件已变化')
    const asset = current.asset
    if (asset.kind === 'prompt') throw new Error('提示词素材没有文件位置')
    return { assetId: asset.id, projectId: asset.projectId, name: asset.name, kind: asset.kind,
      updatedAt: asset.updatedAt, size: file.size, path: file.path }
  }
  archive(id: string, archived: boolean): void {
    const record = this.repository.get(id)
    record.asset = { ...record.asset, archived, updatedAt: new Date(Math.max(Date.now(), Date.parse(record.asset.updatedAt) + 1)).toISOString() }
    this.repository.save([record])
  }
  remove(id: string): void { this.ensureUnreferenced(id); this.repository.remove(id) }
  media(id: string) {
    const record = this.repository.get(id)
    if (!record.storedName || record.asset.kind === 'prompt') throw new Error('该素材没有媒体文件')
    return { path: this.files.resolve(record.storedName), kind: record.asset.kind }
  }
  reveal(id: string): void {
    const record = this.repository.get(id)
    if (!record.storedName) throw new Error('提示词素材没有文件位置')
    this.files.reveal(record.storedName)
  }
}
