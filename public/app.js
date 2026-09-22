const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let config;
const glyphs = { play: '▶', home: '⌂', pulse: '⌁', file: '▤', chart: '⌁' };

function relativeDate(date) {
  const delta = Date.now() - new Date(date).getTime();
  const hours = Math.max(1, Math.floor(delta / 36e5));
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function renderServices(health) {
  const byId = new Map(health.services.map((item) => [item.id, item]));
  const online = health.services.filter((item) => item.state === 'online').length;
  const total = config.services.length;
  $('#online-count').textContent = `${online}/${total}`;
  $('#service-count').textContent = total;
  $('#header-status').textContent = online === total ? 'all systems nominal' : `${total - online} service${total - online === 1 ? '' : 's'} need attention`;
  $('#health-title').textContent = online === total ? 'All systems nominal' : `${online} of ${total} services online`;
  $('#health-subtitle').textContent = `Status checked ${new Date(health.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  $('#services').innerHTML = config.services.map((service) => {
    const item = byId.get(service.id) || { state: 'unknown' };
    const status = item.state === 'online' ? 'Online' : item.state === 'offline' ? 'Offline' : 'Unknown';
    return `<a class="service-card ${escapeHtml(service.accent)}" href="${escapeHtml(service.url)}" target="_blank" rel="noreferrer">
      <span class="service-icon">${glyphs[service.icon] ?? '◇'}</span>
      <span class="service-meta"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.type)}</small></span>
      <span class="service-status ${item.state}"><i></i>${status}${item.latency ? `<em>${item.latency}ms</em>` : ''}</span>
      <span class="arrow">↗</span>
    </a>`;
  }).join('');
}

function renderFeed(feed) {
  $('#quote').textContent = `“${feed.quote?.text ?? 'Make it work, make it right, make it fast.'}”`;
  $('#quote-author').textContent = `— ${feed.quote?.author ?? 'Kent Beck'}`;
  $('#videos').innerHTML = feed.videos?.length ? feed.videos.slice(0, 3).map((video) => `<a class="video" href="${escapeHtml(video.url)}" target="_blank" rel="noreferrer"><img src="${escapeHtml(video.image)}" alt="" loading="lazy"/><span><small>${escapeHtml(video.creator)} · ${relativeDate(video.published)}</small><strong>${escapeHtml(video.title)}</strong></span><b>▶</b></a>`).join('') : '<div class="feed-loading">No YouTube feeds configured yet.</div>';
  $('#reddit').innerHTML = feed.reddit?.length ? feed.reddit.slice(0, 4).map((post) => `<a class="reddit-item" href="${escapeHtml(post.url)}" target="_blank" rel="noreferrer"><span><small>r/${escapeHtml(post.subreddit)}</small><strong>${escapeHtml(post.title)}</strong></span><b>↑ ${post.score}<em>${escapeHtml(post.comments)}</em></b></a>`).join('') : '<div class="feed-loading">Reddit feed is temporarily unavailable.</div>';
}

async function load() {
  try {
    [config] = await Promise.all([fetch('/api/config').then((r) => r.json())]);
    $('#server-address').textContent = config.serverAddress || 'TAILNET';
    $('#beszel-link').href = config.services.find((service) => service.id === 'beszel')?.url ?? '#';
    $('#ha-link').href = config.services.find((service) => service.id === 'homeassistant')?.url ?? '#';
    const [health, feed] = await Promise.all([fetch('/api/health').then((r) => r.json()), fetch('/api/feed').then((r) => r.json())]);
    renderServices(health); renderFeed(feed);
    $('#last-updated').textContent = `LAST REFRESH ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (error) {
    $('#header-status').textContent = 'dashboard data unavailable';
    $('#health-subtitle').textContent = 'Check your network connection and dashboard configuration.';
  }
}

function updateClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#quote-date').textContent = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  const h = now.getHours(); $('#greeting').textContent = h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

$('#refresh').addEventListener('click', () => { $('#refresh').classList.add('spinning'); load().finally(() => setTimeout(() => $('#refresh').classList.remove('spinning'), 500)); });
$('.home-controls').addEventListener('click', (event) => event.target.closest('.control')?.classList.toggle('active'));
updateClock(); setInterval(updateClock, 1000); load(); setInterval(load, 1000 * 60 * 5);
