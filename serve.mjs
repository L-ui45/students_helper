/* 校园机会雷达 · 本地服务（静态托管 + 评论 API，零依赖）
 *
 * 为什么需要它：localStorage 只存在单台设备的浏览器里，物理上无法跨设备共享。
 * 要让「其他同学、其他设备」看到评论，必须有一个所有访问者都能连到的服务端。
 *
 * 启动：
 *   node serve.mjs                # 默认 http://127.0.0.1:8017（仅本机可访问）
 *   node serve.mjs 8017 0.0.0.0   # 监听所有网卡 → 同一 Wi-Fi 下其他设备可访问 http://<你的IP>:8017
 *   PORT=8080 HOST=0.0.0.0 node serve.mjs
 *
 * 评论接口：
 *   GET    /api/health                      → { ok, shared:true, items, comments }
 *   GET    /api/comments?item=11            → { item, comments:[{id,at,text,author,mine}] }
 *   POST   /api/comments {item,text,author,device} → 201 { comment }
 *   DELETE /api/comments {item,id,device}   → { ok:true }（只有同一 device 才能删自己的评论）
 *
 * 存储：data/comments.json（可用 CAMPUS_COMMENTS_FILE 指定到别处，便于测试隔离）
 * 写入用「临时文件 + rename」保证原子性，并用串行队列避免并发写坏文件。
 */
import http from 'node:http';
import { readFile, writeFile, stat, mkdir, rename } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8017);
const HOST = String(process.argv[3] || process.env.HOST || '127.0.0.1');
const DATA_FILE = process.env.CAMPUS_COMMENTS_FILE || join(ROOT, 'data', 'comments.json');

const LIMITS = {
  textMax: 300,
  authorMax: 24,
  perItem: 500,
  total: 5000,
  perMinutePerIp: 20,
  bodyMax: 8 * 1024
};
const ITEM_RE = /^[A-Za-z0-9_-]{1,24}$/;
const DEVICE_RE = /^[A-Za-z0-9_-]{6,64}$/;

/* ---------------- 存储 ---------------- */
let store = { version: 1, items: {} };
let writeQueue = Promise.resolve();
async function loadStore() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.items) store = parsed;
  } catch { store = { version: 1, items: {} }; }
}
function saveStore() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
    await rename(tmp, DATA_FILE);
  }).catch(() => {});
  return writeQueue;
}
function countAll() {
  return Object.keys(store.items).reduce((n, k) => n + store.items[k].length, 0);
}
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

/* ---------------- 简易限流 ---------------- */
const hits = new Map();
const mockTopics = {};
let mockSeq = 1;
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > LIMITS.perMinutePerIp;
}

/* ---------------- 工具 ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.ics': 'text/calendar; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};
function send(res, code, body, headers = {}) {
  const h = Object.assign({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  }, headers);
  res.writeHead(code, h);
  res.end(body);
}
function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8' });
}
async function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > LIMITS.bodyMax) { rejectPromise(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolvePromise({});
      try { resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { rejectPromise(new Error('invalid json')); }
    });
    req.on('error', rejectPromise);
  });
}

/* ---------------- 评论接口 ---------------- */
async function handleApi(req, res, url) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  /* ---- mock 频道：模拟公网频道（ntfy 协议子集），供测试离线复现「打开即用」链路 ---- */
  if (path.indexOf('/mock-ntfy/') === 0) {
    const rest = path.slice('/mock-ntfy/'.length);
    const topic = rest.replace(/\/json$/, '');
    if (!mockTopics[topic]) mockTopics[topic] = [];
    if (req.method === 'POST') {
      let body = '';
      await new Promise((res) => { req.on('data', (c) => { body += c; }); req.on('end', res); });
      const msg = { id: 'm' + (mockSeq++), time: Math.floor(Date.now() / 1000), event: 'message', topic, message: body };
      mockTopics[topic].push(msg);
      return sendJson(res, 200, { id: msg.id, topic });
    }
    if (req.method === 'GET') {
      const lines = mockTopics[topic].map((m) => JSON.stringify(m)).join(String.fromCharCode(10));
      return send(res, 200, lines, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    }
  }

  if (path === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, shared: true, items: Object.keys(store.items).length, comments: countAll(), file: DATA_FILE });
  }

  if (path === '/api/comments' && req.method === 'GET') {
    const item = String(url.searchParams.get('item') || '');
    const me = clean(url.searchParams.get('device'), 64);
    if (item && !ITEM_RE.test(item)) return sendJson(res, 400, { ok: false, error: 'bad item' });
    /* 不对外暴露 device（否则任何人都能冒充发布者删评论），只回一个 mine 标记 */
    const pub = (c) => ({ id: c.id, at: c.at, text: c.text, author: c.author, mine: c.device === me });
    const out = {};
    if (item) out[item] = (store.items[item] || []).slice(-200).reverse().map(pub);
    else Object.keys(store.items).forEach((k) => { out[k] = store.items[k].slice(-200).reverse().map(pub); });
    return sendJson(res, 200, { ok: true, item: item || null, comments: item ? out[item] : undefined, byItem: item ? undefined : out });
  }

  if (path === '/api/comments' && req.method === 'POST') {
    if (rateLimited(ip)) return sendJson(res, 429, { ok: false, error: 'too many requests' });
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    const item = clean(body.item, 24);
    const text = clean(body.text, LIMITS.textMax);
    const author = clean(body.author, LIMITS.authorMax) || '匿名同学';
    const device = clean(body.device, 64);
    if (!ITEM_RE.test(item)) return sendJson(res, 400, { ok: false, error: 'bad item' });
    if (!text) return sendJson(res, 400, { ok: false, error: 'empty text' });
    if (!DEVICE_RE.test(device)) return sendJson(res, 400, { ok: false, error: 'bad device' });
    const list = store.items[item] || (store.items[item] = []);
    if (list.length >= LIMITS.perItem) return sendJson(res, 409, { ok: false, error: 'item full' });
    if (countAll() >= LIMITS.total) return sendJson(res, 409, { ok: false, error: 'store full' });
    const comment = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      text, author, device
    };
    list.push(comment);
    await saveStore();
    return sendJson(res, 201, { ok: true, comment: { id: comment.id, at: comment.at, text: comment.text, author: comment.author, mine: true } });
  }

  if (path === '/api/comments' && req.method === 'DELETE') {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
    const item = clean(body.item, 24), id = clean(body.id, 40), device = clean(body.device, 64);
    const list = store.items[item] || [];
    const target = list.filter((c) => c.id === id)[0];
    if (!target) return sendJson(res, 404, { ok: false, error: 'not found' });
    if (target.device !== device) return sendJson(res, 403, { ok: false, error: 'not your comment' });
    store.items[item] = list.filter((c) => c.id !== id);
    await saveStore();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, error: 'no such api' });
}

/* ---------------- 静态文件 ---------------- */
async function handleStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const target = join(ROOT, normalize(pathname).replace(/^([/\\])+/, ''));
  if (!target.startsWith(ROOT)) return send(res, 403, 'forbidden');
  const info = await stat(target);
  if (info.isDirectory()) return send(res, 302, '', { location: pathname + '/' });
  const body = await readFile(target);
  return send(res, 200, body, { 'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST + ':' + PORT}`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mock-ntfy/')) return await handleApi(req, res, url);
    return await handleStatic(req, res, url);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 404 : 500;
    send(res, code, code === 404 ? 'not found' : 'server error');
  }
});

await loadStore();
server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? '<本机局域网 IP>' : HOST;
  console.log(`校园机会雷达： http://${shown}:${PORT}/`);
  console.log(`评论数据文件： ${DATA_FILE}（当前 ${countAll()} 条评论 / ${Object.keys(store.items).length} 个条目）`);
  if (HOST === '0.0.0.0') console.log('提示：同一 Wi-Fi 下的其他设备用 http://<你的IP>:' + PORT + ' 打开，即可看到同一份评论。');
});
