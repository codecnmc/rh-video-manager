# 内置媒体引擎声明

本应用以独立外部进程调用 FFmpeg 和 FFprobe。二者随 Windows x64 应用分发，在 resources/media-engine/win32-x64 内；素材处理无需联网，应用运行时不下载程序，也不搜索系统 PATH。

## 版本与来源

- npm 依赖：ffmpeg-ffprobe-static，固定版本 6.1.1。项目：https://github.com/descriptinc/ffmpeg-ffprobe-static 。包元数据声明 GPL-3.0-or-later；原始包装代码的 LICENSE 原样附在 DEPENDENCY-LICENSE.txt，不用包装代码许可替代二进制许可。
- 安装脚本固定发布标识：b6.1.1-rc.1。二进制下载发布页：https://github.com/srikanth-descript/ffmpeg-ffprobe-static/releases/tag/b6.1.1-rc.1 。下载仅发生于开发依赖安装，不发生于终端用户运行。
- 实际两个二进制均为：6.1.1-essentials_build-www.gyan.dev；FFmpeg 项目：https://ffmpeg.org/ ；Windows 构建来源：https://www.gyan.dev/ffmpeg/builds/ 。构建启用了 GPL、version3、静态链接、libx264、libx265 等组件。构建工具链为 GCC 12.2.0 / MSYS2。
- FFmpeg 源码：https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz 。构建发布与脚本：https://github.com/GyanD/codexffmpeg 。具体依赖的对应源码、补丁与编译配置应以该构建提供的材料为准，FFmpeg 主源码不代表完整静态依赖源码。
- 两个可执行文件的 SHA-256、依赖和发布版本记录在随附 manifest.json，源仓库维护 scripts/media-engine/win32-x64.json。装配前必须与固定摘要匹配，不允许环境变量静默替换为其他发行版。

## 许可证与再分发

FFmpeg 与 FFprobe 的构建使用 GNU GPL version 3，完整许可原样附在 FFMPEG-LICENSE.txt。Copyright (c) 2000-2023 the FFmpeg developers；FFprobe Copyright (c) 2007-2023 the FFmpeg developers。二进制未作修改。FFmpeg 名称和标志不表示其开发者为本应用背书。

本应用对程序的本地调用与打包配置不等于完成面向第三方发布的全部许可义务。对外提供下载或分发安装包时，分发者必须按 GPLv3 为这一确切构建及其静态链接依赖提供适用的完整对应源码、构建材料和许可声明；仅放通用源码链接或 npm 包链接不足以替代该义务。还需核对相关组件及编解码器的其他适用许可或专利要求。本次接入完成本机依赖与资源装配，未建立公开源码分发站点或作出法律合规结论。

引擎体积约 158 MiB，二者共同打包；不把开发依赖或下载器放进应用运行时。缺失资源会在装配/打包前报错，运行时保留修复安装及手动选择备用引擎入口。
