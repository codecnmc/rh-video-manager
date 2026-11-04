import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFolderOpen, faUsers, faVideo, faImages, faDiagramProject, faListCheck, faPlug, faImage, faXmark } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { AnchoredGuide } from '@/components/ui/anchored-guide'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { usePreferences } from './use-preferences'

export type GuideView = 'video' | 'assets' | 'accounts' | 'workflows' | 'image-generation' | 'tasks' | 'mcp'
const steps: { view: GuideView; target: string; title: string; icon: typeof faVideo; text: string }[] = [
  { view: 'video', target: 'new-project', title: '新建项目', icon: faFolderOpen, text: '这里创建项目，再在视频生成页新建视频草稿。引导不会替你创建示例数据；没有项目时也可以先了解后续入口。' },
  { view: 'assets', target: 'assets', title: '素材库', icon: faImages, text: '已切到素材库。导入本地图片、视频和音频只会保存到本地，不会立即上传。双击素材可预览，右键素材或文件夹可复制、编辑和移动。' },
  { view: 'accounts', target: 'accounts', title: '账号池', icon: faUsers, text: '已切到账号池。在这里添加 RunningHub 账号，API Key 加密保存在本机。消费明细入口可查看成功任务耗币，平台未返回的费用显示为未知。' },
  { view: 'workflows', target: 'workflows', title: '工作流总览', icon: faDiagramProject, text: '已切到工作流总览。工作流必须归属具体账号；提交生成前需要配置并明确选择账号和工作流，引导不会自动配置或发起生成。' },
  { view: 'video', target: 'video', title: '视频生成', icon: faVideo, text: '已切到视频生成。右键草稿可复制、多选或排序；右键参考素材名称可替换、插入引用和解除关联。保存草稿不产生生成费用，确认提交后才上传素材并消耗平台额度。' },
  { view: 'image-generation', target: 'image-generation', title: '素材生成', icon: faImage, text: '已切到素材生成。进入任务组后可使用画布：右键插入素材或新建任务，拖动连线绑定参考，底部工具栏可查看操作说明。引导不会创建任务或提交付费请求。' },
  { view: 'tasks', target: 'tasks', title: '任务队列', icon: faListCheck, text: '已切到任务队列。提交后在这里查看任务进度和结果；也可以点击窗口底部的任务队列入口。生成状态与下载状态独立，请勿因等待结果而重复提交。' },
  { view: 'mcp', target: 'mcp', title: '可选的 MCP 授权', icon: faPlug, text: '已切到 MCP。仅在需要外部工具访问时配置授权范围和读写权限，引导不会替你开启服务或扩大授权。以后可在设置中重新打开本引导。' }
]

export function FirstUseGuide({ autoStart, requested, onClose, onNavigate, activeView }: {
  autoStart: boolean; requested: boolean; onClose: () => void; onNavigate: (view: GuideView) => Promise<boolean>; activeView: string
}) {
  const preferences = usePreferences()
  const client = useQueryClient()
  const [step, setStep] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [moving, setMoving] = useState(false)
  const [located, setLocated] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [locationRevision, setLocationRevision] = useState(0)
  const [error, setError] = useState('')
  const savingRef = useRef(false)
  const movingRef = useRef(false)
  const pendingStep = useRef(0)
  const mounted = useRef(true)
  const originalFocus = useRef<HTMLElement | null>(null)
  const navigateRef = useRef(onNavigate)
  navigateRef.current = onNavigate
  const open = requested || (autoStart && preferences.isSuccess && (preferences.data.onboardingVersion ?? 0) < 1 && !dismissed)
  const current = steps[step]!
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function move(next: number) {
    if (movingRef.current || savingRef.current) return
    movingRef.current = true
    pendingStep.current = next
    setMoving(true); setError(''); setLocated(false); setTarget(null)
    try {
      if (!await navigateRef.current(steps[next]!.view)) {
        if (mounted.current) setError('尚未切换页面，当前修改已保留。请先处理未保存内容，再点击重新定位。')
        return
      }
      if (mounted.current) { setStep(next); setLocated(true); setLocationRevision((value) => value + 1) }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : '页面定位失败，请重试')
    } finally { movingRef.current = false; if (mounted.current) setMoving(false) }
  }
  const moveRef = useRef(move)
  moveRef.current = move
  useEffect(() => {
    if (!open) return
    originalFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void moveRef.current(0)
    return () => {
      if (originalFocus.current?.isConnected) originalFocus.current.focus({ preventScroll: true })
    }
  }, [open])
  useEffect(() => {
    if (!open || !located) return
    // 切页后等 React 提交目标入口，找不到时明确提示而不是跳到错误位置。
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(`[data-guide-target="${current.target}"]`)
      setTarget(element)
      if (!element) { setLocated(false); setError('当前入口尚未显示，请点击重新定位。') }
    })
    return () => cancelAnimationFrame(frame)
  }, [open, located, current.target, locationRevision])
  useEffect(() => {
    if (!open || !located || movingRef.current || activeView === current.view) return
    setTarget(null); setLocated(false)
    setError('页面已手动切换，点击重新定位可回到本步骤。')
  }, [open, located, activeView, current.view])
  async function finish() {
    if (savingRef.current || movingRef.current) return
    savingRef.current = true
    setSaving(true); setError('')
    try {
      const saved = unwrap(await desktop().saveAppPreferences({ onboardingVersion: 1 }))
      client.setQueryData(['app-preferences'], saved)
      const focus = originalFocus.current?.isConnected ? originalFocus.current : target
      setDismissed(true); setStep(0); setTarget(null); setLocated(false); onClose()
      requestAnimationFrame(() => { if (focus?.isConnected) focus.focus({ preventScroll: true }) })
    } catch (failure) { setError(failure instanceof Error ? failure.message : '引导状态保存失败，请重试') }
    finally { savingRef.current = false; setSaving(false) }
  }
  if (!open) return null
  return <AnchoredGuide target={target} onDismiss={() => void finish()}><div className="guide-heading"><span className="muted">首次使用 · {step + 1} / {steps.length}</span>
    <Button variant="ghost" size="icon" title="结束引导" aria-label="结束引导" disabled={moving || saving} onClick={() => void finish()}><FontAwesomeIcon icon={faXmark} /></Button></div>
    <section className="guide-step" aria-live="polite"><h3><FontAwesomeIcon icon={current.icon} />{current.title}</h3><p id="first-use-guide-description">{moving ? '正在切换并定位页面…' : located ? current.text : '请完成页面切换后继续引导。'}</p></section>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dialog-actions"><Button variant="ghost" disabled={saving || moving} onClick={() => void finish()}>跳过</Button>
      <Button variant="outline" disabled={saving || moving || step === 0} onClick={() => void move(step - 1)}>上一步</Button>
      <Button data-guide-next disabled={saving || moving} onClick={() => { if (!located) void move(pendingStep.current); else if (step === steps.length - 1) void finish(); else void move(step + 1) }}>{saving ? '保存中' : !located ? '重新定位' : step === steps.length - 1 ? '完成' : '下一步'}</Button>
    </div>
  </AnchoredGuide>
}
