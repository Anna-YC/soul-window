// 设置持久化：原子写入与失败传播（P2 回归）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const testDir = vi.hoisted(() => `/tmp/eyecare-store-test-${process.pid}`);
vi.mock('electron', () => ({ app: { getPath: () => testDir } }));

import { loadSettings, saveSettings } from '../electron/store';

const settingsFile = join(testDir, 'settings.json');
const tempFile = `${settingsFile}.tmp`;

describe('设置原子持久化', () => {
  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    rmSync(settingsFile, { force: true });
    rmSync(tempFile, { recursive: true, force: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('成功写入后无临时文件，重新读取得到新值', () => {
    saveSettings({ ...DEFAULT_SETTINGS, reminderMinutes: 35 });
    expect(loadSettings().reminderMinutes).toBe(35);
    expect(existsSync(tempFile)).toBe(false);
  });

  it('写入失败会抛错，且原设置文件保持完整', () => {
    saveSettings({ ...DEFAULT_SETTINGS, reminderMinutes: 35 });
    const original = readFileSync(settingsFile, 'utf8');

    // 让临时路径变成目录，writeFileSync 必然失败
    mkdirSync(tempFile);
    expect(() => saveSettings({ ...DEFAULT_SETTINGS, reminderMinutes: 99 })).toThrow();

    expect(readFileSync(settingsFile, 'utf8')).toBe(original);
    expect(loadSettings().reminderMinutes).toBe(35);
  });
});
