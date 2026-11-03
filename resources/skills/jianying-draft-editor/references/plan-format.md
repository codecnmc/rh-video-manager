# 草稿计划与运行边界

`scripts/jianying_draft.py` 是基础草稿编译器，不是视频理解模型，也不直接接收工作台 `AssemblyVersion`。先把已有工程或剪辑决策映射到下面的格式。未知字段拒绝，不能无提示丢效果。

## 输入

所有路径必须来自授权的 `assets_resolve_path` 返回值，或用户提供/明确授权的本地绝对路径，且在命令行列出的 `--media-root` 内。拒绝 UNC 路径、目录和远程 URL。`id` 为素材 ID；纯本地任务可自定稳定 ID。用户给目录时可以在该目录授权范围内定位文件，但仍需检查同名歧义，不扫描其他位置。MCP 路径授权仅针对解析过的具体文件，不等于其父目录下全部文件；脚本只处理计划中显式列出的文件。

工具调用顺序：`assets_list` → `assets_resolve_path({assetId, expectedUpdatedAt: updatedAt})`。成功返回 `assetId/projectId/name/kind/updatedAt/size/path`，其中 `assetId/kind/path` 对应本计划的 `id/kind/path`。只读素材会话即可，不要求工作台写权限或排片权限。实际使用前重查，不缓存旧版本路径；工具不存在则报告需应用升级及 MCP 重连，不能靠磁盘扫描推测。

所有时间使用整数微秒。将绝对边界转换后相减，例如 `startUs=round(startSeconds*1000000)`、`durationUs=round(endSeconds*1000000)-startUs`，连续片段共用边界，避免逐段累加浮点误差。脚本不宣称 VFR 素材帧准确，也不自动转成恒定帧率。FPS 缺失或用户没有授权变更时先检查真实媒体，不凭空设定交付帧率。

```json
{
  "schemaVersion": 1,
  "draftName": "项目名-粗剪-v1",
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "provenance": { "projectId": "项目ID", "assemblyId": "工程ID", "versionId": "版本ID", "revision": 3 },
  "assets": [
    { "id": "video-a", "kind": "video", "path": "D:/用户提供的素材/镜头A.mp4" },
    { "id": "music-a", "kind": "audio", "path": "D:/用户提供的素材/音乐.wav" }
  ],
  "video": [
    { "assetId": "video-a", "startUs": 0, "sourceInUs": 1000000, "durationUs": 4000000, "volume": 1 }
  ],
  "audio": [
    { "assetId": "music-a", "track": "music", "startUs": 0, "sourceInUs": 0, "durationUs": 4000000, "volume": 0.3, "fadeInUs": 300000, "fadeOutUs": 500000 }
  ],
  "captions": [
    { "startUs": 500000, "durationUs": 2000000, "text": "字幕内容" }
  ]
}
```

- 顶层只支持以上字段；`provenance` 可省略，存在时只记录这四个来源字段。不是 MCP 权限令牌，不放密钥、URL 或账号配置。
- 可选 `mode` 为 `edit`（默认）或 `importOnly`。仅导入模式要求 `video/audio/captions` 全为空数组，允许素材不被时间线引用；复制完整文件并登记素材区，草稿时长为 0，不编排或裁切。`assets` 每项可选 `name`（最多 500 字符）作为显示名称。
- `assets` 只包含实际引用文件，ID 唯一。同一个文件可被多个片段引用，但每个素材 ID 只复制一次。支持 video/audio/image，不支持 prompt 素材。读取前检查根目录范围；复制时记录和比对内容哈希。
- `video` 至少一个片段，共用主轨且不允许重叠。可保留明确时间空隙；关闭主轨磁吸，不自动拼掉黑场。`volume` 必填，范围 0–2；图片必须为 0，`sourceInUs` 必须为 0。图片显示时长来自 `durationUs`。
- `video` 每个片段可选 `monochrome` 布尔值，默认 `false`；`true` 写入满强度原生“默片”滤镜，不改写源文件、不烘焙。相同素材不同片段可分别为黑白和彩色，不支持自定义滤镜 ID 或其他强度。音频和字幕不接受此字段。
- `audio` 可空；每个 `track` 是独立声音轨，同轨不能重叠。独奏/静音、轨音量和片段音量应先在计划里解析为最终有效 `volume`，不要丢弃原工程的未修改版本。音频默认淡化时长为 0，两侧总和不超过片段时长。只能引用 audio 文件。
- `captions` 可空，一个基础文字轨，不允许重叠。仅保留文字和时间；默认白色居中、底部摆放，字体由剪映默认决定，字号固定为适配器基础值，不等于工作台原样式。用户要求精确字体/样式时不能使用默认样式冒充。
- 独立音频和字幕不得越过视频主轨结尾；应在明确的计划中剪齐，而不是自动延长成片尾部。
- 时长上限 24 小时，FPS 为 1–60 的整数。29.97 等分数帧率不在本适配器支持范围，应报告而非四舍五入。

## 现有工程映射

从 `assembly_get` 指定版本读取完整数据，保存来源 revision。结合当前实例的 `assembly_capabilities`，列出所有无法映射的字段；不支持的非默认效果必须先处理或取得简化同意。

- `inPoint/outPoint` 对应源区间，`gapBefore` 对应时间轴空隙。发生重叠转场时不能直接按顺序累加后删转场，否则后续声音/字幕会错位；这类工程先报告不兼容。
- `originalAudio` 映射视频 `volume` 的 1 或 0。工作台片段和声音轨增益、muted/solo、片段关联声音锚点应使用最终生效结果。
- 已绑定声音才有可用源文件；missing/review 等状态不得伪造为空音频并宣称完整交付。用户确认允许缺声音时在差异报告中注明。
- 素材实际时长、音轨和 VFR 需检查。脚本执行时由 MediaInfo 再检查类型与源范围，超出即失败，不补帧、不自动变速。

## 输出与排错

默认命令只输出预检查 JSON；这验证计划/路径/文件存在，不导入第三方库、不检测媒体真实时长，也不证明草稿能生成。

实际执行需 `pyJianYingDraft==0.3.1` 以及它的依赖（包括可用的 MediaInfo 本地库；Windows 包还依赖 uiautomation）。先选择隔离环境；安装依赖需另行授权，不执行全局 pip、不自动联网安装。

执行会在用户草稿目录下建立私有临时目录，生成完整的新草稿后发布到唯一目录。草稿内 `media/` 保存复制的素材，库中的路径指向最终位置；移动整个草稿到另一路径不保证自动重链接。

生成后包含 `draft_content.json`、`draft_meta_info.json`、`skill-plan.json`、`skill-receipt.json` 和 `media/`。收据记录内容哈希、预期时长以及结构回读检查结果。不会修改工作台数据库或自动导入生成物；失败的临时目录保留并在错误中告知。

收据另含 `monochromeFilterSegments`、`mediaTranscoded: false` 和 `filterRenderVerified: false`。逐片段回读原生滤镜类型、ID、强度和引用，未启用片段不得带滤镜；不以饱和度关键帧作为黑白验证。

结构验证比较每条轨道的片段数量、源区间和目标区间、引用的素材 ID、文字内容与原声/音量；不代替剪映内视觉和听音验收。用户必须在本机剪映版本打开草稿验证。刷新草稿列表可先进入再退出已有草稿，必要时重启剪映；不要为刷新而擅自结束用户进程。
