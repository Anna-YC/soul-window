#!/usr/bin/env node
// 日志体检：解析 userData/logs/app-YYYY-MM-DD.log，校验时序合法性并给出结论。
// 用法：node scripts/check-log.mjs [日期，默认今天]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const dir = join(homedir(), 'Library/Application Support/心灵之窗护眼助手/logs');
let content;
try {
  content = readFileSync(join(dir, `app-${date}.log`), 'utf8');
} catch {
  console.log(`未找到 ${date} 的日志。现有日志：`);
  try {
    console.log(readdirSync(dir).join('\n'));
  } catch {
    console.log('（logs 目录不存在）');
  }
  process.exit(1);
}

// ---- 解析 ----
const lines = content.split('\n').filter(Boolean);
const events = [];
const parseFail = [];
for (const [i, line] of lines.entries()) {
  const m = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \| (\w+)\s*\| ([^|]+?)(?: \| (.*))?$/.exec(line);
  if (!m) {
    parseFail.push({ line: i + 1, text: line.slice(0, 80) });
    continue;
  }
  let detail = {};
  if (m[4]) {
    try {
      detail = JSON.parse(m[4]);
    } catch {
      detail = { raw: m[4] };
    }
  }
  events.push({ time: m[1], level: m[2], event: m[3].trim(), detail, lineNo: i + 1 });
}

console.log(`===== ${date} 日志体检 =====`);
console.log(`总行数 ${lines.length}，解析成功 ${events.length}${parseFail.length ? `，解析失败 ${parseFail.length}` : ''}`);
if (parseFail.length) console.log('解析失败行：', parseFail);

// ---- 1. 错误/警告 ----
const errors = events.filter((e) => e.level === 'ERROR');
const warns = events.filter((e) => e.level === 'WARN');
console.log(`\n[错误] ${errors.length} 条` + (errors.length ? '' : ' ✓'));
for (const e of errors) console.log(`  ${e.time} ${e.event} ${JSON.stringify(e.detail).slice(0, 120)}`);
console.log(`[警告] ${warns.length} 条` + (warns.length ? '' : ' ✓'));
for (const e of warns.slice(0, 10)) console.log(`  ${e.time} ${e.event} ${JSON.stringify(e.detail).slice(0, 120)}`);

// ---- 2. 状态转移合法性 ----
const LEGAL = {
  idle: ['working'],
  working: ['reminder30', 'forcedRest', 'paused', 'manualRest', 'idle'],
  reminder30: ['manualRest', 'extended', 'working', 'paused', 'forcedRest', 'idle'],
  extended: ['reminder30', 'forcedRest', 'paused', 'manualRest', 'idle'],
  forcedRest: ['working'],
  manualRest: ['working'],
  paused: ['working', 'manualRest', 'idle'],
};
const transitions = events.filter((e) => e.event === 'timer:state-change');
const badTransitions = [];
let lastState = 'idle';
for (const t of transitions) {
  const { from, to } = t.detail;
  if (from !== lastState) badTransitions.push({ time: t.time, issue: `from(${from}) 与上一状态(${lastState}) 不连续`, line: t.lineNo });
  if (!LEGAL[from]?.includes(to)) badTransitions.push({ time: t.time, issue: `非法转移 ${from}→${to}`, line: t.lineNo });
  lastState = to;
}
console.log(`\n[状态转移] ${transitions.length} 次${badTransitions.length ? '，异常：' : '，全部合法 ✓'}`);
for (const b of badTransitions) console.log(`  ${b.time} 第${b.line}行 ${b.issue}`);

// ---- 3. 休息配对（rest-start 必须有 complete/end-early 收尾） ----
const restStarts = events.filter((e) => e.event === 'timer:rest-start');
const restEnds = events.filter((e) => e.event === 'timer:rest-complete' || e.event === 'timer:rest-end-early');
let unclosed = 0;
let openIdx = null;
for (const e of events) {
  if (e.event === 'timer:rest-start') {
    if (openIdx !== null) unclosed += 1; // 上一个没关就开新的是异常（理论上状态机不允许）
    openIdx = e.time;
  } else if (e.event === 'timer:rest-complete' || e.event === 'timer:rest-end-early') {
    openIdx = null;
  }
}
if (openIdx !== null && !events.some((e) => e.time > openIdx && (e.event === 'timer:rest-complete' || e.event === 'timer:rest-end-early'))) {
  unclosed += 1; // 日志结尾仍挂着未闭合的休息
}
console.log(`\n[休息配对] 开始 ${restStarts.length} 次 / 结束 ${restEnds.length} 次${unclosed === 0 ? '，配对完整 ✓' : `，未闭合 ${unclosed} 次 ⚠`}`);

// ---- 4. 被拒绝的用户操作（点了没反应） ----
const rejected = events.filter((e) => e.event === 'user-action' && e.detail.accepted === false);
console.log(`\n[被拒绝的操作] ${rejected.length} 条${rejected.length ? '（点了个不该点的按钮，正常但列出备查）' : ' ✓'}`);
for (const e of rejected) console.log(`  ${e.time} ${e.detail.source} ${e.detail.action} (state=${e.detail.state})`);

// ---- 5. 心跳断档（>6 分钟无 heartbeat 且无 suspend 解释 → 进程可能没跑） ----
const heartbeats = events.filter((e) => e.event === 'heartbeat');
const gaps = [];
for (let i = 1; i < heartbeats.length; i++) {
  const dt = new Date(heartbeats[i].time).getTime() - new Date(heartbeats[i - 1].time).getTime();
  if (dt > 6.5 * 60_000) gaps.push({ from: heartbeats[i - 1].time, to: heartbeats[i].time, minutes: Math.round(dt / 60000) });
}
if (heartbeats.length >= 2) {
  console.log(`\n[心跳] ${heartbeats.length} 条`);
  if (gaps.length) {
    for (const g of gaps) {
      const explained = events.some((e) => e.event === 'power-suspend' && e.time >= g.from && e.time <= g.to);
      console.log(`  断档 ${g.from} → ${g.to}（${g.minutes} 分钟）${explained ? '（期间有睡眠记录，正常）' : '（无睡眠记录解释 ⚠）'}`);
    }
  } else {
    console.log('  间隔正常 ✓');
  }
}

// ---- 6. 时间线摘要 ----
console.log(`\n[时间线摘要]`);
const interesting = events.filter((e) =>
  ['app-start', 'app-quit', 'already-running-quit', 'timer:reminder', 'timer:rest-start', 'timer:rest-complete', 'timer:rest-end-early', 'power-suspend', 'power-resume', 'main-window-hidden', 'rest-window-shown', 'settings-changed'].includes(e.event),
);
for (const e of interesting.slice(0, 60)) {
  const d = e.event === 'timer:state-change' ? '' : Object.keys(e.detail).length ? ` ${JSON.stringify(e.detail).slice(0, 90)}` : '';
  console.log(`  ${e.time} ${e.event}${d}`);
}
if (interesting.length > 60) console.log(`  …另有 ${interesting.length - 60} 条`);

const problems = errors.length + badTransitions.length + unclosed + (gaps.some((g) => !events.some((e) => e.event === 'power-suspend' && e.time >= g.from && e.time <= g.to)) ? 1 : 0);
console.log(`\n===== 结论：${problems === 0 ? '日志时序正常 ✓' : `发现 ${problems} 类问题，见上 ⚠`} =====`);
process.exit(problems === 0 ? 0 : 1);
