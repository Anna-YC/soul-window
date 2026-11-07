// 桌面小时钟视图（挂载在主 bundle 的 #widget-hash 窗口里，与主窗共享渲染进程省内存）
import '../../styles/widget.css';
import { fmtClock } from '../../app/format';
import type { AppSnapshot } from '../../shared/settings';

export function mountWidget(root: HTMLElement): void {
  root.innerHTML = `
    <div id="widget-card">
      <div class="status">
        <div class="status-line"><span class="dot" id="w-dot"></span><span class="state-text" id="w-state">未计时</span></div>
        <div class="clock" id="w-clock">--:--</div>
      </div>
      <button class="open-btn" id="w-open">打开主窗</button>
    </div>
  `;
  document.body.classList.add('widget-body');

  const dot = document.getElementById('w-dot') as HTMLElement;
  const stateText = document.getElementById('w-state') as HTMLElement;
  const clock = document.getElementById('w-clock') as HTMLElement;

  document.getElementById('w-open')?.addEventListener('click', () => window.eye.showMain());

  function render(snap: AppSnapshot): void {
    const t = snap.timer;
    let cls = 'dot';
    let label = '未计时';
    let time = '--:--';

    switch (t.state) {
      case 'idle':
        break;
      case 'working':
      case 'paused':
        if (t.state === 'working') cls += ' working';
        label = t.state === 'working' ? '工作中' : '已暂停';
        time = t.remainingToForcedRestSeconds !== null ? fmtClock(t.remainingToForcedRestSeconds) : fmtClock(t.elapsedWorkSeconds);
        if (t.remainingToForcedRestSeconds !== null) label += ' · 距强制休息';
        break;
      case 'reminder30':
      case 'extended':
        cls += ' reminding';
        label = t.state === 'reminder30' ? '该休息了' : '提醒已延后';
        time = fmtClock(t.elapsedWorkSeconds); // 禁用强制休息时也显示连续工作时长，不留 --:--
        if (t.remainingToForcedRestSeconds !== null) {
          label += ' · 距强制休息';
          time = fmtClock(t.remainingToForcedRestSeconds);
        }
        break;
      case 'forcedRest':
      case 'manualRest':
        cls += ' resting';
        label = '休息中';
        time = fmtClock(t.remainingRestSeconds);
        break;
    }

    dot.className = cls;
    stateText.textContent = label;
    clock.textContent = time;
    document.title = `${label} ${time} · 心灵之窗`;
  }

  window.eye.onSnapshot((snap: AppSnapshot) => render(snap));
}
