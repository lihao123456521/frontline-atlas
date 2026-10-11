# 指挥台与战役体验改版

用户已选择 A：界面、交互、玩法闭环综合改进。保留原生 HTML/CSS/JS、现有地图和战斗模型，不引入框架。

## 设计与验收

- 地图居中，左侧固定导航与时间控制，右侧情境面板，顶栏资源中文标签与月度收支；日志默认折叠，可展开分类查看。
- 开局展示战役定位和操作提示。省份点击只选择；移动和进攻通过明确命令进入目标选择，再确认执行。地图与单位使用一致操作。
- 战役任务持久化：准备（安排研究、下达训练）、扩军（完成科研、训练与工厂建设）、选择扩张或工业发展路线。奖励需主动领取，每阶段仅一次，无强制倒计时。
- 成本、资源缺口、队列进度可读；暂停状态、返回概览、存档入口明确。
- 旧存档可迁移；坏存档不能破坏当前状态。修改后验证真实浏览器中的开局、导航、科研、生产、移动/进攻预览、存读档，以及 1440/1280/窄窗口布局。

## 实施计划

- [x] 游戏状态与任务：`js/game.js`，新增 `js/campaign.js`、`tests/campaign.test.cjs`。任务与奖励保持状态层管理；测试任务推进、奖励幂等、路线、存档迁移和错误恢复。
- [x] 界面与交互：`js/ui.js`、`js/main.js`。接入固定导航、任务视图、可见禁用原因、明确调兵、暂停与存档；修正已有继续游戏失败和折叠面板导航问题。
- [x] 视觉与布局：`index.html`、`css/command-center.css`、`js/map.js`。海军蓝/暖金指挥台、地图空间不被面板挤压、减少图标遮挡、适配窄屏与键盘焦点。
- [x] 集成验证：Node 任务测试、JS 语法检查、浏览器实测与截图检查。按规格与代码质量两阶段审核，修复发现的问题，记录实际验证范围。

## 模块接口

任务由游戏导出 `getCampaign()`、`claimCampaignReward()`、`chooseStrategy('industry'|'expansion')`；`getCampaign()` 返回 `{stageIndex,title,description,tasks:[{id,title,detail,current,total,done,view}],reward,status,strategy}`，status 为 `active|ready|complete`。`chooseStrategy` 仅最终阶段未领奖前有效。`autosave()` 返回布尔值；`load()` 未传参时从 `hoi_save_v2` 读取。

HTML 新增 `commandNav`（按钮 `data-view=overview|province|production|research|focus|diplo|war|campaign`）、`btnSave`、`btnHome`、`btnAdvance`、`btnPause`、`btnLogToggle`、`logSummary`、`contextHint`、`campaignSummary`。导航由 UI 在开局/读档后显示；地图上方 `objectiveBar` 由 UI 改为可点击任务概览。`body.playing` / `body.panel-collapsed` / `body.log-expanded` 管理布局。
