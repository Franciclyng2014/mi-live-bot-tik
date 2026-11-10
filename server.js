require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');
const googleTts = require('google-tts-api');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- State ----------
const state = {
  tiktok: null,
  username: null,
  connected: false,
  lastLikeTts: 0,
  connecting: false,
  chat: [],
  queue: [],
  nowPlaying: null,
  volume: 80,
  paused: false,
  points: {}, // username -> points
  settings: loadSettings(),
  streamProc: null,
  sounds: loadSounds()
};

function loadSettings() {
  const f = path.join(DATA_DIR, 'settings.json');
  const base = {
    commandPrefix: '!', playCommand: 'play', tts: true, alertGift: true, autoConnect: false, username: null, ttsVoice: null,
    ttsChat: true, ttsGift: true, ttsLike: true,
    langChat: 'es-MX', langGift: 'es-MX', langLike: 'es-MX',
    rateChat: 1, rateGift: 1, rateLike: 1,
    maxQueueSize: 50
  };
  try {
    const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
    // Force browser TTS (Cloud90-style free voices) to avoid empty lists
    saved.ttsEngine = 'google';
    return { ...base, ...saved };
  } catch { return base; }
}
function saveSettings() { fs.writeFileSync(path.join(DATA_DIR, 'settings.json'), JSON.stringify(state.settings, null, 2)); }
function loadSounds() {
  const f = path.join(DATA_DIR, 'sounds.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; }
}
function saveSounds() { fs.writeFileSync(path.join(DATA_DIR, 'sounds.json'), JSON.stringify(state.sounds, null, 2)); }
function loadPoints() {
  const f = path.join(DATA_DIR, 'points.json');
  try { state.points = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { state.points = {}; }
}
function savePoints() { fs.writeFileSync(path.join(DATA_DIR, 'points.json'), JSON.stringify(state.points, null, 2)); }
loadPoints();

function broadcast(event, payload) { io.emit(event, payload); }
function addChat(msg) {
  state.chat.unshift(msg);
  if (state.chat.length > 200) state.chat.length = 200;
  broadcast('chat:message', msg);
}

// ---------- TikTok connection ----------
async function connectTikTok(username) {
  if (state.connecting) throw new Error('Already connecting');
  state.connecting = true;
  state.username = username;
  broadcast('tiktok:status', { connected: false, connecting: true, username });

  const conn = new TikTokLiveConnection(username, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true
  });
  state.tiktok = conn;

  conn.on('connected', (stateData) => {
    state.connected = true;
    state.connecting = false;
    state.settings.username = username;
    state.settings.autoConnect = true;
    saveSettings();
    broadcast('settings:update', state.settings);
    broadcast('tiktok:status', { connected: true, connecting: false, username, state: stateData });
  });
  conn.on('disconnected', () => {
    state.connected = false;
    state.connecting = false;
    broadcast('tiktok:status', { connected: false, connecting: false, username });
  });
  conn.on('error', (err) => {
    console.error('TikTok error:', err?.message || err);
    broadcast('tiktok:error', { message: String(err?.message || err) });
  });

  conn.on(WebcastEvent.CHAT, (data) => {
    const msg = {
      id: data.msgId || Date.now(),
      user: data.uniqueId || data.nickname || 'user',
      nickname: data.nickname,
      comment: data.comment,
      timestamp: Date.now()
    };
    addChat(msg);
    handleCommand(msg);
    if (state.settings.ttsChat) {
      broadcast('tts:speak', { kind: 'chat', text: `${msg.user} dice ${msg.comment}`, user: msg.user });
    }
    // points
    if (!state.points[msg.user]) state.points[msg.user] = 0;
    state.points[msg.user] += 1;
    savePoints();
    broadcast('points:update', state.points);
  });

  conn.on(WebcastEvent.GIFT, (data) => {
    const ev = {
      user: data.uniqueId,
      giftName: data.giftName,
      repeatCount: data.repeatCount,
      diamondCount: data.diamondCount,
      timestamp: Date.now()
    };
    broadcast('tiktok:gift', ev);
    if (state.settings.alertGift) broadcast('overlay:alert', { type: 'gift', text: `${ev.user} envió ${ev.giftName} x${ev.repeatCount}` });
    if (state.settings.ttsGift) {
      broadcast('tts:speak', { kind: 'gift', text: `Gracias ${ev.user} por el regalo ${ev.giftName}`, user: ev.user });
    }
    // points
    if (!state.points[ev.user]) state.points[ev.user] = 0;
    state.points[ev.user] += (ev.diamondCount || 1) * (ev.repeatCount || 1);
    savePoints();
    broadcast('points:update', state.points);
  });

  conn.on(WebcastEvent.LIKE, (data) => {
    broadcast('tiktok:like', { user: data.uniqueId, likeCount: data.likeCount });
    if (state.settings.tts) {
      const now = Date.now();
      if (state.settings.ttsLike && now - state.lastLikeTts > 8000) {
        state.lastLikeTts = now;
        broadcast('tts:speak', { kind: 'like', text: `Gracias ${data.uniqueId} por ${data.likeCount} tap tap`, user: data.uniqueId });
      }
    }
  });
  conn.on(WebcastEvent.FOLLOW, (data) => {
    broadcast('tiktok:follow', { user: data.uniqueId });
    broadcast('overlay:alert', { type: 'follow', text: `${data.uniqueId} te siguió` });
  });
  conn.on(WebcastEvent.SHARE, (data) => {
    broadcast('tiktok:share', { user: data.uniqueId });
  });

  try {
    await conn.connect();
  } catch (e) {
    state.connecting = false;
    broadcast('tiktok:error', { message: String(e?.message || e) });
    throw e;
  }
}

async function disconnectTikTok() {
  if (state.tiktok) {
    try { state.tiktok.disconnect(); } catch {}
  }
  state.tiktok = null;
  state.connected = false;
  state.connecting = false;
  broadcast('tiktok:status', { connected: false, connecting: false, username: state.username });
}

// ---------- Commands ----------
const prefix = () => state.settings.commandPrefix || '!';

function handleCommand(msg) {
  const text = (msg.comment || '').trim();
  let p = prefix();
  if (!text.startsWith(p) && (text.startsWith('/') || text.startsWith('!'))) p = text[0];
  if (!text.startsWith(p)) return;
  const parts = text.slice(p.length).split(/\s+/);
  const cmd = (parts[0] || '').toLowerCase();
  const args = parts.slice(1).join(' ').trim();
  if (cmd === (state.settings.playCommand || 'play')) {
    if (!args) return;
    broadcast('command:play', { user: msg.user, query: args });
    enqueuePlay(args, msg.user);
  } else if (cmd === 'skip' || cmd === 'next') {
    skipTrack();
  } else if (cmd === 'queue' || cmd === 'cola') {
    const list = state.queue.map((t, i) => `${i + 1}. ${t.title}`).join(' | ');
    broadcast('chat:bot', { text: state.nowPlaying ? `Ahora: ${state.nowPlaying.title}. Cola (${state.queue.length}): ${list || 'vacía'}` : `Cola (${state.queue.length}): ${list || 'vacía'}` });
  } else if (cmd === 'clear' || cmd === 'limpiar') {
    state.queue = [];
    broadcast('music:queue', state.queue);
    broadcast('music:state', getMusicState());
    broadcast('chat:bot', { text: 'Cola limpiada' });
  } else if (cmd === 'remove' || cmd === 'quitar') {
    const idx = parseInt(args, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < state.queue.length) {
      const removed = state.queue.splice(idx, 1)[0];
      broadcast('music:queue', state.queue);
      broadcast('music:state', getMusicState());
      broadcast('chat:bot', { text: `Quitado: ${removed.title}` });
    }
  } else if (cmd === 'pause') {
    state.paused = true;
    broadcast('music:state', getMusicState());
  } else if (cmd === 'resume' || cmd === 'playresume') {
    state.paused = false;
    broadcast('music:state', getMusicState());
  } else if (cmd === 'volume') {
    const v = parseInt(args, 10);
    if (!isNaN(v)) {
      state.volume = Math.max(0, Math.min(100, v));
      broadcast('music:state', getMusicState());
    }
  } else if (cmd === 'sound') {
    if (args) broadcast('sound:play', { name: args, user: msg.user });
  } else if (cmd === 'tts') {
    if (args) broadcast('tts:speak', { kind: 'command', text: args, user: msg.user });
  } else if (cmd === 'points') {
    const u = args || msg.user;
    broadcast('chat:bot', { text: `${u} tiene ${state.points[u] || 0} puntos` });
  }
}

function getMusicState() {
  return { nowPlaying: state.nowPlaying, queue: state.queue, volume: state.volume, paused: state.paused };
}

// ---------- YouTube ----------
function ytExec(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(err || `yt-dlp exited ${code}`));
      else resolve(out);
    });
    proc.on('error', reject);
  });
}

async function searchYouTube(query) {
  const out = await ytExec(['-J', '--no-warnings', `ytsearch1:${query}`]);
  const data = JSON.parse(out);
  const entry = (data.entries && data.entries[0]) || data;
  return {
    id: entry.id,
    title: entry.title,
    url: entry.webpage_url || `https://www.youtube.com/watch?v=${entry.id}`,
    duration: entry.duration,
    thumbnail: entry.thumbnail
  };
}

async function getTrackMeta(videoIdOrUrl) {
  const url = videoIdOrUrl.startsWith('http') ? videoIdOrUrl : `https://www.youtube.com/watch?v=${videoIdOrUrl}`;
  const out = await ytExec(['-J', '--no-warnings', url]);
  const data = JSON.parse(out);
  return {
    id: data.id,
    title: data.title,
    url,
    duration: data.duration,
    thumbnail: data.thumbnail,
    ext: data.ext
  };
}

async function enqueuePlay(query, user) {
  const max = state.settings.maxQueueSize || 50;
  if (state.queue.length >= max) {
    broadcast('tiktok:error', { message: `La cola está llena (máx. ${max} canciones). Usa !skip o !clear.` });
    return;
  }
  try {
    const track = await searchYouTube(query);
    track.requestedBy = user;
    state.queue.push(track);
    broadcast('music:queue', state.queue);
    broadcast('music:state', getMusicState());
    if (!state.nowPlaying && !state.streamProc) {
      playNext();
    }
  } catch (e) {
    broadcast('tiktok:error', { message: `No se pudo buscar: ${e.message}` });
  }
}

function playNext() {
  if (state.queue.length === 0) {
    state.nowPlaying = null;
    broadcast('music:state', getMusicState());
    return;
  }
  const track = state.queue.shift();
  state.nowPlaying = track;
  state.paused = false;
  broadcast('music:track', track);
  broadcast('music:state', getMusicState());
  // stream will be pulled by clients via /api/stream/:id
}

function skipTrack() {
  if (state.streamProc) {
    try { state.streamProc.kill(); } catch {}
    state.streamProc = null;
  }
  playNext();
}

// ---------- Routes ----------
app.get('/api/status', (req, res) => {
  res.json({ connected: state.connected, connecting: state.connecting, username: state.username, settings: state.settings });
});

app.post('/api/connect', async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  try {
    await connectTikTok(username);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/disconnect', async (req, res) => {
  await disconnectTikTok();
  res.json({ ok: true });
});

app.get('/api/chat', (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  res.json(state.chat.slice(0, limit));
});

app.get('/api/queue', (req, res) => {
  res.json({ queue: state.queue, nowPlaying: state.nowPlaying, volume: state.volume, paused: state.paused });
});
app.post('/api/queue/clear', (req, res) => {
  state.queue = [];
  broadcast('music:queue', state.queue);
  broadcast('music:state', getMusicState());
  res.json({ ok: true });
});
app.post('/api/queue/remove', (req, res) => {
  const idx = parseInt(req.body?.index, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= state.queue.length) return res.status(400).json({ error: 'bad index' });
  const removed = state.queue.splice(idx, 1)[0];
  broadcast('music:queue', state.queue);
  broadcast('music:state', getMusicState());
  res.json({ ok: true, removed });
});

app.post('/api/play', async (req, res) => {
  const { query, user } = req.body || {};
  if (!query) return res.status(400).json({ error: 'query required' });
  await enqueuePlay(query, user || 'host');
  res.json({ ok: true, queue: state.queue });
});

app.post('/api/skip', (req, res) => {
  skipTrack();
  res.json({ ok: true });
});

app.post('/api/pause', (req, res) => {
  state.paused = true;
  broadcast('music:state', getMusicState());
  res.json({ ok: true });
});

app.post('/api/resume', (req, res) => {
  state.paused = false;
  broadcast('music:state', getMusicState());
  res.json({ ok: true });
});

app.post('/api/volume', (req, res) => {
  const v = parseInt(req.body?.volume, 10);
  if (isNaN(v)) return res.status(400).json({ error: 'volume required' });
  state.volume = Math.max(0, Math.min(100, v));
  broadcast('music:state', getMusicState());
  res.json({ ok: true, volume: state.volume });
});

app.get('/api/search', async (req, res) => {
  try {
    const track = await searchYouTube(req.query.q || '');
    res.json(track);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// Stream audio for a video id or url
app.get('/api/stream', async (req, res) => {
  const video = req.query.v;
  if (!video) return res.status(400).end();
  // kill previous
  if (state.streamProc) { try { state.streamProc.kill(); } catch {} state.streamProc = null; }
  const url = video.startsWith('http') ? video : `https://www.youtube.com/watch?v=${video}`;
  // get ext first
  let ext = 'webm';
  try {
    const meta = await getTrackMeta(url);
    ext = meta.ext || ext;
  } catch {}
  const mime = ext === 'm4a' || ext === 'mp4' ? 'audio/mp4' : 'audio/webm';
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'no-cache');
  const proc = spawn('python', ['-m', 'yt_dlp', '--js-runtimes', 'node', '-f', 'bestaudio', '-o', '-', url], { stdio: ['ignore', 'pipe', 'pipe'] });
  state.streamProc = proc;
  proc.stdout.pipe(res);
  proc.stderr.on('data', (d) => { /* console.error(d.toString()); */ });
  proc.on('close', () => { if (state.streamProc === proc) state.streamProc = null; });
  req.on('close', () => { if (state.streamProc === proc) { try { proc.kill(); } catch {} state.streamProc = null; } });
});

app.get('/api/sounds', (req, res) => res.json(state.sounds));
app.post('/api/sounds', (req, res) => {
  const { name, url } = req.body || {};
  if (!name || !url) return res.status(400).json({ error: 'name and url required' });
  state.sounds.push({ name, url, createdAt: Date.now() });
  saveSounds();
  res.json({ ok: true, sounds: state.sounds });
});
app.delete('/api/sounds/:idx', (req, res) => {
  const idx = parseInt(req.params.idx, 10);
  if (isNaN(idx) || idx < 0 || idx >= state.sounds.length) return res.status(400).json({ error: 'bad index' });
  state.sounds.splice(idx, 1);
  saveSounds();
  res.json({ ok: true, sounds: state.sounds });
});

app.post('/api/simulate', (req, res) => {
  const { user, comment } = req.body || {};
  const msg = { id: Date.now(), user: user || 'testuser', nickname: user, comment: comment || '', timestamp: Date.now() };
  addChat(msg);
  handleCommand(msg);
  res.json({ ok: true });
});
// Google TTS (free, unofficial)
app.get('/api/tts', async (req, res) => {
  try {
    const text = String(req.query.text || '').slice(0, 200);
    const lang = String(req.query.lang || 'es');
    if (!text) return res.status(400).end();
    const url = googleTts.getAudioUrl(text, { lang, slow: false });
    const r = await fetch(url);
    if (!r.ok) return res.status(502).end();
    res.setHeader('Content-Type', r.headers.get('content-type') || 'audio/mpeg');
    const buf = Buffer.from(await r.arrayBuffer());
    res.send(buf);
  } catch (e) {
    res.status(500).end();
  }
});

// Google Cloud TTS voices list
app.get('/api/gcloud/voices', async (req, res) => {
  const key = state.settings.googleCloudKey;
  if (!key) return res.status(400).json({ error: 'API key not set' });
  const lang = String(req.query.lang || 'es-ES');
  try {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/voices?languageCode=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`);
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data.voices || []);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Google Cloud TTS synthesize
app.post('/api/gcloud/tts', async (req, res) => {
  const key = state.settings.googleCloudKey;
  if (!key) return res.status(400).json({ error: 'API key not set' });
  const { text, voice, lang, rate } = req.body || {};
  if (!text) return res.status(400).json({ error: 'text required' });
  try {
    const body = {
      input: { text: String(text).slice(0, 500) },
      voice: { languageCode: lang || 'es-ES', name: voice || undefined },
      audioConfig: { audioEncoding: 'MP3', speakingRate: rate || 1 }
    };
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    const buf = Buffer.from(data.audioContent, 'base64');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ElevenLabs voices list
app.get('/api/eleven/voices', async (req, res) => {
  const key = state.settings.elevenLabsKey;
  if (!key) return res.status(400).json({ error: 'API key not set' });
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    res.json(data.voices || []);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// ElevenLabs TTS
app.post('/api/eleven/tts', async (req, res) => {
  const key = state.settings.elevenLabsKey;
  if (!key) return res.status(400).json({ error: 'API key not set' });
  const { text, voice } = req.body || {};
  if (!text || !voice) return res.status(400).json({ error: 'text and voice required' });
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: String(text).slice(0, 500), model_id: 'eleven_multilingual_v2' })
    });
    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).send(err);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.get('/api/points', (req, res) => res.json(state.points));

app.get('/api/settings', (req, res) => res.json(state.settings));
app.post('/api/settings', (req, res) => {
  state.settings = { ...state.settings, ...(req.body || {}) };
  saveSettings();
  broadcast('settings:update', state.settings);
  res.json({ ok: true, settings: state.settings });
});

// Overlay page
app.get('/overlay', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// Socket
io.on('connection', (socket) => {
  socket.emit('tiktok:status', { connected: state.connected, connecting: state.connecting, username: state.username });
  socket.emit('music:state', getMusicState());
  socket.emit('settings:update', state.settings);
  socket.emit('points:update', state.points);
  socket.emit('sounds:list', state.sounds);
});

function startAutoConnect() {
  setInterval(async () => {
    if (state.settings.autoConnect && state.settings.username && !state.connected && !state.connecting) {
      try { await connectTikTok(state.settings.username); }
      catch (e) { /* retry later */ }
    }
  }, 15000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TikTok Live Companion running on http://localhost:${PORT}`);
  startAutoConnect();
});
