import { Button } from '@/components/ui/button'
import { useDialogPreview } from './use-dialog-preview'

export function DialogDebug({ onNotice }: { onNotice: (message: string) => void }) {
  const preview = useDialogPreview(onNotice)
  return <section className="settings-section"><h3>提示调试 · 仅开发模式</h3>
    <p className="muted settings-storage-notice">预览真实提示界面。点击“退出”或“放弃修改”只结束预览，不会退出、丢弃编辑或操作任务。</p>
    <div className="button-row settings-storage-actions">
      <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate('task-exit')}>预览任务退出</Button>
      <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate('task-window')}>预览关闭单窗</Button>
      <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate('fallback-exit')}>预览退出回退窗口</Button>
      <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate('unsaved')}>预览未保存提示</Button>
      <Button variant="outline" disabled={preview.isPending} onClick={() => preview.mutate('startup-error')}>预览启动失败</Button>
    </div>
    {preview.error && <p className="field-error" role="alert">{preview.error.message}</p>}
  </section>
}
