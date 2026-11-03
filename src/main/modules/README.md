# 业务模块边界

当前已编写 `projects` 项目元数据、`scripts` 分集剧本、`video` 项目级视频草稿、`assets` 分类素材与引用、`accounts` 加密账号配置、`workflows` 账号内工作流，以及 `jobs` 预览会话。付费提交与持久化任务调度尚未实现，不创建空服务。

单个模块使用 `domain/`、`application/`、`ports/`、`adapters/` 和公共入口 `index.ts`，只在存在相应实现时创建子目录。

- `domain`：纯领域类型、规则与状态转换，不依赖框架、数据库或其他模块实现。
- `application`：用例编排，通过 ports 使用外部能力。
- `ports`：模块需要的仓储、执行器和其他服务接口。
- `adapters`：端口的具体实现，不允许被其他模块直接导入。
- `index.ts`：仅导出明确的公共契约和服务，不使用全量转发导出内部文件。

跨模块通过公共服务或注入端口协作，禁止读取其他模块的数据表、仓储、内部文件及 UI store。依赖统一在 `main/bootstrap` 组装，不在模块内部查找全局服务。

SQLite 适配器位于 `main/infrastructure/database`，使用 `node:sqlite`；项目和剧本各自拥有仓储端口及数据表访问实现。工作区应用服务通过公共服务协调事务与修订，不让业务模块依赖数据库。当前预览会话仅驻留内存，不等同于持久化任务队列。

`scripts` 管理分集剧本，不再管理分镜，不依赖 H3、RunningHub 或任务实现。`video` 独立管理项目级草稿，剧本不是视频的前置条件。工作区聚合层协调修订与软删除，历史表保留存档。素材 MCP 与 UI 共用 assets 公开服务，不读取其他模块内部状态。当前契约见 `docs/contracts/video-assets-mcp.md`。

