const socket = io();
const alertEl = document.getElementById('alert');
const npEl = document.getElementById('nowPlaying');
function showAlert(text) {
  alertEl.textContent = text;
  alertEl.style.display = 'block';
  clearTimeout(window._at);
  window._at = setTimeout(() => { alertEl.style.display = 'none'; }, 5000);
}
socket.on('overlay:alert', (d) => showAlert(d.text));
socket.on('music:track', (t) => {
  npEl.textContent = '🎵 ' + t.title;
  npEl.style.display = 'block';
});
socket.on('music:state', (s) => {
  if (!s.nowPlaying) npEl.style.display = 'none';
});