import { app } from 'electron'
import { join } from 'node:path'
import type { LocalDialogOptions } from './local-dialog'

// 实际故障与开发预览共用排版和文案结构，避免预览与真实提示逐渐分叉。
export function startupFailureDialog(message: string, logged: boolean): LocalDialogOptions {
  const directory = app.getPath('userData')
  return {
    title: '工作台启动失败', tone: 'error', message, confirmLabel: '退出应用',
    details: [
      { label: '数据与配置目录', value: directory },
      { label: '诊断日志', value: logged ? join(directory, 'logs', 'startup.log') : '无法写入日志，请检查目录权限' }
    ],
    hint: '素材位置由设置单独管理，数据库和日志保留在原位。请保留现有数据与素材目录。'
  }
}
