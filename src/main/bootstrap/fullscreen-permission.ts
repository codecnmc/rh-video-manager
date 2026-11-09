export function canUseMediaFullscreen(input: {
  permission: string; requestingUrl: string; topLevelUrl: string; rendererDocumentUrl: string; isMainFrame: boolean
}): boolean {
  if (input.permission !== 'fullscreen' || !input.isMainFrame) return false
  try {
    const documentUrl = (value: string) => { const url = new URL(value); url.hash = ''; return url.href }
    const expected = documentUrl(input.rendererDocumentUrl)
    // 只允许应用自身的顶层文档，不能因为同为 file: 或回环地址就信任其他页面。
    return documentUrl(input.requestingUrl) === expected && documentUrl(input.topLevelUrl) === expected
  } catch { return false }
}
