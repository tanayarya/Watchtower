import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(root, 'public');
const configPath = join(root, 'config', 'dashboard.json');
const homeAssistantTokenPath = process.env.HOME_ASSISTANT_TOKEN_FILE || join(root, 'secrets', 'home-assistant-token');
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

async function homeAssistantRequest(path, options = {}) {
  const config = await dashboardConfig();
  const baseUrl = config.homeAssistant?.url;
  if (!baseUrl) throw new Error('Home Assistant URL is not configured');
  const token = (await readFile(homeAssistantTokenPath, 'utf8')).trim();
  if (!token) throw new Error('Home Assistant token is empty');
  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers ?? {})
    },
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) {
    const error = new Error(`Home Assistant ${response.status}`);
    error.remoteStatus = response.status;
    error.endpoint = path;
    throw error;
  }
  return response.json();
}

async function homeAssistantEntities() {
  const config = await dashboardConfig();
  const entities = config.homeAssistant?.entities ?? [];
  const results = await Promise.all(entities.map(async (entity) => {
    try {
      const state = await homeAssistantRequest(`/api/states/${encodeURIComponent(entity.id)}`);
      return {
        id: entity.id,
        name: entity.name ?? state.attributes?.friendly_name ?? entity.id,
        icon: entity.icon ?? (entity.id.startsWith('light.') ? 'bulb' : 'plug'),
        domain: entity.id.split('.')[0],
        state: state.state,
        isOn: state.state === 'on',
        detail: state.attributes?.brightness != null ? `${Math.round((state.attributes.brightness / 255) * 100)}%` : state.state
      };
    } catch (error) {
      return { id: entity.id, name: entity.name ?? entity.id, icon: entity.icon ?? 'plug', unavailable: true, errorStatus: error.remoteStatus ?? 503 };
    }
  }));
  const authFailure = results.length > 0 && results.every((entity) => entity.errorStatus === 401);
  if (authFailure) {
    const error = new Error('Home Assistant rejected the token');
    error.remoteStatus = 401;
    throw error;
  }
  return { connected: true, entities: results };
}

async function toggleHomeAssistantEntity(entityId) {
  const config = await dashboardConfig();
  const entity = (config.homeAssistant?.entities ?? []).find((item) => item.id === entityId);
  const domain = entity?.id?.split('.')[0];
  if (!entity || !['light', 'switch'].includes(domain)) throw new Error('This entity is not allowed to be toggled');
  await homeAssistantRequest(`/api/services/${domain}/toggle`, {
    method: 'POST', body: JSON.stringify({ entity_id: entity.id })
  });
  return homeAssistantEntities();
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
    if (url.pathname === '/api/home-assistant' && req.method === 'GET') return respond(res, 200, JSON.stringify(await homeAssistantEntities()));
    if (url.pathname === '/api/home-assistant/toggle' && req.method === 'POST') {
      const entityId = url.searchParams.get('entity');
      if (!entityId) return respond(res, 400, JSON.stringify({ error: 'Missing entity' }));
      return respond(res, 200, JSON.stringify(await toggleHomeAssistantEntity(entityId)));
    }

    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = normalize(join(publicDir, requested));
    if (!filePath.startsWith(publicDir)) return respond(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    const file = await readFile(filePath);
    await stat(filePath);
    return respond(res, 200, file, contentTypes[extname(filePath)] ?? 'application/octet-stream');
  } catch (error) {
    const missingSecret = error.code === 'ENOENT' && url.pathname.startsWith('/api/home-assistant');
    const isHomeAssistant = url.pathname.startsWith('/api/home-assistant');
    const code = missingSecret ? 503 : isHomeAssistant ? (error.remoteStatus === 401 ? 401 : 503) : error.code === 'ENOENT' ? 404 : 500;
    const message = missingSecret ? 'Home Assistant token is not mounted' : error.remoteStatus === 401 ? 'Home Assistant rejected the token' : isHomeAssistant ? 'Home Assistant is unreachable or an entity is unavailable' : code === 404 ? 'Not found' : 'Dashboard request failed';
    if (isHomeAssistant) console.error(`[home-assistant] ${message}${error.endpoint ? ` (${error.endpoint})` : ''}`);
    return respond(res, code, JSON.stringify({ error: message, status: error.remoteStatus ?? code }));
  }
}).listen(port, '0.0.0.0', () => console.log(`Watchtower running on http://0.0.0.0:${port}`));
