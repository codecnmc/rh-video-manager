import type { PreviewKind, PreviewNotificationTarget, PreviewState } from '../../shared/contracts/preview'
import type { Workspace } from '../../shared/contracts/workspace'

export function createTaskNotification(
  task: Pick<PreviewState, 'id' | 'projectId' | 'draftId' | 'taskId'>,
  projects: Workspace['projects'], message: string, kind?: PreviewKind
): { title: string; body: string; target: PreviewNotificationTarget } {
  const project = projects.find((item) => item.id === task.projectId)
  const draft = project?.videoDrafts.find((item) => item.id === task.draftId)
  return {
    title: `羊驼AI影视 · ${draft?.title || '视频任务'}`,
    body: `${message}\n${project?.name || '项目不可用'} / ${draft?.title || '草稿不可用'}\n任务 ${task.taskId || task.id}`,
    target: { id: task.id, projectId: task.projectId, draftId: task.draftId, kind }
  }
}
