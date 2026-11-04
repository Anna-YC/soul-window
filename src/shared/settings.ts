// 全局共享类型：设置、每日统计、渲染进程快照。
// 被 electron 主进程（tsc Node 构建）与渲染进程（vite）共同引用，保持零运行时依赖。

export type TrainingMode = 'auto' | 'far-near' | 'tracking' | 'blink' | 'breathing';

export interface UserSettings {
  /** 30 分钟提醒开关 */
  reminderEnabled: boolean;
  /** 40 分钟强制休息开关 */
  forcedRestEnabled: boolean;
  /** 提醒阈值（分钟），默认 30。设置界面「计时规则」可调 */
  reminderMinutes: number;
  /** 强制休息阈值（分钟），默认 40 */
  forcedRestAfterMinutes: number;
  /** 强制休息时长（分钟），默认 5 */
  forcedRestDurationMinutes: number;
  /** 严格模式：40 分钟全屏休息不可跳过 */
  strictMode: boolean;
  /** 提醒声音 */
  soundEnabled: boolean;
  /** 休息窗口自动开始训练 */
  autoTraining: boolean;
  /** 训练模式：自动轮换 / 远近切换 / 缓慢追踪 / 眨眼练习 / 呼吸引导 */
  trainingMode: TrainingMode;
  /** 开机启动 */
  launchAtLogin: boolean;
  /** 主界面显示每日统计 */
  showDailyStats: boolean;
  /** 主窗隐藏（后台运行）时显示桌面小时钟 */
  showDesktopClock: boolean;
}

export const DEFAULT_SETTINGS: UserSettings = {
  reminderEnabled: true,
  forcedRestEnabled: true,
  reminderMinutes: 30,
  forcedRestAfterMinutes: 40,
  forcedRestDurationMinutes: 5,
  strictMode: true,
  soundEnabled: true,
  autoTraining: true,
  trainingMode: 'auto',
  launchAtLogin: false,
  showDailyStats: true,
  showDesktopClock: true,
};

/** 设置写入前的校验与收敛：范围钳制、提醒阈值不得大于强制阈值 */
export function sanitizeSettings(raw: Partial<UserSettings>): UserSettings {
  const s = { ...DEFAULT_SETTINGS, ...raw };
  s.reminderMinutes = clamp(round(s.reminderMinutes, 5), 5, 120);
  s.forcedRestAfterMinutes = clamp(round(s.forcedRestAfterMinutes, 5), 10, 180);
  s.forcedRestDurationMinutes = clamp(round(s.forcedRestDurationMinutes, 1), 1, 30);
  if (s.reminderMinutes > s.forcedRestAfterMinutes) s.reminderMinutes = s.forcedRestAfterMinutes;
  s.trainingMode = (['auto', 'far-near', 'tracking', 'blink', 'breathing'] as const).includes(s.trainingMode)
    ? s.trainingMode
    : 'auto';
  s.showDesktopClock = typeof s.showDesktopClock === 'boolean' ? s.showDesktopClock : true;
  return s;
}

function round(n: number, step: number): number {
  return Math.round(n / step) * step;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export interface DailyStats {
  /** 本地日期 YYYY-MM-DD */
  date: string;
  totalWorkSeconds: number;
  completedRestCount: number;
  longestWorkSessionSeconds: number;
}

/** 广播给全部窗口的应用快照：计时器状态 + 生效设置 */
export interface AppSnapshot {
  timer: import('../features/timer/types').TimerSnapshot;
  settings: UserSettings;
}

export const IPC = {
  snapshotChannel: 'app:snapshot',
  dispatchChannel: 'app:dispatch',
  getSettings: 'app:get-settings',
  saveSettings: 'app:save-settings',
  openSettings: 'app:open-settings',
  showMain: 'app:show-main',
} as const;
