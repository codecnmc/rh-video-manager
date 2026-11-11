import { useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faDownload, faFileImport, faWandMagicSparkles } from '@fortawesome/free-solid-svg-icons'
import { Button } from '@/components/ui/button'
import { desktop, unwrap } from '@/shared/lib/desktop'
import type { BuiltinSkillId } from '../../../../shared/contracts/skills'
import './skills.css'

const skills: { id: BuiltinSkillId; title: string; scope: string }[] = [
  { id: 'workbench-storyboard', title: '导演分镜', scope: '剧本拆解 · 机位表演 · 时间轴 · 声音与剪辑交接' },
  { id: 'workbench-h3-prompts', title: 'H3 视频提示词', scope: 'Ref2VA 六节 · 真实引用 · 连续镜头 · 草稿保存' },
  { id: 'workbench-editing', title: '素材复核与剪辑', scope: '素材取证 · 连续性 · 切点节奏 · 非破坏剪辑' },
  { id: 'workbench-mcp', title: '工作台 MCP', scope: '连接授权 · 素材查询导入 · 草稿与排片操作' },
  { id: 'jianying-draft-editor', title: '剪映草稿剪辑', scope: '素材导入 · Python 草稿 · 声音字幕 · 原生黑白滤镜' }
]

export function SkillsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function act(install: boolean, id: BuiltinSkillId) {
    if (busy) return
    setBusy(true); setError('')
    try {
      if (install) {
        const path = unwrap(await desktop().installBuiltinSkill(id))
        if (path) onNotice(`技能已安装：${path}，请在 Codex 中重新打开聊天以加载`)
      } else if (unwrap(await desktop().exportBuiltinSkill(id))) onNotice(`技能已导出：${id}`)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '技能操作失败') }
    finally { setBusy(false) }
  }
  return <section className="management-page skills-page"><div className="management-toolbar"><h2>Skill</h2><span className="muted">内置技能 · {skills.length}</span></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="skills-grid">{skills.map((skill) => <article className="skill-card" key={skill.id} aria-labelledby={`skill-title-${skill.id}`}>
      <h3 id={`skill-title-${skill.id}`}><FontAwesomeIcon icon={faWandMagicSparkles} />{skill.title}</h3>
      <p className="skill-card-id"><span className="sr-only">技能标识：</span>{skill.id}</p>
      <p className="skill-card-scope"><span className="sr-only">范围：</span>{skill.scope}</p>
      {skill.id === 'jianying-draft-editor' && <p className="skill-card-dependency">运行依赖：Python 与 pyJianYingDraft 需另行配置，未打包</p>}
      <div className="skill-card-actions"><Button disabled={busy} onClick={() => void act(true, skill.id)}><FontAwesomeIcon icon={faFileImport} />导入 Codex</Button>
        <Button variant="outline" disabled={busy} onClick={() => void act(false, skill.id)}><FontAwesomeIcon icon={faDownload} />导出技能目录</Button></div>
    </article>)}</div></section>
}
