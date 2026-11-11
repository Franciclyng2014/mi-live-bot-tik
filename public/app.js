const socket = io();
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// Tabs
$$('.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Status
socket.on('tiktok:status', (d) => {
  const el = $('#status');
  el.textContent = d.connected ? `Conectado: ${d.username}` : (d.connecting ? 'Conectando...' : 'Desconectado');
  el.classList.toggle('connected', !!d.connected);
  logConn(JSON.stringify(d));
});
socket.on('tiktok:error', (d) => {
  const m = d.message || '';
  if (m.toLowerCase().includes("isn't online") || m.toLowerCase().includes('not online')) {
    logConn('⏳ Esperando a que inicies el live... (reintentando)');
  } else {
    logConn('ERROR: ' + m);
  }
});
function logConn(t) { const el = $('#connLog'); el.textContent += t + '\n'; el.scrollTop = el.scrollHeight; }

// Connect
$('#btnConnect').onclick = async () => {
  const username = $('#username').value.trim().replace(/^@/, '');
  if (!username) return alert('Ingresa usuario');
  await fetch('/api/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
};
$('#btnDisconnect').onclick = async () => {
  await fetch('/api/disconnect', { method: 'POST' });
};

// Chat
$('#btnSimulate').onclick = async () => {
  const user = $('#simUser').value.trim() || 'fan1';
  const comment = $('#simComment').value.trim();
  if (!comment) return;
  await fetch('/api/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, comment }) });
  $('#simComment').value = '';
};
socket.on('chat:message', (m) => {
  const el = $('#chatLog');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="user">${escapeHtml(m.user)}</span>: ${escapeHtml(m.comment)}`;
  el.prepend(div);
});
socket.on('chat:bot', (m) => {
  const el = $('#chatLog');
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="user">Bot</span>: ${escapeHtml(m.text)}`;
  el.prepend(div);
});
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Music
let currentTrack = null;
$('#btnSearch').onclick = async () => {
  const q = $('#searchQuery').value.trim();
  if (!q) return;
  const r = await fetch('/api/search?q=' + encodeURIComponent(q));
  const t = await r.json();
  if (t.error) return alert(t.error);
  $('#nowPlaying').textContent = `Encontrado: ${t.title}`;
  // store for play
  $('#btnPlay').dataset.track = JSON.stringify(t);
};
$('#btnPlay').onclick = async () => {
  let q = $('#searchQuery').value.trim();
  if (!q && $('#btnPlay').dataset.track) {
    const t = JSON.parse($('#btnPlay').dataset.track);
    q = t.url || t.title;
  }
  if (!q) return alert('Ingresa búsqueda');
  await fetch('/api/play', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q, user: 'host' }) });
};
socket.on('music:track', (t) => {
  console.log('music:track received:', t && t.title);
  currentTrack = t;
  $('#nowPlaying').textContent = `🎵 ${t.title} (pedido por ${t.requestedBy || ''})`;
  const iframe = $('#ytPlayer');
  if (iframe && t.id) {
    iframe.src = `https://www.youtube.com/embed/${t.id}?autoplay=1&controls=1&modestbranding=1&rel=0`;
  }
});
$('#btnPlayNow').onclick = () => {
  if (currentTrack && currentTrack.id) {
    const iframe = $('#ytPlayer');
    iframe.src = `https://www.youtube.com/embed/${currentTrack.id}?autoplay=1&controls=1&modestbranding=1&rel=0`;
  }
};
socket.on('music:state', (s) => {
  // volume removed
  updateQueue(s.queue || []);
});
socket.on('music:queue', (q) => updateQueue(q));
function updateQueue(q) {
  const ul = $('#queueList');
  ul.innerHTML = '';
  (q || []).forEach((t, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${t.title} — ${t.requestedBy || ''}`;
    ul.appendChild(li);
  });
  $('#queueCount').textContent = (q || []).length;
}
$('#btnClearQueue').onclick = async () => {
  await fetch('/api/queue/clear', { method: 'POST' });
};
function stateVolume() { return 80; }
// volume control removed (not in UI)
$('#btnPlayNow').onclick = () => {
  if (currentTrack && currentTrack.id) {
    const iframe = $('#ytPlayer');
    iframe.src = `https://www.youtube.com/embed/${currentTrack.id}?autoplay=1&controls=1&modestbranding=1&rel=0`;
  }
};
$('#btnSkip').onclick = async () => { await fetch('/api/skip', { method: 'POST' }); };
$('#btnPause').onclick = async () => { await fetch('/api/pause', { method: 'POST' }); };
$('#btnResume').onclick = async () => { await fetch('/api/resume', { method: 'POST' }); };
// (no audio element; YouTube iframe handles playback)

// Sounds
async function loadSounds() {
  const r = await fetch('/api/sounds');
  const list = await r.json();
  renderSounds(list);
}
function renderSounds(list) {
  const container = $('#soundButtons');
  container.innerHTML = '';
  (list || []).forEach((s, idx) => {
    const btn = document.createElement('button');
    btn.className = 'sound-btn';
    btn.textContent = s.name;
    btn.onclick = () => {
      const a = new Audio(s.url);
      a.volume = stateVolume() / 100;
      a.play().catch(() => {});
      socket.emit('sound:play', { name: s.name });
    };
    const del = document.createElement('button');
    del.textContent = '✕';
    del.className = 'sound-btn';
    del.onclick = async () => { await fetch('/api/sounds/' + idx, { method: 'DELETE' }); loadSounds(); };
    const wrap = document.createElement('div');
    wrap.appendChild(btn);
    wrap.appendChild(del);
    container.appendChild(wrap);
  });
}
$('#btnAddSound').onclick = async () => {
  const name = $('#soundName').value.trim();
  const url = $('#soundUrl').value.trim();
  if (!name || !url) return alert('Completa campos');
  await fetch('/api/sounds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url }) });
  $('#soundName').value = '';
  $('#soundUrl').value = '';
  loadSounds();
};
socket.on('sounds:list', (list) => renderSounds(list));
loadSounds();

// Points
socket.on('points:update', (pts) => {
  const tbody = $('#pointsTable tbody');
  tbody.innerHTML = '';
  Object.entries(pts).sort((a, b) => b[1] - a[1]).forEach(([u, p]) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${escapeHtml(u)}</td><td>${p}</td>`;
    tbody.appendChild(tr);
  });
});

// Settings
function fillVoiceSelect(sel, selected) {
  if (!sel) return;
  const voices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  sel.innerHTML = '';
  if (voices.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'Cargando voces...';
    sel.appendChild(opt);
    return;
  }
  voices.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = `${v.name} (${v.lang})`;
    if (selected && selected === v.name) opt.selected = true;
    sel.appendChild(opt);
  });
}
function loadVoices() { /* no-op: using Google TTS by language */ }
if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
  [500, 1000, 2000, 4000, 7000].forEach((t) => setTimeout(loadVoices, t));
} else {
  // Fallback: show a hint option
  ['setVoice','setVoiceChat','setVoiceGift','setVoiceLike'].forEach((id) => {
    const sel = document.getElementById(id);
    if (sel) {
      const opt = document.createElement('option');
      opt.textContent = 'Voces no disponibles en este navegador';
      sel.appendChild(opt);
    }
  });
}

// (removed: voice list button no longer in UI)
function testVoice(lang) {
  const url = '/api/tts?text=' + encodeURIComponent('Esta es una prueba para Mibot live') + '&lang=' + encodeURIComponent(lang || 'es-MX');
  const audio = new Audio(url);
  audio.volume = 1;
  audio.playbackRate = parseFloat($('#setRateChat').value || '1');
  const p = audio.play();
  if (p && typeof p.catch === 'function') {
    p.catch((e) => alert('No se pudo reproducir: ' + (e && e.message ? e.message : e)));
  }
}
$('#btnTestChat').onclick = () => testVoice($('#setLangChat').value);
$('#btnTestGift').onclick = () => testVoice($('#setLangGift').value);
$('#btnTestLike').onclick = () => testVoice($('#setLangLike').value);
$('#btnSaveSettings').onclick = async () => {
  const body = {
    commandPrefix: $('#setPrefix').value.trim() || '!',
    playCommand: $('#setPlayCmd').value.trim() || 'play',
    alertGift: $('#setAlertGift').checked,
    autoConnect: $('#setAutoConnect').checked,
    ttsChat: $('#setTtsChat').checked,
    ttsGift: $('#setTtsGift').checked,
    ttsLike: $('#setTtsLike').checked,
    langChat: $('#setLangChat').value || 'es-MX',
    langGift: $('#setLangGift').value || 'es-MX',
    langLike: $('#setLangLike').value || 'es-MX',
    rateChat: parseFloat($('#setRateChat').value || '1'),
    rateGift: parseFloat($('#setRateGift').value || '1'),
    rateLike: parseFloat($('#setRateLike').value || '1'),
    chatTtsFormat: $('#setChatFormat').value || 'name',
    skipEmojisOnly: $('#setSkipEmojisOnly').checked,
    stripEmojis: $('#setStripEmojis').checked,
    collapseRepeats: $('#setCollapseRepeats').checked,
    skipLinks: $('#setSkipLinks').checked,
    normalizeCaps: $('#setNormalizeCaps').checked,
    profanityLevel: $('#setProfanity').value || 'medium',
    linksMode: $('#setLinksMode').value || 'blur',
    blockSpam: $('#setBlockSpam').checked,
    blockRepeats: $('#setBlockRepeats').checked,
    tiktokOnly: $('#setTiktokOnly').checked,
    maxCommentLength: parseInt($('#setMaxLen').value || '200', 10),
    allowedUsers: $('#setAllowed').value.split(',').map(s => s.trim()).filter(Boolean),
    blockedUsers: $('#setBlocked').value.split(',').map(s => s.trim()).filter(Boolean)
  };
  await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  alert('Guardado');
};
socket.on('settings:update', (s) => {
  currentSettings = s;
  if (s.commandPrefix) $('#setPrefix').value = s.commandPrefix;
  if (s.playCommand) $('#setPlayCmd').value = s.playCommand;
  $('#setAlertGift').checked = !!s.alertGift;
  $('#setAutoConnect').checked = !!s.autoConnect;
  $('#setTtsChat').checked = s.ttsChat !== false;
  $('#setTtsGift').checked = s.ttsGift !== false;
  $('#setTtsLike').checked = s.ttsLike !== false;
  if (s.langChat) $('#setLangChat').value = s.langChat;
  if (s.langGift) $('#setLangGift').value = s.langGift;
  if (s.langLike) $('#setLangLike').value = s.langLike;
  if (s.chatTtsFormat) $('#setChatFormat').value = s.chatTtsFormat;
  if (s.rateChat) $('#setRateChat').value = s.rateChat;
  if (s.rateGift) $('#setRateGift').value = s.rateGift;
  if (s.rateLike) $('#setRateLike').value = s.rateLike;
  $('#setSkipEmojisOnly').checked = s.skipEmojisOnly !== false;
  $('#setStripEmojis').checked = !!s.stripEmojis;
  $('#setCollapseRepeats').checked = s.collapseRepeats !== false;
  $('#setSkipLinks').checked = s.skipLinks !== false;
  $('#setNormalizeCaps').checked = s.normalizeCaps !== false;
  if (s.profanityLevel) $('#setProfanity').value = s.profanityLevel;
  if (s.linksMode) $('#setLinksMode').value = s.linksMode;
  $('#setBlockSpam').checked = s.blockSpam !== false;
  $('#setBlockRepeats').checked = s.blockRepeats !== false;
  $('#setTiktokOnly').checked = s.tiktokOnly !== false;
  if (s.maxCommentLength) $('#setMaxLen').value = s.maxCommentLength;
  if (Array.isArray(s.allowedUsers)) $('#setAllowed').value = s.allowedUsers.join(', ');
  if (Array.isArray(s.blockedUsers)) $('#setBlocked').value = s.blockedUsers.join(', ');
  loadVoices();
});

// Overlay url
$('#overlayUrl').textContent = window.location.origin + '/overlay';
$('#overlayPreview').src = '/overlay';

let currentSettings = {};
socket.on('settings:update', (s) => { currentSettings = s; });

function ttsEnabledFor(kind) {
  if (kind === 'chat') return currentSettings.ttsChat !== false;
  if (kind === 'gift') return currentSettings.ttsGift !== false;
  if (kind === 'like') return currentSettings.ttsLike !== false;
  return currentSettings.tts !== false;
}
function ttsVoiceFor(kind) {
  return currentSettings.ttsVoice || null;
}
function ttsRateFor(kind) {
  if (kind === 'chat') return parseFloat(currentSettings.rateChat || 1);
  if (kind === 'gift') return parseFloat(currentSettings.rateGift || 1);
  if (kind === 'like') return parseFloat(currentSettings.rateLike || 1);
  return 1;
}

// TTS
socket.on('tts:speak', (d) => {
  console.log('tts:speak received:', d && d.kind, d && (d.text || d.comment));
  const kind = d.kind || 'command';
  if (!ttsEnabledFor(kind)) return;
  let text = d.text || '';
  if (kind === 'chat') {
    const fmt = currentSettings.chatTtsFormat || 'name';
    if (fmt === 'at') text = `@${d.user} dice ${d.comment}`;
    else if (fmt === 'colon') text = `${d.user}: ${d.comment}`;
    else text = `${d.user} dice ${d.comment}`;
  }
  let lang = 'es-MX';
  if (kind === 'chat') lang = currentSettings.langChat || 'es-MX';
  else if (kind === 'gift') lang = currentSettings.langGift || 'es-MX';
  else if (kind === 'like') lang = currentSettings.langLike || 'es-MX';
  const url = '/api/tts?text=' + encodeURIComponent(String(text).slice(0,200)) + '&lang=' + encodeURIComponent(lang);
  const audio = new Audio(url);
  audio.volume = 1;
  audio.playbackRate = ttsRateFor(kind);
  audio.play().catch((e) => { console.warn('TTS play failed:', e && e.message); });
});

// Sound play from remote
socket.on('sound:play', (d) => {
  // host can play locally if has sound
});

// Alerts
socket.on('overlay:alert', (d) => {
  // no-op in main UI
});

// Wake Lock + keep-alive audio for background playback
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});
requestWakeLock();

// silent keep-alive
const keepAlive = new Audio();
keepAlive.loop = true;
keepAlive.volume = 0.01;
keepAlive.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
try { keepAlive.play().catch(() => {}); } catch {}