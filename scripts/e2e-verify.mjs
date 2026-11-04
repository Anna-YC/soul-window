// 心灵之窗端到端验证（CDP 驱动真实点击）
// 前置：应用以 EYECARE_DEV_TIMES="20,30,8" --remote-debugging-port=9333 运行
// 流程：开始→20s提醒→继续工作→30s强制休息(全屏+严格)→8s后自动回工作→统计+1
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CDP_HTTP = 'http://127.0.0.1:9333';
const SHOTS_DIR = fileURLToPath(new URL('../shots/', import.meta.url));
mkdirSync(SHOTS_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 轮询等待条件成立（防渲染时序 flaky） */
async function waitFor(predicate, timeoutMs = 4000, intervalMs = 400) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return true;
    await sleep(intervalMs);
  }
  return await predicate();
}
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function listPages() {
  const res = await fetch(`${CDP_HTTP}/json/list`);
  return res.json();
}

class CdpPage {
  constructor(wsUrl, name) {
    this.wsUrl = wsUrl;
    this.name = name;
    this.seq = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    return this;
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
    });
    if (r.exceptionDetails) throw new Error(`eval 异常: ${r.exceptionDetails.text} ${JSON.stringify(r.exceptionDetails.exception?.description ?? '')}`);
    return r.result.value;
  }
  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOTS_DIR + file, Buffer.from(r.data, 'base64'));
    console.log(`📷 ${file}`);
  }
}

async function findPage(predicate, timeoutMs = 30000, label = 'page') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pages = (await listPages()).filter((t) => t.type === 'page');
    const hit = pages.find(predicate);
    if (hit) return hit;
    await sleep(500);
  }
  throw new Error(`等不到 ${label}`);
}

// CDP 表达式必须是字符串（传函数会被序列化成箭头函数文本而非求值）
const state = "document.querySelector('#state-badge')?.textContent?.trim()";
const clock = "document.querySelector('#big-clock')?.textContent?.trim()";
const reminderVisible = "!document.getElementById('reminder-card')?.hidden";

async function main() {
  // ---- 0. 主进程 inspector（读窗口真实状态与显示器数） ----
  const nodeInspector = await (async () => {
    const targets = await (await fetch('http://127.0.0.1:9229/json')).json();
    const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let seq = 0;
    await new Promise((res) => {
      const id = ++seq;
      const on = (ev) => { const m = JSON.parse(ev.data); if (m.id === id) { ws.removeEventListener('message', on); res(); } };
      ws.addEventListener('message', on);
      ws.send(JSON.stringify({ id, method: 'Runtime.enable' }));
    });
    return {
      eval(expression) {
        return new Promise((res, rej) => {
          const id = ++seq;
          const on = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id === id) {
              ws.removeEventListener('message', on);
              if (m.error) rej(new Error(m.error.message));
              else if (m.result.exceptionDetails) rej(new Error(m.result.exceptionDetails.exception?.description ?? '主进程表达式异常'));
              else res(m.result.result.value);
            }
          };
          ws.addEventListener('message', on);
          ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
        });
      },
    };
  })();
  const displayCount = await nodeInspector.eval(
    `process.mainModule.require('electron').screen.getAllDisplays().length`,
  );
  console.log(`显示器数量：${displayCount}`);
  const restWinCountExpr = `process.mainModule.require('electron').BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('rest.html')).length`;

  // ---- 1. 主窗口初始状态 ----
  const mainTarget = await findPage((t) => t.url.includes('index.html') && !t.url.includes('#widget'), 15000, '主窗口');
  const main = await new CdpPage(mainTarget.webSocketDebuggerUrl, 'main').connect();
  await sleep(800); // 等 onSnapshot 首帧
  check('主窗口标题', (await main.eval('document.title')) === '心灵之窗护眼助手');
  check('初始状态=未开始', (await main.eval(state)) === '未开始');

  // ---- 2. 点击开始计时 ----
  await main.eval('document.getElementById("btn-start").click()');
  await sleep(1200);
  check('开始后=工作中', (await main.eval(state)) === '工作中');
  const restCountBaseline = Number(await main.eval('document.getElementById("stat-rest").textContent')) || 0;
  await main.screenshot('01-主窗口-工作中.png');

  // ---- 3. 最小化后计时继续（隐藏主窗口不可行，改为验证关闭=隐藏路径由人工；这里验证时间推进） ----
  await sleep(6000);
  const t1 = await main.eval(clock);
  await sleep(3000);
  const t2 = await main.eval(clock);
  check('计时随真实时间推进', t1 !== t2, `${t1} → ${t2}`);

  // ---- 4. 20s 提醒出现 ----
  await sleep(11000); // 累计约 21s
  check('20s 触发提醒（该休息了）', (await main.eval(state)) === '该休息了');
  check('提醒卡可见', (await main.eval(reminderVisible)) === true);
  check('提醒文案含休息建议', String(await main.eval('document.getElementById("reminder-copy").textContent')).includes('休息'));
  await main.screenshot('02-主窗口-提醒.png');

  // ---- 5. 延后 5 分钟 → extended（snooze 秒数未走完前） ----
  await main.eval('document.querySelector("#reminder-card [data-action=snooze]").click()');
  await sleep(1200);
  check('延后=提醒已延后', (await main.eval(state)) === '提醒已延后');
  check('延后提示可见', String(await main.eval('document.getElementById("extended-note").textContent')).includes('强制休息'));

  // ---- 6. 等 30s 强制休息（dev: forced=30s；从开始约 21+? 已过 ~21s，再等 ~10s） ----
  const restTarget = await findPage((t) => t.url.includes("rest.html") && !t.url.includes("#mirror"), 25000, '休息窗口').catch(() => null);
  if (!restTarget) {
    // 再等几秒
    await sleep(6000);
  }
  const restTarget2 =
    restTarget ?? (await findPage((t) => t.url.includes("rest.html") && !t.url.includes("#mirror"), 15000, '休息窗口'));
  const rest = await new CdpPage(restTarget2.webSocketDebuggerUrl, 'rest').connect();
  await sleep(1000);
  check('强制休息全屏窗口已打开', true, restTarget2.url.slice(-20));
  const restWinCount = await nodeInspector.eval(restWinCountExpr);
  check(`强制休息覆盖所有屏幕（${displayCount} 块）`, restWinCount === displayCount, `休息窗口=${restWinCount}`);
  if (displayCount > 1) {
    const mirrorT = (await listPages()).find((t) => t.url.includes('rest.html#mirror'));
    const mirror = mirrorT && await new CdpPage(mirrorT.webSocketDebuggerUrl, 'mirror').connect();
    const mirrorText = mirror ? await mirror.eval('document.getElementById("m-countdown").textContent') : '';
    check('副屏镜像显示倒计时', /^\d{1,2}:\d{2}$/.test(mirrorText), `镜像=${mirrorText}`);
  }
  const countdown = "document.querySelector('#rest-countdown')?.textContent?.trim()";
  const cd1 = await rest.eval(countdown);
  check('休息倒计时在走', /^0?0?0?:?\d{1,2}$/.test(cd1), `剩余 ${cd1}`);
  check('严格模式提示可见', String(await rest.eval('document.getElementById("strict-note").hidden')) === 'false');
  check('严格模式无结束按钮', String(await rest.eval('document.getElementById("end-rest").hidden')) === 'true');
  check('训练舞台已挂载', String(await rest.eval('document.querySelectorAll("#stage .stage-orb").length')) === '1');
  await rest.screenshot('03-休息窗口-强制.png');

  // ---- 7. 8s 休息结束 → 回到工作，休息窗口关闭 ----
  await sleep(9000);
  const stillThere = (await listPages()).some((t) => t.url.includes('rest.html'));
  check('休息结束休息窗口已关闭', !stillThere);
  await sleep(1200);
  check('回到工作中（新一轮）', (await main.eval(state)) === '工作中');
  const restCount = Number(await main.eval('document.getElementById("stat-rest").textContent'));
  check('完成休息次数+1', restCount === restCountBaseline + 1, `基线=${restCountBaseline} 现在=${restCount}`);
  await main.screenshot('04-主窗口-新一轮.png');

  // ---- 8. 设置读写 ----
  const saved = await main.eval('window.eye.saveSettings({ soundEnabled: false, trainingMode: "blink" })', true);
  check('设置保存生效', saved.soundEnabled === false && saved.trainingMode === 'blink');
  const reread = await main.eval('window.eye.getSettings()', true);
  check('设置回读一致', reread.soundEnabled === false && reread.trainingMode === 'blink');

  // ---- 9. 立即休息（手动）→ 休息窗口出现且可结束 ----
  await main.eval('document.getElementById("btn-rest").click()');
  const rest2T = await findPage((t) => t.url.includes("rest.html") && !t.url.includes("#mirror"), 15000, '手动休息窗口');
  const rest2 = await new CdpPage(rest2T.webSocketDebuggerUrl, 'rest2').connect();
  await sleep(1000);
  check('手动休息窗口=休息', (await rest2.eval('document.querySelector("#rest-kind").textContent.trim()')) === '休息');
  check(
    '手动休息可结束（按钮可见）',
    await waitFor(async () => String(await rest2.eval('document.getElementById("end-rest").hidden')) === 'false', 4000),
  );
  // 手动休息（kind=manual）不显示「跳过本次休息」（那是非严格强制休息的入口）
  check('手动休息不显示跳过按钮', String(await rest2.eval('document.getElementById("skip-rest").hidden')) === 'true');

  // ---- 9b. 呼吸引导 + 背景声 ----
  check('呼吸引导按钮存在', String(await rest2.eval('document.querySelectorAll("#training-pick .pick-btn").length')) === '5');
  await rest2.eval('document.querySelector("#training-pick [data-mode=breathing]").click()');
  check(
    '呼吸引导已启动（第 1 拍=缓缓吸气）',
    await waitFor(async () => String(await rest2.eval('document.querySelector("#stage .stage-label").textContent')).includes('吸气'), 4000),
  );
  check('背景声栏可见', String(await rest2.eval('document.getElementById("ambient-bar").hidden')) === 'false');
  await rest2.eval('document.querySelector("#ambient-bar [data-sound=rain]").click()');
  check(
    '雨声开启（AudioContext 合成）',
    await waitFor(async () => String(await rest2.eval('document.getElementById("ambient-bar").dataset.playing')) === 'rain', 5000),
  );
  await rest2.eval('document.querySelector("#ambient-bar [data-sound=off]").click()');
  check(
    '雨声可关闭',
    await waitFor(async () => String(await rest2.eval('document.getElementById("ambient-bar").dataset.playing')) === 'off', 5000),
  );

  // ---- 9c. 息屏场景回归（2026-11-03 反馈）：人为踢出全屏+缩小，验证 3 秒内自愈 ----
  const mainRestExpr = (code) =>
    `(() => { const w = process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('rest.html') && !w.webContents.getURL().includes('#mirror')); ${code} })()`;
  await nodeInspector.eval(mainRestExpr('w.setBounds({x:60,y:60,width:900,height:600}); return true;'));
  await sleep(4500); // 自愈周期 3s + setBounds 生效
  const healed = await nodeInspector.eval(
    mainRestExpr(
      'const { screen } = process.mainModule.require("electron"); const d = screen.getDisplayMatching(w.getBounds()); const b = w.getBounds(); return { x: b.x, y: b.y, w: b.width, h: b.height, dx: d.bounds.x, dy: d.bounds.y, dw: d.bounds.width, dh: d.bounds.height };',
    ),
  );
  check(
    '全屏丢失自愈（息屏场景回归）',
    typeof healed === 'object' &&
      Math.abs(healed.x - healed.dx) <= 100 && Math.abs(healed.y - healed.dy) <= 100 &&
      Math.abs(healed.w - healed.dw) <= 100 && Math.abs(healed.h - healed.dh) <= 100,
    `修复后=${JSON.stringify(healed)}`,
  );
  // 点击会销毁窗口（响应可能永远不回），不无限等待
  await Promise.race([
    rest2.eval('document.getElementById("end-rest").click()'),
    sleep(1000),
  ]);
  await sleep(1500);
  const rest2Gone = !(await listPages()).some((t) => t.url.includes('rest.html'));
  check('结束休息后窗口关闭', rest2Gone);
  check('结束休息回到工作中', (await main.eval(state)) === '工作中');

  // ---- 10. 暂停/恢复 ----
  await main.eval('document.getElementById("btn-pause").click()');
  await sleep(800);
  const pausedClock = await main.eval(clock);
  check('暂停状态', (await main.eval(state)) === '已暂停');
  await sleep(3000);
  const stillClock = await main.eval(clock);
  check('暂停期间时钟冻结', pausedClock === stillClock, `${pausedClock}`);
  await main.eval('document.getElementById("btn-start").click()'); // 暂停态主按钮=恢复计时（暂停钮已禁用）
  await sleep(800);
  check('恢复计时', (await main.eval(state)) === '工作中' || (await main.eval(state)) === '该休息了');

  // ---- 11. 托盘路径回归（2026-11-03 闪退反馈）：主窗隐藏（驻留托盘）时休息，结束休息后主窗口必须自动回来 ----
  // 通过主进程 Node inspector 真实 hide() 主窗口（等价「关窗驻留」状态）；window.close() 对非脚本窗口是空操作
  const mainWinExpr = (method) =>
    `process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('index.html') && !w.webContents.getURL().includes('#widget')).${method}`;
  const widgetWinExpr = (method) =>
    `(() => { const w = process.mainModule.require('electron').BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('#widget')); return w ? w.${method} : false; })()`;
  await nodeInspector.eval(mainWinExpr('hide()'));
  await sleep(1000);
  const hidden = await nodeInspector.eval(mainWinExpr('isVisible()'));
  check('主窗口隐藏=驻留托盘状态', hidden === false, `isVisible=${hidden}`);

  // ---- 11b. 桌面小时钟：主窗隐藏时按需创建并显示、点击恢复主窗、休息时销毁 ----
  const widgetT = await findPage((t) => t.url.includes('#widget'), 10000, '桌面小时钟页面');
  const widget = await new CdpPage(widgetT.webSocketDebuggerUrl, 'widget').connect();
  await sleep(1500); // 等 ready-to-show → showInactive
  const widgetShown = await nodeInspector.eval(widgetWinExpr('isVisible()'));
  check('主窗隐藏→桌面小时钟显示', widgetShown === true, `widget.isVisible=${widgetShown}`);
  const widgetText = await widget.eval('document.getElementById("w-clock").textContent');
  check('小时钟显示倒计时格式', /^\d{1,2}:\d{2}$/.test(widgetText), `文本=${widgetText}`);
  await widget.eval('document.getElementById("w-open").click()');
  await sleep(900);
  const mainBackViaWidget = await nodeInspector.eval(mainWinExpr('isVisible()'));
  check('点小时钟「打开主窗」→主窗口恢复', mainBackViaWidget === true, `isVisible=${mainBackViaWidget}`);
  const widgetHiddenNow = await nodeInspector.eval(widgetWinExpr('isVisible()'));
  check('主窗恢复→小时钟退场', widgetHiddenNow === false, `widget.isVisible=${widgetHiddenNow}`);
  // 再隐藏主窗，进入休息场景验证小时钟在全屏休息时销毁
  await nodeInspector.eval(mainWinExpr('hide()'));
  await sleep(1500);
  await main.eval('window.eye.dispatch({type:"start-rest"})'); // 模拟托盘「立即休息」
  const rest3T = await findPage((t) => t.url.includes("rest.html") && !t.url.includes("#mirror"), 15000, '隐藏态休息窗口');
  const rest3 = await new CdpPage(rest3T.webSocketDebuggerUrl, 'rest3').connect();
  await sleep(1000);
  check('隐藏态下休息窗口正常打开', true);
  await sleep(1200);
  const widgetDuringRest = await nodeInspector.eval(widgetWinExpr('isVisible()'));
  check('全屏休息时小时钟退场', widgetDuringRest === false, `widget.isVisible=${widgetDuringRest}`);
  await Promise.race([
    rest3.eval('document.getElementById("end-rest").click()'),
    sleep(1000),
  ]);
  await sleep(1500);
  const visibleAgain = await nodeInspector.eval(mainWinExpr('isVisible()'));
  check('结束休息后主窗口自动恢复可见（原「闪退」表象）', visibleAgain === true, `isVisible=${visibleAgain}`);
  const finalBadge = await main.eval(state);
  check('最终回到工作中', finalBadge === '工作中' || finalBadge === '该休息了', finalBadge);

  // ---- 汇总 ----
  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== E2E 结果：${results.length - failed.length}/${results.length} 通过 =====`);
  if (failed.length) {
    console.log('失败项：', failed.map((f) => f.name).join(' | '));
    process.exit(1);
  }
  process.exit(0); // CDP WebSocket 会挂住事件循环，显式退出
}

main().catch((err) => {
  console.error('E2E 脚本异常:', err);
  process.exit(1);
});
