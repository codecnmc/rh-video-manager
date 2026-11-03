export function reorderDraftSubset<T extends { id: string }>(drafts: T[], visibleIds: string[], orderedIds: string[]): T[] {
  const visible = new Set(visibleIds)
  const byId = new Map(drafts.map((draft) => [draft.id, draft]))
  if (visible.size !== visibleIds.length || orderedIds.length !== visible.size || new Set(orderedIds).size !== orderedIds.length
    || visibleIds.some((id) => !byId.has(id)) || orderedIds.some((id) => !visible.has(id))) {
    throw new Error('草稿列表已变化，请重新载入后排序')
  }
  let index = 0
  // 只替换筛选结果原来占用的槽位，隐藏草稿的位置和内容保持不变。
  return drafts.map((draft) => {
    if (!visible.has(draft.id)) return draft
    const next = byId.get(orderedIds[index++])
    if (!next) throw new Error('待排序草稿不存在')
    return next
  })
}
