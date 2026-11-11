import { SelectOption } from '@/components/ui/select-field'
import { confirmAction } from '@/components/ui/confirmation'
import { SelectField } from '@/components/ui/select-field'
import { Input } from '@/components/ui/input'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlug, faStop, faCopy, faFolderOpen } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { desktop, unwrap } from '@/shared/lib/desktop'
import type { AssetMcpPreferences } from '@contracts/mcp'
import { mcpAuthorizationSummary } from './authorization-summary'
import './mcp.css'

export function AssetMcpPanel({ projectId, projects, onNotice }: {
  projectId: string | null; projects: { id: string; name: string }[]; onNotice: (message: string) => void
}) {
  const client = useQueryClient()
  const status = useQuery({ queryKey: ['asset-mcp'], queryFn: async () => unwrap(await desktop().assetMcpStatus()), retry: false, refetchInterval: 3000 })
  const preferences = useQuery({ queryKey: ['asset-mcp-preferences'], queryFn: async () => unwrap(await desktop().assetMcpPreferences()), retry: false })
  const [form, setForm] = useState<AssetMcpPreferences | null>(null)
  const [minutes, setMinutes] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState('')
  const current = status.data
  const draft = form ?? preferences.data
  const project = draft?.projectId ?? projectId ?? ''
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try {
      await action()
      await Promise.all([client.invalidateQueries({ queryKey: ['asset-mcp'] }), client.invalidateQueries({ queryKey: ['asset-mcp-preferences'] })])
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'MCP 操作失败') } finally { setBusy(false) }
  }
  return <section className="management-page"><div className="management-toolbar"><h2>素材、视频草稿、剧本与排片 MCP</h2><span className={current?.enabled ? 'text-success' : 'muted'}>{current?.enabled ? '已开启' : '已关闭'}</span></div>
    {current?.enabled ? <div className="mcp-status"><dl>
      <dt>授权范围</dt><dd>{current.allProjects ? '全部项目及公共素材' : projects.find((item) => item.id === current.projectId)?.name ?? '项目不可用'}</dd>
      <dt>本机地址</dt><dd>{current.url}</dd><dt>权限</dt><dd>{current.writeEnabled ? '素材、视频草稿读写与分类管理' : '只读素材和视频草稿'}</dd>
      <dt>公共音色</dt><dd>{current.publicVoicesEnabled ? '只读' : '未授权'}</dd>
      <dt>剧本库</dt><dd>{current.scriptLibraryEnabled ? current.writeEnabled ? '授权项目内读写（不含删除）' : '授权项目内只读' : '未授权'}</dd>
      <dt>排片剪辑库</dt><dd>{current.assemblyEnabled ? current.writeEnabled ? '授权项目内读写（不含工程删除、生成或导出）' : '授权项目内只读' : '未授权'}</dd>
      <dt>素材生成</dt><dd>{current.imageGenerationEnabled ? current.writeEnabled ? '查询、诊断、创建待提交节点及恢复已有图片下载（不含生图提交）' : '只读任务、结果及脱敏网络诊断' : '未授权'}</dd>
      <dt>生图提交</dt><dd>{current.imageSubmissionEnabled ? '允许自动排队执行、切换空闲账号；不逐次确认，可能消耗服务额度' : '未授权'}</dd>
      <dt>授权目录</dt><dd>{current.importDirectory || '未授权'}</dd><dt>到期时间</dt><dd>{current.expiresAt ? new Date(current.expiresAt).toLocaleString('zh-CN') : '不限时（关闭连接或退出应用后失效）'}</dd>
      </dl>
      <div className="button-row"><Button variant="outline" disabled={busy} onClick={() => void act(async () => { unwrap(await desktop().copyAssetMcpConfig()); onNotice('连接配置已复制，包含固定访问令牌，请妥善保管') })}><FontAwesomeIcon icon={faCopy} />复制连接配置</Button>
        <Button variant="danger" disabled={busy} onClick={() => void act(async () => { unwrap(await desktop().stopAssetMcp()) })}><FontAwesomeIcon icon={faStop} />关闭连接</Button></div></div>
      : <form className="mcp-form" onSubmit={(event) => {
        event.preventDefault()
        void act(async () => {
          if (!draft) return
          const duration = Number(minutes ?? draft.minutes)
          const projectName = projects.find((item) => item.id === project)?.name ?? '所选项目'
          if (!(await confirmAction(mcpAuthorizationSummary(draft, projectName, duration)))) return
          unwrap(await desktop().startAssetMcp({ projectId: draft.allProjects ? null : project, allProjects: draft.allProjects,
            publicVoicesEnabled: draft.publicVoicesEnabled, writeEnabled: draft.writeEnabled, minutes: duration, scriptLibraryEnabled: draft.scriptLibraryEnabled, assemblyEnabled: draft.assemblyEnabled, imageGenerationEnabled: draft.imageGenerationEnabled, imageSubmissionEnabled: draft.imageSubmissionEnabled,
            ...(token ? { token } : {}) }))
          setToken('')
        })
      }}><fieldset disabled={busy || status.isPending || !draft}>
        <div className="mcp-field"><label className="field-label" htmlFor="mcp-project">授权范围</label><SelectField id="mcp-project" required value={draft?.allProjects ? '__all__' : project} onChange={(event) => {
          if (draft) setForm({ ...draft, allProjects: event.target.value === '__all__', projectId: event.target.value === '__all__' ? null : event.target.value || null })
        }}><SelectOption value="">选择项目</SelectOption><SelectOption value="__all__">全部项目及公共素材</SelectOption>{projects.map((item) => <SelectOption key={item.id} value={item.id}>{item.name}</SelectOption>)}</SelectField></div>
        <div className="mcp-field"><label className="field-label" htmlFor="mcp-minutes">有效期（分钟，-1 为不限时）</label><Input id="mcp-minutes" type="number" min={-1} max={120} step={1} required value={minutes ?? String(draft?.minutes ?? 60)} onChange={(event) => setMinutes(event.target.value)} /></div>
        <div className="mcp-field"><label className="field-label" htmlFor="mcp-token">替换固定令牌（可选）</label><Input id="mcp-token" type="password" autoComplete="new-password" minLength={32} maxLength={128} pattern="[A-Za-z0-9_-]+" value={token} placeholder="留空沿用；首次开启自动生成" onChange={(event) => setToken(event.target.value)} /></div>
        <div className="mcp-field"><label className="field-label" htmlFor="mcp-directory">导入目录</label><div className="mcp-directory-row"><Input id="mcp-directory" readOnly value={draft?.importDirectory ?? ''} title={draft?.importDirectory || undefined} placeholder="未选择" />
        <Button type="button" variant="outline" onClick={() => void act(async () => {
          const saved = unwrap(await desktop().chooseAssetMcpDirectory())
          client.setQueryData(['asset-mcp-preferences'], saved)
          setForm(previous => previous ? { ...previous, importDirectory: saved.importDirectory } : null)
        })}><FontAwesomeIcon icon={faFolderOpen} />{draft?.importDirectory ? '更换目录' : '选择目录'}</Button></div></div>
        <label className="checkbox-label"><CheckboxField checked={draft?.writeEnabled ?? false} onChange={(event) => { if (draft) setForm({ ...draft, writeEnabled: event.target.checked, imageSubmissionEnabled: event.target.checked && draft.imageSubmissionEnabled }) }} />允许素材和视频草稿读写、引用绑定与分类管理</label>
        <label className="checkbox-label"><CheckboxField checked={draft?.publicVoicesEnabled ?? false} onChange={(event) => { if (draft) setForm({ ...draft, publicVoicesEnabled: event.target.checked }) }} />公共音色库（独立只读授权，所有项目共享）</label>
        <label className="checkbox-label"><CheckboxField checked={draft?.scriptLibraryEnabled ?? false} onChange={(event) => { if (draft) setForm({ ...draft, scriptLibraryEnabled: event.target.checked }) }} />授权范围内的剧本库（随当前读写权限，不含删除）</label>
        <label className="checkbox-label"><CheckboxField checked={draft?.assemblyEnabled ?? false} onChange={(event) => { if (draft) setForm({ ...draft, assemblyEnabled: event.target.checked }) }} />授权范围内的排片剪辑库（随当前读写权限，不含工程删除、生成或导出）</label>
        <label className="checkbox-label"><CheckboxField checked={draft?.imageGenerationEnabled ?? false} onChange={(event) => { if (draft) setForm({ ...draft, imageGenerationEnabled: event.target.checked, imageSubmissionEnabled: event.target.checked && draft.imageSubmissionEnabled }) }} />素材生成（查询与诊断；写权限可创建节点、恢复已有图片下载）</label>
        <label className="checkbox-label"><CheckboxField checked={draft?.imageSubmissionEnabled ?? false} disabled={!draft?.writeEnabled || !draft.imageGenerationEnabled} onChange={(event) => { if (draft) setForm({ ...draft, imageSubmissionEnabled: event.target.checked }) }} />允许 MCP 提交生图（自动排队及账号调度，不逐次确认，可能消耗服务额度）</label>
        <div className="dialog-actions"><Button type="submit" disabled={!draft || !draft.allProjects && (!project || !projects.some((item) => item.id === project))}><FontAwesomeIcon icon={faPlug} />开启连接</Button></div>
      </fieldset></form>}
    {(error || status.error || preferences.error || current?.startupError) && <p role="alert" className="field-error">{error || status.error?.message || preferences.error?.message || current?.startupError}</p>}
  </section>
}
