import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFloppyDisk } from '@fortawesome/free-solid-svg-icons'
import { saveImageAccountSchema, imageExecutionSettingsSchema, type ImageAccount, type ImageExecutionSettings } from '@contracts/image-generation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Dialog } from '@/components/ui/dialog'
import type { ImageGenerationController } from './use-image-generation'

type AccountFields = z.infer<typeof saveImageAccountSchema>

export function ImageAccountDialog({ account, control, onClose }: { account: ImageAccount | null; control: ImageGenerationController; onClose: () => void }) {
  const form = useForm<AccountFields>({ resolver: zodResolver(saveImageAccountSchema), defaultValues: {
    id: account?.id ?? null, expectedRevision: account?.revision ?? 0, name: account?.name ?? '', baseUrl: account?.baseUrl ?? '',
    model: account?.model ?? '', accountGroup: account?.accountGroup ?? crypto.randomUUID(), maxConcurrency: account?.maxConcurrency ?? 2,
    enabled: account?.enabled ?? true, apiKey: ''
  } })
  return <Dialog title={account ? '编辑生图账号' : '新增生图账号'} className="image-account-edit-dialog" onClose={() => { form.reset(); onClose() }}>
    <form className="image-account-form" onSubmit={form.handleSubmit(async (values) => {
      const saved = await control.saveAccount(values)
      form.setValue('apiKey', '')
      if (saved) { form.reset(); onClose() }
    })}>
      <fieldset className="image-account-fieldset" disabled={control.busy}><legend>服务连接</legend><div className="image-account-fields">
        <label>账号名称<Input {...form.register('name')} autoFocus autoComplete="off" /></label>
        <label>模型名称<Input {...form.register('model')} autoComplete="off" spellCheck={false} /></label>
        <label className="image-account-full">服务地址<Input {...form.register('baseUrl')} placeholder="https://example.com" autoComplete="off" spellCheck={false} /></label>
        <label className="image-account-full">API Key<Input type="password" {...form.register('apiKey')} autoComplete="new-password" spellCheck={false} placeholder={account ? '留空保留原密钥' : ''} /></label>
      </div></fieldset>
      <fieldset className="image-account-fieldset" disabled={control.busy}><legend>调度设置</legend><div className="image-account-fields">
        <label>实际账号组<Input {...form.register('accountGroup')} spellCheck={false} /></label>
        <label>账号并发上限<Input type="number" min={1} max={16} {...form.register('maxConcurrency', { valueAsNumber: true })} /></label>
        <label className="checkbox-label image-account-full"><Controller name="enabled" control={form.control} render={({ field }) => <CheckboxField checked={field.value} onChange={(event) => field.onChange(event.target.checked)} />} />启用账号</label>
      </div></fieldset>
      {Object.values(form.formState.errors).map((error, index) => <p className="field-error" role="alert" key={index}>{error.message}</p>)}
      {control.error && <p className="field-error" role="alert">{control.error}</p>}
      <div className="dialog-actions"><Button type="button" variant="outline" disabled={control.busy} onClick={() => { form.reset(); onClose() }}>取消</Button><Button type="submit" disabled={control.busy}><FontAwesomeIcon icon={faFloppyDisk} />保存账号</Button></div>
    </form>
  </Dialog>
}

export function ImageConcurrencyForm({ value, control }: { value: number; control: ImageGenerationController }) {
  const form = useForm<ImageExecutionSettings>({ resolver: zodResolver(imageExecutionSettingsSchema), defaultValues: { globalConcurrency: value } })
  return <form className="image-concurrency-form" onSubmit={form.handleSubmit(async (values) => { await control.saveConcurrency(values.globalConcurrency) })}>
    <label htmlFor="image-global-concurrency">全局并发上限</label><Input id="image-global-concurrency" aria-invalid={Boolean(form.formState.errors.globalConcurrency)} type="number" min={1} max={64} {...form.register('globalConcurrency', { valueAsNumber: true })} />
    <Button variant="outline" type="submit" size="icon" title="保存全局并发上限" aria-label="保存全局并发上限" disabled={control.busy}><FontAwesomeIcon icon={faFloppyDisk} /></Button>
    {form.formState.errors.globalConcurrency && <p role="alert" className="field-error">{form.formState.errors.globalConcurrency.message}</p>}
  </form>
}
