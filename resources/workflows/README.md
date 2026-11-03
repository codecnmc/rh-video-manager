# 内置 H3 全能参考工作流

可下载模板的唯一数据源是仓库内已跟踪的 [`src/main/providers/runninghub/h3-comfyui-template.json`](../../src/main/providers/runninghub/h3-comfyui-template.json)。

主进程 bootstrap 通过静态 JSON import 将模板编入应用；源码下载和发行包均不依赖 `docs/`、`outputs/` 或开发者电脑上的私有文件。用户可在软件「工作流总览 → 下载工作流」保存为 ComfyUI JSON，再导入自己的 RunningHub 账号。

模板用于创建线上工作流，不作为 API 检测失败时的运行回退。用户仍需填入所属账号自己的线上工作流 ID，并用该账号检测。不要把开发者的账号、API Key、私有工作流 ID、通知地址或历史任务输出加到模板。

本地 `docs/workflows/工作流.json` 为私人历史参考，不打包、不跟踪、不覆盖。维护模板时仅修改上述公开源文件，并核对通知、凭据、个人路径和输出历史。
