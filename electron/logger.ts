// 全量事件日志：应用自身的每次状态流转、用户操作、窗口生命周期全部落盘。
// 隐私边界：只记应用内部事件与按钮名，不记任何输入内容/屏幕内容/其他软件信息（PRD §9）。
// 落盘位置 userData/logs/app-YYYY-MM-DD.log，每日一文件，自动清理 14 天前。
// 使用同步小写入保证调用顺序与文件顺序一致，避免排障时启动/窗口日志倒序。
import { app } from 'electron';
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const KEEP_DAYS = 14;
let logDir: string | null = null;
let currentDate = '';

export type LogLevel = 'info' | 'warn' | 'error';

export function logEvent(level: LogLevel, event: string, detail?: unknown): void {
  const now = new Date();
  const line = `${ts(now)} | ${level.toUpperCase().padEnd(5)} | ${event}${detail === undefined ? '' : ` | ${safeJson(detail)}`}\n`;
  const fn = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
  fn(`[log] ${line.trim()}`);
  try {
    writeToFile(now, line);
  } catch {
    /* 日志写不动时不再打日志，避免递归 */
  }
}

function writeToFile(now: Date, line: string): void {
  const dir = ensureDir();
  const date = dateStr(now);
  if (date !== currentDate) {
    currentDate = date;
    pruneOldLogs(dir, date);
  }
  appendFileSync(join(dir, `app-${date}.log`), line, 'utf8');
}

function ensureDir(): string {
  if (!logDir) {
    logDir = join(app.getPath('userData'), 'logs');
    mkdirSync(logDir, { recursive: true });
  }
  return logDir;
}

function pruneOldLogs(dir: string, today: string): void {
  const cutoff = new Date(today + 'T00:00:00').getTime() - KEEP_DAYS * 86_400_000;
  for (const f of readdirSync(dir)) {
    const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
    if (!m) continue;
    if (new Date(m[1] + 'T00:00:00').getTime() < cutoff) {
      try {
        rmSync(join(dir, f));
      } catch {
        /* 清理失败不影响新日志 */
      }
    }
  }
}

function ts(d: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function dateStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function safeJson(detail: unknown): string {
  try {
    return JSON.stringify(detail ?? {});
  } catch {
    return String(detail);
  }
}
