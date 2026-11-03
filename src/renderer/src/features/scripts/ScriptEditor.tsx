import { Textarea } from '@/components/ui/textarea'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import type { Episode } from '@contracts/workspace'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { ExtensionTools } from '@/features/extensions'

export function ScriptEditor({ episode, projectId, saving, onSave, onDirty }: {
  episode: Episode; projectId: string; saving: boolean; onSave: (script: string) => Promise<void>; onDirty: (dirty: boolean) => void
}) {
  const form = useForm({ defaultValues: { script: episode.script } })
  const { isDirty } = form.formState
  useEffect(() => form.reset({ script: episode.script }), [episode.script, form])
  useEffect(() => onDirty(isDirty), [isDirty, onDirty])
  return <form className="script-pane" onSubmit={form.handleSubmit(async ({ script }) => { await onSave(script).catch(() => undefined) })}>
    <div className="pane-toolbar"><div><h2>{episode.title}</h2><span className="muted">剧本正文</span></div>
      <div className="button-row"><ExtensionTools context={{ kind: 'script', projectId, entityId: episode.id, text: form.watch('script') }} disabled={saving}
        onApply={(text) => form.setValue('script', text, { shouldDirty: true, shouldValidate: true })} />
        <Button type="submit" disabled={!isDirty || saving}><FontAwesomeIcon icon={faFloppyDisk} />保存剧本</Button></div></div>
    <Textarea aria-label="剧本正文" className="script-editor" disabled={saving} placeholder="" {...form.register('script', { maxLength: 200000 })} />
    <div className="script-footer"><span>{isDirty ? '未保存' : '已保存'}</span><span>{form.watch('script').length.toLocaleString()} 字</span></div>
  </form>
}
