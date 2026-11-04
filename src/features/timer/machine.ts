// 心灵之窗核心计时状态机（纯 TypeScript，无 Electron 依赖）
//
// 设计要点（对应 PRD §8 / 交接文档 §6.1）：
// - 一切时长 = 真实时间差（注入时钟 now()），绝不依赖 setInterval 累加或渲染帧数。
// - 工作状态（working / reminder30 / extended）持续累计；暂停与睡眠期间冻结不补算。
// - 睡眠不改变可见状态，只冻结/解冻活跃计时段（sleep() / wake()）。
// - UI 只能通过 dispatch(action) 驱动，不直接改内部变量。
import type { DailyStats } from '../../shared/settings';
import type {
  RestKind,
  TimerAction,
  TimerConfig,
  TimerEvent,
  TimerSnapshot,
  TimerStateName,
} from './types';
import { DEFAULT_TIMER_CONFIG } from './types';

type AccumulatingState = 'working' | 'reminder30' | 'extended';

export interface TimerMachineOptions {
  config?: Partial<TimerConfig>;
  /** 时钟注入（毫秒 epoch），测试传假时钟；默认 Date.now */
  now?: () => number;
  /** 本地日期（YYYY-MM-DD），测试注入固定值 */
  dateFor?: (ts: number) => string;
  /** 启动时载入的历史统计（昨日留存），日期不同会被 rollover 重置 */
  initialStats?: DailyStats;
}

interface InternalStats {
  date: string;
  totalWorkMs: number;
  completedRestCount: number;
  longestSessionMs: number;
}

export class TimerMachine {
  private config: TimerConfig;
  private readonly now: () => number;
  private readonly dateFor: (ts: number) => string;

  private state: TimerStateName = 'idle';
  private prePauseState: AccumulatingState = 'working';

  /** 当前工作段：已结算毫秒 + 活跃起点（null = 冻结/未开始） */
  private workAccumMs = 0;
  private workActiveSince: number | null = null;
  private reminderFired = false;
  private snoozeUntilTs: number | null = null;

  /** 休息倒计时：已结算毫秒 + 活跃起点 */
  private restKind: RestKind = 'manual';
  private restAccumMs = 0;
  private restActiveSince: number | null = null;

  private sleeping = false;
  private stats: InternalStats;

  private readonly listeners = new Set<(e: TimerEvent) => void>();

  constructor(opts: TimerMachineOptions = {}) {
    this.config = { ...DEFAULT_TIMER_CONFIG, ...opts.config };
    this.now = opts.now ?? Date.now;
    this.dateFor =
      opts.dateFor ??
      ((ts) => {
        const d = new Date(ts);
        const pad = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      });
    const init = opts.initialStats;
    this.stats = init
      ? {
          date: init.date,
          totalWorkMs: init.totalWorkSeconds * 1000,
          completedRestCount: init.completedRestCount,
          longestSessionMs: init.longestWorkSessionSeconds * 1000,
        }
      : { date: this.dateFor(this.now()), totalWorkMs: 0, completedRestCount: 0, longestSessionMs: 0 };
  }

  on(listener: (e: TimerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateConfig(patch: Partial<TimerConfig>): void {
    this.config = { ...this.config, ...patch };
  }

  getState(): TimerStateName {
    return this.state;
  }

  getStats(): DailyStats {
    return {
      date: this.stats.date,
      totalWorkSeconds: Math.floor(this.stats.totalWorkMs / 1000),
      completedRestCount: this.stats.completedRestCount,
      longestWorkSessionSeconds: Math.floor(this.stats.longestSessionMs / 1000),
    };
  }

  /** 用户动作。返回是否被接受（非法时序动作会被拒绝并忽略）。 */
  dispatch(action: TimerAction): boolean {
    const now = this.now();
    switch (action.type) {
      case 'start':
        if (this.state !== 'idle') return false;
        this.beginWorkSegment(now);
        this.transition('working');
        return true;

      case 'pause':
        if (!this.isAccumulating()) return false;
        this.prePauseState = this.state as AccumulatingState;
        this.settleWork(now);
        this.workActiveSince = null;
        this.transition('paused');
        return true;

      case 'resume':
        if (this.state !== 'paused') return false;
        this.workActiveSince = now;
        this.transition(this.prePauseState);
        return true;

      case 'reset':
        if (this.state === 'idle') return false;
        this.settleWork(now); // 已工作部分仍计入今日统计
        this.clearWorkSegment();
        this.transition('idle');
        return true;

      case 'start-rest':
        if (this.state !== 'working' && this.state !== 'reminder30' && this.state !== 'extended' && this.state !== 'paused')
          return false;
        this.settleWork(now);
        this.clearWorkSegment();
        this.workActiveSince = null;
        this.restKind = 'manual';
        this.restAccumMs = 0;
        this.restActiveSince = now;
        this.emit({ type: 'rest-start', kind: 'manual' });
        this.transition('manualRest');
        return true;

      case 'end-rest':
        if (this.state === 'manualRest') {
          this.finishRest(now, { completed: false });
          return true;
        }
        if (this.state === 'forcedRest') {
          // 严格模式下强制休息不可由应用界面跳过（PRD §6.6）
          if (this.config.strict && this.restElapsedMs(now) < this.config.restSeconds * 1000) return false;
          this.finishRest(now, { completed: false });
          return true;
        }
        return false;

      case 'dismiss-reminder':
        if (this.state !== 'reminder30') return false;
        this.transition('working');
        return true;

      case 'snooze':
        if (this.state !== 'reminder30') return false;
        this.snoozeUntilTs = now + this.config.snoozeSeconds * 1000;
        this.transition('extended');
        return true;

      default:
        return false;
    }
  }

  /** 时间驱动的前进：由主进程每秒调用（也可测试直接调）。返回本轮触发的事件。 */
  advance(): TimerEvent[] {
    const now = this.now();
    const events: TimerEvent[] = [];
    const collect = (e: TimerEvent) => events.push(e);
    this.on(collect);
    try {
      this.rollDateIfNeeded(now);

      if (!this.sleeping && this.isAccumulating()) {
        this.settleWork(now);
        const elapsedSec = this.workAccumMs / 1000;

        // 40 分钟强制休息优先（含 reminder30 / extended 状态下到点）
        if (this.config.forcedEnabled && elapsedSec >= this.config.forcedAfterSeconds) {
          this.clearWorkSegment();
          this.workActiveSince = null;
          this.restKind = 'forced';
          this.restAccumMs = 0;
          this.restActiveSince = now;
          this.emit({ type: 'rest-start', kind: 'forced' });
          this.transition('forcedRest');
        } else if (this.state === 'extended' && this.snoozeUntilTs !== null && now >= this.snoozeUntilTs) {
          // 延后 5 分钟到期：重新展示提醒
          this.snoozeUntilTs = null;
          this.emit({ type: 'reminder-show', elapsedSeconds: Math.floor(elapsedSec) });
          this.transition('reminder30');
        } else if (
          this.state === 'working' &&
          this.config.reminderEnabled &&
          !this.reminderFired &&
          elapsedSec >= this.config.reminderSeconds
        ) {
          this.reminderFired = true;
          this.emit({ type: 'reminder', elapsedSeconds: Math.floor(elapsedSec) });
          this.transition('reminder30');
        }
      }

      if (!this.sleeping && (this.state === 'forcedRest' || this.state === 'manualRest')) {
        this.settleRest(now);
        if (this.restAccumMs >= this.config.restSeconds * 1000) {
          this.finishRest(now, { completed: true });
        }
      }
    } finally {
      this.listeners.delete(collect);
    }
    return events;
  }

  /** 系统睡眠：冻结当前活跃段（工作或休息），不改变可见状态 */
  sleep(): void {
    if (this.sleeping) return;
    const now = this.now();
    this.settleWork(now);
    this.settleRest(now);
    this.workActiveSince = null;
    this.restActiveSince = null;
    this.sleeping = true;
  }

  /** 系统唤醒：解冻，从当前时刻继续（睡眠时长不计入工作/休息） */
  wake(): void {
    if (!this.sleeping) return;
    const now = this.now();
    this.sleeping = false;
    if (this.isAccumulating()) this.workActiveSince = now;
    if (this.state === 'forcedRest' || this.state === 'manualRest') this.restActiveSince = now;
  }

  snapshot(): TimerSnapshot {
    const now = this.now();
    const elapsedSec = this.workElapsedMs(now) / 1000;
    const inWorkStates = this.state !== 'idle' && this.state !== 'forcedRest' && this.state !== 'manualRest';

    return {
      state: this.state,
      elapsedWorkSeconds: Math.floor(elapsedSec),
      remainingToReminderSeconds:
        this.config.reminderEnabled && inWorkStates && !this.reminderFired
          ? Math.max(0, Math.ceil(this.config.reminderSeconds - elapsedSec))
          : null,
      remainingToForcedRestSeconds:
        this.config.forcedEnabled && inWorkStates
          ? Math.max(0, Math.ceil(this.config.forcedAfterSeconds - elapsedSec))
          : null,
      remainingRestSeconds:
        this.state === 'forcedRest' || this.state === 'manualRest'
          ? Math.max(0, Math.ceil(this.config.restSeconds - this.restAccumMs / 1000))
          : 0,
      restKind: this.state === 'forcedRest' || this.state === 'manualRest' ? this.restKind : null,
      reminderFired: this.reminderFired,
      snoozed: this.state === 'extended',
      todayStats: this.getStats(),
      nowTs: now,
    };
  }

  // ---- 内部实现 ----

  private isAccumulating(): boolean {
    return this.state === 'working' || this.state === 'reminder30' || this.state === 'extended';
  }

  private workElapsedMs(now: number): number {
    const active = this.workActiveSince !== null ? Math.max(0, now - this.workActiveSince) : 0;
    return this.workAccumMs + active;
  }

  private restElapsedMs(now: number): number {
    const active = this.restActiveSince !== null ? Math.max(0, now - this.restActiveSince) : 0;
    return this.restAccumMs + active;
  }

  /** 把活跃工作段结算进累计与统计（同时刷新最长段记录） */
  private settleWork(now: number): void {
    if (this.workActiveSince === null) return;
    const delta = now - this.workActiveSince;
    if (delta > 0) {
      this.workAccumMs += delta;
      this.stats.totalWorkMs += delta;
      if (this.workAccumMs > this.stats.longestSessionMs) this.stats.longestSessionMs = this.workAccumMs;
    }
    this.workActiveSince = now;
  }

  private settleRest(now: number): void {
    if (this.restActiveSince === null) return;
    const delta = now - this.restActiveSince;
    if (delta > 0) this.restAccumMs += delta;
    this.restActiveSince = now;
  }

  private beginWorkSegment(now: number): void {
    this.clearWorkSegment();
    this.workActiveSince = now;
  }

  private clearWorkSegment(): void {
    this.workAccumMs = 0;
    this.reminderFired = false;
    this.snoozeUntilTs = null;
  }

  /** 休息结束（倒计时走完 = completed；提前结束不算完成次数） */
  private finishRest(now: number, opts: { completed: boolean }): void {
    const kind = this.restKind;
    this.settleRest(now);
    if (opts.completed) this.stats.completedRestCount += 1;
    this.restAccumMs = 0;
    this.restActiveSince = null;
    const event: TimerEvent = opts.completed
      ? { type: 'rest-complete', kind, completedRestCount: this.stats.completedRestCount }
      : { type: 'rest-end-early', kind };
    this.emit(event);
    this.beginWorkSegment(now);
    this.transition('working');
  }

  private rollDateIfNeeded(now: number): void {
    const today = this.dateFor(now);
    if (today === this.stats.date) return;
    // 跨天：统计重置；若正处工作段，当前段时长保留为新一日的最长段基数
    const carrySessionMs = this.workElapsedMs(now);
    this.stats = { date: today, totalWorkMs: 0, completedRestCount: 0, longestSessionMs: carrySessionMs };
  }

  private transition(to: TimerStateName): void {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.emit({ type: 'state-change', from, to });
  }

  private emit(event: TimerEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
