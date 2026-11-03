import test from 'node:test'
import assert from 'node:assert/strict'
import { folderOptions, folderPath, isWithinFolder } from '../src/renderer/src/features/assets/folders.ts'

const folders = [
  { id: 'root', name: '素材', parentId: null, projectId: null },
  { id: 'child', name: '图片', parentId: 'root', projectId: null },
  { id: 'leaf', name: '角色', parentId: 'child', projectId: null },
  { id: 'other', name: '声音', parentId: null, projectId: null }
]

test('完整文件夹路径和祖先判断适用于导入、编辑和选择，根目录不绑定分类', () => {
  assert.equal(folderPath(folders, 'leaf'), '素材 / 图片 / 角色')
  assert.equal(folderPath(folders, null), '根目录')
  assert.equal(isWithinFolder(folders, 'leaf', 'root'), true)
  assert.equal(isWithinFolder(folders, 'root', 'leaf'), false)
  assert.equal(isWithinFolder(folders, 'leaf', 'other'), false)
  assert.equal(folderOptions(folders).find((item) => item.id === 'child')?.path, '素材 / 图片')
})

test('路径展示对缺失父级和异常循环数据有限结束', () => {
  const invalid = [{ id: 'a', name: '甲', parentId: 'b', projectId: null }, { id: 'b', name: '乙', parentId: 'a', projectId: null }]
  assert.equal(folderPath(invalid, 'a'), '乙 / 甲')
  assert.equal(isWithinFolder(invalid, 'a', 'missing'), false)
  assert.equal(folderPath([{ id: 'a', name: '甲', parentId: 'missing', projectId: null }], 'a'), '甲')
})
