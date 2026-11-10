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
  currentTrack = t;
  $('#nowPlaying').textContent = `Reproduciendo: ${t.title} (pedido por ${t.requestedBy || ''})`;
  const audio = $('#audioPlayer');
  audio.src = '/api/stream?v=' + encodeURIComponent(t.id || t.url);
  audio.volume = (stateVolume() / 100);
  audio.play().catch(() => {});
});
socket.on('music:state', (s) => {
  $('#volume').value = s.volume;
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
function stateVolume() { return parseInt($('#volume').value || '80', 10); }
$('#volume').oninput = async () => {
  await fetch('/api/volume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ volume: parseInt($('#volume').value, 10) }) });
};
$('#btnSkip').onclick = async () => { await fetch('/api/skip', { method: 'POST' }); };
$('#btnPause').onclick = async () => { await fetch('/api/pause', { method: 'POST' }); };
$('#btnResume').onclick = async () => { await fetch('/api/resume', { method: 'POST' }); };
$('#audioPlayer').addEventListener('ended', async () => { await fetch('/api/skip', { method: 'POST' }); });

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

$('#btnListVoices').onclick = () => {
  if (!('speechSynthesis' in window)) { alert('Tu navegador no soporta voces'); return; }
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) { alert('Aún no hay voces cargadas. Espera unos segundos y vuelve a intentar.'); return; }
  alert(voices.map((v) => `${v.name} (${v.lang})`).join('\n'));
};
$('#btnTestVoice').onclick = () => {
  const lang = $('#setLangChat').value || 'es-MX';
  const url = '/api/tts?text=' + encodeURIComponent('Hola, esta es una prueba de voz') + '&lang=' + encodeURIComponent(lang);
  new Audio(url).play().catch(() => alert('No se pudo reproducir el audio'));
};
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
    rateLike: parseFloat($('#setRateLike').value || '1')
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
  if (s.rateChat) $('#setRateChat').value = s.rateChat;
  if (s.rateGift) $('#setRateGift').value = s.rateGift;
  if (s.rateLike) $('#setRateLike').value = s.rateLike;
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
  const kind = d.kind || 'command';
  if (!ttsEnabledFor(kind)) return;
  let lang = 'es-MX';
  if (kind === 'chat') lang = currentSettings.langChat || 'es-MX';
  else if (kind === 'gift') lang = currentSettings.langGift || 'es-MX';
  else if (kind === 'like') lang = currentSettings.langLike || 'es-MX';
  const url = '/api/tts?text=' + encodeURIComponent(String(d.text).slice(0,200)) + '&lang=' + encodeURIComponent(lang);
  new Audio(url).play().catch(() => {});
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