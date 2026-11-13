import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCopy } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { desktop, unwrap } from '@/shared/lib/desktop'
import { voiceReferenceText as referenceText } from '../../../../shared/voice-reference'

export function VoiceReferenceHint({ onNotice }: { onNotice: (message: string) => void }) {
  return <aside className="workflow-voice-reference-hint"><header><strong>H3 音色参考推荐台词</strong><Button variant="ghost" size="small" onClick={async () => {
    try { unwrap(await desktop().copyVoiceReferenceText()); onNotice('推荐台词已复制') } catch { onNotice('复制失败，请展开台词后手动复制') }
  }}><FontAwesomeIcon icon={faCopy} />复制台词</Button></header><p>建议使用这段台词制作声音克隆的引用音频，再用于 H3 视频对话参考，有助于保留原音色和说话节奏，提高贴合度。</p><details><summary>查看推荐台词</summary><blockquote>{referenceText}</blockquote></details></aside>
}
