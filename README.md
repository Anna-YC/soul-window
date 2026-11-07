# 心灵之窗护眼助手

> 常驻 macOS 桌面的护眼提醒工具，帮你在长时间盯屏时建立规律休息习惯。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)
[![Electron](https://img.shields.io/badge/electron-45-brightgreen.svg)](https://www.electronjs.org/)

---

## 这是什么

一个为长时间使用电脑的人设计的护眼工具。它不是简单的番茄钟，而是**在你真正需要休息的时候，温柔但坚定地让你离开屏幕**。

- **30 分钟**：桌面通知 + 主窗口提醒卡，你可以继续工作、延后 5 分钟，或开始休息
- **40 分钟**：全屏强制休息 5 分钟（严格模式下无法跳过）
- **休息期间**：护眼训练、低刺激小游戏、雨声白噪音陪你度过

---

## 核心特性

### 计时与提醒
- 真实时间戳计时（不依赖渲染帧数），最小化/睡眠/唤醒全部正确处理
- 30 分钟提醒 → 可延后 5 分钟 → 40 分钟强制休息
- 严格模式默认开启（休息不可跳过），可关闭

### 多显示器支持
- **每块屏幕各一个全屏休息窗**：主屏完整界面，其余屏简洁镜像
- 息屏/唤醒时自愈（每 3 秒校验全屏状态，丢失即拉回）

### 休息内容
| 类型 | 说明 |
|---|---|
| 远近切换 | 看远 20 秒 → 看近 10 秒，循环 2-3 轮 |
| 缓慢追踪 | 目光跟随缓慢移动的光点 |
| 眨眼练习 | 引导缓慢眨眼 5-8 次 |
| 呼吸引导 | 4-4-6 拍节奏（吸-停-呼），光环随拍缩放 |
| 寻找远点 | 低刺激小游戏，放松观察漂移目标 |
| 雨声/溪流 | 本地合成白噪音，音量可调，偏好记忆 |

### 桌面小时钟
- 主窗隐藏时，桌面显示半透明倒计时（可拖动、位置记忆）
- 按需创建/销毁：主窗可见时进程不存在，常态零额外内存

### 托盘图标
- 眼睛形态随状态变化：工作=明眸大眼、提醒=眯眼、休息=闭眼、未开始=半睁
- 右眼特征：瞳孔偏左、外眼角尖尖、长睫毛

### 隐私与日志
- 所有数据只存本机，无账号无云端
- 不采集屏幕、键盘、鼠标、应用使用记录
- 全量事件日志（每日一文件，保留 14 天），排障时可直接定位

---

## 快速开始

### 日常使用（已安装）

直接打开 `/Applications/心灵之窗护眼助手.app`，或双击 `启动心灵之窗.command`。

### 从源码运行

```bash
git clone https://github.com/Anna-YC/soul-window.git
cd soul-window
npm install          # 安装依赖（Electron 走 npmmirror 镜像）
npm start            # 构建并启动（生产默认 30/40/5 分钟）
```

### 开发模式

```bash
npm run dev          # Vite 热更新 + Electron
npm test             # 单元测试（51 项，含设置/音频/持久化回归）
npm run typecheck    # 类型检查
```

### 打包 .app

```bash
npm run dist              # 一键：构建 → electron-builder → 中文名/bundleId/icns 后处理
```

### 验收用短时长模式

```bash
EYECARE_DEV_TIMES="20,30,8" npx electron . --remote-debugging-port=9333
node scripts/e2e-verify.mjs   # CDP 端到端：44 项断言
```

---

## 项目结构

```
soul-window/
├── electron/           # 主进程（窗口/托盘/通知/电源/持久化/日志）
│   ├── main.ts         # 入口：状态机驱动 + 窗口编排
│   ├── tray.ts         # 托盘：眼睛形态图标 + 菜单
│   ├── store.ts        # 本地 JSON 持久化（settings/stats/widget 位置）
│   ├── logger.ts       # 全量事件日志（每日一文件）
│   └── preload.ts      # contextBridge 最小 API
├── src/
│   ├── features/timer/ # 纯 TS 计时状态机（无 Electron 依赖，32 单测）
│   ├── features/rest/  # 休息窗口（完整界面 + 副屏镜像）
│   ├── features/training/  # 训练计划 + 舞台动画运行时
│   ├── features/settings/  # 设置面板（即时保存）
│   ├── features/widget/    # 桌面小时钟（按需创建/销毁）
│   └── shared/         # 设置/统计/IPC 类型（主进程与渲染进程共用）
├── tests/              # vitest 单元测试（状态机/流程/训练计划）
├── scripts/            # 图标生成 / CDP 端到端 / 日志体检 / 打包后处理
├── assets/icons/       # 托盘四态图标（眼睛形态，脚本生成）
├── build/              # 应用图标（512px 品牌图）
├── docs/               # PRD + 项目交接文档
└── shots/              # 端到端验收截图
```

---

## 技术栈

- **Electron 45**：桌面窗口、系统托盘、全屏置顶、电源监听
- **TypeScript 7**：严格类型，状态机与 UI 解耦
- **Vite 8**：前端构建（主窗口 + 休息窗口 + 桌面小时钟三入口）
- **Vitest 5**：单元测试（注入时钟，真实时间差断言）
- **原生 CSS**：低刺激动画，无 UI 框架依赖

---

## 设计原则

1. **计时独立于 UI**：状态机是唯一真源，UI 只读快照、发动作
2. **低刺激**：无快速闪烁、无高频变化、允许闭眼或看向远处
3. **隐私红线**：不采集任何输入内容，日志只记应用内部事件
4. **可验证**：所有核心逻辑有单测，端到端用 CDP 真实点击走完整流程

---

## 已知边界

- 「强制」是应用层全屏置顶，无法阻止系统级强制退出（设计如此）
- .app 为本机免签名构建；分发需开发者证书签名公证
- 桌面通知在未签名应用上由 macOS 决定是否展示
- 休息进行中热插拔显示器不动态增减窗口（5 分钟窗口内属小概率）

---

## 文档

- [PRD（产品需求文档）](./docs/PRD.md)
- [项目交接文档（开发记录/坑/决策）](./docs/PROJECT_HANDOFF.md)

---

## License

MIT
