# api-server 项目规则

- 测试命令：`npm test`（集成测试会真实启动 HTTP 服务）
- 路由统一走 `src/router.js` 的 `handleRequest`
- 数据层为内存 `UserStore`，重启即重置
