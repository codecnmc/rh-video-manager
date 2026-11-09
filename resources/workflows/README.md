# 内置 H3 全能参考工作流

可下载模板的数据源均位于仓库中，通过 bootstrap 的静态 JSON import 编入应用：

- [标准版](../../src/main/providers/runninghub/h3-comfyui-template.json)：保留原有 FeiHou 全能参考模板。
- [加速版](../../src/main/providers/runninghub/h3-accelerated-template.json)：依据用户提供的 H3加速.json，原生 H3 + SelfLift；保留启用的采样预览链路，只有成片输出，无独立低清预览。加速为版本名称，不承诺固定速度倍率；API 是否收到采样仍取决于平台事件转发。

加速版已清空用户提示词、上传引用及预览历史，移除模型下载地址元数据，并修正 CreateVideo 的 chroma_subsampling 为 auto；codec 的合法 none 不变。模型名、LoRA、参考槽位和采样连接保留。网页单独运行前需自行上传引用、处理未用槽位并填写提示词；通过工作台提交时由原生适配器按实际引用绑定并移除空槽。用户原始文件未修改。

主进程 bootstrap 通过静态 JSON import 将模板编入应用；源码下载和发行包均不依赖 `docs/`、`outputs/` 或开发者电脑上的私有文件。用户可在软件「工作流总览 → 下载工作流」保存为 ComfyUI JSON，再导入自己的 RunningHub 账号。

模板用于创建线上工作流，不作为 API 检测失败时的运行回退。用户仍需填入所属账号自己的线上工作流 ID，并用该账号检测。不要把开发者的账号、API Key、私有工作流 ID、通知地址或历史任务输出加到模板。

本地 `docs/workflows/工作流.json` 为私人历史参考，不打包、不跟踪、不覆盖。维护模板时仅修改上述公开源文件，并核对通知、凭据、个人路径和输出历史。
