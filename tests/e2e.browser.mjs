/* 浏览器端到端测试（零依赖）：
 * 通过 Chrome DevTools Protocol（Node 内置 fetch + WebSocket）真实点击、输入、提交，
 * 验证「筛选 → 详情 → 收藏冲突 → 日历下钻 → 发布/删除」整条链路，并收集控制台报错。
 *
 * 用法：
 *   1) 起服务：node serve.mjs 8017
 *   2) 起浏览器：chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<临时目录> about:blank
 *   3) 跑测试：node tests/e2e.browser.mjs 9222 http://127.0.0.1:8017
 */
'use strict';

const CDP_PORT = Number(process.argv[2] || 9222);
const BASE = String(process.argv[3] || 'http://127.0.0.1:8017').replace(/\/$/, '');

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 极简 CDP 客户端 ---------- */
const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('未捕获异常: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || ''));
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res) => pending.set(id, res));
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression: `(function(){${expression}})()`, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
async function waitFor(expression, label, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(`return !!(${expression});`)) return true;
    await sleep(60);
  }
  throw new Error('等待超时：' + label);
}
/* 视图是显示偏好，不属于筛选条件：做与卡片相关的断言前先把视图切回卡片流 */
async function useCardsView() {
  await evalJs(`
    const b = document.querySelector('[data-action="set-view"][data-value="cards"]');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    return true;`);
  await sleep(200);
}
const cardIds = () => evalJs(`return [...document.querySelectorAll('.card')].map(c => c.getAttribute('data-id'));`);
/* 时间基准改成系统时间后，「今天有几场」取决于跑测试的日期；
   系统日期不是 9/19 时这些断言改为跳过（并在总结里计数），而不是误报失败 */
let skips = 0;
function softOk(name, cond, note, when) {
  if (when === undefined) when = EXAM_DAY;
  if (!when) { skips++; console.log('  – 跳过（当前日期不满足前提）：' + name); return; }
  ok(name, cond, note);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable').catch(() => {});

/* ---------- 打开页面（清空本机数据，保证可重复运行） ---------- */
await send('Page.navigate', { url: BASE + '/' });
await sleep(400);
await evalJs(`localStorage.clear(); return true;`);
await send('Page.navigate', { url: BASE + '/' });
await waitFor(`document.querySelectorAll('.card').length === 26`, '首页渲染 26 张卡片');
const EXAM_DAY = (await evalJs(`const d = new Date(); return (d.getMonth() + 1) + '-' + d.getDate();`)) === '9-19';

console.log(`浏览器端到端测试 @ ${BASE}（CDP ${CDP_PORT}）\n`);
console.log('【首屏与列表】');

ok('首页渲染 26 条（发布内容条目数一致）', (await evalJs(`return document.querySelectorAll('.card').length;`)) === 26);
ok('顶部计数显示「找到 26 / 26 条」', /找到 26 \/ 26 条/.test(await evalJs(`return document.getElementById('resultCount').textContent;`)));
softOk('首屏给出今天 3 场 + 时间重叠提醒', await evalJs(`
  return document.querySelectorAll('#today .todaycard').length === 3 &&
         document.getElementById('alerts').textContent.indexOf('今晚时间重叠') >= 0;`));
ok('时间基准 = 电脑系统时间（显示当前年份与实时时刻）', await evalJs(`
  const t = document.getElementById('clockLabel').textContent;
  return t.indexOf(String(new Date().getFullYear()) + '年') >= 0 &&
         t.indexOf('电脑系统时间') >= 0 && /[0-9]{2}:[0-9]{2}/.test(t);`));
ok('已移除「使用引导」按钮与引导浮层', await evalJs(`
  return !document.querySelector('[data-action="open-panel"][data-value="help"]') &&
         !document.getElementById('onboard') &&
         document.body.textContent.indexOf('使用引导') < 0;`));
ok('已移除「回到考核日」，改为「回到现在」', await evalJs(`
  const b = document.getElementById('clockReset');
  return !!b && b.textContent.indexOf('回到现在') >= 0 && document.body.textContent.indexOf('回到考核日') < 0;`));
ok('全页文案不再出现「原文」二字（统一为发布者 / 发布内容）', await evalJs(`
  return document.body.textContent.indexOf('原文') < 0;`));
ok('来源分层可见：学院发布 2 / 学生个人 4 / 未注明 17', await evalJs(`
  const txt = document.getElementById('sourceRow').textContent;
  return txt.indexOf('学院发布2') >= 0 && txt.indexOf('学生个人发布4') >= 0 && txt.indexOf('来源未注明17') >= 0;`));

console.log('\n【搜索与筛选】');

await evalJs(`
  const q = document.getElementById('q');
  q.value = '志愿'; q.dispatchEvent(new Event('input', {bubbles:true})); return true;`);
await sleep(300);
ok('搜索「志愿」只剩 2 条（05 志愿服务活动、16 摄影志愿者）', await evalJs(`
  const ids = [...document.querySelectorAll('.card')].map(c => c.getAttribute('data-id'));
  return ids.length === 2 && ids.join(',') === '05,16';`));
ok('搜索状态写进了 URL hash（可分享/刷新保持）', (await evalJs(`return location.hash;`)).indexOf('q=%E5%BF%97%E6%84%BF') >= 0);

await evalJs(`document.querySelector('[data-action="clear-all"]').click(); return true;`);
await sleep(200);
await useCardsView();
await evalJs(`document.querySelector('[data-action="toggle-quick"][data-value="适合新生"]').click(); return true;`);
await sleep(250);
ok('快捷筛选「适合新生」得到 18 条（界面标签必须真正生效）', await evalJs(`
  return document.querySelectorAll('.card').length === 18;`),
  '实际 ' + (await evalJs(`return document.querySelectorAll('.card').length;`)) + ' 条');

await evalJs(`document.querySelector('[data-action="clear-all"]').click(); return true;`);
await sleep(200);
await evalJs(`document.querySelector('[data-action="toggle-category"][data-value="竞赛挑战"]').click(); return true;`);
await sleep(250);
ok('类别筛选「竞赛挑战」得到 07/12/15 三条', (await cardIds()).sort().join(',') === '07,12,15');
await evalJs(`document.querySelector('[data-action="clear-all"]').click(); return true;`);

console.log('\n【空态与提示】');

await evalJs(`
  const q = document.getElementById('q');
  q.value = '这个关键词不存在'; q.dispatchEvent(new Event('input', {bubbles:true})); return true;`);
await sleep(300);
ok('无结果时给出可操作的空态（含清空筛选按钮）', await evalJs(`
  const e = document.querySelector('.empty');
  return !!e && e.textContent.indexOf('没有符合条件的内容') >= 0 && !!e.querySelector('[data-action="clear-all"]');`));
await evalJs(`document.querySelector('.empty [data-action="clear-all"]').click(); return true;`);
await sleep(200);

console.log('\n【详情抽屉】');

await evalJs(`document.querySelector('.card[data-id="24"]').click(); return true;`);
await waitFor(`!document.getElementById('drawer').classList.contains('hidden')`, '详情抽屉打开');
ok('风险条目 24 详情显示「需谨慎」与风险理由', await evalJs(`
  const t = document.getElementById('drawer').textContent;
  return t.indexOf('需谨慎') >= 0 && t.indexOf('私人微信') >= 0;`));
ok('详情里能看到逐字发布内容', await evalJs(`
  const t = document.getElementById('drawer').textContent;
  return t.indexOf('零门槛、日结') >= 0 && t.indexOf('发布内容（逐字照录）') >= 0;`));
ok('发布者没有提供的字段标红（费用/主办方等）', await evalJs(`
  return document.querySelectorAll('#drawer .unknownval').length >= 1;`));

/* 标红约定：所有「发布者没提供」的字段值必须统一只写「未注明」 */
async function drawUnknownTexts(id) {
  await evalJs(`location.hash = '#id=${id}'; return true;`);
  await sleep(260);
  return evalJs(`return [...document.querySelectorAll('#drawer .unknownval')].map(e => e.textContent.trim());`);
}
const VARIED = ['01', '06', '08', '11', '12', '14', '16', '17', '22', '23', '24', '25'];
const collected = [];
for (const id of VARIED) {
  const texts = await drawUnknownTexts(id);
  collected.push({ id: id, texts: texts });
}
const allRed = collected.flatMap(x => x.texts);
ok('标红单元格文本统一为「未注明」（抽查 ' + VARIED.length + ' 条共 ' + allRed.length + ' 个单元格）',
  allRed.length > 0 && allRed.every(t => t === '未注明'),
  '出现其它写法：' + JSON.stringify([...new Set(allRed.filter(t => t !== '未注明'))]) +
  '（各条数量：' + collected.map(x => x.id + ':' + x.texts.length).join(' ') + '）');
ok('表格标题写明「标红＝未注明」的约定', await evalJs(`
  return document.getElementById('drawer').textContent.indexOf('标红＝未注明') >= 0;`));
await drawUnknownTexts('24');
ok('抽屉打开时 hash 带 id（深链可分享）', (await evalJs(`return location.hash;`)).indexOf('id=24') >= 0);
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return true;`);
await sleep(200);
ok('Esc 可关闭抽屉', await evalJs(`return document.getElementById('drawer').classList.contains('hidden');`));

console.log('\n【详情评论区】');

await evalJs(`location.hash = '#id=11'; return true;`);
await sleep(320);
ok('详情里有「评论」按钮与评论区', await evalJs(`
  const d = document.getElementById('drawer');
  return !!d.querySelector('[data-action="focus-comment"]') && !!document.getElementById('comments') &&
         !!document.getElementById('commentForm') && !!document.getElementById('commentInput');`));
ok('未评论时显示空态提示', await evalJs(`
  return document.getElementById('commentList').textContent.indexOf('还没有评论') >= 0;`));
ok('空评论不会写入（只输入空格时被拒绝）', (await evalJs(`
  document.getElementById('commentInput').value = '   ';
  document.getElementById('commentForm').dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
  return JSON.parse(localStorage.getItem('radar.v1.comments') || '{}')['11'] === undefined;`)) === true);
await evalJs(`
  document.getElementById('commentInput').value = '想问一下：训练营要自带电脑吗？';
  document.getElementById('commentForm').dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
  return true;`);
await sleep(420);
ok('发表后评论区出现该评论', await evalJs(`
  return document.getElementById('commentList').textContent.indexOf('训练营要自带电脑吗') >= 0;`));
ok('评论计数同步（按钮与标题）', await evalJs(`
  return document.querySelector('#drawer [data-action="focus-comment"]').textContent.indexOf('1') >= 0 &&
         document.querySelector('.comments .cnum').textContent === '1';`));
ok('评论写入了本机存储（刷新不丢的前提）', await evalJs(`
  return JSON.parse(localStorage.getItem('radar.v1.comments'))['11'].length === 1;`));
await send('Page.reload');
await waitFor(`!!document.getElementById('comments')`, '刷新后详情自动打开');
ok('刷新页面后评论仍然存在（持久化生效）', await evalJs(`
  return document.getElementById('commentList').textContent.indexOf('训练营要自带电脑吗') >= 0;`));
await evalJs(`
  window.confirm = function(){ return true; };
  document.querySelector('#drawer [data-action="del-comment"]').click();
  return true;`);
await sleep(380);
ok('可以删除自己的评论', await evalJs(`
  return document.getElementById('commentList').textContent.indexOf('训练营要自带电脑吗') < 0 &&
         (JSON.parse(localStorage.getItem('radar.v1.comments'))['11'] || []).length === 0;`));
await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); return true;`);
await sleep(200);

console.log('\n【收藏与冲突检查】');

await evalJs(`
  document.querySelector('.card[data-id="02"] [data-action="toggle-fav"]').click();
  document.querySelector('.card[data-id="18"] [data-action="toggle-fav"]').click();
  return true;`);
await sleep(200);
await evalJs(`document.querySelector('[data-action="open-panel"][data-value="agenda"]').click(); return true;`);
await waitFor(`!!document.getElementById('dlg-agenda')`, '日程弹窗打开');
ok('我的日程提示两条收藏的活动时间冲突', await evalJs(`
  const t = document.getElementById('dlg-agenda').textContent;
  return t.indexOf('日程冲突') >= 0 && t.indexOf('02') >= 0 && t.indexOf('18') >= 0;`));
ok('日程支持导出 .ics / 复制文本', await evalJs(`
  const t = document.getElementById('dlg-agenda').textContent;
  return t.indexOf('导出日历文件') >= 0 && t.indexOf('复制日程文本') >= 0;`));
await evalJs(`document.querySelector('#dlg-agenda [data-action="close-panel"]').click(); return true;`);
await sleep(200);

console.log('\n【月历下钻】');

await evalJs(`document.querySelector('[data-action="set-view"][data-value="calendar"]').click(); return true;`);
await sleep(250);
ok('月历视图渲染 9 月与 10 月两个月', (await evalJs(`return document.querySelectorAll('.cal').length;`)) === 2);
const inCalMonth = await evalJs(`const m = new Date().getMonth() + 1; return m === 9 || m === 10;`);
const d21 = await evalJs(`return new Date().getFullYear() + '-09-21';`);
softOk('月历标出今天「很满」的日子', await evalJs(`
  return document.querySelectorAll('.cell.today').length <= 1 && document.querySelectorAll('.cell.busy').length >= 3;`), '', inCalMonth);
await evalJs(`const c = document.querySelector('.cell[data-value="${d21}"]'); if (c) c.click(); return !!c;`);
await sleep(300);
ok('点击 9/21（当前年份）自动切到时间线并只显示那天', await evalJs(`
  const head = document.querySelector('.tlday header');
  return document.querySelector('[data-action="set-view"][data-value="timeline"]').getAttribute('aria-pressed') === 'true' &&
         document.querySelectorAll('.tlday').length === 1 && !!head && head.textContent.indexOf('9月21日') >= 0;`));
ok('9/21 当天标出时间冲突 01/11/14', await evalJs(`
  const head = document.querySelector('.tlday header');
  return !!head && head.textContent.indexOf('时间冲突 01/11/14') >= 0;`));
await evalJs(`document.querySelector('[data-action="clear-all"]').click(); return true;`);
await sleep(200);

console.log('\n【发布闭环（学生自主发布）】');

ok('未通过自查时拒绝发布并给出原因', await evalJs(`
  document.querySelector('[data-action="open-panel"][data-value="publish"]').click();
  const f = document.getElementById('pubForm');
  f.elements.title.value = '测试：新生夜跑搭子';
  f.elements.date.value = '2025-09-22';
  f.elements.startTime.value = '20:00';
  f.elements.location.value = '东操场';
  f.elements.signup.value = '直接到场';
  f.elements.note.value = '晚上八点东操场集合，慢跑 3 公里，欢迎零基础。';
  f.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
  return document.getElementById('pubErr').textContent.indexOf('自查') >= 0;`));
ok('缺必填项时提示具体缺什么', await evalJs(`
  const f = document.getElementById('pubForm');
  f.elements.title.value = '';
  document.querySelectorAll('input[name="chk"]').forEach(c => { c.checked = true; });
  f.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
  return document.getElementById('pubErr').textContent.indexOf('标题') >= 0;`));

await evalJs(`
  const f = document.getElementById('pubForm');
  f.elements.title.value = '测试：新生夜跑搭子';
  f.elements.date.value = '2025-09-22';
  f.elements.startTime.value = '20:00';
  f.elements.location.value = '东操场';
  f.elements.signup.value = '直接到场';
  f.elements.note.value = '晚上八点东操场集合，慢跑 3 公里，欢迎零基础。';
  document.querySelectorAll('input[name="chk"]').forEach(c => { c.checked = true; });
  f.dispatchEvent(new Event('submit', {cancelable:true, bubbles:true}));
  return true;`);
await sleep(300);
await useCardsView();
ok('发布成功后进入同一个列表（26 → 27 条）', (await cardIds()).length === 27,
  '实际 ' + (await cardIds()).length + ' 条');
ok('新卡片带「本机发布·未审核」标记，不与校方信息混淆', await evalJs(`
  const c = [...document.querySelectorAll('.card')].filter(x => x.textContent.indexOf('测试：新生夜跑搭子') >= 0)[0];
  return !!c && c.textContent.indexOf('本机发布·未审核') >= 0;`));
ok('发布的数据被本地持久化（localStorage）', await evalJs(`
  return JSON.parse(localStorage.getItem('radar.v1.published')).length === 1;`));
await evalJs(`
  const q = document.getElementById('q');
  q.value = '夜跑'; q.dispatchEvent(new Event('input', {bubbles:true}));
  return true;`);
await sleep(300);
ok('搜索「夜跑」命中本机发布的那条', (await cardIds()).length === 1);
await evalJs(`document.querySelector('[data-action="clear-all"]').click(); return true;`);
await sleep(200);

const openedLocal = await evalJs(`
  window.confirm = function(){ return true; };
  const c = [...document.querySelectorAll('.card')].filter(x => x.textContent.indexOf('测试：新生夜跑搭子') >= 0)[0];
  if (!c) return false;
  c.querySelector('[data-action="open"]').click();
  return true;`);
ok('可以从列表打开刚发布的条目', openedLocal === true);
await sleep(250);
const hasDelete = await evalJs(`
  return !!document.querySelector('#drawer [data-action="delete-local"]');`);
ok('本机发布条目提供「删除」入口', hasDelete === true);
if (hasDelete) {
  await evalJs(`document.querySelector('#drawer [data-action="delete-local"]').click(); return true;`);
  await sleep(300);
}
ok('可以删除本机发布（回到 26 条）', (await cardIds()).length === 26,
  '实际 ' + (await cardIds()).length + ' 条');

console.log('\n【发布内容对照与信息质量】');

await evalJs(`document.querySelector('[data-action="set-view"][data-value="raw"]').click(); return true;`);
await sleep(250);
ok('发布内容对照视图并排显示 26 条内容', (await evalJs(`return document.querySelectorAll('.rawtable tbody tr').length;`)) === 26);
ok('发布者对照里能看到原始文本（未被改写）', await evalJs(`
  const t = document.querySelector('.rawtable').textContent;
  return t.indexOf('意向登记不等同于最终作品提交') >= 0 && t.indexOf('仅限大二及以上学生') >= 0;`));

await evalJs(`document.querySelector('[data-action="open-panel"][data-value="quality"]').click(); return true;`);
await waitFor(`!!document.getElementById('dlg-quality')`, '信息质量页打开');
ok('信息质量页展示来源分层与占比', await evalJs(`
  const t = document.getElementById('dlg-quality').textContent;
  return t.indexOf('来源分层') >= 0 && t.indexOf('学院发布') >= 0;`));
ok('信息质量页列出风险条目与「该问什么」话术', await evalJs(`
  const t = document.getElementById('dlg-quality').textContent;
  return t.indexOf('需要谨慎对待的学生发布') >= 0 && t.indexOf('发布者没说清的地方') >= 0 && t.indexOf('训练营报名走哪个入口') >= 0;`));
ok('浏览器内数据自检通过', await evalJs(`
  return document.getElementById('dlg-quality').textContent.indexOf('数据自检：通过') >= 0;`));
await evalJs(`document.querySelector('#dlg-quality [data-action="close-panel"]').click(); return true;`);
await sleep(200);

console.log('\n【时间基准 = 电脑系统时间（±1 天为演示偏移）】');

await useCardsView();
await evalJs(`document.querySelector('[data-action="clock-shift"][data-value="1"]').click(); return true;`);
await sleep(250);
softOk('+1 天后基准日变为 9月20日，且 9/20 的活动变成「今天」', await evalJs(`
  const t = document.getElementById('clockLabel').textContent;
  return t.indexOf('9月20日') >= 0 && document.getElementById('todayTitle').textContent.indexOf('9月20日') >= 0;`));
softOk('+1 天后 05 报名截止从「即将截止」变为「已截止」', await evalJs(`
  const c = [...document.querySelectorAll('.card')].filter(x => x.getAttribute('data-id') === '05')[0];
  return !!c && c.textContent.indexOf('报名已截止') >= 0;`));
await evalJs(`document.querySelector('[data-action="clock-reset"]').click(); return true;`);
await sleep(250);
softOk('点「回到现在」后 05 又显示为即将截止（状态随时间实时重算）', await evalJs(`
  const c = [...document.querySelectorAll('.card')].filter(x => x.getAttribute('data-id') === '05')[0];
  return !!c && c.textContent.indexOf('即将截止') >= 0;`));

console.log('\n【深色 / 浅色模式】');

const prefersDark = await evalJs(`return window.matchMedia('(prefers-color-scheme: dark)').matches;`);
const t0 = await evalJs(`return document.documentElement.getAttribute('data-theme');`);
const t1 = t0 === 'dark' ? 'light' : 'dark';
ok('顶栏有主题切换按钮，文案与当前主题一致（当前 ' + t0 + '）', await evalJs(`
  const b = document.getElementById('themeToggle');
  return !!b && b.textContent.indexOf('${t0 === 'dark' ? '浅色' : '深色'}') >= 0;`));
ok('没有本机选择时跟随系统偏好（prefers-color-scheme=' + (prefersDark ? 'dark' : 'light') + '）',
  t0 === (prefersDark ? 'dark' : 'light'));
await evalJs(`document.getElementById('themeToggle').click(); return true;`);
await sleep(360);
ok('点击可切换主题（' + t0 + ' → ' + t1 + '）', await evalJs(`
  return document.documentElement.getAttribute('data-theme') === '${t1}' &&
         document.getElementById('themeToggle').textContent.indexOf('${t1 === 'dark' ? '浅色' : '深色'}') >= 0;`));
ok('切换是立即生效的（同一帧内颜色变量就变了，无过渡延迟）', await evalJs(`
  const root = document.documentElement;
  const before = getComputedStyle(root).getPropertyValue('--bg').trim();
  root.setAttribute('data-theme', before === '#0b111c' ? 'light' : 'dark');
  const after = getComputedStyle(root).getPropertyValue('--bg').trim();
  root.setAttribute('data-theme', before === '#0b111c' ? 'dark' : 'light');
  return before !== after && !root.classList.contains('theme-anim');`));
ok('主题选择持久化到 localStorage（JSON 编码，首屏预置脚本能正确读取）', await evalJs(`return JSON.parse(localStorage.getItem('radar.v1.theme')) === '${t1}';`));
if (t1 !== 'dark') { await evalJs(`document.getElementById('themeToggle').click(); return true;`); await sleep(360); }
ok('深色配色真正生效（CSS 变量与卡片底色都变暗）', await evalJs(`
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  const card = getComputedStyle(document.querySelector('.card')).backgroundColor;
  const m = card.match(/[0-9]+/g).map(Number);
  return bg === '#0b111c' && (m[0] + m[1] + m[2]) / 3 < 100;`));
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await sleep(340);
ok('深色模式 390px 无横向溢出', await evalJs(`return document.documentElement.scrollWidth <= window.innerWidth + 1;`));
await send('Emulation.clearDeviceMetricsOverride');
if (t0 !== 'dark') { await evalJs(`document.getElementById('themeToggle').click(); return true;`); await sleep(340); }
ok('切回初始主题（' + t0 + '）后状态一致', await evalJs(`
  return document.documentElement.getAttribute('data-theme') === '${t0}';`));

console.log('\n【移动端与无障碍】');

/* 这一项曾经假通过：只测 mobile:true 时，Chrome 会把布局视口撑宽到内容宽度，
   于是「无横向滚动」永远成立。必须同时测 mobile:false（桌面浏览器把窗口拉窄的真实情形）。 */
for (const mobile of [false, true]) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile });
  await sleep(350);
  const m = await evalJs(`return { doc: document.documentElement.scrollWidth, inner: window.innerWidth,
    widest: Math.max(...[...document.querySelectorAll('.card,.todaycard,.badge')].map(e => e.getBoundingClientRect().width), 0) };`);
  ok('390px 无横向滚动（mobile 仿真 = ' + mobile + '）', m.doc <= m.inner + 1,
    '文档 ' + m.doc + 'px vs 视口 ' + m.inner + 'px（最宽元素 ' + Math.round(m.widest) + 'px）');
}
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(250);
ok('390px 下仍能看到 26 张卡片（不是被裁掉）', (await evalJs(`return document.querySelectorAll('.card').length;`)) === 26);
await send('Emulation.clearDeviceMetricsOverride');

ok('页面无控制台报错', consoleErrors.length === 0, consoleErrors.join(' | '));

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败' + (skips ? '（另有 ' + skips + ' 项因系统日期不是 9/19 而跳过）' : ''));
if (fail) console.log('失败项：\n - ' + failures.join('\n - '));
ws.close();
process.exit(fail ? 1 : 0);
