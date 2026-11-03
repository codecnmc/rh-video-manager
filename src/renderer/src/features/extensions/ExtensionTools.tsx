import { SelectOption } from '@/components/ui/select-field'
import { SelectField } from '@/components/ui/select-field'
import { Textarea } from '@/components/ui/textarea'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPuzzlePiece, faPlay, faCheck } from '@fortawesome/free-solid-svg-icons'
import type { ExtensionDocumentContext, ExtensionProposal } from '@contracts/extensions'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { useExtensions } from './use-extensions'
import './extension-tools.css'

export function ExtensionTools({ context, disabled, onApply }: {
  context: ExtensionDocumentContext; disabled: boolean; onApply: (text: string) => void
}) {
  const extensions = useExtensions()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [proposal, setProposal] = useState<ExtensionProposal>(null)
  const [base, setBase] = useState<ExtensionDocumentContext | null>(null)
  const choices = (extensions.data ?? []).flatMap((extension) => {
    const commands = extension.manifest.contributes.commands.filter((command) => command.contexts?.includes(context.kind))
    return commands.map((command) => ({ id: `${extension.id}/${command.id}`, extensionId: extension.id, command: command.id,
      title: extension.manifest.contributes.views?.find((view) => view.command === command.id && view.location === context.kind)?.title ?? command.title,
      enabled: extension.enabled && extension.configured }))
  })
  const selected = choices.find((item) => item.id === choice)
  const stale = base && (base.entityId !== context.entityId || base.projectId !== context.projectId || base.text !== context.text)
  return <>
    <Button variant="outline" size="small" disabled={disabled} title="当前文档的插件工具" onClick={() => { setOpen(true); setError('') }}><FontAwesomeIcon icon={faPuzzlePiece} />插件工具</Button>
    {open && <Dialog title={proposal?.title ?? '插件工具'} className="extension-tool-dialog" onClose={() => { if (!busy) setOpen(false) }}>
      <div className="extension-tool-controls"><label>文档工具<SelectField value={choice} disabled={busy} onChange={(event) => { setChoice(event.target.value); setProposal(null); setError('') }}>
        <SelectOption value="">选择插件工具</SelectOption>{choices.map((item) => <SelectOption key={item.id} value={item.id} disabled={!item.enabled}>{item.title}{!item.enabled ? ' · 未启用或未配置' : ''}</SelectOption>)}</SelectField></label>
        <Button disabled={busy || !selected?.enabled} onClick={() => {
          if (!selected) return
          const snapshot = { ...context }
          setBusy(true); setError(''); setProposal(null); setBase(snapshot)
          void desktop().runExtensionContextCommand({ id: selected.extensionId, command: selected.command, context: snapshot })
            .then((result) => { const value = unwrap(result); setProposal(value); if (!value) setError('未返回修改建议') })
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : '插件调用失败'))
            .finally(() => setBusy(false))
        }}><FontAwesomeIcon icon={faPlay} />{busy ? '执行中' : '运行'}</Button></div>
      {!choices.length && <p className="muted">暂无适用于此文档的插件工具</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {proposal && <><div className="extension-proposal-columns"><label>输入快照<Textarea readOnly value={base?.text ?? ''} rows={14} /></label>
        <label>修改建议<Textarea value={proposal.text} rows={14} maxLength={context.kind === 'draft' ? 50000 : 200000} onChange={(event) => setProposal({ ...proposal, text: event.target.value })} /></label></div>
        {stale && <p className="field-error">原文已变化，请重新运行工具</p>}
        {context.kind === 'draft' && proposal.text.length > 50000 && <p className="field-error">修改建议超过视频提示词长度上限</p>}
        <div className="dialog-actions"><Button disabled={Boolean(stale) || (context.kind === 'draft' && proposal.text.length > 50000)} onClick={() => {
          onApply(proposal.text); setOpen(false); setProposal(null)
        }}><FontAwesomeIcon icon={faCheck} />应用到编辑器</Button></div></>}
    </Dialog>}
  </>
}
