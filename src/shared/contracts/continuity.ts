import { z } from 'zod'
import { videoDraftSchema } from './video'

// UI 与提交用例共用边界校验；保存草稿仍允许尚未绑定参考的中间状态。
export const continuousShotInputSchema = videoDraftSchema.pick({ shotContinuity: true, prompt: true }).extend({
  references: z.array(z.object({ kind: z.enum(['image', 'video', 'audio']), label: z.string() }))
}).superRefine((input, context) => {
  if (input.shotContinuity !== 'continuous') return
  const videos = input.references.filter((reference) => reference.kind === 'video' && /^<Video [1-9]\d*>$/.test(reference.label))
  if (!videos.length) {
    context.addIssue({ code: 'custom', path: ['references'], message: '连续镜头必须绑定上一段的尾段参考视频，不能只使用尾帧图片' })
  } else if (![...input.prompt.matchAll(/<Video [1-9]\d*>/g)].some((match) => videos.some((reference) => reference.label === match[0]))) {
    context.addIssue({ code: 'custom', path: ['prompt'], message: '连续镜头提示词必须引用已绑定视频的真实 <Video N> 标签' })
  }
})
