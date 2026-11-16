// 护眼训练与「寻找远点」小游戏的计划（纯函数，无 DOM，供休息窗口执行、供单测校验）
// 所有阶段节奏缓慢：无快速闪烁、无高频切换（PRD §6.4 / 交接 §6.4）

export type TrainingPhaseKind =
  | 'far'
  | 'near'
  | 'track'
  | 'observe'
  | 'blink-open'
  | 'blink-closed'
  | 'breathe-in'
  | 'breathe-hold'
  | 'breathe-out';

export interface TrainingPhase {
  kind: TrainingPhaseKind;
  /** 给用户看的引导文案 */
  label: string;
  durationSeconds: number;
}

/** 远近切换：看远 20s → 看近 10s，默认 3 轮 */
export function buildFarNearPlan(rounds = 3, farSeconds = 20, nearSeconds = 10): TrainingPhase[] {
  const phases: TrainingPhase[] = [];
  for (let i = 1; i <= clampInt(rounds, 1, 5); i++) {
    phases.push({ kind: 'far', label: `第 ${i} 轮 · 看向窗外或最远的地方`, durationSeconds: farSeconds });
    phases.push({ kind: 'near', label: `第 ${i} 轮 · 收回目光，看近处一个固定点`, durationSeconds: nearSeconds });
  }
  return phases;
}

/** 眨眼练习：闭眼 2s / 睁眼 2s 交替，默认 6 次 */
export function buildBlinkPlan(blinks = 6, closedSeconds = 2, openSeconds = 2): TrainingPhase[] {
  const phases: TrainingPhase[] = [];
  for (let i = 1; i <= clampInt(blinks, 3, 8); i++) {
    phases.push({ kind: 'blink-closed', label: `第 ${i} 次 · 轻轻闭上`, durationSeconds: closedSeconds });
    phases.push({ kind: 'blink-open', label: `第 ${i} 次 · 缓缓睁开`, durationSeconds: openSeconds });
  }
  return phases;
}

/** 呼吸引导：吸 4s → 保持 4s → 呼 6s（14s/轮），轮数按休息时长收敛 */
export function buildBreathingPlan(cycles = 8, inSec = 4, holdSec = 4, outSec = 6): TrainingPhase[] {
  const phases: TrainingPhase[] = [];
  for (let i = 1; i <= clampInt(cycles, 1, 20); i++) {
    phases.push({ kind: 'breathe-in', label: `第 ${i} 轮 · 缓缓吸气`, durationSeconds: inSec });
    phases.push({ kind: 'breathe-hold', label: `第 ${i} 轮 · 轻轻保持`, durationSeconds: holdSec });
    phases.push({ kind: 'breathe-out', label: `第 ${i} 轮 · 慢慢呼气`, durationSeconds: outSec });
  }
  return phases;
}

/** 缓慢追踪：单一匀速目标，总时长即阶段时长（视觉由渲染层生成稳定慢速轨迹） */
export function buildTrackingPlan(totalSeconds = 90): TrainingPhase[] {
  return [{ kind: 'track', label: '目光跟着光点慢慢走', durationSeconds: clampInt(totalSeconds, 30, 180) }];
}

/** 寻找远点小游戏：每轮 45s 观察，默认 1~2 轮（PRD：每轮 30–60s） */
export function buildFarPointGame(rounds = 1): TrainingPhase[] {
  const phases: TrainingPhase[] = [];
  for (let i = 1; i <= clampInt(rounds, 1, 3); i++) {
    phases.push({ kind: 'observe', label: `寻找远点 · 第 ${i} 轮，放松地看着它漂移`, durationSeconds: 45 });
  }
  return phases;
}

export type FixedTrainingMode = 'far-near' | 'tracking' | 'blink' | 'breathing';

export const AUTO_TRAINING_ROTATION: readonly FixedTrainingMode[] = ['far-near', 'tracking', 'blink', 'breathing'];

/** 主进程在每次休息结束后推进；索引跨休息窗口持久，避免 auto 永远停在第一项 */
export function nextAutoRotationIndex(current: number): number {
  return (current + 1) % AUTO_TRAINING_ROTATION.length;
}

/** 按设置生成休息期间的活动序列；所有模式的总时长都不超过本次休息预算 */
export function buildRestActivities(
  mode: FixedTrainingMode | 'auto',
  restSeconds: number,
  autoRotationIndex = 0,
): { title: string; phases: TrainingPhase[] } {
  const budget = Math.max(1, Math.floor(restSeconds));
  if (mode !== 'auto') return buildFixedActivity(mode, budget);

  const pick = AUTO_TRAINING_ROTATION[autoRotationIndex % AUTO_TRAINING_ROTATION.length];
  // 不足 90 秒时不强行塞入小游戏，避免训练被休息结束截断
  if (budget < 90) return buildFixedActivity(pick, budget);

  // 预留 45 秒寻找远点，训练在剩余预算内收敛
  const first = buildFixedActivity(pick, budget - 45);
  return { title: `${first.title} + 寻找远点`, phases: [...first.phases, ...buildFarPointGame(1)] };
}

function buildFixedActivity(mode: FixedTrainingMode, budget: number): { title: string; phases: TrainingPhase[] } {
  if (mode === 'far-near') {
    return { title: '远近切换', phases: buildFarNearPlan(Math.min(3, Math.max(1, Math.floor(budget / 30)))) };
  }
  if (mode === 'blink') {
    return { title: '眨眼练习', phases: buildBlinkPlan(Math.min(8, Math.max(3, Math.floor(budget / 4)))) };
  }
  if (mode === 'tracking') {
    return { title: '缓慢追踪', phases: buildTrackingPlan(Math.min(90, budget)) };
  }
  const cycles = Math.min(10, Math.max(1, Math.floor(budget / 14)));
  return { title: '呼吸引导', phases: buildBreathingPlan(cycles) };
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}
