import type { ImageNode } from '@contracts/image-generation'

const labels: Record<ImageNode['status'], string> = {
  draft: '待提交', queued: '排队中', preparing: '准备中', generating: '生成中', downloading: '下载归档中', saved: '已归档',
  not_submitted: '尚未提交', acceptance_unknown: '受理不明', output_unavailable: '归档未完成', resolved: '已人工核实'
}
export function imageStatusLabel(status: ImageNode['status']) { return labels[status] }
