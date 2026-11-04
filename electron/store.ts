// 本地 JSON 持久化（userData 目录）：设置 + 每日统计。
// 纯文件读写，无数据库（避开交接文档中 WorkBuddy 的 SQLite 限制，虽然本 Agent 不受影响，但保持轻量）
import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, sanitizeSettings, type DailyStats, type UserSettings } from '../src/shared/settings';

function userDataFile(name: string): string {
  return join(app.getPath('userData'), name);
}

function readJson<T>(file: string): T | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn('[store] 读取失败，使用默认值:', file, err);
    return null;
  }
}

function writeJson(file: string, data: unknown): void {
  try {
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[store] 写入失败:', file, err);
  }
}

export function loadSettings(): UserSettings {
  const raw = readJson<Partial<UserSettings>>(userDataFile('settings.json'));
  return raw ? sanitizeSettings(raw) : { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: UserSettings): void {
  writeJson(userDataFile('settings.json'), settings);
}

/** 昨日统计可能已跨天：交给状态机在首个 advance() 时 rollover */
export function loadStats(): DailyStats | null {
  return readJson<DailyStats>(userDataFile('stats.json'));
}

export function saveStats(stats: DailyStats): void {
  writeJson(userDataFile('stats.json'), stats);
}

/** 桌面小时钟上次位置（用户拖动后记忆） */
export function loadWidgetPosition(): { x: number; y: number } | null {
  return readJson<{ x: number; y: number }>(userDataFile('widget.json'));
}

export function saveWidgetPosition(pos: { x: number; y: number }): void {
  writeJson(userDataFile('widget.json'), pos);
}
