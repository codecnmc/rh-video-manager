import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useVoices } from './use-voices'
import { VoiceAudioPlayer } from './VoiceAudioPlayer'
import './voices.css'

export function VoicePicker({ onPick, onClose }: { onPick: (assetId: string) => Promise<void>; onClose: () => void }) {
  const voices = useVoices()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <Dialog title="选择公共参考音色" onClose={onClose}><div className="voice-picker">{(voices.data ?? []).map((voice) => <section className="voice-card" key={voice.id}><strong>{voice.name}</strong>
    <VoiceAudioPlayer assetId={voice.assetId} name={voice.name} />
    <Button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await onPick(voice.assetId); onClose() } catch (failure) { setError(failure instanceof Error ? failure.message : '音色绑定失败') } finally { setBusy(false) } }}>作为音频参考</Button>
  </section>)}</div>{(error || voices.error) && <p className="field-error" role="alert">{error || voices.error?.message}</p>}{!voices.isPending && !voices.data?.length && <p className="muted">公共音色库暂无音色</p>}</Dialog>
}
