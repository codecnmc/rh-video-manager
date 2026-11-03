import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faClock, faSliders, faTrash } from '@fortawesome/free-solid-svg-icons'
import { generationTimingSampleSchema, type GenerationTimingSample } from '@contracts/video'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { estimateGenerationTime, formatGenerationTime, matchesTimingConfiguration, type TimingConfiguration } from './generation-estimate'

interface GenerationEstimateProps {
  config: TimingConfiguration
  samples: GenerationTimingSample[] | undefined
  ready: boolean
  disabled: boolean
  onChange: (samples: GenerationTimingSample[]) => void
}

function TimingCalibration({ config, samples, onChange, onClose }: Omit<GenerationEstimateProps, 'ready' | 'disabled'> & { onClose: () => void }) {
  const existing = samples ? [...samples].reverse().find((sample) => matchesTimingConfiguration(sample, config)) : undefined
  const [workflowLabel, setWorkflowLabel] = useState(existing?.workflowLabel ?? '')
  const [duration, setDuration] = useState(String(existing?.duration ?? config.duration))
  const [minimum, setMinimum] = useState(existing ? String(existing.minSeconds) : '')
  const [maximum, setMaximum] = useState(existing ? String(existing.maxSeconds) : '')
  const [error, setError] = useState('')
  const others = (samples ?? []).filter((sample) => !matchesTimingConfiguration(sample, config))

  return <Dialog title="实测耗时基准" onClose={onClose}><form onSubmit={(event) => {
    event.preventDefault()
    const result = generationTimingSampleSchema.safeParse({ ...config, workflowLabel, duration: Number(duration), minSeconds: Number(minimum), maxSeconds: Number(maximum) })
    if (!result.success) { setError(result.error.issues[0]?.message ?? '请检查基准数据'); return }
    if (others.length >= 20) { setError('当前草稿最多保存 20 组耗时基准'); return }
    onChange([...others, result.data]); onClose()
  }}>
    <p className="dialog-context">{config.resolution} · {config.aspectRatio} · {config.instance === 'default' ? 'Lite' : config.instance === 'plus' ? 'Plus' : 'Ultra'} · {config.images} 图 / {config.videos} 视频 / {config.audio} 音频</p>
    <label className="field-label" htmlFor="timing-workflow">实测工作流 / 版本</label><Input id="timing-workflow" value={workflowLabel} maxLength={100} required onChange={(event) => setWorkflowLabel(event.target.value)} />
    <label className="field-label" htmlFor="timing-duration">样本成片时长（秒）</label><Input id="timing-duration" type="number" min={4} max={15} step={1} value={duration} required onChange={(event) => setDuration(event.target.value)} />
    <div className="timing-calibration-grid"><label className="field-label">最短生成耗时（秒）<Input type="number" min={1} max={86400} step={1} value={minimum} required onChange={(event) => setMinimum(event.target.value)} /></label>
      <label className="field-label">最长生成耗时（秒）<Input type="number" min={1} max={86400} step={1} value={maximum} required onChange={(event) => setMaximum(event.target.value)} /></label></div>
    <p className="dialog-context">仅记录该工作流实际运行耗时，不含上传、排队、冷启动和下载。更换工作流或采样设置后需重新标定。</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="dialog-actions">{existing && <Button variant="danger" onClick={() => { onChange(others); onClose() }}><FontAwesomeIcon icon={faTrash} />清除基准</Button>}
      <Button variant="outline" onClick={onClose}>取消</Button><Button type="submit">应用到草稿</Button></div>
  </form></Dialog>
}

export function GenerationEstimate({ config, samples, ready, disabled, onChange }: GenerationEstimateProps) {
  const [calibrating, setCalibrating] = useState(false)
  const estimate = ready ? estimateGenerationTime(config, samples) : null
  const time = estimate ? estimate.minSeconds === estimate.maxSeconds ? formatGenerationTime(estimate.maxSeconds)
    : `${formatGenerationTime(estimate.minSeconds)} – ${formatGenerationTime(estimate.maxSeconds)}` : '待标定'
  return <div className="generation-estimate">
    <div className="estimate-heading"><span><FontAwesomeIcon icon={faClock} />预估生成耗时</span>
      <Button variant="ghost" size="icon" title="配置当前工作流实测耗时基准" aria-label="配置实测耗时基准" disabled={disabled || !ready || !Number.isInteger(config.duration) || config.duration < 4 || config.duration > 15} onClick={() => setCalibrating(true)}><FontAwesomeIcon icon={faSliders} /></Button></div>
    <div className="estimate-value" role="status" aria-live="polite"><strong>{ready ? `${estimate ? '约 ' : ''}${time}` : '参考素材读取中'}</strong><span>排队时间未知</span></div>
    <small title={estimate ? `基于 ${estimate.workflowLabel} 的实测数据；不是平台承诺，工作流与采样配置须保持一致` : 'RunningHub 未提供提交前 ETA；Lite / Plus / Ultra 的显存容量不能直接换算运行速度'}>
      {estimate ? `${estimate.scaled ? '按时长线性参考' : '实测范围参考'} · 不含排队与冷启动` : '暂无当前配置的实测基准'}</small>
    {calibrating && <TimingCalibration config={config} samples={samples} onChange={onChange} onClose={() => setCalibrating(false)} />}
  </div>
}
