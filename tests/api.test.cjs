/* 评论服务端测试（零依赖）：验证「其他设备也能看到评论」这条链路真的成立。
 * 运行：node tests/api.test.cjs
 * 覆盖：健康检查 / 发表 / 读取（含 mine 标记、不泄露 device）/ 校验（空内容、超长、非法 item）
 *      / 权限（他人设备删不掉）/ 持久化（重启服务后评论仍在）/ 限流
 */
'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const { mkdtempSync, rmSync, readFileSync } = require('fs');
const { tmpdir } = require('os');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const PORT = 8123;
const DATA = join(mkdtempSync(join(tmpdir(), 'campus-comments-')), 'comments.json');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  const child = spawn(process.execPath, [join(ROOT, 'serve.mjs'), String(PORT)], {
    env: Object.assign({}, process.env, { CAMPUS_COMMENTS_FILE: DATA }),
    stdio: 'ignore'
  });
  return child;
}
async function waitUp(timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch (e) { /* 还没起来 */ }
    await sleep(150);
  }
  throw new Error('服务未在预期时间内启动');
}
const api = (path, opts) => fetch(`http://127.0.0.1:${PORT}${path}`, Object.assign({
  headers: { 'content-type': 'application/json' }
}, opts || {})).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

(async () => {
  let server = startServer();
  await waitUp();
  console.log('评论服务测试 @ http://127.0.0.1:' + PORT + '\n');

  console.log('【基础链路（设备 A 发、设备 B 看）】');
  const health = await api('/api/health');
  ok('健康检查返回 shared:true', health.status === 200 && health.body && health.body.shared === true);

  const post = await api('/api/comments', {
    method: 'POST',
    body: JSON.stringify({ item: '11', text: '训练营要自带电脑吗？', author: '小明', device: 'deviceAAAA1111' })
  });
  ok('设备 A 发表评论成功（201）', post.status === 201 && post.body.comment && post.body.comment.text.includes('自带电脑'));

  const asB = await api('/api/comments?item=11&device=deviceBBBB2222');
  ok('设备 B 能读到设备 A 的评论（跨设备可见）', asB.body.comments.length === 1 && asB.body.comments[0].author === '小明');
  ok('别人的评论不给 mine 标记（前端不显示删除按钮）', asB.body.comments[0].mine === false);
  ok('接口不泄露 device 字段（防止冒充他人删评论）', asB.body.comments[0].device === undefined);

  const asA = await api('/api/comments?item=11&device=deviceAAAA1111');
  ok('作者本人读取时 mine=true', asA.body.comments[0].mine === true);

  console.log('\n【输入校验】');
  const empty = await api('/api/comments', { method: 'POST', body: JSON.stringify({ item: '11', text: '   ', device: 'deviceAAAA1111' }) });
  ok('拒绝空内容', empty.status === 400 && empty.body.error === 'empty text');
  const longText = await api('/api/comments', { method: 'POST', body: JSON.stringify({ item: '11', text: 'x'.repeat(500), device: 'deviceAAAA1111' }) });
  ok('超长内容被截断到 300 字而不是报错', longText.status === 201 && longText.body.comment.text.length === 300);
  const badItem = await api('/api/comments', { method: 'POST', body: JSON.stringify({ item: '../../etc/passwd', text: 'hi', device: 'deviceAAAA1111' }) });
  ok('拒绝非法条目 id', badItem.status === 400 && badItem.body.error === 'bad item');
  const badDevice = await api('/api/comments', { method: 'POST', body: JSON.stringify({ item: '11', text: 'hi', device: 'x' }) });
  ok('拒绝非法 device', badDevice.status === 400 && badDevice.body.error === 'bad device');

  console.log('\n【删除权限】');
  const cid = post.body.comment.id;
  const steal = await api('/api/comments', { method: 'DELETE', body: JSON.stringify({ item: '11', id: cid, device: 'deviceBBBB2222' }) });
  ok('他人设备删不掉（403）', steal.status === 403);
  const own = await api('/api/comments', { method: 'DELETE', body: JSON.stringify({ item: '11', id: cid, device: 'deviceAAAA1111' }) });
  ok('作者本人可以删除（200）', own.status === 200 && own.body.ok === true);
  const left = (await api('/api/comments?item=11')).body.comments;
  ok('被删的那条不再出现在列表里', left.every((c) => c.id !== cid), '仍存在：' + JSON.stringify(left.map((c) => c.id)));

  console.log('\n【持久化（换设备/重启后仍可见）】');
  await api('/api/comments', { method: 'POST', body: JSON.stringify({ item: '02', text: '这条要活过重启', author: '小红', device: 'deviceAAAA1111' }) });
  const fileRaw = JSON.parse(readFileSync(DATA, 'utf8'));
  ok('评论已落盘到 JSON 文件', !!fileRaw.items['02'] && fileRaw.items['02'][0].text === '这条要活过重启');
  server.kill();
  await sleep(400);
  server = startServer();
  await waitUp();
  const afterRestart = await api('/api/comments?item=02');
  ok('重启服务后评论仍在（真正持久化）', afterRestart.body.comments.length === 1 && afterRestart.body.comments[0].text === '这条要活过重启');

  console.log('\n【限流】');
  let limited = false;
  for (let i = 0; i < 25; i++) {
    const r = await api('/api/comments', { method: 'POST', body: JSON.stringify({ item: '99', text: 'spam ' + i, device: 'deviceAAAA1111' }) });
    if (r.status === 429) { limited = true; break; }
  }
  ok('高频提交会被限流（429）', limited === true);

  server.kill();
  try { rmSync(DATA, { force: true }); } catch (e) { /* ignore */ }
  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('测试异常：' + e.message); process.exit(1); });
