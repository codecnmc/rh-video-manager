# 前端模块边界

按业务能力创建 feature；页面负责组装，组件负责展示，hooks 负责界面编排。不得从前端调用 Node.js、数据库、RunningHub 或其他 feature 的内部文件。

- Zustand：界面临时状态，按 feature 创建 store，不建设全局业务大 store。
- TanStack Query：通过受控桥接读取的持久化数据和任务快照。
- React Hook Form + Zod：表单编辑与输入校验，不以 UI 校验替代主进程校验。
- `components/ui`：shadcn 基础组件，不依赖 feature、桥接或业务 store。
- Font Awesome 7：按需导入图标，不引入整包图标注册、运行时 CDN 或另一套图标库。

当前 `workbench` 按已确认设计组装独立的 `scripts`、`video`、`assets`、`accounts`、`workflows`、`mcp` 公共入口；不提供分镜管理或手工关联任务。界面选中项用 Zustand，持久化快照用 Query，编辑表单用 React Hook Form + Zod，通过专用 preload API 交给主进程持久化，不使用 localStorage 保存业务数据。

实时采样、低清预览与最终成片分开显示；没有真实媒体时不得用参考图伪装结果。素材库使用真实本地媒体，素材 MCP 默认关闭且只读。付费提交仍禁用，不提供虚假成功交互。生成基础组件时将默认图标替换为 Font Awesome 7。

