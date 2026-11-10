import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import './tutorial.css'

const images = import.meta.glob<string>('./assets/step-*.png', { eager: true, query: '?url', import: 'default' })
const captions = [
  '会员权益：选择支持消费级 API Key 调用的套餐，价格与权益以平台实时页面为准',
  'RunningHub 头像菜单：查看账号标识并进入控制台',
  '工作台账号池：添加账号，填写账号标识和 API Key 后保存并同步',
  'RunningHub 控制台：消费级－会员中的 API 密钥',
  '工作流总览：下载软件内置的加速版工作流',
  'RunningHub 工作台：导入下载的工作流',
  '视频草稿：参考素材、H3 全能参考提示词与生成结果',
  '视频生成示例：核对参考素材、生成参数和实际成片',
  '推荐流程示例：与智能体讨论分镜和片段衔接',
  '推荐流程示例：准备并修订分镜参考素材'
]
type Destination = 'accounts' | 'workflows' | 'video' | 'mcp' | 'skills' | 'assembly' | 'image-generation'

export function TutorialPage({ onNavigate }: { onNavigate: (view: Destination) => void }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const source = (number: number) => images[`./assets/step-${number}.png`]
  function figures(numbers: number[]) {
    return <div className="tutorial-figures">{numbers.map((number) => <figure key={number} className="tutorial-figure">
      <button className="tutorial-image-button" aria-label={`放大图${number}：${captions[number - 1]}`} onClick={() => setExpanded(number)}>
        <img src={source(number)} alt={captions[number - 1]} loading="lazy" />
      </button><figcaption>图{number} · {captions[number - 1]}（点击放大）</figcaption>
    </figure>)}</div>
  }
  return <section className="management-page tutorial-page"><div className="tutorial-content">
    <h1>使用教程</h1><p className="muted">第一次使用，从准备工具开始。先配置账号池，再配置工作流，最后进入视频生产。</p>
    <nav className="tutorial-toc" aria-label="教程目录">
      <a href="#tutorial-ready">使用前提</a><a href="#tutorial-accounts">01 账号池</a><a href="#tutorial-workflows">02 工作流总览</a>
      <a href="#tutorial-video">03 视频生成</a><a href="#tutorial-agent">推荐创作流程</a><a href="#tutorial-edit">排片与剪映</a>
    </nav>
    <section id="tutorial-ready" className="tutorial-section"><h2>使用前提 · 准备好这些工具</h2>
      <ul><li><strong>RunningHub 会员：</strong>视频生成需要支持消费级 API Key 调用的会员权益和可用积分。购买前请确认对应套餐支持该能力。</li>
        <li><strong>素材生成：</strong>准备支持 OpenAI 协议、且与软件所用图像接口兼容的生成站及其配置，用于制作人物、场景和分镜参考图。</li>
        <li><strong>MCP 与 Skill：</strong>准备支持 MCP 和 Skill 的 Agent 智能体，例如 Codex。可在左侧 Skill 页面安装或导出内置技能，其他智能体按其自身安装方式接入。</li>
        <li><strong>账号池：</strong>集成 RunningHub 消费级 API Key。多个独立账号可汇总可用并发；同一账号添加多个 Key 不会增加该账号的平台并发额度。</li>
        <li><strong>工作流：</strong>仅使用软件内置的兼容工作流，下载后导入 RunningHub，再将线上 workflowId 配置回软件。</li></ul>
      <p><a href="https://www.runninghub.cn/vip-rights/2" target="_blank" rel="noreferrer">打开 RunningHub 会员权益页面</a></p>
      {figures([1])}
    </section>
    <section id="tutorial-accounts" className="tutorial-section"><h2>01 · 账号池（优先配置）</h2>
      <ol><li>进入软件左侧“账号池”，点击“添加账号”。</li><li>在 RunningHub 主页右上角点击头像，找到账号 ID，作为软件中的“RunningHub 账号标识”；同一账号请始终使用同一个标识。</li>
        <li>点击头像菜单中的“控制台”，进入“消费级－会员”，复制 API Key。</li><li>回到软件，填写账号名称、账号标识和 API Key，启用账号后点击“保存并同步”，核对额度和远端队列同步结果。</li></ol>
      <p className="tutorial-note">API Key 只在录入时填写，加密保存在本机。账号池的可用并发以平台实际容量为准，网站运行任务也会占用同一账号的额度。</p>
      <div className="button-row"><Button onClick={() => onNavigate('accounts')}>前往账号池</Button></div>{figures([2, 3, 4])}
    </section>
    <section id="tutorial-workflows" className="tutorial-section"><h2>02 · 工作流总览（第二步）</h2>
      <ol><li>进入“工作流总览”，点击“下载加速版”。加速版适合优先尝试；实际耗时与积分消耗以平台任务结果为准。</li>
        <li>打开 <a href="https://www.runninghub.cn/workspace" target="_blank" rel="noreferrer">RunningHub 工作台</a>，点击“导入工作流”，导入刚下载的文件。</li>
        <li>打开导入后的工作流详情，从浏览器地址中复制 workflowId。地址格式为 <code>https://www.runninghub.cn/workflow/这里是workflowId?source=workspace</code>，只复制中间的 ID。</li>
        <li>回到软件点击“添加工作流”，选择所属账号，填写自定义名称和 RunningHub 工作流 ID，启用并保存，再设为该账号的默认工作流。</li>
        <li>检测线上工作流并核对识别结果。加速版包含采样与成片输出，没有独立低清预览；不同版本的可用预览能力可能不同。</li></ol>
      <p>如果工作流分享权限允许其他账号调用，可复用同一个线上工作流，无需重复上传；仍需在软件中为每个使用它的账号配置工作流归属，并确认该账号实际有权访问。</p>
      <div className="button-row"><Button onClick={() => onNavigate('workflows')}>前往工作流总览</Button></div>{figures([5, 6])}
    </section>
    <section id="tutorial-video" className="tutorial-section"><h2>03 · 视频生成（配置完成后开始生产）</h2>
      <ol><li>先准备人物、场景和分镜图等参考素材，再创建项目与视频草稿。</li><li>使用内置 H3 视频提示词 Skill，让支持 Skill 的智能体输出 H3 六段式全能参考提示词，并核对其中图片、视频和音频引用与草稿中真实素材一致。</li>
        <li>将参考素材和提示词写入草稿，设置时长、画幅及清晰度，先保存并检查。</li><li>点击“提交生成”，明确选择账号与工作流，确认付费后提交。之后在任务队列查看进度，回到视频页核对可用预览和最终成片。</li></ol>
      <p className="tutorial-note">作者经验：搭配分镜图和加速工作流，部分约 10 秒片段可在 10 分钟以内完成。此为实测经验，排队、实例、分辨率和平台负载都会影响耗时，不作为完成时限承诺。截图中的单次结果仅作操作示例。</p>
      <div className="button-row"><Button onClick={() => onNavigate('video')}>前往视频生成</Button><Button variant="outline" onClick={() => onNavigate('skills')}>获取 H3 提示词 Skill</Button></div>{figures([7, 8])}
    </section>
    <section id="tutorial-agent" className="tutorial-section"><h2>推荐创作流程 · 智能体准备，工作台生产</h2>
      <p>作者个人推荐使用 Codex 配合 Plus 会员完成分镜稿与素材准备，也可以选择其他支持所需能力的智能体。素材是视频创作的重要基础：先统一人物、场景和镜头参考，再批量准备多个片段。</p>
      <ol><li>在智能体中讨论剧本、分镜、人物与场景，生成并修订参考素材。</li><li>在软件 MCP 页面选择项目范围、有效期与需要的权限；需要导入素材时，另外授权导入目录。</li>
        <li>通过 MCP 和 Skill 将素材导入工作台，建立视频草稿，绑定引用并保存提示词。大部分准备工作可通过对话完成。</li><li>回到软件检查草稿，再确认视频生成与费用；生成后可视化预览、比较并调整片段衔接。</li></ol>
      <h3>MCP 可以操作哪些内容？</h3><ul><li>在授权范围内查询项目、素材、分类和视频草稿；获得写权限后，可从授权目录导入素材、保存草稿、绑定或解除媒体引用。</li>
        <li>单独启用剧本库能力后，可访问授权范围内的剧本文档；写操作仍受当前授权约束。</li><li>单独启用排片剪辑库能力后，可查询排片工程和版本、检查媒体，获得写权限后编排片段、声音、字幕和支持的转场等内容。</li>
        <li>素材生成相关操作需要另行开启对应权限；提交生成与额度限制以 MCP 页面当前授权为准。</li></ul>
      <p>视频生成付费提交仍在软件内确认。MCP 不提供账号密钥或任意磁盘读取；连接成功也不代表已经授予全部功能。</p>
      <div className="button-row"><Button onClick={() => onNavigate('mcp')}>配置 MCP</Button><Button variant="outline" onClick={() => onNavigate('skills')}>查看内置 Skill</Button><Button variant="outline" onClick={() => onNavigate('image-generation')}>前往素材生成</Button></div>{figures([9, 10])}
    </section>
    <section id="tutorial-edit" className="tutorial-section"><h2>排片剪辑库与剪映草稿</h2>
      <p>排片剪辑库用于编排已有片段，尤其适合预览生成片段之间的衔接。开启相应 MCP 授权后，可让智能体协助编排，再回软件检查画面、声音和节奏。</p>
      <p>需要继续在剪映精剪时，可使用内置“剪映草稿剪辑”Skill 创建可继续编辑的剪映草稿。需另行安装 Python 与 pyJianYingDraft 依赖，软件未打包这些运行依赖。具体环境配置与操作按技能说明执行。</p>
      <div className="button-row"><Button onClick={() => onNavigate('assembly')}>前往排片剪辑库</Button><Button variant="outline" onClick={() => onNavigate('skills')}>获取剪映 Skill</Button></div>
    </section>
  </div>{expanded !== null && <Dialog className="tutorial-image-dialog" title={`图${expanded} · ${captions[expanded - 1]}`} onClose={() => setExpanded(null)}><img className="tutorial-full-image" src={source(expanded)} alt={captions[expanded - 1]} /></Dialog>}</section>
}
