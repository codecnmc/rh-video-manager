import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { imageNodeFieldsSchema, type ImageNode } from '@contracts/image-generation'
import type { Asset } from '@contracts/assets'
import { ImageComposer } from './ImageComposer'
import { editableImageTask } from './canvas-model'
import { sameImageTaskFields, taskSessionDirty, type ImageTaskSession, type ImageTaskFields } from './task-editor-state'
import type { ImageGenerationController } from './use-image-generation'
import { canRegenerateImageTask } from './task-versions'

export function ImageTaskEditor({ session, node, control, assets, externalChanges, onReload, onFields, onSave, onClose, onAddReferences, onPasteImages, onPreview }: {
  session: ImageTaskSession; node: ImageNode | null; control: ImageGenerationController; assets: Asset[];
  externalChanges: boolean; onReload: () => void;
  onFields: (id: string, fields: ImageTaskFields) => void; onSave: (id: string, fields: ImageTaskFields, generate: boolean) => Promise<void>;
  onClose: () => void; onAddReferences: () => void; onPasteImages: (files: File[]) => void;
  onPreview: (asset: Asset) => void
}) {
  const form = useForm<ImageTaskFields>({ resolver: zodResolver(imageNodeFieldsSchema), defaultValues: session.fields })
  useEffect(() => {
    const subscription = form.watch(() => onFields(session.id, form.getValues()))
    return () => subscription.unsubscribe()
  }, [form, session.id, onFields])
  useEffect(() => {
    // 自动保存仅推进基准修订；值未变化时不重置输入、光标、选区和输入法状态。
    if (!sameImageTaskFields(form.getValues(), session.fields)) form.reset(session.fields)
  }, [session.base, form])
  useEffect(() => {
    if (JSON.stringify(form.getValues('references')) === JSON.stringify(session.fields.references)) return
    form.setValue('references', session.fields.references, { shouldDirty: true, shouldValidate: true })
  }, [session.fields.references, form])
  const save = (generate: boolean) => { void form.handleSubmit((fields) => onSave(session.id, fields, generate))() }
  return <ImageComposer form={form} node={node} accounts={control.accounts.data ?? []} assets={assets}
    readOnly={externalChanges || Boolean(node && !editableImageTask(node) && !canRegenerateImageTask(node))} dirty={taskSessionDirty(session)} control={control}
    externalChanges={externalChanges} onReload={onReload}
    onSave={() => save(false)} onGenerate={() => save(true)} onClose={onClose} onAddReferences={onAddReferences}
    onRemoveReference={(id) => form.setValue('references', form.getValues('references').filter((reference) => reference.assetId !== id), { shouldDirty: true })}
    onMoveReference={(index, offset) => {
      const references = [...form.getValues('references')]
      const target = index + offset
      if (target < 0 || target >= references.length) return
      const item = references.splice(index, 1)[0]!
      references.splice(target, 0, item)
      form.setValue('references', references, { shouldDirty: true })
    }}
    onPasteImages={onPasteImages} onPreview={onPreview} />
}
