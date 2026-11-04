 # 心灵之窗护眼助手项目交接文档

## 1. 项目概况

项目名称：心灵之窗护眼助手。

目标是开发一个常驻桌面的护眼提醒工具：连续工作 30 分钟时提醒休息；如果用户继续工作，到 40 分钟后进入 5 分钟全屏强制休息，并在休息期间提供护眼训练和低刺激小游戏。

当前阶段：需求已确认，PRD 已落盘，代码尚未开始实现。

产品依据：[PRD.md](./PRD.md)

## 2. 当前工作区状态

截至 2026-11-02（MVP + 休息增强完成后）：

- **MVP 全部功能已实现并通过自动化验收**：七阶段开发顺序（骨架→状态机→主界面→强制休息→训练/游戏→托盘/设置/数据→验证）全部走完。
- **休息增强（应李先生 2026-11-02 反馈「休息界面加点内容」）**：新增 ①呼吸引导（4-4-6 拍，光环随拍长缩放 + 轻拍点音，闭眼可跟练，已入 auto 轮换与设置下拉）②雨声/溪流白噪音（Web Audio 本地合成、音量滑块、localStorage 记忆偏好、休息窗口关闭即停）。
- 单元测试 **32/32 通过**（`npm test`：计时状态机全部边界 + 休息流程 + 训练/呼吸计划）。
- CDP 端到端 **31/31 通过**（`EYECARE_DEV_TIMES="20,30,8"` 短时长，真实点击按钮走完 开始→提醒→延后→强制休息(严格不可跳)→自动回工作→统计+1→设置持久化→手动休息→呼吸引导→雨声开/关→暂停/冻结/恢复 全循环；截图 `shots/`）。
- `npm run typecheck`（renderer + electron 两个工程）与 `npm run build` 均通过。
- 测试产生的 userData 数据（settings.json/stats.json/Local Storage）与开机启动项已清理，交还给用户的是干净首启状态。
- 未创建 Git 仓库、未提交（按第 10 节约定）。
- 尚未打包 .app/.dmg（见第 12 节待办）。

### 已完成功能清单（对照 PRD 第 6 节）

| PRD 章节 | 功能 | 状态 |
| --- | --- | --- |
| 6.1 | 工作计时（状态/连续时长/双倒计时/今日统计/五个操作） | ✅ e2e |
| 6.2 | 30 分钟提醒（桌面通知 + 主窗口提醒卡 + 托盘变色 + 声音开关；三操作） | ✅ e2e（通知展示待真机） |
| 6.3 | 40 分钟强制休息（全屏、置顶、5 分钟倒计时、严格模式默认无跳过） | ✅ e2e |
| 6.4 | 三种护眼训练（远近切换/缓慢追踪/眨眼练习，全部含非医疗提示） | ✅ 挂载验证 |
| 6.4a | 呼吸引导（4-4-6 拍 + 拍点音）+ 雨声/溪流白噪音（本地合成/音量/偏好记忆） | ✅ e2e |
| 6.5 | 寻找远点低刺激小游戏（30–60s 观察） | ✅ 实现并接入 |
| 6.6 | 设置（全部 11 项 + 严格模式说明，训练模式含呼吸引导，即时保存热生效） | ✅ e2e 保存/回读 |
| 6.7 | 系统托盘（开始/暂停、立即休息、主界面、设置、退出 + 灰绿黄蓝四色） | ✅ 实现（四色待目测） |
| 8 | 状态机 idle/working/reminder30/extended/forcedRest/manualRest/paused | ✅ 31 单测 |
| 9 | 本地数据（settings.json + stats.json，userData 目录） | ✅ |
| — | 睡眠/唤醒不补算（powerMonitor suspend/resume → 冻结/解冻） | ✅ 单测（真机睡眠待人工） |
| — | 单实例锁、关窗驻留后台、跨天统计重置 | ✅ |

### 已修改/新增的关键文件

- `package.json` / `tsconfig.json` / `tsconfig.electron.json` / `vite.config.ts` / `.npmrc`（Electron npmmirror 镜像）
- `electron/`：`main.ts`（窗口/托盘/通知/电源/IPC/心跳）、`preload.ts`（contextBridge 最小 API）、`tray.ts`、`store.ts`
- `src/features/timer/`：`machine.ts`（纯 TS 状态机，注入时钟）、`types.ts`、`main-view.ts`
- `src/features/rest/rest-view.ts`、`src/features/rest/ambient-sound.ts`（雨声/溪流合成 + 拍点音 + localStorage 偏好）、`src/features/training/{plans.ts,runtime.ts}`、`src/features/settings/settings-view.ts`
- `src/shared/`：`settings.ts`（含 sanitizeSettings）、`api.ts`（EyeApi + window.eye 全局类型）、`src/app/format.ts`
- `index.html` / `rest.html` / `src/main.ts` / `src/rest-main.ts` / `src/styles/{main,settings,rest}.css`
- `tests/timer.test.ts`、`tests/rest-flow.test.ts`
- `scripts/gen-icons.mjs`（纯 Node PNG 编码生成托盘图标）、`scripts/e2e-verify.mjs`（CDP 端到端）、`assets/icons/`、`shots/`、`README.md`

### 已运行的命令与结果

- `npm install -D electron@45.0.0 vite vitest typescript concurrently wait-on @types/node`（Electron 二进制复用本机缓存 zip 手动解压；`.npmrc` 已配镜像防复发）
- `npm test` → 32 passed；`npm run typecheck` → 0 错误；`npm run build` → 成功
- `EYECARE_DEV_TIMES="20,30,8" npx electron . --remote-debugging-port=9333` + `node scripts/e2e-verify.mjs` → 26/26（多轮）

## 3. 已确认的产品决策

### 3.1 运行形态

必须是桌面应用，不是只在浏览器标签页中运行的网页。

应用需要支持：

- 后台常驻。
- 系统托盘。
- 桌面通知。
- 全屏、置顶的休息界面。
- 应用最小化后继续计时。

### 3.2 时间规则

- 30 分钟：重要提醒。
- 40 分钟：强制进入休息。
- 强制休息：5 分钟。
- 30 分钟提醒被忽略时，不能阻止 40 分钟强制休息。
- 默认使用严格模式。

### 3.3 隐私边界

默认只存本地数据，不采集屏幕、键盘、鼠标、当前应用和浏览记录，也不引入账号或云端服务。

### 3.4 健康边界

产品是休息提醒和习惯辅助工具，不得宣称治疗干眼、散光、视力下降或其他眼科问题。界面应避免医疗诊断式措辞。

## 4. 推荐技术路线

第一版推荐使用 Electron + TypeScript + Vite。

理由：

- 项目为空，Electron 能快速实现桌面窗口和系统托盘。
- 全屏置顶窗口和跨平台通知都有成熟能力。
- 计时、训练和设置逻辑可以与渲染层解耦。
- 后续可以补充 Windows 打包，不需要重写业务层。

建议不要在 MVP 阶段引入后端、数据库服务、账号体系或复杂状态管理框架。

## 5. 建议开发顺序

### 阶段 1：项目骨架

1. 初始化 Electron + Vite + TypeScript。
2. 建立主进程、预加载脚本和渲染进程边界。
3. 配置开发启动、构建和基础检查命令。
4. 确认 macOS 本地可以启动最小窗口。

### 阶段 2：核心计时状态机

1. 定义 `idle`、`working`、`reminder30`、`extended`、`forcedRest`、`manualRest`、`paused` 等状态。
2. 使用真实时间戳计算 elapsed time，不用渲染次数累加时间。
3. 对 30 分钟和 40 分钟边界做确定性测试。
4. 实现暂停、恢复、手动休息和重置。

### 阶段 3：主界面与提醒

1. 实现当前状态、连续工作时长和下一次提醒。
2. 实现 30 分钟提醒弹窗。
3. 实现开始休息、延后 5 分钟、继续工作三个动作。
4. 将 UI 动作通过明确接口传给计时模块。

### 阶段 4：强制休息层

1. 创建独立的休息窗口或休息路由。
2. 实现全屏和置顶。
3. 实现 5 分钟倒计时。
4. 倒计时结束前不提供严格模式下的跳过动作。
5. 处理主窗口与休息窗口之间的状态同步。

### 阶段 5：训练与小游戏

1. 先实现远近切换训练。
2. 再实现缓慢追踪训练。
3. 实现寻找远点小游戏。
4. 所有动画避免高频闪烁、快速跳动和强刺激色彩。

### 阶段 6：托盘、设置和本地数据

1. 加入系统托盘菜单。
2. 加入桌面通知和可选声音。
3. 加入设置持久化。
4. 加入每日统计。
5. 验证重新打开应用后的设置恢复。

### 阶段 7：验证与交付

1. 运行单元测试。
2. 用短时长测试配置验证完整流程，避免真实等待 40 分钟。
3. 手动验证最小化、恢复、系统托盘和全屏休息层。
4. 在 macOS 上构建可运行产物。
5. 记录已验证项和未验证项。

## 6. 关键技术约束

### 6.1 计时器

不要使用以下方式作为唯一计时依据：

- `setInterval` 每次加一秒。
- 根据 UI render 次数累加。
- 只依赖窗口是否可见。

应保存工作段开始时间、暂停时间和当前状态，用当前时间减去开始时间计算实际经过时间。

### 6.2 主进程与渲染进程

- 文件系统、本地存储、系统托盘和通知由主进程负责。
- 渲染进程只处理界面和交互。
- 通过 preload 暴露最小化、类型明确的 API。
- 不要直接在渲染进程开启 Node.js 能力。

### 6.3 强制休息

“强制”只表示应用层面的全屏置顶和流程限制。不能声称可以阻止操作系统级退出、任务管理器、终端命令或用户强制结束进程。

### 6.4 训练视觉

- 不使用快速闪烁。
- 不使用高频颜色切换。
- 不设计要求用户持续近距离盯屏的训练。
- 休息提示必须允许闭眼或看向远处。

## 7. 建议接口边界

计时模块可以提供类似接口：

```ts
type TimerAction =
  | { type: "start" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "reset" }
  | { type: "start-rest" }
  | { type: "dismiss-reminder" }
  | { type: "snooze" };

type TimerSnapshot = {
  state: "idle" | "working" | "reminder30" | "extended" | "forcedRest" | "manualRest" | "paused";
  elapsedWorkSeconds: number;
  remainingToReminderSeconds: number;
  remainingToForcedRestSeconds: number;
  remainingRestSeconds: number;
};
```

实际命名可以按实现时的代码风格调整，但要保持 UI 不直接修改计时内部变量。

## 8. 测试重点

### 单元测试

- 新建计时器的初始状态。
- 开始后状态变为 `working`。
- 29:59 不触发 30 分钟提醒。
- 30:00 触发 `reminder30`。
- 延后后进入 `extended`。
- 40:00 进入 `forcedRest`。
- 强制休息 5 分钟后进入下一轮工作。
- 暂停期间 elapsed time 不增加。
- 重置后回到初始状态。
- 睡眠时间不被错误计入工作时长。

### 集成和手动测试

- 30 分钟提醒能显示在桌面。
- 最小化后计时继续。
- 点击托盘菜单能打开主窗口。
- 40 分钟后休息窗口全屏且置顶。
- 主窗口和休息窗口状态一致。
- 休息完成后窗口正确关闭或恢复。
- 设置重启后仍然有效。

开发阶段应提供测试时间缩短配置，例如把 30 分钟和 40 分钟临时缩短为几秒，但生产默认值必须保持 30 和 40 分钟。

## 9. 交接时必须说明的事项

每次开发交接应记录：

- 已完成的功能。
- 已修改的文件。
- 已运行的命令和结果。
- 已通过的测试。
- 未完成的功能。
- 已知问题和复现步骤。
- 当前是否有未提交变更。

不要把“代码已写入”描述为“功能已验收”。桌面应用必须至少完成启动、提醒、强制休息和计时边界的实际运行验证。

## 10. 下一步

1. **李先生真机验收**（自动化覆盖不到的部分）：托盘四色图标与菜单、桌面通知是否展示、真机最小化/恢复后计时准确、真合盖睡眠唤醒后不补算、强制休息窗口的置顶/全屏观感、训练动画低刺激观感、声音提醒。
2. **打包**：引入 electron-builder 产出 .app（`dir` 目标起步，免签名），应用图标（当前用 Electron 默认图标），打包后开机启动才指向正式应用。
3. 可选迭代：休息窗口「跳过」在非严格模式的入口文案、每日统计历史趋势、Windows 适配（主进程已按跨平台 API 编写，需实测）。

### 已知问题

- 开发版（未签名 `electron .`）的 macOS 桌面通知是否展示由系统决定；不影响主窗口提醒卡与托盘。
- `npm warn Unknown project config "electron_mirror"`：npm 对自定义配置的提醒，Electron 安装器正常读取，无害。
- 休息窗口严格模式下用系统快捷键仍可切换 Space（应用层强制，PRD 已声明边界）；如需更强可用 kiosk 模式，暂未启用。
- 单元测试对 advance() 返回值与监听器双断言（修复过「事件只进返回值、监听器收不到」的回归，见根交接文档变更记录）。

### 2026-11-03 「点击立即休息闪退」 incident 与修复

李先生反馈点「立即休息」后应用「闪退」。排查结论：**进程并未崩溃**（其启动的实例一直活着，userData 无 Crashpad 报告、日志全空）——真实表象是**窗口全部消失**。定位到的确定性缺陷：从托盘/主窗隐藏状态发起休息时，休息结束只销毁休息窗口、回到工作状态，**没有任何路径把主窗口带回屏幕** → 应用驻留后台但零窗口可见，用户视角即「闪退」。修复与加固：

1. `rest-complete` / `rest-end-early` 事件后强制 `showMainWindow()`（含最小化态 `restore()`）；e2e 新增「隐藏态休息→结束→主窗口自动恢复」回归断言。
2. 全屏休息窗口创建改为构造参数直接落位到光标所在屏，**移除创建后的两次 setBounds**（macOS 全屏过渡期改 bounds 有风险）。
3. 诊断落盘：主进程启动行、uncaughtException/unhandledRejection、render-process-gone/child-process-gone、窗口 closed 全部写入 stderr（.command 的 nohup 落 `/tmp/心灵之窗.log`）；主窗口渲染进程崩溃自动重建窗口。
4. e2e 从 31 项扩到 **35/35**（新增隐藏驻留 4 项断言）；期间实测：`window.close()` 对非脚本打开窗口是空操作、macOS 最小化不改变 visibilityState、Electron CDP 未实现 `Browser.getWindowForTarget`——最终用主进程 `--inspect` Node inspector 做真实 hide/show 断言。
5. 单测 32/32 不变；typecheck/build 通过；测试后 userData 已重置，已用 `.command` 生产路径冒烟（启动日志正常落盘）。

### 2026-11-03 全量事件日志（李先生要求「把所有日志都记下来」）

此前只记异常导致「点击立即休息闪退」时无操作痕迹可查。现已全量落盘：

- **位置**：`userData/logs/app-YYYY-MM-DD.log`，每日一文件，自动清理 14 天前的（`electron/logger.ts`）；同时回显 stdout（.command 的 nohup 落 `/tmp/心灵之窗.log` 兜底）。
- **记录范围**：app-start/quit（含版本与设置快照）、状态机全部事件（timer:*）、每次用户操作（来源=主窗口/托盘/休息窗口、动作、是否被接受、当时状态）、窗口生命周期（创建/显示/隐藏驻留/最小化/关闭/渲染崩溃重建）、设置变更（哪些键从什么改成什么）、通知、电源睡眠/唤醒、每 5 分钟心跳摘要、uncaughtException/unhandledRejection/render-process-gone/child-process-gone。隐私红线不变：只记应用内部事件与按钮名。
- **体检脚本** `scripts/check-log.mjs`：解析日志→校验状态转移合法性表（7 状态）→休息开始/结束配对→心跳断档（>6.5 分钟需有 suspend 解释）→列出被拒绝操作与错误行，输出「日志时序正常/发现 N 类问题」。
- **验证**：真实操作序列（开始→提醒→继续→强制休息→呼吸引导→手动休息→提前结束→暂停/恢复→改设置）生成 33 行日志，体检全绿；e2e 35/35 回归通过。落地当天即立功：一眼揪出一个未被杀净的测试实例在 15/20/6 配置下无限循环强制休息（日志直接显示 rest-complete 已到 8 次、无人操作）。

### 2026-11-03 托盘眼睛图标 + 桌面小时钟（李先生优化点 1/2）

1. **托盘图标**：`scripts/gen-icons.mjs` 从圆点改为杏仁形「眼睛」（眼白 250,251,253 + 深色描边保证深浅菜单栏可见 + 状态色瞳孔 + 高光），四色语义不变（灰/绿/黄/蓝瞳孔 = idle/工作/提醒/休息）。像素级程序化验证（中线眼宽 34px、瞳孔/眼白像素分布）。
2. **桌面小时钟**（PRD 6.7a）：主窗隐藏时显示半透明置顶小窗（232×64 胶囊卡片，可拖动、位置记忆 widget.json、点「打开主窗」恢复主窗）；工作中=距强制休息倒计时（绿点）、提醒=黄点、休息=蓝点+剩余、idle=灰点；设置开关「后台时显示桌面小时钟」默认开。实现为 **index.html#widget 路由**（与主窗同 bundle），**按需创建/销毁**：主窗可见的常态 renderer 进程数=1（113MB），仅后台时段多一个轻量进程（~110MB，页面包 0.7KB gzip），全屏休息开始即销毁。
3. **过程中的关键决策与坑**：①曾尝试自定义标准协议 xlb:// 想让主窗/小钟共享渲染进程——透明窗口强制独立进程，共享不成立且引入 rest 窗口偶发不渲染，果断回退 file:// + 按需销毁方案（内存反而更优：常态零开销）②状态机 `rest-start` 语义事件先于 `state-change` 发出，事件处理器里读 `getState()` 是旧状态——小窗显隐判定必须以 state-change 后的校准为准，rest-start 里直接销毁 ③e2e 教训：多窗口后 `getAllWindows()` 顺序不定，定位窗口必须精确匹配 URL（index.html vs index.html#widget）；macOS 隐藏/最小化窗口的 `document.visibilityState` 恒为 visible，断言窗口显隐必须用主进程 `isVisible()`（经 --inspect Node inspector）。
4. **验证**：e2e 扩到 **40/40**（新增小钟 6 项：主窗隐藏→显示、倒计时格式、点击恢复、主窗恢复→销毁、全屏休息→销毁、闪退回归保持）；单测 32/32；typecheck/build 通过；内存实测两态（主窗可见=1 进程 113MB / 后台=2 进程）。

### 2026-11-03 多显示器强制休息覆盖（李先生：「使用扩展屏幕，休息时要一起纳入其中」）

- **实现**：`ensureRestWindow` 改为遍历 `screen.getAllDisplays()`，每屏一个全屏置顶窗（构造参数落位该屏 bounds）；光标所在屏加载 `rest.html` 完整界面，其余屏加载 `rest.html#mirror` 简洁镜像（120px 大倒计时 + 「这块屏幕也在休息 · 可以闭眼」+ 免责，无交互）。`restWindows: BrowserWindow[]` 数组管理，`closeRestWindow` 全部销毁，每窗独立严格模式关闭拦截；镜像与主界面同 bundle（hash 路由），无新构建产物。
- **验证（双屏实测，本机即接有 x=1710 的第二屏）**：e2e 扩到 **42/42**，新增断言「休息窗口数 === `screen.getAllDisplays().length`」与「副屏镜像倒计时格式」；副屏截图 `shots/05-副屏休息镜像.png`（1600×1200 暗色 + 大倒计时亮像素 609）；手动/强制休息结束全部窗口消失；单测 32/32。
- 已知边界：休息进行中热插拔显示器不动态增减窗口（5 分钟窗口内属小概率，窗口由系统自然处理）。

### 2026-11-03 打包 .app v0.2.0 并装入 /Applications（李先生「测试 ok，继续」后的下一待办）

- **应用图标**：`scripts/gen-app-icon.mjs` 生成 512×512 品牌图标（深色渐变圆角底 + 白眼 + 品牌蓝渐变瞳 + 高光，与托盘图标同语言），像素级验证（四角透明/瞳孔渐变/圆角占比）。
- **打包**：electron-builder 26（`electron-builder.yml`，mac dir arm64 免签名 identity:null；files 只带 dist/dist-electron/assets——运行时零 npm 依赖，asar 打包）。产物 258MB（Chromium 全家桶属正常）。
- **两个坑**：①electron-builder 26 对非 ASCII productName 静默回退 Electron.app（yml/CLI 均如此）→ `scripts/finalize-app.sh` 后处理：改名 + PlistBuddy 写 CFBundleName/DisplayName/Identifier=cn.dengshan.soul-window/IconFile + iconset→iconutil 生成 app.icns；②二进制下载 TLS 断开（直连 GitHub）→ `.npmrc` electron_mirror + `ELECTRON_MIRROR` 环境变量双保险（electronDownload.mirror 字段在 26 未生效）。
- **验证**：打包 .app 带调试端口启动 CDP 冒烟——主窗口状态流转/时钟推进/手动休息双屏 2 窗/副屏镜像倒计时 04:58/结束回工作全过；userData 与 dev 模式同目录（「心灵之窗护眼助手」）无缝延续；已 cp 至 /Applications 并从正式位置启动成功；开机启动注册为登录项「心灵之窗护眼助手」→ /Applications 路径（旧的 dev "Electron" 登录项已清理）。`启动心灵之窗.command` 改为优先 `open -a` 正式应用，无正式版才退回 dev 模式。
- 单测 32/32、双 typecheck 回归通过。**遗留**：分发需签名公证（本机自用免）；未来 icon 可请设计师替换 `build/icon.png` 后重跑 dist+finalize。

### 2026-11-03 息屏强制休息不全屏修复（李先生截图反馈）+ 非严格模式跳过入口（v0.2.2）

- **息屏场景根因**：息屏/唤醒过渡期 macOS 无法为某屏建立全屏空间，构造时 `fullscreen:true` 静默失败 → 窗口以 900×600 默认尺寸定格在左上，右侧/下方露出其他应用（见用户截图）。
- **修复三道防线**：①创建时直接给整屏尺寸（x/y/width/height 全设），全屏失败也至少铺满；②休息期间每 3 秒自愈校验 `ensureRestWindowIntegrity`——判定「是否铺满所在屏」（位置/尺寸偏差 >100px），丢失即 `setBounds` 拉回整屏 + 重申 screen-saver 置顶；③powerMonitor resume 与 screen display-metrics-changed 事件触发即时校验。
- **排障关键发现（已记入坑）**：`frameless + resizable:false` 窗口上 `isFullScreen()` 恒为 false、`setFullScreen()` 运行中被 macOS 忽略，只有 `setBounds` 可靠；自愈判定因此走尺寸/位置而非全屏标志。
- **验证**：e2e 扩到 **43/43**（新增「人为踢出全屏缩小到 900×600 → 3 秒内自动拉回整屏」断言，实测通过）；单测 32/32。同时顺带修 e2e 多窗口定位 bug（findPage 曾把 mirror 当主休息窗）。
- **非严格模式跳过入口**：强制休息窗底部新增低调文字按钮「跳过本次休息」（仅在 `strictMode: false` 时显示，严格模式完全不提供），手动休息场景保持不显示；样式与「结束休息，回去工作」区分权重。e2e 扩到 **44/44**。
- 重打包 v0.2.2 装入 /Applications 并启动验证。

### 2026-11-04 托盘图标美观优化（李先生反馈「图标还可以再优化得美观一些」）

- **问题**：第一版眼睛图标太小（44px 中有效区域仅 39×25px）、描边太细（1.6px），缩到菜单栏 22px 后几乎不可见。
- **重做**：加粗描边到 3px、眼睛更饱满（占高度 ~68%）、瞳孔加大（占眼睛宽度 ~38%）、高光提亮。生成后程序化验证（眼睛 43×27px 覆盖范围、瞳孔/眼白像素分布）。
- **验证**：22px 缩放预览确认可读性提升；重打包装入 /Applications 运行中。

当前不需要创建分支、提交或推送 Git，除非用户明确要求。无未提交变更（无 Git 仓库）。

## 11. 项目文档维护规则

这是本项目的固定协作流程：

1. 每次开始开发、修复或功能调整前，必须重新读取本文件，确认当前项目状态、产品决策、技术约束和未完成事项。
2. 开发过程中如果发现需求、边界、状态机、验收标准或技术方案发生变化，应同步更新 `docs/PRD.md`，不能只修改代码。
3. 每次开发完成后，如果项目有行为、功能范围、默认配置或验收状态更新，应及时回写 `docs/PRD.md`。
4. 如果交接信息、已完成项、测试结果或已知问题发生变化，应同步更新本文件。
5. 文档状态必须以真实代码和实际运行验证为依据；不能把计划、推测或未验证内容写成已完成。

### 2026-11-04 眼睛形态图标（李先生选定「斜眼-长睫毛」风格，v0.2.4）

- **灵感来源**：iconfont「明眸」搜索结果，李先生选定「斜眼-长睫毛」方案（长睫毛、几何轮廓、22px 下清晰）。
- **四状态**：工作=明眸大眼（睫毛最长最翘）、提醒=眯眼（变扁+睫毛下垂+瞳孔缩小）、休息=闭眼（弧线+下垂睫毛）、未开始=半睁。右眼特征：瞳孔偏左、外眼角尖尖。
- **生成**：`scripts/gen-eye-icons-v5.mjs` 程序化绘制（贝塞尔曲线眼型 + 睫毛线段 + 瞳孔圆），22px 预览验证清晰。
- **打包**：v0.2.4 已装入 /Applications 运行中。
