/* Camera + face recognition, running fully in the browser with face-api (vendor/face-api.js).
   Models are self-hosted in vendor/models and cached by the service worker, so they download once.

   Flow in recognize():
     1. detect a face and compute a 128-number descriptor, several times a second
     2. compare with each registered employee (Euclidean distance)
     3. the same person must match on 3 frames in a row
     4. the person must blink once (eye-aspect-ratio drop) so a still photo does not pass

   A blink check stops a printed photo. It does not stop a replayed video of the person. */
(function () {
  var MATCH = 0.5;          // lower = stricter. 0.6 is face-api's default; 0.5 cuts false matches.
  var STABLE_FRAMES = 3;
  var TIMEOUT_MS = 20000;
  var loading = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (window.faceapi) return resolve();
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = function () { reject(new Error('script-load')); };
      document.head.appendChild(s);
    });
  }

  /* Loads library + models once. Safe to call at page start, in parallel with the camera. */
  function load() {
    if (loading) return loading;
    loading = loadScript('vendor/face-api.js').then(function () {
      // The bundle lists 'wasm' first but ships no wasm binaries, so pick the backend explicitly.
      var tf = faceapi.tf;
      return tf.setBackend('webgl').then(function (okay) {
        if (okay === false) throw new Error('webgl-unavailable');
      }).catch(function () { return tf.setBackend('cpu'); }).then(function () { return tf.ready(); });
    }).then(function () {
      var url = 'vendor/models';
      return Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(url),
        faceapi.nets.faceLandmark68TinyNet.loadFromUri(url),
        faceapi.nets.faceRecognitionNet.loadFromUri(url)
      ]);
    }).then(warmUp);
    loading.catch(function () { loading = null; });
    return loading;
  }

  /* The first inference compiles GPU shaders and takes 1-2 s on a phone. Do it now, on blank
     canvases, while the camera is still starting, so the first real frame is already fast. */
  function warmUp() {
    var c1 = document.createElement('canvas'); c1.width = 224; c1.height = 224;
    var c2 = document.createElement('canvas'); c2.width = 150; c2.height = 150;
    var o = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    return faceapi.detectSingleFace(c1, o).withFaceLandmarks(true)
      .then(function () { return faceapi.nets.faceRecognitionNet.computeFaceDescriptor(c2); })
      .catch(function () {});
  }

  var opts = null;
  function detect(video) {
    if (!opts) opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
    return faceapi.detectSingleFace(video, opts).withFaceLandmarks(true).withFaceDescriptor();
  }

  function dist(a, b) {
    var s = 0;
    for (var i = 0; i < a.length; i++) { var d = a[i] - b[i]; s += d * d; }
    return Math.sqrt(s);
  }

  /* Best employee for a descriptor, or null if nobody is close enough. */
  function match(descriptor, employees) {
    var best = null, bestD = Infinity;
    employees.forEach(function (e) {
      (e.descriptors || []).forEach(function (d) {
        var x = dist(descriptor, d);
        if (x < bestD) { bestD = x; best = e; }
      });
    });
    return bestD <= MATCH ? { employee: best, distance: bestD } : null;
  }

  function ear(eye) {
    function d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    return (d(eye[1], eye[5]) + d(eye[2], eye[4])) / (2 * d(eye[0], eye[3]));
  }
  function eyeRatio(landmarks) {
    return (ear(landmarks.getLeftEye()) + ear(landmarks.getRightEye())) / 2;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  window.GWFace = {
    load: load,

    /* size: scanning needs far fewer pixels than registering (the detector runs at 224 px),
       and a smaller stream starts faster on most phones. */
    async startCamera(video, size) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no-camera-api');
      var s = size || { width: 640, height: 480 };
      var stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: s.width }, height: { ideal: s.height }, frameRate: { ideal: 24, max: 30 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      return stream;
    },

    stop(stream) {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    },

    /* One descriptor from the current frame, or null. Used by registration. */
    async descriptor(video) {
      await load();
      var r = await detect(video);
      return r ? Array.prototype.slice.call(r.descriptor) : null;
    },

    /* Resolves { employee } on success, { reason: 'timeout' | 'cancelled' } otherwise.
       isCancelled() lets the page abort. onState(text, percent) drives the UI. */
    async recognize(video, employees, onState, isCancelled) {
      var registered = employees.filter(function (e) { return e.descriptors && e.descriptors.length; });
      if (!registered.length) return { reason: 'nobody' };
      onState('กำลังโหลดระบบจดจำใบหน้า', 30);
      await load();
      var started = Date.now();
      var who = null, streak = 0, baseline = 0, blinkAt = 0, blinked = false, blinkStart = 0;
      while (Date.now() - started < TIMEOUT_MS) {
        if (isCancelled()) return { reason: 'cancelled' };
        var r = await detect(video);
        if (!r) { who = null; streak = 0; onState('มองกล้องให้เห็นหน้าชัดๆ', 45); await sleep(120); continue; }
        if (!blinked || !who) {
          var m = match(Array.prototype.slice.call(r.descriptor), registered);
          if (!m) { who = null; streak = 0; onState('ไม่พบใบหน้าที่ลงทะเบียน', 45); await sleep(150); continue; }
          if (who && who.name === m.employee.name) streak++; else { who = m.employee; streak = 1; blinked = false; baseline = 0; }
        }
        if (streak < STABLE_FRAMES) { onState('กำลังยืนยันตัวตน', 65); await sleep(100); continue; }
        // identity stable: now wait for one blink
        var e = eyeRatio(r.landmarks);
        if (!blinkStart) { blinkStart = Date.now(); }
        baseline = Math.max(baseline * 0.98, e);
        onState('กะพริบตา 1 ครั้งเพื่อยืนยัน', 85);
        if (baseline > 0.2 && e < baseline * 0.72) { blinkAt = Date.now(); blinked = true; }
        if (blinked) return { employee: who };
        await sleep(60);
      }
      return { reason: 'timeout' };
    },

    snapshot(video, width) {
      var w = width || 160;
      var h = Math.round(w * (video.videoHeight / video.videoWidth || 0.75));
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(video, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.7);
    }
  };
})();
