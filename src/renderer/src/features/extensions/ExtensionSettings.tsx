import { confirmAction } from '@/components/ui/confirmation'
import { CheckboxField } from '@/components/ui/checkbox-field'
import { Input } from '@/components/ui/input'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFloppyDisk, faTrash, faRotateLeft } from '@fortawesome/free-solid-svg-icons'
import { extensionSettingsSchema, type ExtensionSettingValue, type InstalledExtension } from '@contracts/extensions'
import { Button } from '@/components/ui/button'

const settingsFormSchema = z.object({ values: extensionSettingsSchema, secrets: z.record(z.string(), z.string().max(4000)) })
type SettingsForm = z.infer<typeof settingsFormSchema>

export function ExtensionSettings({ extension, locked, onDirty, onSave, onClearSecret }: {
  extension: InstalledExtension; locked: boolean; onDirty: (value: boolean) => void
  onSave: (values: Record<string, ExtensionSettingValue>, secrets: Record<string, string>) => Promise<void>
  onClearSecret: (key: string) => Promise<void>
}) {
  const fields = extension.manifest.contributes.configuration
  const form = useForm<SettingsForm>({ resolver: zodResolver(settingsFormSchema), defaultValues: {
    values: Object.fromEntries(fields.filter((field) => field.type !== 'secret').map((field) => [field.key,
      extension.settings[field.key] ?? (field.type === 'boolean' ? false : field.type === 'number' ? 0 : '')])), secrets: {}
  } })
  const [error, setError] = useState('')
  useEffect(() => { onDirty(form.formState.isDirty) }, [form.formState.isDirty, onDirty])
  if (!fields.length) return null
  return <form className="extension-settings" onSubmit={form.handleSubmit(async (input) => {
    const missing = fields.find((field) => field.required && (field.type === 'secret'
      ? !input.secrets[field.key] && !extension.configuredSecrets.includes(field.key)
      : input.values[field.key] === '' || input.values[field.key] === undefined))
    if (missing) { setError(`请填写${missing.title}`); return }
    setError('')
    try {
      await onSave(input.values, input.secrets)
      form.reset({ values: input.values, secrets: {} }); onDirty(false)
    } catch { setError('设置未全部保存，请检查后重试') }
  })}><h3>设置</h3><fieldset disabled={locked || form.formState.isSubmitting}>
    {fields.map((field) => <div key={field.key}>
      {field.type === 'boolean' ? <label className="check-field"><CheckboxField  checked={form.watch(`values.${field.key}`) === true} onChange={(event) => form.setValue(`values.${field.key}`, event.target.checked, { shouldDirty: true, shouldValidate: true })} />{field.title}{field.required ? ' *' : ''}</label>
        : <><label className="field-label" htmlFor={`extension-setting-${field.key}`}>{field.title}{field.required ? ' *' : ''}</label>
          {field.type === 'secret' ? <div className="extension-secret"><Input id={`extension-setting-${field.key}`} type="password" autoComplete="new-password"
            placeholder={extension.configuredSecrets.includes(field.key) ? '已保存，留空保持不变' : '未设置'} {...form.register(`secrets.${field.key}`)} />
            <Button variant="ghost" size="icon" title={`清除${field.title}`} aria-label={`清除${field.title}`} disabled={!extension.configuredSecrets.includes(field.key) || form.formState.isDirty}
              onClick={async () => { if ((await confirmAction(`清除「${field.title}」？`))) void onClearSecret(field.key) }}><FontAwesomeIcon icon={faTrash} /></Button></div>
            : <Input id={`extension-setting-${field.key}`} type={field.type === 'number' ? 'number' : 'text'} step="any" autoComplete="off"
              {...form.register(`values.${field.key}`, field.type === 'number' ? { valueAsNumber: true } : {})} />}</>}
    </div>)}
    {(error || Object.keys(form.formState.errors).length > 0) && <p className="field-error" role="alert">{error || '请检查设置的字段类型和长度'}</p>}
    <div className="button-row"><Button variant="outline" disabled={!form.formState.isDirty} onClick={() => { form.reset(); setError(''); onDirty(false) }}><FontAwesomeIcon icon={faRotateLeft} />还原</Button>
      <Button type="submit" disabled={!form.formState.isDirty}><FontAwesomeIcon icon={faFloppyDisk} />保存设置</Button></div>
  </fieldset></form>
}
