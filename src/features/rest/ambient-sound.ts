// 休息白噪音：Web Audio 本地合成（不联网、无音频文件、无依赖）
// 雨声 = 白噪 + 低通 + 慢起伏；溪流 = 白噪 + 带通 + 潺潺调制；ping = 呼吸拍点轻音
export type AmbientKind = 'rain' | 'stream';

export interface AmbientPrefs {
  kind: AmbientKind | 'off';
  volume: number; // 0..1
}

const PREFS_KEY = 'ambient-prefs';

export function loadAmbientPrefs(): AmbientPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { kind: 'off', volume: 0.5 };
    const p = JSON.parse(raw) as Partial<AmbientPrefs>;
    const kind = p.kind === 'rain' || p.kind === 'stream' ? p.kind : 'off';
    const volume = typeof p.volume === 'number' && Number.isFinite(p.volume) ? Math.min(1, Math.max(0, p.volume)) : 0.5;
    return { kind, volume };
  } catch {
    return { kind: 'off', volume: 0.5 };
  }
}

export function saveAmbientPrefs(prefs: AmbientPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage 不可用时静默降级（下次休息回到默认） */
  }
}

export class AmbientSound {
  private ctx: AudioContext | null = null;
  /** 当前音源链的独立 master；stop 后立刻置空，下次 start 必建新链 */
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private kind: AmbientKind | 'off' = 'off';
  private volume = 0.5;
  /** 每次 start/stop 都递增，使 await resume() 之后的过期启动失效 */
  private generation = 0;
  /** 状态暴露给验收脚本（data 驱动的 UI 已够人读，这里给程序读） */
  readonly stateEl: HTMLElement;

  constructor(container: HTMLElement) {
    this.stateEl = container;
    this.stateEl.dataset.playing = 'off';
  }

  get current(): AmbientKind | 'off' {
    return this.kind;
  }

  /** 开启/切换音源；渐入防爆音。每次启动都有独立 master 和 generation。 */
  async start(kind: AmbientKind, volume = this.volume): Promise<void> {
    this.stop(); // 停掉旧链，并令所有尚未完成的旧 start 失效
    const generation = ++this.generation;
    this.kind = kind;
    this.volume = volume;
    const ctx = this.ensureContext();
    const master = this.master!;

    try {
      await ctx.resume();
    } catch (err) {
      console.warn('[ambient] AudioContext 恢复失败', err);
      if (generation === this.generation) this.stop();
      return;
    }

    // resume 期间用户可能已静音或切换；过期启动不得再创建节点/发声
    if (generation !== this.generation || this.kind !== kind || this.master !== master) return;

    const noise = this.noiseSource();
    const filter = ctx.createBiquadFilter();
    if (kind === 'rain') {
      filter.type = 'lowpass'; // 雨声：低通后的沙沙声
      filter.frequency.value = 1100;
      filter.Q.value = 0.6;
    } else {
      filter.type = 'bandpass'; // 溪流：中频带通 + 起伏 = 潺潺
      filter.frequency.value = 850;
      filter.Q.value = 1.1;
    }

    const layerGain = ctx.createGain();
    layerGain.gain.value = kind === 'rain' ? 0.5 : 0.65;

    // 慢起伏：雨势/水流的自然波动（很低频率，无节拍感）
    const lfo = ctx.createOscillator();
    lfo.frequency.value = kind === 'rain' ? 0.05 : 0.22;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = kind === 'rain' ? 0.1 : 0.3;
    lfo.connect(lfoDepth).connect(layerGain.gain);

    noise.connect(filter).connect(layerGain).connect(master);
    lfo.start();
    this.nodes = [noise, filter, layerGain, lfo, lfoDepth];

    // 2 秒渐入
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, this.volume), ctx.currentTime + 2);
    this.stateEl.dataset.playing = kind;
  }

  /** 停止（1.5 秒渐出后释放）；旧 master 与节点由本次定时器独立清理 */
  stop(): void {
    this.generation += 1; // 同时使等待 resume() 的 start 失效
    this.kind = 'off';
    this.stateEl.dataset.playing = 'off';

    const ctx = this.ctx;
    const master = this.master;
    const nodes = this.nodes;
    // 先脱离当前状态：下次 start 会创建全新 master，不受旧清理定时器影响
    this.master = null;
    this.nodes = [];
    if (!ctx || !master) return;

    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
    window.setTimeout(() => {
      for (const n of nodes) {
        try {
          if ('stop' in n && typeof (n as OscillatorNode).stop === 'function') (n as OscillatorNode).stop();
        } catch {
          /* 已停止 */
        }
        try {
          n.disconnect();
        } catch {
          /* 已断开 */
        }
      }
      master.disconnect();
    }, 1600);
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    if (this.ctx && this.master && this.kind !== 'off') {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(Math.max(0.0001, this.volume), t, 0.15);
    }
  }

  /** 呼吸引导的轻拍点音：吸气高一点、呼气低一点。独立通道，不受白噪音音量/关闭影响 */
  ping(kind: 'breathe-in' | 'breathe-out'): void {
    const ctx = this.ensureContext();
    void ctx.resume().catch(() => undefined);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = kind === 'breathe-in' ? 523.25 : 392.0; // C5 / G4
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 1);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** 循环白噪声源（2 秒缓冲，避免单样本循环的金属感） */
  private noiseSource(): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const seconds = 2;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.72 + white * 0.28; // 轻微粉化，更接近自然声
      data[i] = last * 2.4;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }
}
