# 跨进程契约

这里只放可序列化 DTO、Zod 输入校验、稳定错误码与事件定义。当前包含工作区草稿及修订契约、预览快照与事件、专用桌面桥接 API 和 H3 提示词结构校验。

不得导入 Electron、React、Node.js I/O、数据库、HTTP 客户端或其他业务模块实现。主进程、preload、renderer 和 MCP 必须共享契约，但不能共享持久化对象或全局可变状态。

远端 ID 使用字符串。后续 IPC 与 MCP 的输入在主进程边界校验，renderer 不得持有密钥或原始 IPC 调用能力。

