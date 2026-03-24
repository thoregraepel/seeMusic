// seeMusic service worker — cache-first for app shell, network-first for media.
// Bump CACHE_VERSION when deploying breaking changes to force a refresh.
const CACHE_VERSION = 'v1';
const CACHE_NAME    = `seemusic-${CACHE_VERSION}`;

const APP_SHELL = [
  '/seeMusic/',
  '/seeMusic/index.html',
  '/seeMusic/style.css',
  '/seeMusic/favicon.svg',
  '/seeMusic/manifest.json',
  '/seeMusic/js/app.js',
  '/seeMusic/js/audio_engine.js',
  '/seeMusic/js/audio_files.js',
  '/seeMusic/js/fft_analyzer.js',
  '/seeMusic/js/midi_files.js',
  '/seeMusic/js/midi_input.js',
  '/seeMusic/js/midi_parser.js',
  '/seeMusic/js/mp3_engine.js',
  '/seeMusic/js/piano.js',
  '/seeMusic/js/scheduler.js',
  '/seeMusic/js/ui.js',
  '/seeMusic/js/visual_engine.js',
];

// Pre-cache the app shell on install
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Remove old caches on activate
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-first for app shell; network-first for MIDI/audio media files
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isMedia = /\.(mid|mp3|wav|ogg|flac)$/i.test(url.pathname);

  if (isMedia) {
    // Network-first: always try to get fresh media, fall back to cache
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Cache-first: serve from cache instantly, fall back to network
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request))
    );
  }
});
