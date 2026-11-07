// 计时状态机单元测试（交接文档 §8 全部重点用例）
import { describe, expect, it } from 'vitest';
import { TimerMachine } from '../src/features/timer/machine';

const DAY = '2026-11-02';

function makeMachine(startMs = 0, cfg?: Parameters<typeof TimerMachine.prototype.updateConfig>[0]) {
  let now = startMs;
  const m = new TimerMachine({ now: () => now, dateFor: () => DAY });
  if (cfg) m.updateConfig(cfg);
  return {
    m,
    tick(): TimerEvent2[] {
      return m.advance();
    },
    set(t: number) {
      now = t;
    },
    jump(seconds: number) {
      now += seconds * 1000;
      return m.advance();
    },
    now: () => now,
  };
}

type TimerEvent2 = ReturnType<TimerMachine['advance']>[number];

describe('初始状态与开始', () => {
  it('新建计时器为 idle，时长为 0', () => {
    const { m } = makeMachine();
    const s = m.snapshot();
    expect(s.state).toBe('idle');
    expect(s.elapsedWorkSeconds).toBe(0);
    expect(s.remainingRestSeconds).toBe(0);
    expect(s.todayStats).toEqual({ date: DAY, totalWorkSeconds: 0, completedRestCount: 0, longestWorkSessionSeconds: 0 });
  });

  it('开始后进入 working，elapsed 随真实时间差增长', () => {
    const { m, set } = makeMachine();
    expect(m.dispatch({ type: 'start' })).toBe(true);
    expect(m.getState()).toBe('working');
    set(10_000);
    expect(m.snapshot().elapsedWorkSeconds).toBe(10);
    set(65_000);
    expect(m.snapshot().elapsedWorkSeconds).toBe(65);
  });

  it('重复 start 被拒绝', () => {
    const { m } = makeMachine();
    m.dispatch({ type: 'start' });
    expect(m.dispatch({ type: 'start' })).toBe(false);
  });
});

describe('30 分钟提醒边界', () => {
  it('29:59 不触发提醒，30:00 触发 reminder30', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    let events = jump(29 * 60 + 59);
    expect(events.filter((e) => e.type === 'reminder')).toHaveLength(0);
    expect(m.getState()).toBe('working');
    events = jump(1);
    expect(m.getState()).toBe('reminder30');
    expect(events).toContainEqual(expect.objectContaining({ type: 'reminder', elapsedSeconds: 1800 }));
    const s = m.snapshot();
    expect(s.reminderFired).toBe(true);
    expect(s.remainingToReminderSeconds).toBeNull();
    expect(s.remainingToForcedRestSeconds).toBe(600);
  });

  it('关闭提醒开关后 30 分钟不触发', () => {
    const { m, jump } = makeMachine(0, { reminderEnabled: false });
    m.dispatch({ type: 'start' });
    const events = jump(1800);
    expect(events.filter((e) => e.type === 'reminder')).toHaveLength(0);
    expect(m.getState()).toBe('working');
    expect(m.snapshot().remainingToReminderSeconds).toBeNull();
  });
});

describe('提醒后的三个选择', () => {
  it('继续工作（dismiss）→ 40 分钟强制休息', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(1800);
    expect(m.dispatch({ type: 'dismiss-reminder' })).toBe(true);
    expect(m.getState()).toBe('working');
    // 工作仍在累计
    jump(300);
    expect(m.snapshot().elapsedWorkSeconds).toBe(2100);
    const events = jump(300);
    expect(m.getState()).toBe('forcedRest');
    expect(events).toContainEqual({ type: 'rest-start', kind: 'forced' });
    const s = m.snapshot();
    expect(s.restKind).toBe('forced');
    expect(s.remainingRestSeconds).toBe(300);
    expect(s.elapsedWorkSeconds).toBe(0);
  });

  it('延后 5 分钟（snooze）→ extended，5 分钟后提醒重新出现，40 分钟仍强制', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(1800); // reminder30
    expect(m.dispatch({ type: 'snooze' })).toBe(true);
    expect(m.getState()).toBe('extended');
    expect(m.snapshot().snoozed).toBe(true);
    let events = jump(299);
    expect(m.getState()).toBe('extended');
    events = jump(1); // 35:00 提醒重新出现
    expect(m.getState()).toBe('reminder30');
    expect(events).toContainEqual(expect.objectContaining({ type: 'reminder-show' }));
    events = jump(300); // 40:00
    expect(m.getState()).toBe('forcedRest');
    expect(events).toContainEqual({ type: 'rest-start', kind: 'forced' });
  });

  it('开始休息 → manualRest，提前结束返回工作且不计完成次数', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(1800);
    expect(m.dispatch({ type: 'start-rest' })).toBe(true);
    expect(m.getState()).toBe('manualRest');
    expect(m.snapshot().remainingRestSeconds).toBe(300);
    jump(120);
    expect(m.snapshot().remainingRestSeconds).toBe(180);
    const events = jump(0);
    void events;
    expect(m.dispatch({ type: 'end-rest' })).toBe(true);
    expect(m.getState()).toBe('working');
    expect(m.snapshot().todayStats.completedRestCount).toBe(0);
    expect(m.snapshot().elapsedWorkSeconds).toBe(0); // 新工作段
  });
});

describe('强制休息倒计时', () => {
  it('严格模式：倒计时未结束前 end-rest 被拒绝，走满 5 分钟自动进入下一轮', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(2400);
    expect(m.getState()).toBe('forcedRest');
    jump(299);
    expect(m.getState()).toBe('forcedRest');
    expect(m.snapshot().remainingRestSeconds).toBe(1);
    expect(m.dispatch({ type: 'end-rest' })).toBe(false); // 严格模式拒绝跳过
    const events = jump(1);
    expect(m.getState()).toBe('working');
    expect(events).toContainEqual(expect.objectContaining({ type: 'rest-complete', kind: 'forced', completedRestCount: 1 }));
    expect(m.snapshot().todayStats.completedRestCount).toBe(1);
    expect(m.snapshot().reminderFired).toBe(false); // 新一轮提醒重新可用
  });

  it('非严格模式：强制休息可手动跳过，不计完成次数', () => {
    const { m, jump } = makeMachine(0, { strict: false });
    m.dispatch({ type: 'start' });
    jump(2400);
    expect(m.getState()).toBe('forcedRest');
    jump(30);
    expect(m.dispatch({ type: 'end-rest' })).toBe(true);
    expect(m.getState()).toBe('working');
    expect(m.snapshot().todayStats.completedRestCount).toBe(0);
  });

  it('手动休息走满时长计一次完成', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(600);
    m.dispatch({ type: 'start-rest' });
    jump(299);
    expect(m.getState()).toBe('manualRest');
    const events = jump(1);
    expect(m.getState()).toBe('working');
    expect(events).toContainEqual(expect.objectContaining({ type: 'rest-complete', kind: 'manual', completedRestCount: 1 }));
  });
});

describe('暂停 / 恢复 / 重置', () => {
  it('暂停期间 elapsed 不增加，恢复后继续', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(100);
    expect(m.dispatch({ type: 'pause' })).toBe(true);
    expect(m.getState()).toBe('paused');
    jump(500);
    expect(m.snapshot().elapsedWorkSeconds).toBe(100);
    expect(m.dispatch({ type: 'resume' })).toBe(true);
    expect(m.getState()).toBe('working');
    jump(50);
    expect(m.snapshot().elapsedWorkSeconds).toBe(150);
  });

  it('从 reminder30 暂停，恢复后回到 reminder30', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(1800);
    expect(m.getState()).toBe('reminder30');
    m.dispatch({ type: 'pause' });
    expect(m.getState()).toBe('paused');
    jump(999);
    m.dispatch({ type: 'resume' });
    expect(m.getState()).toBe('reminder30');
  });

  it('暂停时界不推进：29 分钟暂停 1 小时恢复，仍在 29 分钟', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(29 * 60);
    m.dispatch({ type: 'pause' });
    jump(3600);
    m.dispatch({ type: 'resume' });
    expect(m.snapshot().elapsedWorkSeconds).toBe(29 * 60);
    jump(60);
    expect(m.snapshot().elapsedWorkSeconds).toBe(30 * 60);
  });

  it('重置回到 idle，已工作时长计入今日统计', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(1200);
    expect(m.dispatch({ type: 'reset' })).toBe(true);
    expect(m.getState()).toBe('idle');
    expect(m.snapshot().elapsedWorkSeconds).toBe(0);
    expect(m.snapshot().todayStats.totalWorkSeconds).toBe(1200);
  });
});

describe('睡眠与唤醒', () => {
  it('睡眠时间不计入工作时长', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(600);
    m.sleep();
    jump(7200); // 睡 2 小时
    const s1 = m.snapshot();
    expect(s1.elapsedWorkSeconds).toBe(600);
    expect(s1.state).toBe('working'); // 可见状态不变
    m.wake();
    jump(60);
    expect(m.snapshot().elapsedWorkSeconds).toBe(660);
  });

  it('休息倒计时在睡眠期间冻结', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(2400);
    m.sleep();
    jump(1800);
    expect(m.snapshot().remainingRestSeconds).toBe(300);
    m.wake();
    jump(299);
    expect(m.snapshot().remainingRestSeconds).toBe(1);
    jump(1);
    expect(m.getState()).toBe('working');
  });
});

describe('开关与统计', () => {
  it('关闭强制休息后 40 分钟不进入休息，工作继续累计', () => {
    const { m, jump } = makeMachine(0, { forcedEnabled: false });
    m.dispatch({ type: 'start' });
    jump(1800);
    expect(m.getState()).toBe('reminder30');
    m.dispatch({ type: 'dismiss-reminder' });
    jump(600);
    expect(m.getState()).toBe('working');
    expect(m.snapshot().remainingToForcedRestSeconds).toBeNull();
    expect(m.snapshot().elapsedWorkSeconds).toBe(2400);
  });

  it('今日累计与最长段随工作增长', () => {
    const { m, jump } = makeMachine();
    m.dispatch({ type: 'start' });
    jump(700);
    expect(m.snapshot().todayStats.totalWorkSeconds).toBe(700);
    expect(m.snapshot().todayStats.longestWorkSessionSeconds).toBe(700);
    jump(2400 - 700); // 进入强制休息
    expect(m.snapshot().todayStats.longestWorkSessionSeconds).toBe(2400);
  });

  it('跨天统计重置', () => {
    let date = '2026-11-02';
    let now = 0;
    const m = new TimerMachine({ now: () => now, dateFor: () => date });
    m.dispatch({ type: 'start' });
    now = 1000 * 1000;
    m.advance();
    date = '2026-11-03';
    now += 1000;
    m.advance();
    const s = m.snapshot();
    expect(s.todayStats.date).toBe('2026-11-03');
    expect(s.todayStats.completedRestCount).toBe(0);
    // 跨天后从 0 重新累计（跨天瞬间的新增 1 秒计入新一天）
    expect(s.todayStats.totalWorkSeconds).toBe(1);
  });

  it('配置热更新生效（测试用短时长）', () => {
    const { m, jump } = makeMachine(0, { reminderSeconds: 10, forcedAfterSeconds: 15, restSeconds: 6 });
    m.dispatch({ type: 'start' });
    jump(10);
    expect(m.getState()).toBe('reminder30');
    jump(5);
    expect(m.getState()).toBe('forcedRest');
    expect(m.snapshot().remainingRestSeconds).toBe(6);
    jump(6);
    expect(m.getState()).toBe('working');
  });

  it('延后期间关闭定时提醒，立即回到工作且到点不再提醒', () => {
    const { m, jump } = makeMachine(0, { reminderSeconds: 10, forcedAfterSeconds: 60, snoozeSeconds: 5 });
    m.dispatch({ type: 'start' });
    jump(10);
    m.dispatch({ type: 'snooze' });
    expect(m.getState()).toBe('extended');
    m.updateConfig({ reminderEnabled: false });
    expect(m.getState()).toBe('working');
    const events = jump(5);
    expect(m.getState()).toBe('working');
    expect(events.filter((e) => e.type === 'reminder-show')).toHaveLength(0);
  });

  it('提醒卡显示期间关闭定时提醒，卡片对应状态立即结束', () => {
    const { m, jump } = makeMachine(0, { reminderSeconds: 10, forcedAfterSeconds: 60 });
    m.dispatch({ type: 'start' });
    jump(10);
    expect(m.getState()).toBe('reminder30');
    m.updateConfig({ reminderEnabled: false });
    expect(m.getState()).toBe('working');
  });

  it('监听器（而非仅返回值）能收到 advance 触发的语义事件（回归：休息窗口不开的根因）', () => {
    const { m, jump } = makeMachine(0, { reminderSeconds: 10, forcedAfterSeconds: 15, restSeconds: 6 });
    const seen: string[] = [];
    m.on((e) => seen.push(e.type));
    m.dispatch({ type: 'start' });
    jump(10); // reminder
    jump(5); // forced rest
    jump(6); // rest complete
    expect(seen).toContain('reminder');
    expect(seen).toContain('rest-start');
    expect(seen).toContain('rest-complete');
    expect(seen).toContain('state-change');
  });
});
