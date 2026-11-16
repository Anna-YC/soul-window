// 日志写入顺序回归（P3）
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const testDir = vi.hoisted(() => `/tmp/eyecare-logger-test-${process.pid}`);
vi.mock('electron', () => ({ app: { getPath: () => testDir } }));
import { logEvent } from '../electron/logger';

describe('logEvent 写入顺序', () => {
  beforeEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('文件行顺序与调用顺序一致', () => {
    logEvent('info', 'app-start', { seq: 1 });
    logEvent('info', 'main-window-created', { seq: 2 });
    logEvent('info', 'timer:state-change', { from: 'idle', to: 'working' });

    const dir = join(testDir, 'logs');
    const file = readdirSync(dir).find((f) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    expect(file).toBeTruthy();
    const content = readFileSync(join(dir, file!), 'utf8');
    expect(content.indexOf('app-start')).toBeLessThan(content.indexOf('main-window-created'));
    expect(content.indexOf('main-window-created')).toBeLessThan(content.indexOf('timer:state-change'));
    expect(content.trim().split('\n')).toHaveLength(3);
  });
});
