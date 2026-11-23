import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

/**
 * 生产环境的静态文件（D100）：一个进程按路径提供几份构建好的前端。
 *   MICROCITY_STATIC_DIR=apps/web/dist                                   只有一份，挂在根路径
 *   MICROCITY_STATIC_DIR=/=apps/landing/dist;/app/=apps/studio/dist;/classic/=apps/web/dist
 * 每一份都是单页应用：找不到的路径回落到它自己的 index.html。视频、大图支持按字节范围取（Safari 播视频必须要）。
 */
export interface Mount {
  /** '/' 或 '/app/' 这样以斜杠结尾的前缀 */
  prefix: string;
  dir: string;
}

export function parseMounts(spec: string, root: string): Mount[] {
  if (!spec) return [];
  if (!spec.includes('=')) return [{ prefix: '/', dir: resolve(root, spec) }];
  return spec
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [p, d] = part.split('=');
      const prefix = `/${(p ?? '').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
      return { prefix, dir: resolve(root, d ?? '') };
    })
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function serveStatic(app: FastifyInstance, mounts: Mount[]): void {
  const live = mounts.filter((m) => existsSync(join(m.dir, 'index.html')));
  if (live.length === 0) return;
  const classic = live.find((m) => m.prefix === '/classic/');
  app.setNotFoundHandler((req, reply) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    const [rawPath, query] = req.url.split('?') as [string, string | undefined];
    let path = '/';
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      // 路由已把畸形的百分号编码拒成 400；这里再兜一层，当作首页
    }
    // 经典版的旧链接（根路径带 ?ws=…）转到 /classic/
    if (classic && query && /(^|&)ws=/.test(query) && !path.startsWith('/classic/')) return reply.redirect(`/classic/?${query}`, 302);
    // /app → /app/
    const bare = live.find((m) => m.prefix !== '/' && path === m.prefix.slice(0, -1));
    if (bare) return reply.redirect(bare.prefix + (query ? `?${query}` : ''), 301);
    const mount = live.find((m) => path.startsWith(m.prefix));
    if (!mount) return reply.code(404).send({ error: 'not found' });
    const rel = path.slice(mount.prefix.length - 1);
    const index = join(mount.dir, 'index.html');
    let file = join(mount.dir, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    const missing = !file.startsWith(mount.dir + sep) || !existsSync(file) || statSync(file).isDirectory();
    // 带哈希的资源找不到就是 404，不要回落成首页（否则浏览器会把 HTML 当脚本缓存起来）
    if (missing && rel.startsWith('/assets/')) return reply.code(404).send({ error: 'not found' });
    if (missing) file = index;
    const size = statSync(file).size;
    reply
      .header('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream')
      .header('Cache-Control', file.startsWith(join(mount.dir, 'assets') + sep) ? 'public, max-age=31536000, immutable' : 'no-cache')
      .header('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', String(end - start + 1))
        .send(createReadStream(file, { start, end }));
    }
    return reply.header('Content-Length', String(size)).send(createReadStream(file));
  });
}
