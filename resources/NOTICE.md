# 应用图标来源

- 当前图标：用户于 2026-10-22 确认的羊驼与剪辑场记板图案，通过 online-image 服务生成。
- 原始预览：outputs/app-icon-alpaca-v1/online-image-20261022-155029-1.png。
- 处理：清除圆角底板外侧的近白背景，导出本地 PNG 与多尺寸 Windows ICO；不使用远程资源。
- 历史图标使用 Twemoji 14.0.2 的 U+1F999 Llama，作者 Twitter, Inc. and other contributors，来源 https://github.com/twitter/twemoji/blob/v14.0.2/assets/72x72/1f999.png 。历史许可文件 TWEMOJI-LICENSE-GRAPHICS 保留。
- 字体及界面操作图标仍沿用项目现有本地资源和 Font Awesome。

## 字幕卡字体

- 新增 Noto Serif CJK SC Regular 与 Noto Sans CJK SC Regular，来源为 notofonts/noto-cjk，固定修订 f8d157532fbfaeda587e826d4cd5b21a49186f7c。
- 原始 OTF 未修改，许可为 SIL Open Font License 1.1。字体、许可及 SHA-256 清单位于 resources/fonts，并作为独立资源随应用打包。
- 字幕卡预览与 FFmpeg 导出使用相同本地字体，不依赖系统安装或运行时 CDN。来源及扩展说明见 docs/contracts/assembly-generated-visuals.md。

## 内置媒体引擎

- FFmpeg / FFprobe 6.1.1 Windows x64，默认供本地导出和连续镜头衔接素材处理使用。
- 许可证、来源、版本和 SHA-256 清单随应用放在 resources/media-engine/win32-x64；参见该目录 NOTICE.md、FFMPEG-LICENSE.txt、DEPENDENCY-LICENSE.txt 和 manifest.json。
- 独立程序使用 GPLv3 构建，包装代码许可不能替代二进制许可；对外再分发前须落实确切构建及依赖的完整对应源码提供义务，详见 docs/third-party/media-engine.md。
