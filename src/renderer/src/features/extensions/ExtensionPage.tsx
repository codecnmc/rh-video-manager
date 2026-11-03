import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay, faImages, faXmark, faCopy } from '@fortawesome/free-solid-svg-icons'
import { extensionPageRequestSchema, type ExtensionPageRequest, type ExtensionProposal, type InstalledExtension } from '@contracts/extensions'
import type { Asset } from '@contracts/assets'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AssetPicker } from '@/features/assets'
import { MarkdownPreview } from '@/shared/components/MarkdownPreview'
import { desktop, unwrap } from '@/shared/lib/desktop'
import './extension-page.css'

export function ExtensionPage({ extension, pageId, projectId, onDirty, onNotice }: {
  extension: InstalledExtension | undefined; pageId: string | null; projectId: string | null;
  onDirty: (dirty: boolean) => void; onNotice: (message: string) => void
}) {
  const page = extension?.manifest.contributes.pages?.find((item) => item.id === pageId)
  const form = useForm<ExtensionPageRequest>({ resolver: zodResolver(extensionPageRequestSchema), defaultValues: {
    id: extension?.id ?? '', pageId: pageId ?? '', projectId, text: '', assetIds: []
  } })
  const [assets, setAssets] = useState<Asset[]>([])
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [result, setResult] = useState<ExtensionProposal>(null)
  const [error, setError] = useState('')
  useEffect(() => { onDirty(form.formState.isDirty || busy || Boolean(result)) }, [form.formState.isDirty, busy, result, onDirty])
  if (!extension?.enabled || !page) return <div className="management-empty">插件页面已停用或卸载</div>
  return <section className="extension-page"><header className="pane-toolbar"><div><h2>{page.title}</h2><span className="muted">{extension.manifest.displayName}</span></div></header>
    <form className="extension-page-input" onSubmit={form.handleSubmit(async (input) => {
      if (running.current) return
      running.current = true; setBusy(true); setError(''); setResult(null)
      try { setResult(unwrap(await desktop().runExtensionPage(input))) }
      catch (failure) { setError(failure instanceof Error ? failure.message : '插件执行失败') }
      finally { running.current = false; setBusy(false) }
    })}><label className="field-label" htmlFor="extension-page-text">{page.inputLabel ?? '输入'}</label>
      <Textarea id="extension-page-text" rows={8} maxLength={200000} disabled={busy} {...form.register('text')} />
      <div className="extension-page-assets">{assets.map((asset) => <div key={asset.id}><span>{asset.name}</span><Button variant="ghost" size="icon" title={`移除引用：${asset.name}`} aria-label={`移除引用：${asset.name}`} disabled={busy} onClick={() => {
        const next = assets.filter((item) => item.id !== asset.id); setAssets(next); form.setValue('assetIds', next.map((item) => item.id), { shouldDirty: true, shouldValidate: true })
      }}><FontAwesomeIcon icon={faXmark} /></Button></div>)}</div>
      <div className="button-row">{page.acceptsAssets && <Button variant="outline" disabled={busy || assets.length >= 20} onClick={() => setPicking(true)}><FontAwesomeIcon icon={faImages} />引用素材</Button>}
        <Button type="submit" disabled={busy || !extension.configured}><FontAwesomeIcon icon={faPlay} />{busy ? '执行中' : '运行'}</Button>
        {!extension.configured && <span className="muted">请先完成插件配置</span>}</div>
      {(error || Object.keys(form.formState.errors).length > 0) && <p className="field-error" role="alert">{error || '输入格式不正确，请检查文字长度和素材引用'}</p>}
    </form>
    {result && <section className="extension-page-result"><div className="pane-toolbar"><h3>{result.title}</h3><Button variant="ghost" size="icon" title="复制结果" aria-label="复制结果" onClick={() => { void navigator.clipboard.writeText(result.text).then(() => onNotice('结果已复制')).catch(() => onNotice('复制失败')) }}><FontAwesomeIcon icon={faCopy} /></Button></div><MarkdownPreview markdown={result.text} /></section>}
    {picking && <AssetPicker projectId={projectId} onClose={() => setPicking(false)} onPick={async (asset) => {
      if (assets.some((item) => item.id === asset.id)) throw new Error('该素材已引用')
      if (assets.length >= 20) throw new Error('最多引用 20 个素材')
      const next = [...assets, asset]; setAssets(next); form.setValue('assetIds', next.map((item) => item.id), { shouldDirty: true, shouldValidate: true })
    }} />}
  </section>
}
