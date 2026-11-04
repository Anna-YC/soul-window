// 主窗口视图：只读快照 + 派发动作，不持有任何计时状态（PRD §8）
import '../../styles/main.css';
import { fmtClock, fmtHuman } from '../../app/format';
import type { AppSnapshot } from '../../shared/settings';
import type { TimerStateName } from './types';
import { mountSettingsPanel } from '../settings/settings-view';

const STATE_TEXT: Record<TimerStateName, string> = {
  idle: '未开始',
  working: '工作中',
  reminder30: '该休息了',
  extended: '提醒已延后',
  forcedRest: '强制休息中',
  manualRest: '休息中',
  paused: '已暂停',
};

const REMINDER_COPY = '已连续工作 30 分钟。现在休息 2 到 5 分钟，让眼睛离开屏幕。';

export function mountMainApp(root: HTMLElement): void {
  root.innerHTML = `
    <header class="masthead">
      <div class="brand"><h1>心灵之窗</h1><span class="sub">护眼助手</span></div>
      <button class="ghost-btn" id="btn-settings">设置</button>
    </header>

    <section class="status-card" id="status-card">
      <span class="state-badge" id="state-badge">未开始</span>
      <div class="big-clock" id="big-clock">00:00</div>
      <div class="clock-caption" id="clock-caption">连续工作时长</div>

      <div class="progress-rows" id="progress-rows">
        <div class="progress-row" id="row-reminder">
          <div class="meta"><span>到定时提醒</span><span class="value" id="val-reminder">--:--</span></div>
          <div class="bar reminder"><i id="bar-reminder"></i></div>
        </div>
        <div class="progress-row" id="row-forced">
          <div class="meta"><span>到强制休息</span><span class="value" id="val-forced">--:--</span></div>
          <div class="bar forced"><i id="bar-forced"></i></div>
        </div>
      </div>
    </section>

    <section class="reminder-card" id="reminder-card" hidden>
      <h2>该休息一下了</h2>
      <p id="reminder-copy">${REMINDER_COPY}</p>
      <div class="actions">
        <button class="btn primary" data-action="start-rest">开始休息</button>
        <button class="btn" data-action="snooze">延后 5 分钟</button>
        <button class="btn" data-action="dismiss-reminder">继续工作</button>
      </div>
    </section>

    <div class="extended-note" id="extended-note" hidden></div>

    <section class="actions" id="main-actions">
      <button class="btn primary" id="btn-start">开始计时</button>
      <button class="btn" id="btn-pause">暂停</button>
      <button class="btn" id="btn-rest">立即休息</button>
      <button class="btn quiet span-3" id="btn-reset">重置当前工作段</button>
    </section>

    <section class="stats" id="stats" hidden>
      <div class="stat"><b id="stat-work">0 分</b><span>今日工作</span></div>
      <div class="stat"><b id="stat-rest">0</b><span>完成休息</span></div>
      <div class="stat"><b id="stat-longest">0 分</b><span>最长一段</span></div>
    </section>

    <p class="footnote">
      关闭窗口会驻留后台，计时不停；退出请用托盘菜单。<br />
      本应用帮助养成休息习惯，不提供医疗建议。
    </p>
  `;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const refs = {
    card: $('status-card'),
    badge: $('state-badge'),
    clock: $('big-clock'),
    caption: $('clock-caption'),
    progressRows: $('progress-rows'),
    rowReminder: $('row-reminder'),
    rowForced: $('row-forced'),
    valReminder: $('val-reminder'),
    valForced: $('val-forced'),
    barReminder: $('bar-reminder'),
    barForced: $('bar-forced'),
    reminderCard: $('reminder-card'),
    reminderCopy: $('reminder-copy'),
    extendedNote: $('extended-note'),
    btnStart: $<HTMLButtonElement>('btn-start'),
    btnPause: $<HTMLButtonElement>('btn-pause'),
    btnRest: $<HTMLButtonElement>('btn-rest'),
    btnReset: $<HTMLButtonElement>('btn-reset'),
    stats: $('stats'),
    statWork: $('stat-work'),
    statRest: $('stat-rest'),
    statLongest: $('stat-longest'),
  };

  // ---- 动作派发 ----
  refs.btnStart.addEventListener('click', () => {
    const s = latest?.timer.state;
    if (s === 'idle') window.eye.dispatch({ type: 'start' });
    else if (s === 'paused') window.eye.dispatch({ type: 'resume' });
  });
  refs.btnPause.addEventListener('click', () => {
    const s = latest?.timer.state;
    if (s === 'working' || s === 'reminder30' || s === 'extended') window.eye.dispatch({ type: 'pause' });
    else if (s === 'paused') window.eye.dispatch({ type: 'resume' });
  });
  refs.btnRest.addEventListener('click', () => window.eye.dispatch({ type: 'start-rest' }));
  refs.btnReset.addEventListener('click', () => window.eye.dispatch({ type: 'reset' }));
  refs.reminderCard.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'start-rest') window.eye.dispatch({ type: 'start-rest' });
    if (action === 'snooze') window.eye.dispatch({ type: 'snooze' });
    if (action === 'dismiss-reminder') window.eye.dispatch({ type: 'dismiss-reminder' });
  });
  $('btn-settings').addEventListener('click', openSettings);

  function openSettings(): void {
    if (root.querySelector('.settings-overlay')) return;
    mountSettingsPanel(root, {
      getSettings: () => window.eye.getSettings(),
      saveSettings: (patch) => window.eye.saveSettings(patch),
      onClose: () => undefined,
    });
  }
  window.eye.onOpenSettings(openSettings);

  // ---- 快照渲染 ----
  let latest: AppSnapshot | null = null;
  window.eye.onSnapshot((snap: AppSnapshot) => {
    latest = snap;
    render(snap);
  });

  function render(snap: AppSnapshot): void {
    const t = snap.timer;
    const s = snap.settings;

    // 状态徽章 + 大字时钟
    refs.badge.textContent = STATE_TEXT[t.state];
    refs.badge.className = 'state-badge';
    refs.card.className = 'status-card';
    if (t.state === 'working' || t.state === 'paused') refs.badge.classList.add('working');
    if (t.state === 'reminder30' || t.state === 'extended') {
      refs.badge.classList.add('reminding');
      refs.card.classList.add('is-reminder');
    }
    if (t.state === 'forcedRest' || t.state === 'manualRest') {
      refs.badge.classList.add('resting');
      refs.card.classList.add('is-rest');
    }

    if (t.state === 'forcedRest' || t.state === 'manualRest') {
      refs.clock.textContent = fmtClock(t.remainingRestSeconds);
      refs.caption.textContent = t.state === 'forcedRest' ? '强制休息剩余' : '休息剩余';
    } else if (t.state === 'idle') {
      refs.clock.textContent = fmtClock(0);
      refs.caption.textContent = '连续工作时长';
    } else {
      refs.clock.textContent = fmtClock(t.elapsedWorkSeconds);
      refs.caption.textContent = '连续工作时长';
    }

    // 进度行
    const inWork = t.state !== 'idle' && t.state !== 'forcedRest' && t.state !== 'manualRest';
    refs.progressRows.style.display = inWork ? '' : 'none';
    if (inWork) {
      const reminderTotal = s.reminderMinutes * 60;
      const forcedTotal = s.forcedRestAfterMinutes * 60;
      if (t.remainingToReminderSeconds === null) {
        refs.rowReminder.style.display = 'none';
      } else {
        refs.rowReminder.style.display = '';
        refs.valReminder.textContent = fmtClock(t.remainingToReminderSeconds);
        refs.valReminder.className = 'value';
        refs.barReminder.style.width = `${pct(t.elapsedWorkSeconds, reminderTotal)}%`;
      }
      if (t.remainingToForcedRestSeconds === null) {
        refs.rowForced.style.display = 'none';
      } else {
        refs.rowForced.style.display = '';
        refs.valForced.textContent = fmtClock(t.remainingToForcedRestSeconds);
        refs.valForced.className = 'value';
        refs.barForced.style.width = `${pct(t.elapsedWorkSeconds, forcedTotal)}%`;
      }
    }

    // 提醒卡 / 延后提示
    refs.reminderCard.hidden = t.state !== 'reminder30';
    if (t.state === 'reminder30') {
      refs.reminderCopy.textContent = `已连续工作 ${Math.floor(t.elapsedWorkSeconds / 60)} 分钟。现在休息 2 到 5 分钟，让眼睛离开屏幕。`;
    }
    refs.extendedNote.hidden = t.state !== 'extended';
    if (t.state === 'extended') {
      refs.extendedNote.textContent = `提醒已延后，工作满 ${s.forcedRestAfterMinutes} 分钟将进入 ${s.forcedRestDurationMinutes} 分钟强制休息。`;
    }

    // 主操作区
    switch (t.state) {
      case 'idle':
        refs.btnStart.textContent = '开始计时';
        refs.btnStart.disabled = false;
        refs.btnPause.disabled = true;
        refs.btnRest.disabled = true;
        refs.btnReset.disabled = true;
        break;
      case 'working':
      case 'reminder30':
      case 'extended':
        refs.btnStart.textContent = '计时中';
        refs.btnStart.disabled = true;
        refs.btnPause.disabled = false;
        refs.btnPause.textContent = '暂停';
        refs.btnRest.disabled = false;
        refs.btnReset.disabled = false;
        break;
      case 'paused':
        refs.btnStart.textContent = '恢复计时';
        refs.btnStart.disabled = false;
        refs.btnPause.disabled = true;
        refs.btnRest.disabled = false;
        refs.btnReset.disabled = false;
        break;
      case 'forcedRest':
      case 'manualRest':
        refs.btnStart.textContent = '休息中…';
        refs.btnStart.disabled = true;
        refs.btnPause.disabled = true;
        refs.btnRest.disabled = true;
        refs.btnReset.disabled = true;
        break;
    }

    // 统计
    refs.stats.hidden = !s.showDailyStats;
    if (s.showDailyStats) {
      refs.statWork.textContent = fmtHuman(t.todayStats.totalWorkSeconds);
      refs.statRest.textContent = String(t.todayStats.completedRestCount);
      refs.statLongest.textContent = fmtHuman(t.todayStats.longestWorkSessionSeconds);
    }
  }
}

function pct(elapsed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / total) * 100));
}
