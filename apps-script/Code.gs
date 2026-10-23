/**
 * Shared backend for Go Wholesale. Paste into a Google Apps Script project bound to a Google Sheet.
 *
 * Setup:
 *  1. Create a Google Sheet. Extensions > Apps Script. Paste this file.
 *  2. Project Settings > Script properties > add  TOKEN = <a long random string>
 *  3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone.
 *  4. Copy the Web app URL and the token into the site's Config page.
 *
 * The site sends POST bodies as text/plain JSON { token, kind, data } and reads with GET ?action=...&token=...
 * Face descriptors are biometric data. Keep the sheet private and use a long token.
 */
var SHEETS = {
  employees: ['name', 'nick', 'plate', 'branch', 'sts', 'phone', 'descriptors', 'photo', 'createdAt'],
  log: ['id', 'name', 'status', 'at'],
  quiz: ['name', 'score', 'total', 'pass', 'date']
};

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(SHEETS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function ok_(token) {
  var want = PropertiesService.getScriptProperties().getProperty('TOKEN');
  return !!want && token === want;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var p = e.parameter || {};
  if (!ok_(p.token)) return json_({ error: 'unauthorized' });
  if (p.action === 'employees') {
    var rows = sheet_('employees').getDataRange().getValues();
    var head = rows.shift();
    var latest = {};
    rows.forEach(function (r) {
      var o = {};
      head.forEach(function (h, i) { o[h] = r[i]; });
      try { o.descriptors = JSON.parse(o.descriptors || '[]'); } catch (x) { o.descriptors = []; }
      latest[o.name] = o; // later rows replace earlier ones
    });
    return json_({ employees: Object.keys(latest).map(function (k) { return latest[k]; }) });
  }
  if (p.action === 'log') {
    var lr = sheet_('log').getDataRange().getValues();
    var lh = lr.shift();
    var since = new Date(); since.setDate(since.getDate() - 2);
    var out = [];
    lr.forEach(function (r) {
      var o = {};
      lh.forEach(function (h, i) { o[h] = r[i]; });
      if (new Date(o.at) >= since) out.push(o);
    });
    return json_({ log: out });
  }
  return json_({ error: 'unknown action' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (x) { return json_({ error: 'bad json' }); }
  if (!ok_(body.token)) return json_({ error: 'unauthorized' });
  var d = body.data || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.kind === 'employee') {
      d.descriptors = JSON.stringify(d.descriptors || []);
    }
    var name = body.kind === 'employee' ? 'employees' : body.kind === 'status' ? 'log' : body.kind === 'quiz' ? 'quiz' : null;
    if (!name) return json_({ error: 'unknown kind' });
    sheet_(name).appendRow(SHEETS[name].map(function (k) { return d[k] === undefined ? '' : d[k]; }));
  } finally { lock.releaseLock(); }
  return json_({ ok: true });
}
