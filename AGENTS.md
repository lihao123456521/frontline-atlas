# 项目工作规则

- 默认中文，战争是核心玩法。默认界面优先地图和当前战斗；经营、统计和历史记录按需打开。
- 修改前读取 `.codex/lessons.md`，保留既有正确内容与用户未提交工作。
- PC 与平板都需要验证：单击/触摸、持续按压跨日刷新、拖动取消、双指缩放、横竖屏边界。VM 测试不能称为真实平板实机验收。
- 所有交付必须提交完整源代码并发布到 `https://gangtiexiongxin-game.netlify.app/`，确认正式网址的 `version.json` 与 `hoi-build` 一致。只做本地修改不能算完成。
- 本地已配置 `core.hooksPath=.githooks`，提交后自动运行测试、构建、生产部署和正式网址验证。新克隆先运行 `git config core.hooksPath .githooks`；需要原有 Netlify 账户登录权限。Hook 失败时用 `npm run deploy` 重试并说明失败，禁止忽略。
- `npm run build` 自动更新资源指纹。只上传生成的 `dist`；不得上传 `.git`、凭据、测试、日志、临时包或开发文档。禁止输出含凭据的远程地址；需要检查时只展示脱敏主机和路径。
- 提交前执行 `node --test tests/*.test.cjs`、`python -B -m unittest discover -s tests -p test_server.py` 和 `git diff --check`，并在浏览器验证核心操作。发布结果以正式网址验收为准。
