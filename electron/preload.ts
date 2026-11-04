// preload：以最小化、类型明确的 API 暴露给渲染进程（交接文档 §6.2）
import { contextBridge, ipcRenderer } from 'electron';
import type { TimerAction } from '../src/features/timer/types';
import { IPC, type AppSnapshot, type UserSettings } from '../src/shared/settings';

const eyeApi = {
  /** 订阅应用快照（每秒 + 每次状态变化）；返回退订函数 */
  onSnapshot(callback: (snapshot: AppSnapshot) => void): () => void {
    const listener = (_e: Electron.IpcRendererEvent, snapshot: AppSnapshot) => callback(snapshot);
    ipcRenderer.on(IPC.snapshotChannel, listener);
    return () => ipcRenderer.removeListener(IPC.snapshotChannel, listener);
  },
  /** 托盘「打开设置」时通知主界面展开设置面板 */
  onOpenSettings(callback: () => void): () => void {
    const listener = () => callback();
    ipcRenderer.on(IPC.openSettings, listener);
    return () => ipcRenderer.removeListener(IPC.openSettings, listener);
  },
  /** 发送计时动作（唯一改变计时状态的途径） */
  dispatch(action: TimerAction): void {
    ipcRenderer.send(IPC.dispatchChannel, action);
  },
  /** 桌面小时钟：请求显示主窗口 */
  showMain(): void {
    ipcRenderer.send(IPC.showMain);
  },
  getSettings(): Promise<UserSettings> {
    return ipcRenderer.invoke(IPC.getSettings);
  },
  saveSettings(patch: Partial<UserSettings>): Promise<UserSettings> {
    return ipcRenderer.invoke(IPC.saveSettings, patch);
  },
};

contextBridge.exposeInMainWorld('eye', eyeApi);

export type EyeApi = typeof eyeApi;
