const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

let config;
const iconPaths = {
  play: '<path d="M8 5.5 18 12 8 18.5Z"/><circle cx="12" cy="12" r="9"/>',
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z"/>',
  pulse: '<path d="M3 12h4l2.2-5 4 10 2.2-5H21"/>',
  file: '<path d="M6 3h8l4 4v14H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M14 3v5h5M8 13h8M8 17h6"/>',
  chart: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 5-6"/>',
  bulb: '<path d="M9 18h6M10 22h4M8.2 14.5A6 6 0 1 1 15.8 14.5c-.8.7-1.3 1.7-1.3 2.7h-5c0-1-.5-2-1.3-2.7Z"/>',
  plug: '<path d="M9 3v6M15 3v6M7 8h10v3a5 5 0 0 1-5 5v5M12 21h3"/>'
};
function icon(name) { return `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${iconPaths[name] ?? iconPaths.chart}</svg>`; }

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
      <span class="service-icon">${icon(service.icon)}</span>
      <span class="service-meta"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.type)}</small></span>
      <span class="service-status ${item.state}"><i></i>${status}${item.latency ? `<em>${item.latency}ms</em>` : ''}</span>
      <span class="arrow">↗</span>
    </a>`;
  }).join('');
}

function renderHomeAssistant(data) {
  const target = $('.home-controls');
  const note = $('.home-card .card-note');
  if (!data?.connected) {
    target.innerHTML = '<div class="integration-empty">Home Assistant is not connected yet.</div>';
    note.textContent = 'Mount the local token file, then refresh this dashboard.';
    return;
  }
  target.innerHTML = data.entities.map((entity) => `<button class="control ${entity.isOn ? 'active' : ''}" data-entity="${escapeHtml(entity.id)}" aria-label="Toggle ${escapeHtml(entity.name)}" ${entity.unavailable ? 'disabled' : ''}>
    <span class="control-icon">${icon(entity.icon)}</span><span>${escapeHtml(entity.name)}</span><b>${entity.unavailable ? 'N/A' : entity.isOn ? 'ON' : 'OFF'}</b>
  </button>`).join('');
  note.textContent = 'Live Home Assistant states · only configured devices can be controlled.';
}

async function loadHomeAssistant() {
  const response = await fetch('/api/home-assistant');
  if (!response.ok) return renderHomeAssistant({ connected: false });
  return renderHomeAssistant(await response.json());
}

async function toggleHomeAssistant(button) {
  const entity = button.dataset.entity;
  if (!entity || button.disabled) return;
  button.disabled = true;
  button.classList.add('is-loading');
  try {
    const response = await fetch(`/api/home-assistant/toggle?entity=${encodeURIComponent(entity)}`, { method: 'POST' });
    if (!response.ok) throw new Error('Toggle failed');
    renderHomeAssistant(await response.json());
  } catch {
    $('.home-card .card-note').textContent = 'Action failed — check the Home Assistant token and entity permissions.';
  } finally {
    button.disabled = false;
    button.classList.remove('is-loading');
  }
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
    const [health, feed] = await Promise.all([fetch('/api/health').then((r) => r.json()), fetch('/api/feed').then((r) => r.json()), loadHomeAssistant()]);
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
$('.home-controls').addEventListener('click', (event) => toggleHomeAssistant(event.target.closest('.control')));
updateClock(); setInterval(updateClock, 1000); load(); setInterval(load, 1000 * 60 * 5);
