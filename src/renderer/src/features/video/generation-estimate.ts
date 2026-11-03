import type { GenerationTimingSample, VideoDraft } from '../../../../shared/contracts/video'

export type TimingConfiguration = Pick<VideoDraft, 'duration' | 'resolution' | 'aspectRatio' | 'instance'> & {
  images: number; videos: number; audio: number
}

export function matchesTimingConfiguration(sample: GenerationTimingSample, config: TimingConfiguration): boolean {
  return sample.instance === config.instance && sample.resolution === config.resolution && sample.aspectRatio === config.aspectRatio &&
    sample.images === config.images && sample.videos === config.videos && sample.audio === config.audio
}

export function estimateGenerationTime(config: TimingConfiguration, samples: GenerationTimingSample[] | undefined) {
  if (!Number.isInteger(config.duration) || config.duration < 4 || config.duration > 15) return null
  const sample = samples ? [...samples].reverse().find((item) => matchesTimingConfiguration(item, config)) : undefined
  if (!sample) return null
  // 只在相同档位、分辨率、比例及参考数量下按时长线性换算，不推断跨硬件或放大流程速度。
  const ratio = config.duration / sample.duration
  return {
    minSeconds: Math.max(1, Math.floor(sample.minSeconds * ratio)),
    maxSeconds: Math.max(1, Math.ceil(sample.maxSeconds * ratio)),
    workflowLabel: sample.workflowLabel,
    scaled: config.duration !== sample.duration
  }
}

export function formatGenerationTime(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} 秒`
  const minutes = Math.ceil(seconds / 60)
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`
}
