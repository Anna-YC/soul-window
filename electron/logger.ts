// 全量事件日志：应用自身的每次状态流转、用户操作、窗口生命周期全部落盘。
// 隐私边界：只记应用内部事件与按钮名，不记任何输入内容/屏幕内容/其他软件信息（PRD §9）。
// 落盘位置 userData/logs/app-YYYY-MM-DD.log，每日一文件，自动清理 14 天前。
import { app } from 'electron';
import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const KEEP_DAYS = 14;
let logDir: string | null = null;
let currentDate = '';

export type LogLevel = 'info' | 'warn' | 'error';

export function logEvent(level: LogLevel, event: string, detail?: unknown): void {
  const now = new Date();
  const line = `${ts(now)} | ${level.toUpperCase().padEnd(5)} | ${event}${detail === undefined ? '' : ` | ${safeJson(detail)}`}\n`;
  // 同步回显到 stdout（.command 的 nohup 兜底 /tmp/心灵之窗.log）
  const fn = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
  fn(`[log] ${line.trim()}`);
  void writeToFile(now, line).catch(() => {
    /* 日志写不动时不再打日志，避免递归 */
  });
}

async function writeToFile(now: Date, line: string): Promise<void> {
  const dir = await ensureDir();
  const date = dateStr(now);
  if (date !== currentDate) {
    currentDate = date;
    void pruneOldLogs(dir, date).catch(() => undefined);
  }
  await appendFile(join(dir, `app-${date}.log`), line, 'utf8');
}

async function ensureDir(): Promise<string> {
  if (!logDir) {
    logDir = join(app.getPath('userData'), 'logs');
    await mkdir(logDir, { recursive: true });
  }
  return logDir;
}

async function pruneOldLogs(dir: string, today: string): Promise<void> {
  const files = await readdir(dir);
  const cutoff = new Date(today + 'T00:00:00').getTime() - KEEP_DAYS * 86_400_000;
  for (const f of files) {
    const m = /^app-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
    if (!m) continue;
    if (new Date(m[1] + 'T00:00:00').getTime() < cutoff) {
      await rm(join(dir, f)).catch(() => undefined);
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
