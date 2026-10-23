# Go Wholesale

ระบบบันทึกสถานะรถขนส่งแบบสแกนใบหน้า เว็บ static ล้วน ไม่มี build step ใช้บนมือถือผ่านเบราว์เซอร์

Vehicle status tracking with in-browser face recognition. Plain HTML/CSS/JS, no build step.

## What it does

| Page | Job |
|---|---|
| `index.html` | Home. Scan is the big button. |
| `scan.html` | Camera, face match, blink check, then one tap to log the next status. |
| `register.html` | New employee: form plus 3 face angles. |
| `dashboard.html` | Today's status counts, hours worked (lunch excluded), CSV download. |
| `news.html`, `learning.html`, `quiz.html` | Announcements, lessons, 5-question test. Content lives in `js/data.js`. |
| `config.html` | Admin: shared database URL, GPS geofence. |

## Run locally

Camera needs HTTPS or `localhost`.

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Host it

Both work. Both give HTTPS, which the camera requires.

**Netlify (recommended).** `netlify.toml` is included (long cache for the 7 MB of models, camera permission header).
- Drag this folder onto https://app.netlify.com/drop, or
- New site from Git, pick this repo, leave build command empty, publish directory `.`

**GitHub Pages.** Repo Settings > Pages > Deploy from branch `main` / root. The site appears at `https://<user>.github.io/<repo>/`. All paths are relative, so the sub-path is fine. Pages is free for public repos.

## Make it work across phones: shared database

Without this, everything is stored in each phone's own browser. A face registered on phone A is unknown to phone B, and the dashboard only shows that phone's scans.

1. Create a Google Sheet, open Extensions > Apps Script, paste `apps-script/Code.gs`.
2. Project Settings > Script properties: add `TOKEN` with a long random value.
3. Deploy > New deployment > Web app. Execute as **Me**, access **Anyone**.
4. Open `config.html` on the site, set a password, paste the Web app URL and the token, save.

Scan pages then download the employee list before matching, and every status goes to the sheet.

## Face recognition

- Library: [@vladmandic/face-api](https://github.com/vladmandic/face-api) (MIT), self-hosted in `vendor/`, no CDN.
- Models: tiny face detector, 68-point tiny landmarks, face recognition net (about 6.7 MB total, cached by `sw.js` after the first visit).
- Camera frames are processed on the phone and never uploaded. Only the 128-number descriptors and one small thumbnail are stored.
- Match rule: same person on 3 frames in a row, distance below 0.5 (`MATCH` in `js/face.js`; lower is stricter).
- Blink check: one blink required, which stops a printed photo. It does **not** stop a video of the person played on another screen. For payroll-grade attendance, add a server-side check or a second factor.

### Privacy

Face descriptors are biometric personal data. Under Thailand's PDPA you need employees' consent and a stated purpose. Keep the sheet private, use a long token, and delete a person's row when they leave.

### Limits to know

- The config password only locks that screen on one device. Real protection is the sheet token.
- GPS geofence runs in the browser, so a determined user can spoof it.
- `news`, `learning` and `quiz` content is static in `js/data.js`. Edit it and redeploy.

## Layout

```
index.html scan.html register.html dashboard.html
news.html learning.html quiz.html config.html
css/style.css          shared styles (dark, light follows the phone)
js/app.js              storage, status log, work-time maths, geofence, sync
js/face.js             camera, recognition, blink check
js/data.js             sample content
sw.js                  offline cache for shell and models
vendor/                face-api + models (do not edit)
apps-script/Code.gs    optional shared backend
```
