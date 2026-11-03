import type { CreateImageNode, ImageNode } from '@contracts/image-generation'

export type ImageTaskFields = Pick<CreateImageNode, 'title' | 'prompt' | 'size' | 'accountId' | 'references'>
export type ImageTaskSession = { id: string; base: ImageNode | null; fields: ImageTaskFields; open: boolean; sourceNodeId?: string }
export type ImageTaskSessions = Record<string, ImageTaskSession>

export function imageTaskFields(node: ImageTaskFields): ImageTaskFields {
  return { title: node.title, prompt: node.prompt, size: node.size, accountId: node.accountId, references: node.references }
}

export function sameImageTaskFields(left: ImageTaskFields, right: ImageTaskFields): boolean {
  return left.title === right.title && left.prompt === right.prompt && left.size === right.size && left.accountId === right.accountId &&
    left.references.length === right.references.length && left.references.every((reference, index) =>
      reference.assetId === right.references[index]?.assetId && reference.expectedUpdatedAt === right.references[index]?.expectedUpdatedAt)
}

export function taskSessionDirty(session: ImageTaskSession): boolean {
  return !session.base || !sameImageTaskFields(session.fields, session.base)
}

export function taskSessionConflict(session: ImageTaskSession, node: ImageNode | undefined): boolean {
  return Boolean(session.base && taskSessionDirty(session) && (!node || node.revision !== session.base.revision))
}

export function updateTaskFields(sessions: ImageTaskSessions, id: string, fields: ImageTaskFields): ImageTaskSessions {
  const session = sessions[id]
  if (!session || sameImageTaskFields(session.fields, fields)) return sessions
  return { ...sessions, [id]: { ...session, fields } }
}

export function acknowledgeTaskSave(sessions: ImageTaskSessions, id: string, submitted: ImageTaskFields, saved: ImageNode): ImageTaskSessions {
  const session = sessions[id]
  if (!session) return sessions
  // 保存期间继续输入时只推进基准修订，不能用旧请求的响应覆盖新输入。
  const unchanged = sameImageTaskFields(session.fields, submitted)
  return { ...sessions, [id]: { ...session, base: saved, fields: unchanged ? imageTaskFields(saved) : session.fields } }
}

export function acknowledgeTaskCopy(sessions: ImageTaskSessions, source: ImageNode, saved: ImageNode): ImageTaskSessions {
  const session = sessions[source.id]
  if (!session) return sessions
  // 历史记录恢复原快照；保存期间的新输入留在新草稿上，仍按未保存处理。
  return { ...sessions,
    [source.id]: { ...session, base: source, fields: imageTaskFields(source) },
    [saved.id]: { id: saved.id, base: saved, fields: session.fields, open: true }
  }
}

export function syncTaskSessions(sessions: ImageTaskSessions, nodes: ImageNode[]): ImageTaskSessions {
  let next = sessions
  for (const session of Object.values(sessions)) {
    if (session.base && !nodes.some((node) => node.id === session.id)) {
      next = { ...next }
      delete next[session.id]
    }
  }
  for (const node of nodes) {
    const session = sessions[node.id]
    // 轮询只同步未编辑任务；其他任务的未保存输入和开始编辑时的修订必须保留。
    if (!session || taskSessionDirty(session) || session.base?.revision === node.revision) continue
    next = { ...next, [node.id]: { ...session, base: node, fields: imageTaskFields(node) } }
  }
  return next
}
