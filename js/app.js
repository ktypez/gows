/* Shared logic: storage, status log, work-time maths, geofence, optional Apps Script sync. */
(function () {
  var NS = 'gw.';
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(NS + k); } catch (e) {} }
  };

  var STATUSES = [
    { id: 'branch', label: 'กลับถึงสาขา', hint: 'รอโหลดงาน', tone: 't-teal', list: 'จอดรอสาขา' },
    { id: 'out', label: 'เริ่มออกส่งสินค้า', hint: '', tone: 't-blue', list: 'กำลังวิ่งส่ง' },
    { id: 'lunch', label: 'พักกลางวัน', hint: '', tone: 't-amber', list: 'พักกลางวัน' },
    { id: 'ot', label: 'ทำ OT', hint: '', tone: 't-amber', list: 'ทำ OT' },
    { id: 'end', label: 'จบงานสิ้นวัน', hint: '', tone: 't-gray', list: 'จบงานแล้ว' }
  ];
  var NEXT = { branch: 'out', out: 'branch', lunch: 'out', ot: 'out', end: 'branch' };

  function status(id) { return STATUSES.filter(function (s) { return s.id === id; })[0] || null; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hhmm(iso) { var d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtMinutes(m) { return Math.floor(m / 60) + ':' + pad(Math.round(m % 60)); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ---------- employees ---------- */
  function employees() { return store.get('employees', []); }
  function addEmployee(e) {
    var l = employees().filter(function (x) { return x.name !== e.name; });
    l.push(e); store.set('employees', l); sync('employee', e);
  }
  /* Sample people and a few sample statuses, so the dashboard has something to show. */
  function loadDemo() {
    var have = employees().map(function (e) { return e.name; });
    var l = employees();
    (window.GW_DATA ? window.GW_DATA.employees : []).forEach(function (e) { if (have.indexOf(e.name) < 0) l.push({ name: e.name, plate: e.plate, demo: true }); });
    store.set('employees', l);
    store.set('log', getLog().concat(seedLog()));
  }

  /* ---------- status log ---------- */
  function seedLog() {
    var start = new Date(); start.setHours(0, 1, 0, 0);
    var now = Date.now();
    function at(minAgo) { return new Date(Math.max(start.getTime(), now - minAgo * 60000)).toISOString(); }
    var emps = (window.GW_DATA ? window.GW_DATA.employees : []);
    var plan = [
      [['branch', 330], ['out', 300]],
      [['branch', 250]],
      [['branch', 400], ['out', 380], ['lunch', 90]],
      [['branch', 360], ['out', 340]],
      [['branch', 420], ['out', 400], ['end', 20]],
      [['branch', 200]]
    ];
    var log = [];
    emps.slice(0, plan.length).forEach(function (e, i) {
      plan[i].forEach(function (p) { log.push({ id: uid(), name: e.name, status: p[0], at: at(p[1]), demo: true }); });
    });
    return log;
  }
  function getLog() {
    return store.get('log', []);
  }
  function addLog(name, statusId) {
    var log = getLog();
    var entry = { id: uid(), name: name, status: statusId, at: new Date().toISOString() };
    log.push(entry);
    store.set('log', log);
    sync('status', entry);
    return entry;
  }
  function removeLog(id) { store.set('log', getLog().filter(function (e) { return e.id !== id; })); }
  function clearDemo() {
    store.set('log', getLog().filter(function (e) { return !e.demo; }));
    store.set('employees', employees().filter(function (e) { return !e.demo; }));
  }
  function todayEntries(name) {
    var k = dayKey();
    return getLog().filter(function (e) { return dayKey(new Date(e.at)) === k && (!name || e.name === name); })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
  }
  function lastEntry(name) {
    var all = getLog().filter(function (e) { return e.name === name; }).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    return all[all.length - 1] || null;
  }
  /* Minutes worked today: first entry to now (or the "end" entry), minus lunch breaks. */
  function workMinutes(entries) {
    if (!entries.length) return 0;
    var now = Date.now();
    var start = new Date(entries[0].at).getTime();
    var last = entries[entries.length - 1];
    var end = last.status === 'end' ? new Date(last.at).getTime() : now;
    var lunch = 0;
    entries.forEach(function (e, i) {
      if (e.status !== 'lunch') return;
      var from = new Date(e.at).getTime();
      var to = entries[i + 1] ? new Date(entries[i + 1].at).getTime() : end;
      lunch += Math.max(0, Math.min(to, end) - from);
    });
    return Math.max(0, (end - start - lunch) / 60000);
  }
  function board() {
    var byName = {};
    todayEntries().forEach(function (e) { (byName[e.name] = byName[e.name] || []).push(e); });
    var plates = {};
    employees().forEach(function (e) { plates[e.name] = e.plate; });
    return Object.keys(byName).map(function (name) {
      var es = byName[name];
      var last = es[es.length - 1];
      return { name: name, plate: plates[name] || '', status: last.status, at: last.at, minutes: workMinutes(es), demo: es.every(function (e) { return e.demo; }) };
    });
  }

  /* ---------- config, geofence, sync ---------- */
  function config() { return store.get('config', { apiUrl: '', token: '', lat: '', lng: '', radius: '' }); }
  function distKm(a, b, c, d) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (c - a) * rad, dLng = (d - b) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function checkGeofence() {
    var c = config();
    var r = parseFloat(c.radius) || 0, lat = parseFloat(c.lat), lng = parseFloat(c.lng);
    if (!r || isNaN(lat) || isNaN(lng)) return Promise.resolve({ ok: true });
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve({ ok: false, msg: 'อุปกรณ์นี้ไม่รองรับตำแหน่งที่ตั้ง' });
      navigator.geolocation.getCurrentPosition(function (p) {
        var d = distKm(lat, lng, p.coords.latitude, p.coords.longitude);
        resolve(d <= r ? { ok: true } : { ok: false, msg: 'คุณอยู่ห่างจากสาขา ' + d.toFixed(1) + ' กม. (อนุญาต ' + r + ' กม.)' });
      }, function () {
        resolve({ ok: false, msg: 'เปิดการเข้าถึงตำแหน่งที่ตั้งก่อนบันทึก' });
      }, { timeout: 8000, maximumAge: 60000 });
    });
  }
  /* Shared backend (Google Apps Script, see apps-script/Code.gs). Optional: without it, data stays on this phone. */
  function sync(kind, payload) {
    var c = config();
    if (!c.apiUrl) return;
    try {
      fetch(c.apiUrl, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ token: c.token || '', kind: kind, data: payload }) }).catch(function () {});
    } catch (e) {}
  }
  function pull(action) {
    var c = config();
    if (!c.apiUrl) return Promise.resolve(null);
    var u = c.apiUrl + (c.apiUrl.indexOf('?') < 0 ? '?' : '&') + 'action=' + action + '&token=' + encodeURIComponent(c.token || '');
    return fetch(u).then(function (r) { return r.json(); }).catch(function () { return null; });
  }
  /* Download employees (with face data) from the shared sheet and merge into this phone. */
  function pullEmployees() {
    return pull('employees').then(function (res) {
      if (!res || !res.employees) return false;
      var local = employees(), byName = {};
      local.forEach(function (e) { byName[e.name] = e; });
      res.employees.forEach(function (e) { byName[e.name] = e; });
      store.set('employees', Object.keys(byName).map(function (k) { return byName[k]; }));
      return true;
    });
  }
  function pullLog() {
    return pull('log').then(function (res) {
      if (!res || !res.log) return false;
      var have = {}, log = getLog();
      log.forEach(function (e) { have[e.id] = 1; });
      res.log.forEach(function (e) { if (!have[e.id]) log.push(e); });
      store.set('log', log);
      return true;
    });
  }

  /* ---------- small UI helpers ---------- */
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  window.GW = {
    store: store, STATUSES: STATUSES, NEXT: NEXT, status: status, hhmm: hhmm, fmtMinutes: fmtMinutes, dayKey: dayKey,
    employees: employees, addEmployee: addEmployee, loadDemo: loadDemo, pullEmployees: pullEmployees, pullLog: pullLog, getLog: getLog, addLog: addLog, removeLog: removeLog, clearDemo: clearDemo,
    todayEntries: todayEntries, lastEntry: lastEntry, board: board, config: config, checkGeofence: checkGeofence,
    toast: toast, el: el, esc: esc
  };
})();
