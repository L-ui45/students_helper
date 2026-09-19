/* 截图工具（零依赖）：用 CDP 设备仿真真实还原移动端/桌面端布局后再截图。
 *
 * 为什么不用 chrome --window-size=390：Windows 上浏览器窗口有最小宽度限制，
 * 实际布局宽度会大于 390 再被裁切，导致「看起来文字被裁掉」的假象。
 * 这里用 Emulation.setDeviceMetricsOverride 指定真实布局宽高，再用 Page.captureScreenshot 全页截图。
 *
 * 用法：
 *   node serve.mjs 8017 &
 *   chrome --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank &
 *   node tools/capture-shots.mjs 9222 http://127.0.0.1:8017 shots
 */
'use strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const CDP_PORT = Number(process.argv[2] || 9222);
const BASE = String(process.argv[3] || 'http://127.0.0.1:8017').replace(/\/$/, '');
const OUT = String(process.argv[4] || 'shots');

const SHOTS = [
    { name: '02-home-desktop', url: '/', w: 1280, h: 900, mobile: false },
  { name: '03-calendar', url: '/#view=calendar', w: 1280, h: 900, mobile: false },
  { name: '04-timeline', url: '/#view=timeline', w: 1280, h: 900, mobile: false },
  { name: '05-detail-01', url: '/#id=01', w: 1280, h: 900, mobile: false, viewport: true },
  { name: '06-quality', url: '/#panel=quality', w: 1280, h: 900, mobile: false, viewport: true },
  { name: '07-publish', url: '/#panel=publish', w: 1280, h: 900, mobile: false, viewport: true },
  { name: '08-rawtable', url: '/#view=raw', w: 1280, h: 900, mobile: false },
  { name: '09-filtered', url: '/#quick=%E9%80%82%E5%90%88%E6%96%B0%E7%94%9F&win=3d', w: 1280, h: 900, mobile: false },
  { name: '10-mobile-home', url: '/', w: 390, h: 844, mobile: true, dsf: 2 },
  { name: '11-mobile-detail', url: '/#id=19', w: 390, h: 844, mobile: true, dsf: 2, viewport: true },
  { name: '12-mobile-calendar', url: '/#view=calendar', w: 390, h: 844, mobile: true, dsf: 2 },
  { name: '13-detail-06-unified', url: '/#id=06', w: 1280, h: 1000, mobile: false, viewport: true },
  { name: '14-time-basis', url: '/', w: 1280, h: 360, mobile: false, viewport: true },
  { name: '15-dark-home', url: '/', w: 1280, h: 900, mobile: false, viewport: true, pre: 'dark' },
  { name: '16-dark-mobile', url: '/#id=24', w: 390, h: 844, mobile: true, dsf: 2, viewport: true, pre: 'dark' },
  { name: '17-detail-comment', url: '/#id=11', w: 1280, h: 900, mobile: false, viewport: true, pre: 'comment' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTarget() {
  const t = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((r) => pending.set(i, r));
  };
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: `(function(){${expr}})()`, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'eval failed');
    return r.result?.result?.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, evalJs, close: () => ws.close() };
}

await mkdir(OUT, { recursive: true });
console.log(`截图输出目录：${OUT}`);



for (const s of SHOTS) {
  const page = await openTarget();
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: s.w, height: s.h, deviceScaleFactor: s.dsf || 1, mobile: !!s.mobile
  });
  // 每次都用唯一的 query 参数，强制整页重新加载：
  // 纯 fragment 变化属于同文档导航，不会重新初始化应用
  // 注意必须先拆出 hash 再拼 query，否则 ?s= 会落到 # 后面，深链（#id=/#panel=）就失效了
  const [pathPart, ...fragParts] = s.url.split('#');
  const frag = fragParts.length ? '#' + fragParts.join('#') : '';
  const bust = (pathPart.indexOf('?') >= 0
    ? pathPart.replace('?', '?s=' + s.name + '&')
    : pathPart + '?s=' + s.name) + frag;
  await page.send('Page.navigate', { url: BASE + bust });
  await sleep(900);
  // 主题必须确定性指定：这台机器的系统偏好可能是深色，
  // 靠"点一次切换"会得到相反结果。写入偏好后重新加载，顺带验证首屏预置脚本。
  const wantTheme = s.pre === 'dark' ? 'dark' : 'light';
  await page.evalJs(`try { localStorage.setItem('radar.v1.theme', JSON.stringify('${wantTheme}')); } catch (e) {} return true;`);
  await page.send('Page.reload');
  await sleep(950);
  if (s.pre === 'comment') {
    await page.evalJs("const b=document.getElementById('commentInput'); if(b){b.value='想问一下：训练营要自带电脑吗？需要自己带笔记本吗？'; document.getElementById('commentForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));} return true;");
    await page.evalJs("const c=document.getElementById('comments'); if(c) c.scrollIntoView({block:'center'}); return true;");
    await sleep(600);
  }
  await page.evalJs(`return document.querySelectorAll('.card,.todaycard,.tlday,.rawtable').length;`);
  const doc = await page.evalJs(`return { h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth,
    inner: window.innerWidth, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };`);
  const clip = s.viewport
    ? { x: 0, y: 0, width: s.w, height: s.h, scale: 1 }
    : { x: 0, y: 0, width: s.w, height: Math.min(doc.h, 4000), scale: 1 };
  // 视口类截图（抽屉/弹窗是 position:fixed）必须用普通视口捕获：
  // captureBeyondViewport 会丢掉固定定位图层，导致截图里看不到抽屉与弹窗
  const shot = s.viewport
    ? await page.send('Page.captureScreenshot', { format: 'png' })
    : await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip });
  await writeFile(join(OUT, s.name + '.png'), Buffer.from(shot.result.data, 'base64'));
  console.log(`  ${s.name}.png  ${s.w}x${Math.round(clip.height)}  横向溢出=${doc.overflow ? '有（文档 ' + doc.w + ' > 视口 ' + doc.inner + '）' : '无'}`);
  page.close();
}
console.log('完成。');
process.exit(0);
