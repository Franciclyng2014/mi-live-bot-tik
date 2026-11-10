# TikTok Live Companion

App gratuita (web + PWA) para tus lives de TikTok: chat en tiempo real, comandos, música de YouTube gratis, soundboard, puntos y overlay para OBS.

## Requisitos
- Node.js 18+
- Python 3.10+ con `yt-dlp` instalado:
  ```
  python -m pip install -U yt-dlp
  ```
- (Opcional) Node como runtime JS para yt-dlp ya se pasa con `--js-runtimes node`.

## Instalación
```
npm install
npm start
```
Abre http://localhost:3000

## Uso
1. En la pestaña **Conexión**, ingresa tu usuario de TikTok (sin @) y conecta mientras estás en live.
2. **Música**: escribe una búsqueda o URL de YouTube y pulsa Reproducir, o en el chat del live usa `!play <canción>` (gratis, sin Spotify Premium).
3. **Sonidos**: añade URLs de audio y pulsa botones.
4. **Overlay**: añade `http://TU_IP:3000/overlay` como Browser Source en OBS o ábrelo en el teléfono.

## Comandos de chat (prefijo configurable, por defecto `!`)
- `!play <búsqueda o URL>` poner música de YouTube
- `!skip` / `!next` saltar canción
- `!pause`, `!resume`
- `!volume 0-100`
- `!sound <nombre>` disparar sonido
- `!tts <texto>` texto a voz
- `!points [usuario]`

## Android
Es una PWA: ábrela en Chrome en Android → menú → "Añadir a pantalla de inicio". También puedes empaquetarla con Capacitor si quieres APK.

## Notas
- La conexión real a TikTok se hace con `tiktok-live-connector`. Debe haber un live activo.
- La música se extrae con yt-dlp y se transmite por el servidor, sin pagar membresías.