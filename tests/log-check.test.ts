// 日志体检：正常重启不误报（P3 回归）
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = `/tmp/eyecare-log-check-${process.pid}`;
const file = join(dir, 'app-2026-11-07.log');
const script = join(process.cwd(), 'scripts/check-log.mjs');

function line(time: string, event: string, detail: unknown = {}): string {
  return `${time} | INFO  | ${event} | ${JSON.stringify(detail)}`;
}

function runCheck() {
  return spawnSync(process.execPath, [script, '2026-11-07'], {
    env: { ...process.env, EYECARE_LOG_DIR: dir },
    encoding: 'utf8',
  });
}

describe('check-log 正常重启', () => {
  beforeEach(() => mkdirSync(dir, { recursive: true }));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('跨进程状态重置、休息中正常退出、重启心跳间隔均不误报', () => {
    const lines = [
      line('2026-11-07 10:00:00.000', 'app-start'),
      line('2026-11-07 10:00:01.000', 'timer:state-change', { from: 'idle', to: 'working' }),
      line('2026-11-07 10:00:02.000', 'heartbeat', { state: 'working' }),
      line('2026-11-07 10:01:00.000', 'timer:rest-start', { kind: 'forced' }),
      line('2026-11-07 10:01:01.000', 'app-quit'),
      line('2026-11-07 11:00:00.000', 'app-start'),
      line('2026-11-07 11:00:01.000', 'timer:state-change', { from: 'idle', to: 'working' }),
      line('2026-11-07 11:00:02.000', 'timer:rest-start', { kind: 'manual' }),
      line('2026-11-07 11:00:03.000', 'timer:rest-end-early', { kind: 'manual' }),
      line('2026-11-07 11:00:04.000', 'heartbeat', { state: 'working' }),
    ];
    writeFileSync(file, lines.join('\n') + '\n');
    const result = runCheck();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('全部合法');
    expect(result.stdout).toContain('配对完整');
  });

  it('真实的非法状态转移仍然报错', () => {
    writeFileSync(
      file,
      [line('2026-11-07 10:00:00.000', 'app-start'), line('2026-11-07 10:00:01.000', 'timer:state-change', { from: 'idle', to: 'forcedRest' })].join('\n') + '\n',
    );
    const result = runCheck();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('非法转移');
  });
});
