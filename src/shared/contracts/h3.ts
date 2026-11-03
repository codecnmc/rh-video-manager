import { z } from 'zod'

export const h3Sections = ['subject_definitions', 'summary', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music'] as const

export const h3PromptSchema = z.string().max(50000).superRefine((text, context) => {
  if (/^[ \t]*integrated_multimodal_description[ \t]*:/m.test(text)) {
    context.addIssue({ code: 'custom', message: '检测到文生或关键帧的三节格式；当前为全能参考，需使用六节提示词' })
    return
  }
  const headers = [...text.matchAll(/^(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:/gm)]
  if (headers.length !== h3Sections.length || headers.some((header, index) => header[1] !== h3Sections[index])) {
    context.addIssue({ code: 'custom', message: '需按顺序填写全能参考的六个章节' })
  }
  headers.forEach((header, index) => {
    const start = (header.index ?? 0) + header[0].length
    const end = headers[index + 1]?.index ?? text.length
    if (!text.slice(start, end).trim()) context.addIssue({ code: 'custom', message: `${header[1]} 尚未填写` })
  })
})
