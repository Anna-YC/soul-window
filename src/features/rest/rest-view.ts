// 休息窗口视图：倒计时 + 训练 + 寻找远点小游戏 + 呼吸引导 + 雨声/溪流白噪音。
// 只读快照渲染；「结束休息」只在 手动休息 / 非严格强制 时出现。
import '../../styles/rest.css';
import { fmtClock } from '../../app/format';
import type { AppSnapshot } from '../../shared/settings';
import { buildRestActivities, type FixedTrainingMode, type TrainingPhase } from '../training/plans';
import { TrainingStage } from '../training/runtime';
import { AmbientSound, loadAmbientPrefs, saveAmbientPrefs, type AmbientPrefs } from './ambient-sound';

export function mountRestApp(root: HTMLElement): void {
  root.innerHTML = `
    <div id="app-inner" class="fade-in">
      <div class="rest-head">
        <span class="rest-kind" id="rest-kind">休息</span>
        <div class="rest-countdown" id="rest-countdown">--:--</div>
      </div>

      <div class="stage" id="stage"></div>

      <div class="rest-foot">
        <div class="training-pick" id="training-pick" hidden>
          <button class="pick-btn" data-mode="far-near">远近切换</button>
          <button class="pick-btn" data-mode="tracking">缓慢追踪</button>
          <button class="pick-btn" data-mode="blink">眨眼练习</button>
          <button class="pick-btn" data-mode="breathing">呼吸引导</button>
          <button class="pick-btn" data-mode="game">寻找远点</button>
        </div>
        <div class="ambient-bar" id="ambient-bar" hidden>
          <span class="ambient-label">背景声</span>
          <button class="pick-btn" data-sound="rain">雨声</button>
          <button class="pick-btn" data-sound="stream">溪流</button>
          <button class="pick-btn" data-sound="off">静音</button>
          <input type="range" id="ambient-volume" min="0" max="100" value="50" aria-label="背景声音量" />
        </div>
        <button class="end-rest-btn" id="end-rest" hidden>结束休息，回去工作</button>
        <button class="skip-rest-btn" id="skip-rest" hidden>跳过本次休息</button>
        <div class="strict-note" id="strict-note" hidden></div>
        <p class="disclaimer">
          训练与小游戏只是休息的陪伴，不是医疗治疗。随时可以闭上眼睛、看向窗外，不需要一直盯着屏幕。
        </p>
      </div>
    </div>
  `;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const refs = {
    kind: $('rest-kind'),
    countdown: $('rest-countdown'),
    stage: $('stage'),
    pick: $('training-pick'),
    ambientBar: $('ambient-bar'),
    ambientVolume: $<HTMLInputElement>('ambient-volume'),
    endRest: $('end-rest'),
    skipRest: $('skip-rest'),
    strictNote: $('strict-note'),
  };

  let latest: AppSnapshot | null = null;
  let stage: TrainingStage | null = null;
  let lastRestRoundKey = ''; // 区分「新一轮休息」：state+开始时间戳
  let autoRotation = Number(sessionStorage.getItem('rest-rotation') ?? '0');

  const ambient = new AmbientSound(refs.ambientBar);
  let ambientPrefs: AmbientPrefs = loadAmbientPrefs();

  /** 呼吸引导的轻拍点音（吸气高音、呼气低音），闭眼也能跟上节奏 */
  const pingPhase = (kind: string): void => {
    if (kind === 'breathe-in') ambient.ping('breathe-in');
    if (kind === 'breathe-out') ambient.ping('breathe-out');
  };

  function startTraining(mode: FixedTrainingMode | 'auto' | 'game'): void {
    const snap = latest;
    if (!snap) return;
    stage?.stop();
    const restSeconds = Math.max(30, snap.timer.remainingRestSeconds);
    let plan: { title: string; phases: TrainingPhase[] };
    if (mode === 'game') {
      // 寻找远点小游戏：单轮 30–60s 观察
      plan = {
        title: '寻找远点',
        phases: [{ kind: 'observe', label: '寻找远点 · 放松地看着它漂移', durationSeconds: Math.min(60, Math.max(30, restSeconds - 10)) }],
      };
    } else {
      plan = buildRestActivities(mode, restSeconds, autoRotation);
    }
    for (const btn of refs.pick.querySelectorAll<HTMLElement>('.pick-btn')) {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    }
    stage = new TrainingStage(refs.stage, plan.phases, {
      onPhaseStart: (phase) => pingPhase(phase.kind),
      onFinish: () => {
        // 训练结束：淡出舞台，回到纯倒计时
        refs.stage.querySelector('.stage-label')!.textContent = '就这样放松一会儿，倒计时结束自动回去工作';
      },
    });
    stage.start();
  }

  refs.pick.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]');
    if (btn?.dataset.mode) startTraining(btn.dataset.mode as FixedTrainingMode | 'game');
  });
  refs.endRest.addEventListener('click', () => window.eye.dispatch({ type: 'end-rest' }));
  refs.skipRest.addEventListener('click', () => window.eye.dispatch({ type: 'end-rest' }));

  // ---- 背景声：雨声 / 溪流（本地合成，音量可调，偏好跨休息记忆） ----
  function refreshAmbientButtons(): void {
    for (const btn of refs.ambientBar.querySelectorAll<HTMLElement>('[data-sound]')) {
      btn.classList.toggle('active', btn.dataset.sound === ambientPrefs.kind);
    }
    refs.ambientVolume.value = String(Math.round(ambientPrefs.volume * 100));
  }

  async function applyAmbient(kind: AmbientPrefs['kind'], volume = ambientPrefs.volume): Promise<void> {
    ambientPrefs = { kind, volume };
    saveAmbientPrefs(ambientPrefs);
    refreshAmbientButtons();
    if (kind === 'off') {
      ambient.stop();
      return;
    }
    await ambient.start(kind, volume);
  }

  refs.ambientBar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-sound]');
    if (!btn?.dataset.sound) return;
    const kind = btn.dataset.sound as AmbientPrefs['kind'];
    // 再点当前音源 = 关闭
    void applyAmbient(kind === ambientPrefs.kind && kind !== 'off' ? 'off' : kind);
  });
  refs.ambientVolume.addEventListener('input', () => {
    const volume = Number(refs.ambientVolume.value) / 100;
    ambient.setVolume(volume);
    ambientPrefs = { ...ambientPrefs, volume };
    saveAmbientPrefs(ambientPrefs);
  });

  window.eye.onSnapshot((snap: AppSnapshot) => {
    latest = snap;
    const t = snap.timer;
    const resting = t.state === 'forcedRest' || t.state === 'manualRest';

    // 主进程关闭本窗口是休息结束的正常路径；这里只处理「还开着」的情况
    refs.countdown.textContent = fmtClock(t.remainingRestSeconds);
    refs.kind.textContent = t.state === 'forcedRest' ? '强制休息' : '休息';

    if (!resting) return; // 结束瞬间（快照早于关窗）：等待窗口被关闭

    const roundKey = `${t.state}-${t.restKind}`;
    const newRound = roundKey !== lastRestRoundKey;
    if (newRound) {
      lastRestRoundKey = roundKey;
      // 按设置自动开始训练
      if (snap.settings.autoTraining) {
        startTraining(snap.settings.trainingMode);
        if (snap.settings.trainingMode === 'auto') {
          autoRotation += 1;
          sessionStorage.setItem('rest-rotation', String(autoRotation));
        }
        refs.pick.hidden = false; // 自动训练也可手动换
      } else {
        refs.pick.hidden = false;
        refs.stage.querySelector('.stage-label')!.textContent = '选一个练习陪这段时间，或什么都不做';
      }
      // 背景声：恢复上次偏好（localStorage 持久）
      refs.ambientBar.hidden = false;
      refreshAmbientButtons();
      if (ambientPrefs.kind !== 'off') void applyAmbient(ambientPrefs.kind);
    }

    const canEnd = t.state === 'manualRest' || !snap.settings.strictMode;
    refs.endRest.hidden = !canEnd;
    // 非严格模式才显示「跳过本次休息」（严格模式严格不给）
    refs.skipRest.hidden = !(t.state === 'forcedRest' && !snap.settings.strictMode);
    refs.strictNote.hidden = canEnd;
    if (!canEnd) {
      refs.strictNote.textContent = `严格模式已开启 · ${fmtClock(t.remainingRestSeconds)} 后自动回到工作`;
    }
  });
}
