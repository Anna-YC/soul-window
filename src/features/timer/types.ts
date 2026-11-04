// 计时状态机的类型定义（纯类型 + 默认配置，无副作用，主进程/渲染进程/测试共用）
import type { DailyStats } from '../../shared/settings';

export type TimerStateName =
  | 'idle'
  | 'working'
  | 'reminder30'
  | 'extended'
  | 'forcedRest'
  | 'manualRest'
  | 'paused';

export type RestKind = 'forced' | 'manual';

export interface TimerConfig {
  /** 提醒阈值（秒），生产默认 1800 */
  reminderSeconds: number;
  /** 强制休息阈值（秒），生产默认 2400 */
  forcedAfterSeconds: number;
  /** 休息时长（秒），生产默认 300 */
  restSeconds: number;
  /** 提醒延后时长（秒），固定 300 */
  snoozeSeconds: number;
  reminderEnabled: boolean;
  forcedEnabled: boolean;
  strict: boolean;
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  reminderSeconds: 30 * 60,
  forcedAfterSeconds: 40 * 60,
  restSeconds: 5 * 60,
  snoozeSeconds: 5 * 60,
  reminderEnabled: true,
  forcedEnabled: true,
  strict: true,
};

export type TimerAction =
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  | { type: 'start-rest' }
  | { type: 'end-rest' }
  | { type: 'dismiss-reminder' }
  | { type: 'snooze' };

export interface TimerSnapshot {
  state: TimerStateName;
  /** 当前工作段已连续工作秒数（不含暂停与睡眠） */
  elapsedWorkSeconds: number;
  /** 距 30 分钟提醒剩余秒数；null = 提醒已触发或已关闭 */
  remainingToReminderSeconds: number | null;
  /** 距强制休息剩余秒数；null = 强制休息已关闭 */
  remainingToForcedRestSeconds: number | null;
  /** 休息剩余秒数；不在休息状态时为 0 */
  remainingRestSeconds: number;
  restKind: RestKind | null;
  /** 本轮工作段 30 分钟提醒是否已触发过 */
  reminderFired: boolean;
  /** 是否处于「延后 5 分钟」状态 */
  snoozed: boolean;
  todayStats: DailyStats;
  nowTs: number;
}

export type TimerEvent =
  | { type: 'state-change'; from: TimerStateName; to: TimerStateName }
  | { type: 'reminder'; elapsedSeconds: number }
  | { type: 'reminder-show'; elapsedSeconds: number }
  | { type: 'rest-start'; kind: RestKind }
  | { type: 'rest-complete'; kind: RestKind; completedRestCount: number }
  | { type: 'rest-end-early'; kind: RestKind };
