// 副屏休息镜像：无交互的简洁休息界面（主屏才显示完整训练舞台）
import { fmtClock } from '../../app/format';
import type { AppSnapshot } from '../../shared/settings';

export function mountRestMirror(root: HTMLElement): void {
  document.body.classList.add('mirror-body');
  root.innerHTML = `
    <div class="mirror-wrap fade-in">
      <div class="mirror-kind" id="m-kind">休息</div>
      <div class="mirror-countdown" id="m-countdown">--:--</div>
      <div class="mirror-tip">这块屏幕也在休息 · 可以闭上眼睛，或看向窗外</div>
      <p class="disclaimer">休息提醒不是医疗治疗，按自己的感受来就好。</p>
    </div>
  `;

  const kind = document.getElementById('m-kind') as HTMLElement;
  const countdown = document.getElementById('m-countdown') as HTMLElement;

  window.eye.onSnapshot((snap: AppSnapshot) => {
    const t = snap.timer;
    kind.textContent = t.state === 'forcedRest' ? '强制休息' : '休息';
    countdown.textContent = fmtClock(t.remainingRestSeconds);
    document.title = `${kind.textContent} ${countdown.textContent} · 心灵之窗`;
  });
}
