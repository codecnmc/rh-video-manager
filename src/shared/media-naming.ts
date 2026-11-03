export function generatedVideoName(title: string, jobId: string, submittedAt: string): string {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim()
    .slice(0, 80).replace(/[\uD800-\uDBFF]$/, '').replace(/[. ]+$/, '') || '未命名视频'
  const date = new Date(submittedAt)
  // 固定中国时区，重试归档不会随本机时区或下载时间改变名称。
  const time = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(date).replace(/[-: ]/g, '') : '时间未知'
  return `${base}-成片-${time}-${jobId.slice(0, 8)}.mp4`
}
