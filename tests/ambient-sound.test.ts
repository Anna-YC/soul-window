// 背景声生命周期回归：重启、切换、延迟 resume 与恢复失败（P1）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AmbientSound } from '../src/features/rest/ambient-sound';

function audioParam(value = 0) {
  return {
    value,
    cancelScheduledValues: vi.fn(),
    setValueAtTime(v: number) { this.value = v; },
    exponentialRampToValueAtTime(v: number) { this.value = v; },
    setTargetAtTime(v: number) { this.value = v; },
  };
}

class MockNode {
  connections = new Set<unknown>();
  disconnected = false;
  start = vi.fn();
  stop = vi.fn();
  connect(target: unknown): unknown {
    this.connections.add(target);
    return target;
  }
  disconnect(): void {
    this.disconnected = true;
    this.connections.clear();
  }
}

class MockAudioContext {
  destination = { name: 'destination' };
  currentTime = 0;
  sampleRate = 8000;
  gains: MockNode[] = [];
  sources: MockNode[] = [];
  resume = vi.fn((): Promise<void> => Promise.resolve());

  createGain(): MockNode {
    const node = new MockNode();
    Object.assign(node, { gain: audioParam(1) });
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): MockNode {
    const node = new MockNode();
    Object.assign(node, { type: '', frequency: audioParam(), Q: audioParam() });
    return node;
  }

  createOscillator(): MockNode {
    const node = new MockNode();
    Object.assign(node, { type: '', frequency: audioParam() });
    return node;
  }

  createBuffer(_channels: number, length: number, _sampleRate: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }

  createBufferSource(): MockNode {
    const node = new MockNode();
    Object.assign(node, { buffer: null, loop: false });
    this.sources.push(node);
    return node;
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function container() {
  return { dataset: { playing: '' } } as unknown as HTMLElement;
}

function masters(ctx: MockAudioContext): MockNode[] {
  return ctx.gains.filter((node) => node.connections.has(ctx.destination));
}

describe('AmbientSound 启动/停止生命周期', () => {
  let ctx: MockAudioContext;

  beforeEach(() => {
    vi.useFakeTimers();
    ctx = new MockAudioContext();
    vi.stubGlobal('AudioContext', function () { return ctx; });
    vi.stubGlobal('window', globalThis);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('停止并清理后再次启动，使用新的已连接 master', async () => {
    const sound = new AmbientSound(container());
    await sound.start('rain');
    const first = masters(ctx)[0];
    sound.stop();
    await vi.advanceTimersByTimeAsync(1700);
    expect(first.disconnected).toBe(true);

    await sound.start('rain');
    const second = masters(ctx)[0];
    expect(second).not.toBe(first);
    expect(second.disconnected).toBe(false);
    expect(sound.current).toBe('rain');
  });

  it('直接切换音源，旧清理定时器不会断开新音源', async () => {
    const sound = new AmbientSound(container());
    await sound.start('rain');
    const first = masters(ctx)[0];
    await sound.start('stream');
    const second = masters(ctx).at(-1)!;

    await vi.advanceTimersByTimeAsync(1700);
    expect(first.disconnected).toBe(true);
    expect(second.disconnected).toBe(false);
    expect(second.connections.has(ctx.destination)).toBe(true);
    expect(sound.current).toBe('stream');
    expect(sound.stateEl.dataset.playing).toBe('stream');
  });

  it('resume 尚未完成时静音，过期启动不会创建声音节点', async () => {
    const pending = deferred();
    ctx.resume = vi.fn(() => pending.promise);
    const sound = new AmbientSound(container());
    const starting = sound.start('rain');

    sound.stop();
    pending.resolve();
    await starting;

    expect(sound.current).toBe('off');
    expect(sound.stateEl.dataset.playing).toBe('off');
    expect(ctx.sources).toHaveLength(0);
  });

  it('快速连续启动时，只有最后一次启动生效', async () => {
    const firstResume = deferred();
    const secondResume = deferred();
    ctx.resume = vi
      .fn()
      .mockImplementationOnce(() => firstResume.promise)
      .mockImplementationOnce(() => secondResume.promise);
    const sound = new AmbientSound(container());

    const first = sound.start('rain');
    const second = sound.start('stream');
    firstResume.resolve();
    await first;
    expect(ctx.sources).toHaveLength(0);

    secondResume.resolve();
    await second;
    expect(ctx.sources).toHaveLength(1);
    expect(sound.current).toBe('stream');
    await vi.advanceTimersByTimeAsync(1700);
    expect(masters(ctx)[0].disconnected).toBe(false);
  });

  it('resume 失败时安静回到 off，不留下未处理的 Promise rejection', async () => {
    ctx.resume = vi.fn(() => Promise.reject(new Error('audio unavailable')));
    const sound = new AmbientSound(container());

    await expect(sound.start('rain')).resolves.toBeUndefined();
    expect(sound.current).toBe('off');
    expect(sound.stateEl.dataset.playing).toBe('off');
    expect(ctx.sources).toHaveLength(0);
  });
});
