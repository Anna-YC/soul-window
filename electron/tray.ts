// 系统托盘：四色状态点 + 菜单（PRD §6.7）
import { Menu, Tray, app, nativeImage } from 'electron';
import { join } from 'node:path';
import type { TimerStateName } from '../src/features/timer/types';

export interface TrayActions {
  onToggleWork: () => void; // 开始 / 暂停 / 恢复（按当前状态）
  onStartRest: () => void;
  onShowMain: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export class TrayController {
  private tray: Tray | null = null;
  private state: TimerStateName = 'idle';

  constructor(private readonly actions: TrayActions) {}

  init(): void {
    this.tray = new Tray(this.icon('idle'));
    this.tray.setTitle('');
    this.refresh();
  }

  /** 状态变化时刷新图标 / 提示 / 菜单 */
  update(state: TimerStateName, elapsedMinutes: number): void {
    this.state = state;
    if (!this.tray) return;
    this.tray.setImage(this.icon(state));
    this.tray.setToolTip(this.tooltip(state, elapsedMinutes));
    this.refresh();
  }

  private refresh(): void {
    if (!this.tray) return;
    const workLabel =
      this.state === 'idle'
        ? '开始计时'
        : this.state === 'paused'
          ? '恢复计时'
          : this.state === 'forcedRest' || this.state === 'manualRest'
            ? '休息中…'
            : '暂停计时';
    const menu = Menu.buildFromTemplate([
      { label: workLabel, enabled: this.state !== 'forcedRest' && this.state !== 'manualRest', click: this.actions.onToggleWork },
      { label: '立即休息', enabled: this.state !== 'forcedRest' && this.state !== 'manualRest' && this.state !== 'idle', click: this.actions.onStartRest },
      { type: 'separator' },
      { label: '查看主界面', click: this.actions.onShowMain },
      { label: '打开设置', click: this.actions.onOpenSettings },
      { type: 'separator' },
      { label: '退出心灵之窗', click: this.actions.onQuit },
    ]);
    this.tray.setContextMenu(menu);
  }

  private icon(state: TimerStateName): Electron.NativeImage {
    const file =
      state === 'idle' || state === 'paused'
        ? 'tray-idle.png'
        : state === 'forcedRest' || state === 'manualRest'
          ? 'tray-rest.png'
          : state === 'reminder30' || state === 'extended'
            ? 'tray-reminder.png'
            : 'tray-working.png';
    // 44×44 生成图，缩到 22 显示（高分屏依然锐利）
    // 开发时 process.resourcesPath 指向 Electron 自带目录，必须用项目根目录；
    // 打包后 extraResources 位于应用 Resources/assets。
    const base = app.isPackaged ? process.resourcesPath : app.getAppPath();
    const img = nativeImage.createFromPath(join(base, 'assets', 'icons', file));
    return img.isEmpty() ? img : img.resize({ width: 22, height: 22 });
  }

  private tooltip(state: TimerStateName, elapsedMinutes: number): string {
    switch (state) {
      case 'idle':
        return '心灵之窗 · 未计时';
      case 'working':
        return `心灵之窗 · 已连续工作 ${elapsedMinutes} 分钟`;
      case 'reminder30':
        return `心灵之窗 · 已工作 ${elapsedMinutes} 分钟，该休息了`;
      case 'extended':
        return `心灵之窗 · 已工作 ${elapsedMinutes} 分钟（提醒已延后）`;
      case 'forcedRest':
        return '心灵之窗 · 强制休息中';
      case 'manualRest':
        return '心灵之窗 · 休息中';
      case 'paused':
        return '心灵之窗 · 已暂停';
    }
  }
}
