// 渲染进程可见的桥接 API 类型（preload 实现；不含任何 electron 导入，保持类型纯净）
import type { TimerAction } from '../features/timer/types';
import type { AppSnapshot, UserSettings } from './settings';

export interface EyeApi {
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void;
  onOpenSettings(callback: () => void): () => void;
  dispatch(action: TimerAction): void;
  showMain(): void;
  getSettings(): Promise<UserSettings>;
  saveSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
}

// preload 通过 contextBridge 挂载的 window.eye
// （注意：TS7 下 .d.ts 中的 declare global 不生效，须写在模块内）
declare global {
  interface Window {
    eye: EyeApi;
  }
}
