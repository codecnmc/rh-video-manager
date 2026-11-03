import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

// 从仓库内已脱敏资源生成独立包；保留源包，目标存在时拒绝覆盖。
const root = resolve('resources/skills')
const source = join(root, 'director-workbench')
const definitions = [
  ['workbench-storyboard', '导演分镜', 'storyboard', '拆解剧本、设计分镜时间轴、机位、表演、逐镜声音与剪辑接点。不写平台提示词，不生图，不实际剪辑。'],
  ['workbench-h3-prompts', 'H3 视频提示词', 'prompt', '将已确认分镜编译为 H3 Ref2VA 六节提示词，核对真实素材标签与连续性；获准时保存草稿。不重新导演，不付费生成。'],
  ['workbench-editing', '素材复核与剪辑', 'editing', '基于真实视频与声音证据检查连续性、选择素材和切点；按授权非破坏编辑。不自动改写分镜或生成提示词，不付费补拍。'],
  ['workbench-mcp', '工作台 MCP', null, '接入 AI 视频工作台 MCP，查询授权范围、素材、剧本、草稿与排片，按授权操作并回读。不负责导演、提示词创作或剪辑判断，不扩大权限。']
]

for (const [id, title, module, description] of definitions) {
  const target = join(root, id)
  await mkdir(target) // EEXIST 时停止，保护手工修改。
  await cp(join(source, 'references'), join(target, 'references'), { recursive: true, errorOnExist: true, force: false })
  // 保留交接文档的包内依赖，但入口只加载当前职责，不再加载总路由。
  for (const dependency of ['storyboard', 'prompt', 'editing']) {
    await cp(join(source, 'modules', dependency), join(target, 'modules', dependency), { recursive: true, errorOnExist: true, force: false })
  }
  const entry = module ? `完整读取 [本技能指南](modules/${module}/guide.md)，只按当前任务读取其中适用参考。` : '完整读取 [MCP 接入与操作契约](references/workspace-mcp.md)，以运行时发现的工具和 schema 为准。'
  const content = `---\nname: ${id}\ndescription: ${description}\n---\n\n# ${title}\n\n${entry}\n\n## 独立职责与权限\n\n- ${description}\n- 默认中文，保留已批准的剧情、对白、镜头、时长与版本。局部修改只动点名范围。\n- 本入口优先于历史模块中的跨模块路由；支持资料仅为自包含交接，不因链接自动切换阶段或加载其他模块。需要其他交付物时另行调用对应独立技能。\n- 不提供参考图生图功能，不安装或调用原导演工作台、图片脚本及其他个人技能。参考图职责设计不等于授权生成图片。\n- 使用工作台数据时才读 [MCP 契约](references/workspace-mcp.md)。连接后先查授权导入目录；不读取密钥或客户端凭据，不猜素材标签或修订。\n- 写入、导入、上传、付费提交、剪辑与导出各自独立授权。查询与咨询不改数据，创建草稿不等于提交。冲突重读，保留用户修改，不盲目重试收费。\n- 区分计划、已保存、已绑定、已生成、已执行与已导出。抽帧不等于完整观看或听审，缺工具时交付可完成部分并说明缺口。\n\n## 跨技能交接\n\n导演分镜：workbench-storyboard；H3 提示词：workbench-h3-prompts；素材复核与剪辑：workbench-editing；MCP 操作：workbench-mcp。均可独立安装，本包不依赖其他包的文件。剪映草稿另用 jianying-draft-editor。\n\n交接具体项目、草稿修订、任务/素材版本、净时间轴、起尾态、声音制作方式及真实引用职责；未知项不猜。尾段默认最后1秒，上限 min(2秒, 来源实际时长×25%)，整数工具向下取整，使用真实同源末帧、默认无音轨，不把引用长度当重复长度。\n\n## 来源\n\n2026-11-03 从 director-workbench 拆分，未包含参考图生成模块。分镜资料源自 62656456/ai-film-skills，版本 f1fee0587e985fa81eedc3be7d7258a9a39a2ed3，保留 modules/storyboard/LICENSE；剪辑资料源自 Skylinekimi/cinematic-stream-editor-skill，版本 949689aff8d18a2f8e56a412dd9927192dab285d，保留 modules/editing/LICENSE；H3 依据包内原始六节指南。\n`
  await writeFile(join(target, 'SKILL.md'), content, 'utf8')
  // 删除对未分发图片模块的跳转，保留叙事设计说明与原始许可。
  async function adapt(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name)
      if (item.isDirectory()) await adapt(path)
      else if (item.name.endsWith('.md')) {
        const text = await readFile(path, 'utf8')
        const updated = text.replace(/\[参考图模块\]\(\.\.\/images\/guide\.md\)/g, '用户另行选择的图片工具（本包不含生图功能）')
        if (updated !== text) await writeFile(path, updated, 'utf8')
      }
    }
  }
  await adapt(target)
}
process.stdout.write('Created four standalone workbench skills; original package preserved.\n')
