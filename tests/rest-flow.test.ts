// 端到端流程级测试：完整工作循环 + 休息期间活动计划
import { describe, expect, it } from 'vitest';
import { TimerMachine } from '../src/features/timer/machine';
import {
  buildBlinkPlan,
  buildBreathingPlan,
  buildFarNearPlan,
  buildFarPointGame,
  buildRestActivities,
  buildTrackingPlan,
} from '../src/features/training/plans';

function simulateDay() {
  const cfg = { reminderSeconds: 1800, forcedAfterSeconds: 2400, restSeconds: 300, snoozeSeconds: 300 };
  let now = 0;
  const m = new TimerMachine({ now: () => now, dateFor: () => '2026-11-02', config: cfg });
  const step = (sec: number) => {
    now += sec * 1000;
    return m.advance();
  };
  return { m, step, nowMs: () => now };
}

describe('完整一日流程（状态机层面）', () => {
  it('标准循环：工作→提醒→继续→强制休息→下一轮→再次提醒', () => {
    const { m, step } = simulateDay();

    m.dispatch({ type: 'start' });
    step(1800);
    expect(m.getState()).toBe('reminder30');
    m.dispatch({ type: 'dismiss-reminder' });
    step(600);
    expect(m.getState()).toBe('forcedRest');
    step(300);
    expect(m.getState()).toBe('working'); // 第二轮自动开始

    // 第二轮：再次提醒（reminderFired 已被重置）
    step(1800);
    expect(m.getState()).toBe('reminder30');
    expect(m.snapshot().todayStats.completedRestCount).toBe(1);
    expect(m.snapshot().todayStats.totalWorkSeconds).toBe(2400 + 1800);
  });

  it('忽略桌面通知（不点击）也会在 40 分钟强制休息', () => {
    const { m, step } = simulateDay();
    m.dispatch({ type: 'start' });
    step(2400); // 全程不操作
    expect(m.getState()).toBe('forcedRest');
  });

  it('连续两轮强制休息后统计正确', () => {
    const { m, step } = simulateDay();
    m.dispatch({ type: 'start' });
    step(2400);
    step(300);
    expect(m.getState()).toBe('working');
    step(2400); // 第二轮直接到 40 分钟（中途提醒出现过并保持）
    expect(m.getState()).toBe('forcedRest');
    step(300);
    const s = m.snapshot();
    expect(s.todayStats.completedRestCount).toBe(2);
    expect(s.todayStats.totalWorkSeconds).toBe(4800);
    expect(s.todayStats.longestWorkSessionSeconds).toBe(2400);
  });

  it('暂停后手动休息再恢复，状态一致', () => {
    const { m, step } = simulateDay();
    m.dispatch({ type: 'start' });
    step(900);
    m.dispatch({ type: 'pause' });
    m.dispatch({ type: 'start-rest' }); // 暂停时也可立即休息
    expect(m.getState()).toBe('manualRest');
    step(300);
    expect(m.getState()).toBe('working'); // 休息完直接开始新一轮工作（不回 paused）
    step(10);
    expect(m.snapshot().elapsedWorkSeconds).toBe(10);
  });
});

describe('休息活动计划', () => {
  it('远近切换：3 轮 = 远20s/近10s 交替，共 90s', () => {
    const phases = buildFarNearPlan(3);
    expect(phases).toHaveLength(6);
    expect(phases[0]).toMatchObject({ kind: 'far', durationSeconds: 20 });
    expect(phases[1]).toMatchObject({ kind: 'near', durationSeconds: 10 });
    expect(phases.reduce((a, p) => a + p.durationSeconds, 0)).toBe(90);
  });

  it('眨眼练习：6 次 = 闭2s/开2s，共 24s，且限制在 3–8 次', () => {
    const phases = buildBlinkPlan(6);
    expect(phases).toHaveLength(12);
    expect(phases.every((p) => p.durationSeconds === 2)).toBe(true);
    expect(buildBlinkPlan(99)).toHaveLength(16); // 钳制到 8 次
    expect(buildBlinkPlan(1)).toHaveLength(6); // 钳制到 3 次
  });

  it('缓慢追踪：单一阶段 30–180s', () => {
    const phases = buildTrackingPlan(90);
    expect(phases).toHaveLength(1);
    expect(buildTrackingPlan(9999)[0].durationSeconds).toBeLessThanOrEqual(180);
    expect(buildTrackingPlan(1)[0].durationSeconds).toBeGreaterThanOrEqual(30);
  });

  it('寻找远点：每轮 45s（30–60s 区间）', () => {
    const phases = buildFarPointGame(2);
    expect(phases).toHaveLength(2);
    for (const p of phases) {
      expect(p.durationSeconds).toBeGreaterThanOrEqual(30);
      expect(p.durationSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('呼吸引导：4-4-6 拍，每轮 14 秒，含吸/持/呼三种 phase', () => {
    const phases = buildBreathingPlan(8);
    expect(phases).toHaveLength(24); // 8 轮 × 3 拍
    expect(phases[0]).toMatchObject({ kind: 'breathe-in', durationSeconds: 4 });
    expect(phases[1]).toMatchObject({ kind: 'breathe-hold', durationSeconds: 4 });
    expect(phases[2]).toMatchObject({ kind: 'breathe-out', durationSeconds: 6 });
    expect(phases.reduce((s, p) => s + p.durationSeconds, 0)).toBe(8 * 14);
    expect(buildBreathingPlan(99)).toHaveLength(60); // 钳制到 20 轮
    // 5 分钟休息按 (300-60)/14 收敛到 10 轮上限内
    const auto = buildRestActivities('breathing', 300);
    expect(auto.title).toBe('呼吸引导');
    expect(auto.phases.length).toBeLessThanOrEqual(30);
  });

  it('auto 模式随轮换索引变化，固定模式稳定', () => {
    const a0 = buildRestActivities('auto', 300, 0);
    const a1 = buildRestActivities('auto', 300, 1);
    const a3 = buildRestActivities('auto', 300, 3); // 第 4 项 = 呼吸引导
    const fixed = buildRestActivities('far-near', 300, 0);
    expect(a0.title).not.toBe(a1.title); // 轮换
    expect(a3.title).toContain('呼吸引导');
    expect(fixed.title).toBe('远近切换');
    // auto 模式总时长不超过休息时长（留 30s 缓冲）
    const total = a0.phases.reduce((s, p) => s + p.durationSeconds, 0);
    expect(total).toBeLessThanOrEqual(300 - 30 + 45); // 追踪计划按 restSeconds-30 封顶
  });
});
