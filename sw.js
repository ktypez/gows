/* Cache-first for the app shell, library and face models, so the 7 MB of models download once. */
var CACHE = 'gw-v1';
var SHELL = ['./', 'index.html', 'scan.html', 'dashboard.html', 'register.html', 'news.html', 'learning.html', 'quiz.html', 'config.html',
  'css/style.css', 'js/app.js', 'js/data.js', 'js/face.js', 'vendor/face-api.js',
  'vendor/models/tiny_face_detector_model-weights_manifest.json', 'vendor/models/tiny_face_detector_model.bin',
  'vendor/models/face_landmark_68_tiny_model-weights_manifest.json', 'vendor/models/face_landmark_68_tiny_model.bin',
  'vendor/models/face_recognition_model-weights_manifest.json', 'vendor/models/face_recognition_model.bin'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); });
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  var heavy = /\/vendor\//.test(req.url);
  e.respondWith(caches.match(req).then(function (hit) {
    // vendor files never change under the same name: cache first. Pages and scripts: network first so edits show up.
    if (heavy && hit) return hit;
    return fetch(req).then(function (res) {
      var copy = res.clone();
      if (res.ok) caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return hit; });
  }));
});
