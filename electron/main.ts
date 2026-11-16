// 心灵之窗主进程：窗口 / 托盘 / 通知 / 电源 / 持久化，驱动纯 TS 计时状态机
// 状态机是唯一计时真源（PRD §8：计时独立于 UI）；渲染进程只收快照、发动作。
// 2026-11-03 起：全部关键事件（状态流转/用户操作/窗口生命周期/异常）经 logger 落盘，
// 位置 userData/logs/app-YYYY-MM-DD.log，保留 14 天；排障直接读日志对时序。
import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  powerMonitor,
  screen,
} from 'electron';
import { join } from 'node:path';
import { TimerMachine } from '../src/features/timer/machine';
import type { TimerAction, TimerConfig, TimerEvent } from '../src/features/timer/types';
import { nextAutoRotationIndex } from '../src/features/training/plans';
import { IPC, sanitizeSettings, type AppSnapshot, type UserSettings } from '../src/shared/settings';
import { logEvent } from './logger';
import { TrayController } from './tray';
import { resolveWidgetPosition } from './widget-position';
import { loadSettings, loadStats, saveSettings, saveStats, loadWidgetPosition, saveWidgetPosition } from './store';

// ---- 全局状态 ----
let mainWindow: BrowserWindow | null = null;
let restWindows: BrowserWindow[] = []; // 每块屏幕一个（主屏=完整界面，其余=镜像）
let widgetWindow: BrowserWindow | null = null;
let tray: TrayController | null = null;
let isQuitting = false;
let tickCount = 0;
let restRotationIndex = 0; // auto 训练轮换由主进程持有，跨休息窗口生效
let settings: UserSettings = loadSettings();

/** 开发/验收用短时长：EYECARE_DEV_TIMES="提醒秒,强制秒,休息秒"，生产默认 30/40/5 分钟 */
const DEV_TIMES = parseDevTimes(process.env.EYECARE_DEV_TIMES);

const machine = new TimerMachine({
  config: timerConfig(settings),
  initialStats: loadStats() ?? undefined,
});

function parseDevTimes(raw: string | undefined): Partial<TimerConfig> | null {
  if (!raw) return null;
  const [r, f, s] = raw.split(',').map((n) => Number(n.trim()));
  if (![r, f, s].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { reminderSeconds: r, forcedAfterSeconds: f, restSeconds: s };
}

function timerConfig(s: UserSettings): TimerConfig {
  return {
    reminderSeconds: s.reminderMinutes * 60,
    forcedAfterSeconds: s.forcedRestAfterMinutes * 60,
    restSeconds: s.forcedRestDurationMinutes * 60,
    snoozeSeconds: 5 * 60,
    reminderEnabled: s.reminderEnabled,
    forcedEnabled: s.forcedRestEnabled,
    strict: s.strictMode,
    ...DEV_TIMES,
  };
}

// ---- 单实例 ----
// 休息窗口自动恢复白噪音时可能无用户手势，显式放开自动播放（仅本地合成音，无外部内容）。
// 必须在 app ready 之前设置。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  logEvent('warn', 'already-running-quit', { note: '已有实例持有单实例锁，本进程退出' });
  app.quit();
} else {
  app.on('second-instance', () => {
    logEvent('info', 'second-instance', { action: '聚焦已有主窗口' });
    showMainWindow();
  });
  void app.whenReady().then(bootstrap);
}

function bootstrap(): void {
  app.setAppUserModelId('cn.dengshan.soul-window');

  logEvent('info', 'app-start', {
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    devTimes: DEV_TIMES ?? '生产默认(30/40/5 分钟)',
    settings: {
      reminderEnabled: settings.reminderEnabled,
      forcedRestEnabled: settings.forcedRestEnabled,
      strictMode: settings.strictMode,
      trainingMode: settings.trainingMode,
      launchAtLogin: settings.launchAtLogin,
    },
  });

  createMainWindow();
  tray = new TrayController({
    onToggleWork: () => {
      logEvent('info', 'user-action', { source: 'tray', action: 'toggle-work', state: machine.getState() });
      toggleWork();
    },
    onStartRest: () => {
      logEvent('info', 'user-action', { source: 'tray', action: 'start-rest', state: machine.getState() });
      machine.dispatch({ type: 'start-rest' });
    },
    onShowMain: () => {
      logEvent('info', 'user-action', { source: 'tray', action: 'show-main' });
      showMainWindow();
    },
    onOpenSettings: () => {
      logEvent('info', 'user-action', { source: 'tray', action: 'open-settings' });
      openSettings();
    },
    onQuit: () => {
      logEvent('info', 'user-action', { source: 'tray', action: 'quit' });
      isQuitting = true;
      app.quit();
    },
  });
  tray.init();

  machine.on(handleTimerEvent);
  tray.update(machine.getState(), 0);

  // 心跳：真实时间差计时，tick 只负责推进状态机与广播（丢失/延迟不影响准确性）
  setInterval(() => {
    tickCount += 1;
    machine.advance();
    broadcast();
    if (tickCount % 30 === 0) saveStats(machine.getStats());
    if (tickCount % 3 === 0) {
      updateWidgetVisibility(); // 低频校准（3 秒），兜住显隐边角时序
      ensureRestWindowIntegrity(); // 休息窗全屏自愈（息屏/唤醒过渡期 macOS 会丢全屏）
    }
    // 心跳摘要：每 5 分钟一条状态快照（不逐秒记，防日志膨胀）
    if (tickCount % 300 === 0) {
      const s = machine.snapshot();
      logEvent('info', 'heartbeat', {
        state: s.state,
        elapsedWorkSeconds: s.elapsedWorkSeconds,
        remainingRestSeconds: s.remainingRestSeconds,
        stats: s.todayStats,
      });
    }
  }, 1000);

  powerMonitor.on('suspend', () => {
    logEvent('info', 'power-suspend', { note: '系统睡眠，计时冻结' });
    machine.sleep();
    broadcast();
  });
  powerMonitor.on('resume', () => {
    logEvent('info', 'power-resume', { note: '系统唤醒，计时解冻（睡眠时长不计入）' });
    machine.wake();
    broadcast();
    ensureRestWindowIntegrity(); // 唤醒后立即校验休息窗全屏状态
  });
  // 息屏/唤醒时 display-metrics-changed 会连续触发（实测 130ms 一次，20+ 次），防抖合并
  let displayChangeTimer: NodeJS.Timeout | undefined;
  screen.on('display-metrics-changed', () => {
    if (displayChangeTimer) clearTimeout(displayChangeTimer);
    displayChangeTimer = setTimeout(() => {
      logEvent('info', 'display-metrics-changed', { note: '显示器参数变化，校验休息窗' });
      ensureRestWindowIntegrity();
      displayChangeTimer = undefined;
    }, 500);
  });
  if (process.env.EYECARE_DEBUG) {
    machine.on((e) => console.log('[debug] event', JSON.stringify(e)));
    setInterval(() => {
      const s = machine.snapshot();
      console.log(`[debug] tick state=${s.state} elapsed=${s.elapsedWorkSeconds}s rest=${s.remainingRestSeconds}s`);
    }, 5000);
  }

  registerIpc();

  // 诊断与韧性：所有异常必须留痕（2026-11-03「点击立即休息闪退」排查教训）
  process.on('uncaughtException', (err) => logEvent('error', 'uncaught-exception', { message: err.message, stack: err.stack }));
  process.on('unhandledRejection', (reason) => logEvent('error', 'unhandled-rejection', { reason: String(reason) }));
  app.on('render-process-gone', (_e, _wc, details) => logEvent('error', 'render-process-gone', details));
  app.on('child-process-gone', (_e, details) => logEvent('error', 'child-process-gone', details));

  app.on('activate', () => showMainWindow()); // macOS 点 Dock 图标
  app.on('before-quit', () => {
    isQuitting = true;
    logEvent('info', 'app-quit', { stats: machine.getStats() });
    saveStats(machine.getStats());
  });
}

// ---- 桌面小时钟（后台运行时的半透明倒计时；按需创建/销毁，主窗可见时进程不存在） ----
function widgetDisplayAreas() {
  const primary = screen.getPrimaryDisplay();
  return [primary.workArea, ...screen.getAllDisplays().filter((d) => d.id !== primary.id).map((d) => d.workArea)];
}

function createWidgetWindow(): void {
  const W = 232;
  const H = 64;
  // 默认贴主屏右上角；记忆位置必须仍在某块屏幕内，否则回退主屏
  const displays = widgetDisplayAreas();
  const { x, y } = resolveWidgetPosition(loadWidgetPosition(), displays, { width: W, height: H });
  widgetWindow = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  widgetWindow.setAlwaysOnTop(true, 'floating'); // 低于全屏休息层的级别
  // 拖动后记忆位置（防抖）
  let saveTimer: NodeJS.Timeout | undefined;
  widgetWindow.on('moved', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!widgetWindow || widgetWindow.isDestroyed()) return;
      const [px, py] = widgetWindow.getPosition();
      saveWidgetPosition({ x: px, y: py });
    }, 800);
  });
  widgetWindow.webContents.on('console-message', (e) => {
    if (isErrorLevel(e.level)) logEvent('warn', 'widget-console', { message: e.message });
  });
  logEvent('info', 'widget-window-created', { x, y });
  void widgetWindow.loadURL(rendererUrl('index.html#widget'));
  widgetWindow.once('ready-to-show', () => {
    widgetWindow?.showInactive(); // 不抢焦点
    logEvent('info', 'widget-shown', { note: '后台运行，桌面时钟显示' });
  });
  sendSnapshotWhenReady(widgetWindow);
}

function destroyWidgetWindow(): void {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  widgetWindow.destroy();
  widgetWindow = null;
  logEvent('info', 'widget-window-destroyed');
}

/** 小窗规则：设置开启 + 主窗不可见 + 不在休息（以状态机为准）→ 存在并显示；否则销毁进程归零 */
function updateWidgetVisibility(): void {
  const mainVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized();
  const st = machine.getState();
  const resting = st === 'forcedRest' || st === 'manualRest';
  const shouldShow = settings.showDesktopClock && !mainVisible && !resting;
  if (shouldShow) {
    if (!widgetWindow || widgetWindow.isDestroyed()) {
      createWidgetWindow();
    } else {
      // 热插拔/分辨率变化后，已存在的小时钟也要拉回可见工作区
      const [x, y] = widgetWindow.getPosition();
      const [width, height] = widgetWindow.getSize();
      const next = resolveWidgetPosition({ x, y }, widgetDisplayAreas(), { width, height });
      if (next.x !== x || next.y !== y) widgetWindow.setPosition(next.x, next.y);
    }
  } else {
    destroyWidgetWindow();
  }
}

function toggleWork(): void {
  switch (machine.getState()) {
    case 'idle':
      machine.dispatch({ type: 'start' });
      break;
    case 'working':
    case 'reminder30':
    case 'extended':
      machine.dispatch({ type: 'pause' });
      break;
    case 'paused':
      machine.dispatch({ type: 'resume' });
      break;
    default:
      break;
  }
}

// ---- 窗口 ----
function rendererUrl(page: 'index.html' | 'rest.html' | 'rest.html#mirror' | 'index.html#widget'): string {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) return `${dev.replace(/\/$/, '')}/${page === 'index.html' ? '' : page}`;
  return `file://${join(__dirname, '../../dist/renderer', page)}`;
}

function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 400,
    minHeight: 560,
    title: '心灵之窗护眼助手',
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#10141c',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需 require 相对路径的共享模块；页面仍与 preload 隔离
    },
  });
  mainWindow = win;
  logEvent('info', 'main-window-created');
  win.once('ready-to-show', () => {
    if (mainWindow !== win || win.isDestroyed()) return;
    win.show();
    logEvent('info', 'main-window-shown', { note: 'ready-to-show' });
    updateWidgetVisibility();
  });
  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault(); // 常驻后台：关窗 = 隐藏到托盘，计时继续
    win.hide();
    logEvent('info', 'main-window-hidden', { note: '用户关窗→驻留托盘，计时继续' });
    updateWidgetVisibility();
  });
  win.on('minimize', () => {
    logEvent('info', 'main-window-minimized');
    updateWidgetVisibility();
  });
  win.on('restore', () => {
    logEvent('info', 'main-window-restored');
    updateWidgetVisibility();
  });
  win.on('closed', () => {
    // 崩溃重建后，旧窗口的 closed 不得清空新窗口引用
    if (mainWindow === win) mainWindow = null;
    logEvent('info', 'main-window-closed');
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logEvent('error', 'main-render-process-gone', { ...details, action: '自动重建主窗口' });
    if (isQuitting || mainWindow !== win) return;
    mainWindow = null;
    try {
      win.destroy();
    } catch {
      /* 已销毁 */
    }
    createMainWindow();
    updateWidgetVisibility();
  });
  win.webContents.on('console-message', (e) => {
    if (isErrorLevel(e.level)) logEvent('warn', 'main-console', { message: e.message });
  });
  void win.loadURL(rendererUrl('index.html'));
  sendSnapshotWhenReady(win);
}

function ensureRestWindow(): void {
  if (restWindows.some((w) => !w.isDestroyed() && w.isVisible())) {
    restWindows.find((w) => !w.isDestroyed())?.show();
    return;
  }
  // 每块屏幕一个全屏休息窗（李先生要求：扩展屏一并纳入休息）。
  // 光标所在屏 = 完整界面（倒计时+训练），其余屏 = 简洁镜像（大倒计时+闭眼提示）。
  // 在构造参数里直接落位，不在创建后对全屏窗口调 setBounds（macOS 全屏过渡期改 bounds 有崩溃风险）。
  const displays = screen.getAllDisplays();
  let primaryId: number | undefined;
  try {
    primaryId = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id;
  } catch (err) {
    logEvent('warn', 'rest-window-display-fallback', { error: String(err) });
  }
  if (!displays.some((d) => d.id === primaryId)) primaryId = displays[0]?.id;

  let primaryDone = false;
  for (const d of displays) {
    const isPrimary = d.id === primaryId && !primaryDone;
    if (isPrimary) primaryDone = true;
    restWindows.push(createRestWindow(d.bounds, isPrimary ? 'rest.html' : 'rest.html#mirror'));
  }
  logEvent('info', 'rest-windows-created', { displays: displays.length, primaryId, mirror: Math.max(0, displays.length - 1) });
}

function createRestWindow(bounds: Electron.Rectangle, page: 'rest.html' | 'rest.html#mirror'): BrowserWindow {
  const win = new BrowserWindow({
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    backgroundColor: '#0b0f16',
    // 显式给整屏尺寸打底：息屏/唤醒过渡期 fullscreen 可能静默失败，至少仍是整屏大小
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('close', (e) => {
    if (isQuitting) return;
    const s = machine.snapshot();
    if (s.state === 'forcedRest' && settings.strictMode) {
      e.preventDefault(); // 严格模式：强制休息不可关闭（PRD §6.3/6.6）
      logEvent('info', 'rest-window-close-blocked', { note: '严格模式强制休息，关闭被拦截' });
      return;
    }
    logEvent('info', 'rest-window-close', { note: '用户关窗→结束休息', state: s.state });
    machine.dispatch({ type: 'end-rest' }); // 手动休息 / 非严格：关窗 = 结束休息
  });
  win.on('closed', () => {
    restWindows = restWindows.filter((w) => w !== win);
    logEvent('info', 'rest-window-closed', { remaining: restWindows.length });
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logEvent('error', 'rest-render-process-gone', { page, details });
  });
  win.webContents.on('console-message', (e) => {
    if (isErrorLevel(e.level)) logEvent('warn', 'rest-console', { page, message: e.message });
  });
  void win.loadURL(rendererUrl(page));
  win.once('ready-to-show', () => {
    win.show();
    logEvent('info', 'rest-window-shown', { page, note: '全屏置顶' });
  });
  sendSnapshotWhenReady(win);
  return win;
}

function closeRestWindow(): void {
  for (const w of restWindows) {
    if (!w.isDestroyed()) w.destroy(); // destroy 不触发 close 拦截
  }
  restWindows = [];
}

/**
 * 休息窗自愈校验（2026-11-03 李先生反馈：息屏时触发的强制休息不全屏）。
 * 息屏/唤醒过渡期 macOS 可能拒绝建立全屏空间 → 窗口以默认小尺寸定格且可能失置顶。
 * 实测：frameless + resizable:false 的窗口 isFullScreen() 恒为 false、setFullScreen 被忽略，
 * 而 setBounds 可靠——因此判定只看「是否铺满所在屏」，修复用 setBounds 拉回整屏。
 * 每 3 秒轮询；显示器参数变化时即时补偿。
 */
function ensureRestWindowIntegrity(): void {
  if (restWindows.length === 0) return;
  const displays = screen.getAllDisplays();
  for (const w of restWindows) {
    if (w.isDestroyed() || !w.isVisible()) continue;
    const b = w.getBounds();
    const d =
      displays.find(
        (dd) =>
          b.x + b.width / 2 >= dd.bounds.x &&
          b.x + b.width / 2 < dd.bounds.x + dd.bounds.width &&
          b.y + b.height / 2 >= dd.bounds.y &&
          b.y + b.height / 2 < dd.bounds.y + dd.bounds.height,
      ) ?? displays[0];
    if (!d) continue;
    // 全屏态 getBounds 与 display.bounds 可能有菜单栏级别（~34px）的合法偏差，
    // 只在明显缩水（>100px，如息屏退化成的 900x600 普通窗）时修复
    const offX = Math.abs(b.x - d.bounds.x);
    const offY = Math.abs(b.y - d.bounds.y);
    const offW = Math.abs(b.width - d.bounds.width);
    const offH = Math.abs(b.height - d.bounds.height);
    if (offW > 100 || offH > 100 || offX > 100 || offY > 100) {
      // 退化态窗口不是全屏态，setBounds 安全且立即生效
      w.setBounds(d.bounds);
      w.setAlwaysOnTop(true, 'screen-saver');
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      logEvent('warn', 'rest-window-refit', {
        page: w.webContents.getURL().includes('#mirror') ? 'mirror' : 'main',
        size: `${b.width}x${b.height}@${b.x},${b.y} → ${d.bounds.width}x${d.bounds.height}@${d.bounds.x},${d.bounds.y}`,
        note: '息屏/唤醒退化后自愈：拉回整屏+置顶',
      });
    }
  }
}

function sendSnapshotWhenReady(win: BrowserWindow): void {
  win.webContents.once('did-finish-load', () => broadcast());
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logEvent('info', 'main-window-recreate', { note: '主窗不存在，重建' });
    createMainWindow();
    updateWidgetVisibility();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  updateWidgetVisibility();
}

function openSettings(): void {
  showMainWindow();
  const win = mainWindow;
  if (!win || win.isDestroyed()) return;
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(IPC.openSettings);
  };
  // 新建/重建窗口时，渲染监听器要等页面加载完成后才注册
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

// ---- 事件 → 桌面行为 ----
function handleTimerEvent(e: TimerEvent): void {
  // 全量状态机事件落日志（含语义事件与状态转移）
  logEvent('info', `timer:${e.type}`, e.type === 'state-change' ? { from: e.from, to: e.to } : e);

  switch (e.type) {
    case 'reminder':
      notify('该休息一下了', `已连续工作 ${Math.round(e.elapsedSeconds / 60)} 分钟。现在休息 2 到 5 分钟，让眼睛离开屏幕。`);
      break;
    case 'reminder-show':
      notify('提醒还在哦', '刚才的休息提醒又回来了。给眼睛几分钟，它值得。');
      break;
    case 'rest-start':
      ensureRestWindow();
      // 注意：rest-start 事件先于 state-change 发出（machine 内 emit→transition 顺序），
      // 此时 getState() 仍是旧状态，不能靠 updateWidgetVisibility 判定——直接销毁退场
      destroyWidgetWindow();
      if (e.kind === 'forced') {
        const cfg = timerConfig(settings);
        notify(
          '强制休息开始',
          `连续工作已达 ${durationText(cfg.forcedAfterSeconds)}。接下来 ${durationText(cfg.restSeconds)}，可以闭眼、看远处，或跟着引导放松。`,
        );
      }
      break;
    case 'rest-complete':
      restRotationIndex = nextAutoRotationIndex(restRotationIndex);
      closeRestWindow();
      // 休息可能从托盘发起（主窗口已隐藏）；结束时必须带回可见窗口，
      // 否则应用「看起来闪退」：进程在跑但没有任何窗口（2026-11-03 李先生反馈）
      showMainWindow();
      notify('休息完成', '眼睛谢谢你。新的一轮工作开始，到时间我会再提醒你。');
      break;
    case 'rest-end-early':
      restRotationIndex = nextAutoRotationIndex(restRotationIndex);
      closeRestWindow();
      showMainWindow();
      break;
    case 'state-change':
      if (tray) {
        const minutes = Math.floor(machine.snapshot().elapsedWorkSeconds / 60);
        tray.update(e.to, minutes);
      }
      saveStats(machine.getStats());
      updateWidgetVisibility(); // 状态已就位，此刻校准小窗显隐最可靠
      break;
  }
  broadcast();
}

/** 通知文案使用实际生效配置；整分钟显示分钟，短时长验收显示秒 */
function durationText(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} 分钟` : `${seconds} 秒`;
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) {
    logEvent('warn', 'notification-unsupported', { title });
    return;
  }
  const n = new Notification({ title, body, silent: !settings.soundEnabled });
  n.show();
  logEvent('info', 'notification-shown', { title, sound: settings.soundEnabled });
}

// ---- 广播与 IPC ----
function snapshot(): AppSnapshot {
  return { timer: machine.snapshot(), settings, restRotationIndex };
}

function broadcast(): void {
  const s = snapshot();
  for (const win of [mainWindow, ...restWindows, widgetWindow]) {
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      win.webContents.send(IPC.snapshotChannel, s);
    }
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => settings);
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<UserSettings>) => {
    const before = { ...settings };
    const next = sanitizeSettings({ ...settings, ...patch });
    // 先持久化成功再热应用；写盘失败会拒绝 IPC，由设置面板提示“保存失败”
    saveSettings(next);
    settings = next;
    machine.updateConfig(timerConfig(settings));
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(settings) as (keyof UserSettings)[]) {
      if (before[key] !== settings[key]) changed[key] = { from: before[key], to: settings[key] };
    }
    logEvent('info', 'settings-changed', { changed });
    if ('showDesktopClock' in changed) updateWidgetVisibility();
    broadcast();
    return settings;
  });
  ipcMain.on(IPC.dispatchChannel, (e, action: TimerAction) => {
    const source = e.senderFrame?.url.includes('rest') ? 'rest-window' : 'main-window';
    const accepted = machine.dispatch(action);
    logEvent('info', 'user-action', { source, action: action.type, accepted, state: machine.getState() });
    broadcast(); // 立即反馈，不等下一秒 tick
  });
  ipcMain.on(IPC.openSettings, () => {
    logEvent('info', 'user-action', { source: 'main-window', action: 'open-settings' });
    openSettings();
  });
  ipcMain.on(IPC.showMain, () => {
    logEvent('info', 'user-action', { source: 'widget', action: 'show-main' });
    showMainWindow();
  });
}

// macOS：关窗不退出（托盘常驻）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !tray) app.quit();
});

/** console-message 的 level 在不同版本为数字或字符串，统一判定是否为错误级 */
function isErrorLevel(level: unknown): boolean {
  if (typeof level === 'number') return level >= 2;
  return level === 'error' || level === 'warning';
}
