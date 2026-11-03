import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faUsers, faArrowLeft, faRotateRight, faPen, faMagnifyingGlass, faLayerGroup, faArrowRight, faArrowUpRightFromSquare } from '@fortawesome/free-solid-svg-icons'
import type { ImageAccount } from '@contracts/image-generation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { confirmAction } from '@/components/ui/confirmation'
import { useImageGeneration } from './use-image-generation'
import { ImageAccountDialog, ImageConcurrencyForm } from './ImageForms'
import { ImageWorkspace } from './ImageWorkspace'
import { useImageGenerationUi } from './image-generation-store'
import { desktop, unwrap } from '@/shared/lib/desktop'
import './image-generation.css'

const titleSchema = z.object({ title: z.string().trim().min(1).max(120) })

export function ImageGenerationLibrary({ projectId, workspaceHeader, onDirty, onNotice, registerSave }: {
  projectId: string | null; workspaceHeader?: ReactNode; onDirty: (value: boolean) => void; onNotice: (message: string) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}) {
  const boardId = useImageGenerationUi((state) => state.boardByProject[projectId ?? 'public'] ?? null)
  const selectBoard = useImageGenerationUi((state) => state.selectBoard)
  const setBoardId = (id: string | null) => selectBoard(projectId, id)
  const control = useImageGeneration(projectId, boardId, onNotice)
  const [creating, setCreating] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [accountForm, setAccountForm] = useState<{ account: ImageAccount | null } | null>(null)
  const [search, setSearch] = useState('')
  const [dirty, setDirty] = useState(false)
  const saveTasks = useRef<(() => Promise<boolean>) | null>(null)
  const registerTaskSave = useCallback((save: (() => Promise<boolean>) | null) => {
    saveTasks.current = save
    registerSave?.(save)
  }, [registerSave])
  const form = useForm<z.infer<typeof titleSchema>>({ resolver: zodResolver(titleSchema), defaultValues: { title: '' } })
  const board = control.boards.data?.find((item) => item.id === boardId)
  const accounts = control.accounts.data ?? []
  const errors = control.error || control.boards.error?.message || control.nodes.error?.message || control.accounts.error?.message || control.assets.error?.message || control.settings.error?.message
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  useEffect(() => {
    // 读取失败或仍在刷新时不清空选择，避免暂时无数据导致恢复位置丢失。
    if (boardId && control.boards.isSuccess && !control.boards.isFetching && !control.boards.data.some((item) => item.id === boardId)) {
      selectBoard(projectId, null)
    }
  }, [boardId, projectId, control.boards.data, control.boards.isSuccess, control.boards.isFetching, selectBoard])
  const visibleBoards = (control.boards.data ?? []).filter((item) => item.title.toLowerCase().includes(search.toLowerCase()))
  async function openWindow(id: string) {
    try { unwrap(await desktop().openWorkbenchWindow({ projectId, view: 'image-generation', boardId: id })) }
    catch (failure) { onNotice(failure instanceof Error ? failure.message : '独立任务组窗口打开失败') }
  }
  const heading = <header className="image-generation-heading"><div className="button-row">
      {boardId && <Button variant="ghost" size="icon" title="返回任务组" aria-label="返回任务组" disabled={control.busy} onClick={async () => {
        if (dirty && !await confirmAction('任务存在未保存修改，是否保存后返回？', () => saveTasks.current?.() ?? Promise.resolve(false))) return
        setBoardId(null); setDirty(false)
      }}><FontAwesomeIcon icon={faArrowLeft} /></Button>}
      <h1>{boardId ? board?.title ?? '正在载入任务组' : '素材生成'}</h1></div>
      <div className="button-row"><Button variant="ghost" size="icon" title="刷新" aria-label="刷新" onClick={() => void control.refresh()}><FontAwesomeIcon icon={faRotateRight} /></Button>
        {board && <Button variant="ghost" size="icon" title="在新窗口打开任务组" aria-label="在新窗口打开任务组" disabled={control.busy} onClick={() => void openWindow(board.id)}><FontAwesomeIcon icon={faArrowUpRightFromSquare} /></Button>}
        <Button variant="outline" onClick={() => setAccountsOpen(true)}><FontAwesomeIcon icon={faUsers} />生图账号</Button>
        {!boardId && <Button disabled={control.busy} onClick={() => setCreating(true)}><FontAwesomeIcon icon={faPlus} />新建任务组</Button>}</div>
    </header>
  const errorNotice = errors ? <p className="image-generation-error" role="alert">{errors}</p> : null
  return <>{!board && workspaceHeader}<section className={`image-generation ${boardId ? 'image-generation-editor' : ''}`} aria-label="素材生成">
    {!board && <>{heading}{errorNotice}</>}
    {!boardId ? <>
      <div className="image-generation-library-toolbar">
        <div className="image-generation-summary"><span><strong>{control.boards.data?.length ?? 0}</strong> 个任务组</span><span><strong>{accounts.filter((item) => item.enabled && !item.stopped).length}</strong> 个可用账号</span></div>
        <div className="image-generation-search"><FontAwesomeIcon icon={faMagnifyingGlass} /><Input aria-label="搜索任务组" placeholder="搜索任务组名称" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      </div>
      <div className="image-generation-table-scroll image-board-list"><table className="image-generation-table image-board-table"><thead><tr><th scope="col">任务组名称</th><th scope="col">更新时间</th><th scope="col"><span className="sr-only">打开</span></th></tr></thead><tbody>
        {visibleBoards.map((item) => <tr key={item.id}><td><Button variant="ghost" className="image-board-title" onClick={() => setBoardId(item.id)}><FontAwesomeIcon icon={faLayerGroup} /><span>{item.title}</span></Button></td><td>{new Date(item.updatedAt).toLocaleString('zh-CN')}</td><td><div className="button-row"><Button variant="ghost" size="icon" aria-label={`在新窗口打开 ${item.title}`} title="在新窗口打开任务组" disabled={control.busy} onClick={() => void openWindow(item.id)}><FontAwesomeIcon icon={faArrowUpRightFromSquare} /></Button><Button variant="ghost" size="icon" aria-label={`打开 ${item.title}`} title="打开任务组" onClick={() => setBoardId(item.id)}><FontAwesomeIcon icon={faArrowRight} /></Button></div></td></tr>)}
      </tbody></table>{control.boards.isPending ? <div className="image-generation-empty" role="status">正在读取任务组</div> : !visibleBoards.length && <div className="image-generation-empty"><FontAwesomeIcon icon={faLayerGroup} /><h2>{search ? '没有匹配的任务组' : '暂无素材生成任务组'}</h2>
        {search ? <Button variant="outline" onClick={() => setSearch('')}>清除搜索</Button> : <Button variant="outline" disabled={control.busy} onClick={() => setCreating(true)}><FontAwesomeIcon icon={faPlus} />新建任务组</Button>}</div>}</div>
    </> : board && <ImageWorkspace key={board.id} board={board} header={<>{workspaceHeader}{heading}{errorNotice}</>} control={control} onDirty={setDirty} onNotice={onNotice} registerSave={registerTaskSave} />}
    {creating && <Dialog title="新建素材生成任务组" className="image-board-dialog" onClose={() => setCreating(false)}><form onSubmit={form.handleSubmit(async ({ title }) => {
      const saved = await control.createBoard(title)
      if (saved) { setBoardId(saved.id); setCreating(false); form.reset() }
    })}><label>任务组名称<Input autoFocus {...form.register('title')} /></label>{form.formState.errors.title && <p className="field-error">{form.formState.errors.title.message}</p>}
      <div className="dialog-actions"><Button variant="outline" onClick={() => setCreating(false)}>取消</Button><Button type="submit" disabled={control.busy}>创建任务组</Button></div></form></Dialog>}
    {accountsOpen && <Dialog title="生图账号" className="image-accounts-dialog" onClose={() => setAccountsOpen(false)}>
      <div className="image-accounts-toolbar">
        {control.settings.data && <ImageConcurrencyForm key={control.settings.data.globalConcurrency} value={control.settings.data.globalConcurrency} control={control} />}
        <Button disabled={control.busy} onClick={() => { setAccountsOpen(false); setAccountForm({ account: null }) }}><FontAwesomeIcon icon={faPlus} />新增账号</Button>
      </div>
      <div className="image-accounts-list-heading"><h3>账号列表 <span>{accounts.length}</span></h3><span>{accounts.filter((account) => account.enabled && !account.stopped).length} 个可用</span></div>
      {control.error && <p className="field-error" role="alert">{control.error}</p>}
      <div className="image-accounts-list">
        {control.accounts.isPending ? <div className="image-generation-empty" role="status"><FontAwesomeIcon icon={faRotateRight} spin /><p>正在读取账号</p></div>
          : control.accounts.error ? <p className="image-generation-empty field-error" role="alert">{control.accounts.error.message}</p>
          : accounts.length ? <table className="image-generation-table image-account-table"><thead><tr><th scope="col">账号 / 模型</th><th scope="col">实际账号组</th><th scope="col">并发</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>{accounts.map((account) => <tr key={account.id}>
            <td><strong className="image-account-name">{account.name}</strong><small>{account.model}</small><small>{account.baseUrl}</small></td>
            <td><span className="image-account-group" title={account.accountGroup}>{account.accountGroup}</span></td><td className="image-account-capacity">{account.maxConcurrency}</td>
            <td><span className="image-account-status" data-state={!account.enabled ? 'disabled' : account.stopped ? 'stopped' : 'enabled'}>{!account.enabled ? '已停用' : account.stopped ? '已暂停' : '已启用'}</span></td><td><div className="button-row">
              <Button variant="ghost" size="icon" title={`编辑账号：${account.name}`} aria-label={`编辑账号：${account.name}`} disabled={control.busy} onClick={() => { setAccountsOpen(false); setAccountForm({ account }) }}><FontAwesomeIcon icon={faPen} /></Button>
              {account.stopped && <Button variant="ghost" size="icon" title={`核实并恢复账号：${account.name}`} aria-label={`核实并恢复账号：${account.name}`} disabled={control.busy} onClick={() => void control.resumeAccount(account.id)}><FontAwesomeIcon icon={faRotateRight} /></Button>}</div></td>
          </tr>)}</tbody></table> : <div className="image-generation-empty"><FontAwesomeIcon icon={faUsers} /><h3>暂无生图账号</h3><Button variant="outline" disabled={control.busy} onClick={() => { setAccountsOpen(false); setAccountForm({ account: null }) }}><FontAwesomeIcon icon={faPlus} />新增账号</Button></div>}
      </div>
      <div className="image-accounts-footer"><Button variant="outline" onClick={() => setAccountsOpen(false)}>完成</Button></div>
    </Dialog>}
    {accountForm && <ImageAccountDialog account={accountForm.account} control={control} onClose={() => { setAccountForm(null); setAccountsOpen(true) }} />}
  </section></>
}
