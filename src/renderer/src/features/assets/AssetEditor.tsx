import { SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { Input } from '@/components/ui/input'
import { SelectField } from '@/components/ui/select-field'
import { Textarea } from '@/components/ui/textarea'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { assetMetadataSchema, type Asset, type ImportAssets, type AutoImportAssets } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { folderOptions } from './folders'
import { useAssetCategories } from './use-library'

const editorSchema = assetMetadataSchema.extend({ projectId: z.string().uuid().nullable(), kind: z.enum(['auto', 'image', 'video', 'audio', 'prompt']) })
type EditorValue = z.infer<typeof editorSchema>

export function AssetEditor({ asset, importing, projectId, projects, categoryId, onClose, onSave, onDirty }: {
  asset: Asset | null; importing: boolean; projectId: string | null; categoryId: string | null
  projects: { id: string; name: string }[]; onClose: () => void
  onSave: (value: EditorValue) => Promise<void | false>; onDirty: (value: boolean) => void
}) {
  const [error, setError] = useState('')
  const [tagsText, setTagsText] = useState(asset?.tags.join(', ') ?? '')
  const form = useForm<EditorValue>({ resolver: zodResolver(editorSchema), defaultValues: asset ?? {
    name: importing ? '导入素材' : '', projectId, categoryId, tags: [], prompt: '', notes: '', kind: importing ? 'auto' : 'prompt'
  } })
  const { isDirty } = form.formState
  const categories = useAssetCategories(form.watch('projectId')).data ?? []
  useEffect(() => { onDirty(isDirty); return () => onDirty(false) }, [isDirty, onDirty])
  return <Dialog title={asset ? '编辑素材' : importing ? '导入素材' : '新建提示词'} className="asset-editor-dialog" onClose={async () => {
    if (!form.formState.isSubmitting && (!isDirty || (await confirmAction('放弃未保存的素材信息？')))) onClose()
  }}><form onSubmit={form.handleSubmit(async (value) => {
    setError('')
    try { if (await onSave(value) !== false) onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败') }
  })}><fieldset disabled={form.formState.isSubmitting} className="asset-editor-fields">
    {asset?.imageGeneration && <div className="asset-generation-provenance">生成账号：{asset.imageGeneration.accountName} · 模型：{asset.imageGeneration.model}<br />账号 ID：{asset.imageGeneration.accountId}<br />账号组：{asset.imageGeneration.accountGroup || '未记录'}<br />服务：{asset.imageGeneration.baseUrl || '未记录'}<br />任务：{asset.imageGeneration.taskId}</div>}
    {!importing && <><label className="field-label" htmlFor="asset-name">名称</label><Input id="asset-name" autoFocus {...form.register('name')} /></>}
    {importing && <><label className="field-label" htmlFor="asset-kind">类型</label><SelectField id="asset-kind" value={form.watch('kind')} onChange={(event) => form.setValue('kind', editorSchema.shape.kind.parse(event.target.value), { shouldDirty: true })}><SelectOption value="auto">自动识别</SelectOption><SelectOption value="image">图片</SelectOption><SelectOption value="video">视频</SelectOption><SelectOption value="audio">音频</SelectOption></SelectField></>}
    {!asset && <><label className="field-label" htmlFor="asset-project">所属项目</label><SelectField id="asset-project" value={form.watch('projectId') ?? ''} onChange={(event) => {
      form.setValue('projectId', event.target.value || null, { shouldDirty: true })
      form.setValue('categoryId', null, { shouldDirty: true })
    }}>
      <SelectOption value="">公共素材</SelectOption>{projects.map((project) => <SelectOption key={project.id} value={project.id}>{project.name}</SelectOption>)}</SelectField></>}
    <label className="field-label" htmlFor="asset-category">文件夹</label><SelectField id="asset-category" value={form.watch('categoryId') ?? ''} onChange={(event) => form.setValue('categoryId', event.target.value || null, { shouldDirty: true })}>
      <SelectOption value="">根目录</SelectOption>{folderOptions(categories).map((category) => <SelectOption key={category.id} value={category.id}>{category.path}</SelectOption>)}</SelectField>
    <label className="field-label" htmlFor="asset-tags">标签</label><Input id="asset-tags" value={tagsText} onChange={(event) => {
      setTagsText(event.target.value)
      form.setValue('tags', [...new Set(event.target.value.split(/[,，]/).map((value) => value.trim()).filter(Boolean))], { shouldDirty: true })
    }} />
    <label className="field-label" htmlFor="asset-prompt">{form.watch('kind') === 'prompt' ? '提示词' : '关联提示词'}</label><Textarea id="asset-prompt" rows={6} {...form.register('prompt')} />
    <label className="field-label" htmlFor="asset-notes">备注</label><Textarea id="asset-notes" rows={3} {...form.register('notes')} />
    {(error || Object.keys(form.formState.errors).length > 0) && <p role="alert" className="field-error">{error || '请检查名称、分类、标签或文本长度'}</p>}
    <div className="dialog-actions"><Button variant="outline" onClick={async () => { if (!isDirty || (await confirmAction('放弃未保存的素材信息？'))) onClose() }}>取消</Button><Button type="submit">{form.formState.isSubmitting ? '处理中' : importing ? '选择文件并导入' : '保存'}</Button></div>
  </fieldset></form></Dialog>
}

export function mediaImport(value: EditorValue): ImportAssets | AutoImportAssets {
  if (value.kind === 'prompt') throw new Error('请选择媒体类型')
  return { projectId: value.projectId, categoryId: value.categoryId, kind: value.kind, tags: value.tags, prompt: value.prompt, notes: value.notes }
}
