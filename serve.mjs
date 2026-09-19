/* 零依赖静态服务器：用于本地预览与 headless 截图验证。
 * 用法：node serve.mjs [端口]   （默认 8017）
 * 产品本身不依赖它——直接双击 index.html（file://）也能正常使用。
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.argv[2] || process.env.PORT || 8017);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ics': 'text/calendar; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    if (url.pathname === '/__health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, root: ROOT }));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const target = join(ROOT, normalize(pathname).replace(/^([/\\])+/, ''));
    if (!target.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const info = await stat(target);
    if (info.isDirectory()) { res.writeHead(302, { location: pathname + '/' }).end(); return; }
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(err && err.code === 'ENOENT' ? 404 : 500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(err && err.code === 'ENOENT' ? 'not found' : String(err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`校园机会雷达预览： http://127.0.0.1:${PORT}/`);
  console.log(`静态根目录： ${ROOT}`);
});
