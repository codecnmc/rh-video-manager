import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheckCircle, faFileExport, faFolderOpen, faStop, faXmark } from '@fortawesome/free-solid-svg-icons'
import { assemblyExportOptionsSchema, type AssemblyExportOptions, type AssemblyExportProgress } from '@contracts/assembly-export'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SelectField, SelectOption } from '@/components/ui/select-field'
import { Dialog } from '@/components/ui/dialog'

const stages: Record<AssemblyExportProgress['stage'], string> = {
  preparing: '准备导出', probing: '检查素材', rendering: '处理片段', joining: '拼接转场', mixing: '混合声音',
  captions: '烧录字幕', finalizing: '写入成片', completed: '导出完成', cancelled: '已取消', failed: '导出失败'
}
const selects = [
  { name: 'resolution', label: '分辨率', values: [['project', '跟随工程'], ['720p', '720p'], ['1080p', '1080p'], ['2160p', '2160p / 4K']] },
  { name: 'frameRate', label: '帧率', values: [['project', '跟随工程'], ['24', '24 fps'], ['25', '25 fps'], ['30', '30 fps'], ['60', '60 fps']] },
  { name: 'preset', label: '编码速度', values: [['ultrafast', '极速'], ['veryfast', '较快'], ['fast', '快速'], ['medium', '标准'], ['slow', '较慢']] },
  { name: 'audioBitrate', label: '音频码率', values: [['128k', '128 kbps'], ['192k', '192 kbps'], ['256k', '256 kbps'], ['320k', '320 kbps']] },
  { name: 'captions', label: '普通字幕烧录', values: [['project', '跟随工程'], ['on', '烧录'], ['off', '不烧录']] }
] as const

export function AssemblyExportSettings({ initial, onClose, onConfirm }: {
  initial: AssemblyExportOptions; onClose: () => void; onConfirm: (options: AssemblyExportOptions) => void
}) {
  const form = useForm<AssemblyExportOptions>({ resolver: zodResolver(assemblyExportOptionsSchema), defaultValues: initial })
  return <Dialog title="导出设置" onClose={onClose}><form className="assembly-form" onSubmit={form.handleSubmit(onConfirm)}>
    <label>格式 / 编码<Input readOnly value="MP4 · H.264 / AAC · CPU" /></label>
    <div className="assembly-field-pair">{selects.map((select) => <label key={select.name}>{select.label}
      <Controller control={form.control} name={select.name} render={({ field }) => <SelectField value={field.value} onChange={(event) => field.onChange(event.target.value)}>
        {select.values.map(([value, label]) => <SelectOption key={value} value={value}>{label}</SelectOption>)}
      </SelectField>} />
    </label>)}
      <label title="14–30，数值越小画质越高、文件越大">画质 / CRF<Input type="number" min={14} max={30} step={1} {...form.register('crf', { valueAsNumber: true })} /></label>
    </div>
    {Object.values(form.formState.errors).map((error, index) => <p key={index} role="alert" className="field-error">{error.message}</p>)}
    <div className="button-row"><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit"><FontAwesomeIcon icon={faFileExport} />选择位置并导出</Button></div>
  </form></Dialog>
}

function elapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
}

export function AssemblyExportProgressView({ progress, exporting, cancelling, onCancel, onDismiss, onReveal }: {
  progress: AssemblyExportProgress; exporting: boolean; cancelling: boolean; onCancel: () => void; onDismiss: () => void; onReveal: () => void
}) {
  const completed = !exporting && progress.stage === 'completed'
  return <section className="assembly-export-progress" aria-label="导出进度">
    <div className="assembly-export-status">
      <div className="assembly-export-summary">
        <strong>{completed && <FontAwesomeIcon icon={faCheckCircle} className="text-success" />}{stages[progress.stage]}{progress.clipIndex && progress.clipCount ? ` · ${progress.clipIndex} / ${progress.clipCount}` : ''}</strong>
        {completed ? <span>成片已保存</span> : exporting && <span>总体估算 {progress.percent.toFixed(1)}%</span>}
        <span>{exporting ? '已用' : '用时'} {elapsed(progress.elapsedSeconds)}</span>
      </div>
      <div className="assembly-export-actions">
        {completed && <Button variant="outline" size="small" onClick={onReveal}><FontAwesomeIcon icon={faFolderOpen} />在资源管理器中显示</Button>}
        {exporting ? <Button variant="ghost" size="small" disabled={cancelling} onClick={onCancel}><FontAwesomeIcon icon={faStop} />{cancelling ? '正在取消' : '取消导出'}</Button>
          : <Button variant="ghost" size="icon" title="收起导出结果" aria-label="收起导出结果" onClick={onDismiss}><FontAwesomeIcon icon={faXmark} /></Button>}
      </div>
    </div>
    {exporting && <progress max={100} value={progress.percent} aria-label="总体估算进度" />}
    {!completed && <div className="assembly-export-detail"><span title={progress.detail}>{progress.detail}</span>
      <span>{progress.stagePercent === null ? (exporting ? '处理中' : '') : `当前步骤 ${progress.stagePercent.toFixed(1)}%`}
        {progress.processedSeconds !== undefined && progress.durationSeconds !== undefined ? ` · ${progress.processedSeconds.toFixed(1)} / ${progress.durationSeconds.toFixed(1)} 秒` : ''}
        {progress.speed !== undefined ? ` · ${progress.speed.toFixed(2)}x` : ''}</span>
    </div>}
  </section>
}
