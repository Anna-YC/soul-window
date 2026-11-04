// 休息训练的舞台运行时：把 plans 的阶段序列渲染成缓慢、无闪烁的动画。
// 视觉原则（PRD §6.4/§10）：单一柔光目标、匀速慢动、所有变化 ≥0.8s 过渡、绝不闪烁。
import type { TrainingPhase } from './plans';

export interface StageCallbacks {
  onPhaseChange?(index: number, total: number, phase: TrainingPhase): void;
  /** 每个阶段开始瞬间（用于呼吸引导的轻拍点音等） */
  onPhaseStart?(phase: TrainingPhase): void;
  onFinish?(): void;
}

export class TrainingStage {
  private readonly orb: HTMLElement;
  private readonly label: HTMLElement;
  private raf = 0;
  private stopped = false;
  private phaseIndex = -1;

  constructor(
    private readonly container: HTMLElement,
    private phases: TrainingPhase[],
    private readonly cb: StageCallbacks,
  ) {
    container.innerHTML = `
      <div class="stage-orb"></div>
      <div class="stage-label"></div>
      <div class="phase-dots"></div>
    `;
    this.orb = container.querySelector('.stage-orb') as HTMLElement;
    this.label = container.querySelector('.stage-label') as HTMLElement;
    const dots = container.querySelector('.phase-dots') as HTMLElement;
    dots.innerHTML = this.phases.map(() => '<i></i>').join('');
  }

  start(): void {
    this.stopped = false;
    this.enterPhase(0);
    this.loop(performance.now());
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.orb.style.opacity = '0';
    this.label.style.opacity = '0';
  }

  private enterPhase(index: number): void {
    if (index >= this.phases.length) {
      this.stop();
      this.cb.onFinish?.();
      return;
    }
    if (this.phaseIndex >= 0) {
      this.container.querySelectorAll('.phase-dots i')[this.phaseIndex]?.classList.replace('current', 'done');
    }
    this.phaseIndex = index;
    this.container.querySelectorAll('.phase-dots i')[index]?.classList.add('current');

    const phase = this.phases[index];
    this.cb.onPhaseStart?.(phase);
    this.label.style.opacity = '0';
    window.setTimeout(() => {
      this.label.textContent = phase.label;
      this.label.style.opacity = '1';
    }, 350);

    this.applyVisual(phase);
    this.phaseStartedAt = performance.now();
    this.phaseDeadline = this.phaseStartedAt + phase.durationSeconds * 1000;
  }

  private phaseStartedAt = 0;
  private phaseDeadline = 0;

  private loop = (now: number): void => {
    if (this.stopped) return;
    const phase = this.phases[this.phaseIndex];
    if (!phase) return;

    if (phase.kind === 'track' || phase.kind === 'observe') {
      this.moveOrbAlongPath(phase.kind, now);
    }
    if (now >= this.phaseDeadline) {
      this.enterPhase(this.phaseIndex + 1);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /** 阶段视觉：远近切换改尺寸；眨眼改透明度；呼吸随拍长缩放；追踪/远点持续移动 */
  private applyVisual(phase: TrainingPhase): void {
    const stage = this.container.getBoundingClientRect();
    const minDim = Math.min(stage.width, stage.height);
    const setOrb = (diameter: number, x = 0, y = 0) => {
      const r = diameter / 2;
      this.orb.style.width = `${diameter}px`;
      this.orb.style.height = `${diameter}px`;
      this.orb.style.margin = `${-r}px 0 0 ${-r}px`;
      this.orb.style.transform = `translate(${x}px, ${y}px)`;
      this.orb.style.opacity = '0.9';
    };

    switch (phase.kind) {
      case 'far':
        this.setOrbTransition(1.6);
        setOrb(Math.max(36, minDim * 0.12)); // 远：小点
        break;
      case 'near':
        this.setOrbTransition(1.6);
        setOrb(Math.max(120, minDim * 0.52)); // 近：大圆
        break;
      case 'blink-open':
        this.setOrbTransition(1.6);
        setOrb(Math.max(90, minDim * 0.34));
        break;
      case 'blink-closed':
        this.setOrbTransition(1.6);
        this.orb.style.opacity = '0.06'; // 缓慢淡出代替消失
        break;
      case 'breathe-in':
        // 吸气：圆环用整拍时长缓放大，呼气用整拍缓缩小——呼吸感全靠这个节奏
        this.setOrbTransition(phase.durationSeconds);
        setOrb(Math.max(200, minDim * 0.6));
        break;
      case 'breathe-hold':
        this.setOrbTransition(1.2);
        setOrb(Math.max(200, minDim * 0.6)); // 保持尺寸不变
        break;
      case 'breathe-out':
        this.setOrbTransition(phase.durationSeconds);
        setOrb(Math.max(110, minDim * 0.32));
        break;
      case 'track':
      case 'observe':
        this.setOrbTransition(1.6);
        setOrb(Math.max(40, minDim * 0.14));
        break;
    }
  }

  /** 尺寸/透明度过渡时长（秒）；transform 恒用 1.6s 线性 */
  private setOrbTransition(seconds: number): void {
    const s = Math.max(0.5, seconds);
    this.orb.style.transition = `width ${s}s cubic-bezier(0.4, 0, 0.2, 1), height ${s}s cubic-bezier(0.4, 0, 0.2, 1), margin ${s}s cubic-bezier(0.4, 0, 0.2, 1), transform 1.6s linear, opacity 1.2s`;
  }

  /** 匀速感路径：追踪 = 缓慢 Lissajous；寻找远点 = 更慢的双频漂移 */
  private moveOrbAlongPath(kind: 'track' | 'observe', now: number): void {
    const stage = this.container.getBoundingClientRect();
    const ax = stage.width * 0.36;
    const ay = stage.height * 0.34;
    const t = now / 1000;
    let x: number;
    let y: number;
    if (kind === 'track') {
      const w = (2 * Math.PI) / 26; // 26 秒一圈
      x = ax * Math.sin(t * w);
      y = ay * Math.sin(t * w * 2 + Math.PI / 3);
    } else {
      const w1 = (2 * Math.PI) / 38;
      const w2 = (2 * Math.PI) / 53;
      x = ax * 0.8 * Math.sin(t * w1);
      y = ay * 0.8 * Math.sin(t * w2 + 1.2);
    }
    this.orb.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}
