import type { ClipColor } from '../../shared/contracts/assembly'

export interface MediaInspection {
  duration: number
  width: number
  height: number
  frames: { time: number; data: string }[]
}

export interface MediaInspector {
  inspect(path: string, kind: 'video' | 'audio', times: number[], color?: ClipColor): Promise<MediaInspection>
}

// 仅允许边界返回这里定义的安全错误，不透传解码器中的本地路径。
export class MediaInspectionError extends Error {}

