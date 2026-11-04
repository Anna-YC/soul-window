# 心灵之窗护眼助手

常驻 macOS 桌面的护眼提醒工具：连续工作 **30 分钟**提醒休息；继续工作到 **40 分钟**进入 **5 分钟**全屏强制休息（默认严格模式，不可跳过；**多显示器时每块屏幕都进入休息**——主屏完整界面、其余屏大倒计时镜像）。休息期间提供远近切换、缓慢追踪、眨眼练习、呼吸引导四种护眼训练、「寻找远点」低刺激小游戏，以及雨声/溪流白噪音（本地合成、可调音量、记住偏好）。托盘图标为眼睛造型（瞳孔四色表状态）；主窗隐藏后台运行时，桌面显示半透明小时钟（按需创建/销毁，常态零额外内存）。

产品定义见 [docs/PRD.md](./docs/PRD.md)，开发交接见 [docs/PROJECT_HANDOFF.md](./docs/PROJECT_HANDOFF.md)。

## 启动

**日常使用（已安装）**：直接打开 `/Applications/心灵之窗护眼助手.app`，或双击项目里的 `启动心灵之窗.command`（它现在只是打开正式应用）；聚焦态/启动器/Launchpad 里搜「心灵之窗」也行。

```bash
npm run dist            # 重新打包 .app（electron-builder，产物在 release/mac-arm64/）
./scripts/finalize-app.sh  # 打包后处理：中文应用名/bundleId/icns（builder 26 对中文 productName 回退，此脚本补齐）
npm start               # 开发方式直接跑（生产默认 30/40/5 分钟）
npm run dev             # 开发模式（Vite 热更新 + Electron）
npm test                # 单元测试（32 项）
npm run typecheck
node scripts/check-log.mjs          # 日志体检（自动校验状态转移/休息配对/心跳断档）
node scripts/check-log.mjs 2026-11-03  # 指定日期
```

首次安装依赖：`npm install`（Electron 二进制已配置 npmmirror 镜像，见 `.npmrc`；打包时如遇下载 TLS 失败，加 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`）。`release/` 目录可删（再跑 dist 重新生成）。

## 验收用短时长模式

不动生产默认值，用环境变量临时缩短时间做端到端验收：

```bash
# 提醒 20 秒 / 强制 30 秒 / 休息 8 秒
EYECARE_DEV_TIMES="20,30,8" npx electron . --remote-debugging-port=9333
node scripts/e2e-verify.mjs   # CDP 端到端：31 项断言（真实点击走完整循环，含呼吸引导与雨声）
```

截图证据在 `shots/`。

## 结构

```
electron/          主进程（main/tray/store/preload），计时状态机的宿主
src/
  features/timer/  纯 TS 计时状态机（machine.ts，无 Electron 依赖，31 项单测）
  features/rest/   休息窗口视图
  features/training/ 训练计划（纯函数）+ 舞台动画运行时
  features/settings/ 设置面板（即时保存）
  shared/          设置/统计/IPC 类型（主进程与渲染进程共用）
tests/             vitest 单元测试
scripts/           图标生成 / CDP 端到端脚本
assets/icons/      托盘四色状态图标（脚本生成）
```

## 数据与隐私

设置与每日统计只存本机 `~/Library/Application Support/心灵之窗护眼助手/`（`settings.json`、`stats.json`）。不采集屏幕、键盘、鼠标和应用使用记录，无账号无云端。

## 运行日志（排障用）

应用自身的全部关键事件都会落盘：`~/Library/Application Support/心灵之窗护眼助手/logs/app-日期.log`（每天一个文件，自动保留 14 天）。记录范围：状态机每次流转、每次按钮/托盘操作（含来源与是否生效）、窗口创建/显示/隐藏/关闭、系统睡眠/唤醒、通知、每 5 分钟心跳摘要、全部异常。只记应用内部事件与按钮名，不含任何输入内容（守住 PRD 隐私红线）。出问题时把对应日期的日志给 Agent 或跑 `node scripts/check-log.mjs` 即可定位。

## 已知边界

- 「强制」是应用层全屏置顶 + 不可跳过，无法阻止系统级强制退出（设计如此，见 PRD §6.3）。
- .app 为本机免签名构建（identity: null）；本机构建的产物无 quarantine 属性可直接运行。如需分发给别人，需开发者证书签名公证。
- 桌面通知在未签名应用上由 macOS 决定是否展示；主窗口提醒卡和托盘状态不受影响。
- 打包 v0.2.0 已装入 /Applications；设置里的「开机启动」已指向正式应用（登录项名「心灵之窗护眼助手」）。
