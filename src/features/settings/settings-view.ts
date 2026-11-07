// 设置面板：全部改动即时保存（主进程持久化 + 热应用）
import '../../styles/settings.css';
import type { UserSettings } from '../../shared/settings';

export interface SettingsPanelHooks {
  getSettings(): Promise<UserSettings>;
  saveSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
  onClose(): void;
}

export function mountSettingsPanel(root: HTMLElement, hooks: SettingsPanelHooks): void {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <section class="settings-panel" role="dialog" aria-label="设置">
      <div class="settings-head">
        <h2>设置</h2>
        <button class="ghost-btn" data-close>完成</button>
      </div>

      <div class="settings-section">
        <h3>计时规则</h3>
        <div class="field">
          <label>提醒阈值<span class="hint">连续工作多久后提醒</span></label>
          <input type="number" data-key="reminderMinutes" min="5" max="120" step="5" /> 分钟
        </div>
        <div class="field">
          <label>强制休息阈值<span class="hint">继续工作多久后强制休息</span></label>
          <input type="number" data-key="forcedRestAfterMinutes" min="10" max="180" step="5" /> 分钟
        </div>
        <div class="field">
          <label>强制休息时长</label>
          <input type="number" data-key="forcedRestDurationMinutes" min="1" max="30" step="1" /> 分钟
        </div>
      </div>

      <div class="settings-section">
        <h3>提醒与休息</h3>
        <div class="field">
          <label>定时提醒</label>
          <span class="switch"><input type="checkbox" data-key="reminderEnabled" /><i></i></span>
        </div>
        <div class="field">
          <label>强制休息</label>
          <span class="switch"><input type="checkbox" data-key="forcedRestEnabled" /><i></i></span>
        </div>
        <div class="field">
          <label>提醒声音</label>
          <span class="switch"><input type="checkbox" data-key="soundEnabled" /><i></i></span>
        </div>
        <div class="field">
          <label>严格模式<span class="hint">开启后强制休息不可跳过</span></label>
          <span class="switch"><input type="checkbox" data-key="strictMode" /><i></i></span>
        </div>
      </div>

      <div class="settings-section">
        <h3>休息内容</h3>
        <div class="field">
          <label>自动开始训练<span class="hint">关闭后可在休息页手动选择</span></label>
          <span class="switch"><input type="checkbox" data-key="autoTraining" /><i></i></span>
        </div>
        <div class="field">
          <label>训练模式</label>
          <select data-key="trainingMode">
            <option value="auto">自动轮换</option>
            <option value="far-near">远近切换</option>
            <option value="tracking">缓慢追踪</option>
            <option value="blink">眨眼练习</option>
            <option value="breathing">呼吸引导</option>
          </select>
        </div>
      </div>

      <div class="settings-section">
        <h3>通用</h3>
        <div class="field">
          <label>开机启动</label>
          <span class="switch"><input type="checkbox" data-key="launchAtLogin" /><i></i></span>
        </div>
        <div class="field">
          <label>显示每日统计</label>
          <span class="switch"><input type="checkbox" data-key="showDailyStats" /><i></i></span>
        </div>
        <div class="field">
          <label>后台时显示桌面小时钟<span class="hint">主窗隐藏后半透明倒计时悬浮桌面</span></label>
          <span class="switch"><input type="checkbox" data-key="showDesktopClock" /><i></i></span>
        </div>
      </div>

      <p class="footnote" style="text-align:left">
        所有数据只保存在这台电脑上，不上传任何信息。<br />
        本应用是休息提醒工具，不提供医疗建议。
      </p>
    </section>
  `;

  root.appendChild(overlay);

  let toastTimer: number | undefined;
  let toast: HTMLDivElement | null = null;
  let saveSequence = 0;

  const syncControls = (s: UserSettings) => {
    for (const el of overlay.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]')) {
      const key = el.dataset.key as keyof UserSettings;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(s[key]);
      else el.value = String(s[key]);
    }
  };

  const showToast = (text: string) => {
    if (!overlay.isConnected) return;
    if (!toast || !toast.isConnected) {
      toast = document.createElement('div');
      toast.className = 'save-toast';
      root.appendChild(toast);
    }
    toast.textContent = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast?.remove();
      toast = null;
    }, 1400);
  };

  const save = (patch: Partial<UserSettings>) => {
    const sequence = ++saveSequence;
    void hooks
      .saveSettings(patch)
      .then((saved) => {
        // 旧响应不覆盖用户后续编辑；主进程返回的规范化值才是真实生效值
        if (sequence !== saveSequence) return;
        syncControls(saved);
        showToast('已保存');
      })
      .catch((error: unknown) => {
        if (sequence !== saveSequence) return;
        console.error('[settings] 保存失败', error);
        showToast('保存失败，请重试');
      });
  };

  // 载入当前值
  void hooks.getSettings().then((s) => {
    if (overlay.isConnected) syncControls(s);
  });

  // 即时保存
  overlay.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const key = target.dataset?.key as keyof UserSettings | undefined;
    if (!key) return;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      save({ [key]: target.checked } as Partial<UserSettings>);
    } else if (target instanceof HTMLInputElement && target.type === 'number') {
      // 清空、0 或其他非法值不提交，保留上次有效设置；绝不让 NaN 进入状态机
      const value = target.valueAsNumber;
      if (!Number.isFinite(value)) return;
      save({ [key]: value } as Partial<UserSettings>);
    } else if (target instanceof HTMLSelectElement) {
      save({ [key]: target.value } as Partial<UserSettings>);
    }
  });

  overlay.querySelector('[data-close]')?.addEventListener('click', () => {
    overlay.remove();
    hooks.onClose();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      hooks.onClose();
    }
  });
}
