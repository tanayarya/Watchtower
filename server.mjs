import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const configPath = join(root, 'config', 'dashboard.json');
const port = Number(process.env.PORT || 8099);
const cache = new Map();

const contentTypes = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

async function dashboardConfig() {
  return JSON.parse(await readFile(configPath, 'utf8'));
}

function cached(key, ttl, loader) {
  const existing = cache.get(key);
  if (existing && Date.now() - existing.at < ttl) return existing.value;
  const value = loader().catch(() => existing?.value ?? null);
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function remoteJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Watchtower home dashboard/0.1' }, signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

const strip = (text = '') => text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function xmlValue(block, name) {
  return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
}

async function youtubeVideos(channel) {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channel.id)}`, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`YouTube ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 2).map((match) => {
    const block = match[1];
    const id = xmlValue(block, 'yt:videoId');
    return { id, title: strip(xmlValue(block, 'title')), creator: channel.name, published: xmlValue(block, 'published'), url: `https://www.youtube.com/watch?v=${id}`, image: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` };
  });
}

async function redditPosts(subreddit) {
  const response = await fetch(`https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot/.rss`, {
    headers: { 'user-agent': 'Watchtower home dashboard/0.1' }, signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error(`Reddit ${response.status}`);
  const xml = await response.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 2).map((match) => {
    const block = match[1];
    const url = block.match(/<link[^>]*href="([^"]+)"/)?.[1] ?? `https://www.reddit.com/r/${subreddit}`;
    return { subreddit, title: strip(xmlValue(block, 'title')), score: 'HOT', comments: 'Open thread', url };
  });
}

async function feed() {
  const config = await dashboardConfig();
  const [quote, videos, reddit] = await Promise.all([
    cached('quote', 1000 * 60 * 60 * 8, async () => {
      const data = await remoteJson('https://zenquotes.io/api/today');
      return { text: data?.[0]?.q ?? 'Make it work, make it right, make it fast.', author: data?.[0]?.a ?? 'Kent Beck' };
    }),
    cached('youtube', 1000 * 60 * 15, async () => (await Promise.all((config.youtubeChannels ?? []).map(youtubeVideos))).flat()),
    cached('reddit', 1000 * 60 * 10, async () => {
      const results = await Promise.allSettled((config.redditSubreddits ?? []).map(redditPosts));
      return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    })
  ]);
  return { quote, videos: videos ?? [], reddit: reddit ?? [] };
}

async function serviceHealth() {
  const config = await dashboardConfig();
  const results = await Promise.all((config.services ?? []).map(async (service) => {
    if (!service.healthUrl) return { id: service.id, state: 'unknown' };
    const started = performance.now();
    try {
      const response = await fetch(service.healthUrl, { signal: AbortSignal.timeout(4500), redirect: 'manual' });
      return { id: service.id, state: response.status < 500 ? 'online' : 'offline', latency: Math.round(performance.now() - started) };
    } catch { return { id: service.id, state: 'offline' }; }
  }));
  return { checkedAt: new Date().toISOString(), services: results };
}

function respond(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/config') return respond(res, 200, JSON.stringify(await dashboardConfig()));
    if (url.pathname === '/api/feed') return respond(res, 200, JSON.stringify(await feed()));
    if (url.pathname === '/api/health') return respond(res, 200, JSON.stringify(await serviceHealth()));

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = normalize(join(publicDir, requested));
    if (!filePath.startsWith(publicDir)) return respond(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    const file = await readFile(filePath);
    await stat(filePath);
    return respond(res, 200, file, contentTypes[extname(filePath)] ?? 'application/octet-stream');
  } catch (error) {
    const code = error.code === 'ENOENT' ? 404 : 500;
    return respond(res, code, JSON.stringify({ error: code === 404 ? 'Not found' : 'Dashboard request failed' }));
  }
}).listen(port, '0.0.0.0', () => console.log(`Watchtower running on http://0.0.0.0:${port}`));
