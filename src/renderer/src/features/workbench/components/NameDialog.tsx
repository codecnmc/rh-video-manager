import { confirmAction } from '@/components/ui/confirmation'
import { Input } from '@/components/ui/input'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

const nameSchema = z.object({ name: z.string().trim().min(1, '请输入名称').max(100, '名称最多 100 字') })

export function NameDialog({ title, initialName = '', submitLabel = '创建', onClose, onCreate }: { title: string; initialName?: string; submitLabel?: string; onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [error, setError] = useState('')
  const form = useForm<z.infer<typeof nameSchema>>({ resolver: zodResolver(nameSchema), defaultValues: { name: initialName } })
  const close = async () => {
    if (!form.formState.isSubmitting && (!form.formState.isDirty || (await confirmAction('放弃当前未保存的名称？')))) onClose()
  }
  return <Dialog title={title} onClose={close}><form onSubmit={form.handleSubmit(async ({ name }) => {
    try { await onCreate(name); onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败') }
  })}><label className="field-label" htmlFor="new-name">名称</label><Input id="new-name" autoFocus disabled={form.formState.isSubmitting} {...form.register('name')} />
    {(error || form.formState.errors.name) && <p className="field-error">{error || form.formState.errors.name?.message}</p>}
    <div className="dialog-actions"><Button variant="outline" disabled={form.formState.isSubmitting} onClick={close}>取消</Button><Button type="submit" disabled={form.formState.isSubmitting}>{submitLabel}</Button></div>
  </form></Dialog>
}
