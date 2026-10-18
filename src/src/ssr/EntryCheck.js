/*
 * Minimal, standalone entry page. It deliberately does not load the main
 * application before the server-side verification succeeds.
 */
import { randomBytes } from 'crypto';

import { BASENAME } from '../core/config.js';

function buildPath(path) {
  return `${BASENAME}${path}`;
}

export default function generateEntryCheckPage() {
  const nonce = randomBytes(18).toString('base64');
  const captchaPath = buildPath('/captcha.svg');
  const challengePath = buildPath('/challenge.js');
  const verifyPath = buildPath('/api/entry-check');

  const script = `
const captchaPath = ${JSON.stringify(captchaPath)};
const challengePath = ${JSON.stringify(challengePath)};
const verifyPath = ${JSON.stringify(verifyPath)};
const captchaImage = document.getElementById('captcha-image');
const captchaInput = document.getElementById('captcha-input');
const challengeInput = document.getElementById('challenge-input');
const form = document.getElementById('entry-form');
const status = document.getElementById('entry-status');
const submit = document.getElementById('entry-submit');
let captchaId = null;
let challengeSolution = null;

function setStatus(message, isError) {
  status.textContent = message;
  status.className = isError ? 'error' : '';
}

async function loadCaptcha() {
  submit.disabled = true;
  setStatus('Güvenlik testi hazırlanıyor...', false);
  try {
    const response = await fetch(captchaPath, { cache: 'no-store' });
    if (!response.ok) throw new Error('CAPTCHA yüklenemedi');
    captchaId = response.headers.get('captcha-id');
    captchaImage.src = URL.createObjectURL(
      new Blob([await response.text()], { type: 'image/svg+xml' }),
    );
    challengeSolution = await new Promise((resolve, reject) => {
      const worker = new Worker(
        challengePath + '?cb=' + Date.now(),
      );
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error('Tarayıcı testi zaman aşımına uğradı'));
      }, 15000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error('Tarayıcı testi çalıştırılamadı'));
      };
    });
    challengeInput.value = String(challengeSolution);
    submit.disabled = false;
    setStatus('Karakterleri yazıp devam edin.', false);
    captchaInput.focus();
  } catch (error) {
    setStatus(error.message, true);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!captchaId || challengeSolution === null) return;
  submit.disabled = true;
  setStatus('Kontrol ediliyor...', false);
  try {
    const response = await fetch(verifyPath, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        captcha: captchaInput.value,
        captchaid: captchaId,
        cs: Number(challengeInput.value),
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Robot doğrulaması başarısız.');
    }
    window.location.reload();
  } catch (error) {
    setStatus(error.message, true);
    await loadCaptcha();
  }
});

document.getElementById('reload-captcha').addEventListener(
  'click', loadCaptcha,
);
loadCaptcha();
`;

  const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Robot testi - PixelGlobe</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center;
        background: #111827; color: #f9fafb; }
      main { width: min(92vw, 460px); box-sizing: border-box; padding: 28px;
        border: 1px solid #374151; border-radius: 16px; background: #1f2937;
        box-shadow: 0 18px 60px #0008; }
      h1 { margin: 0 0 10px; font-size: 1.5rem; }
      p { color: #d1d5db; line-height: 1.5; }
      #captcha-image { display: block; width: 100%; height: 130px;
        margin: 20px 0 12px; border-radius: 8px; background: #e5e7eb; }
      label { display: block; margin: 12px 0 6px; font-weight: 600; }
      input { width: 100%; box-sizing: border-box; padding: 11px;
        border: 1px solid #6b7280; border-radius: 8px; background: #111827;
        color: #fff; font-size: 1rem; }
      button { margin-top: 16px; padding: 11px 16px; border: 0;
        border-radius: 8px; background: #60a5fa; color: #111827;
        font-weight: 700; cursor: pointer; }
      button:disabled { cursor: wait; opacity: .55; }
      #reload-captcha { margin-left: 8px; background: #374151; color: #fff; }
      #entry-status { min-height: 1.5em; margin-top: 14px; }
      .error { color: #fca5a5; }
      .small { font-size: .9rem; color: #9ca3af; }
    </style>
  </head>
  <body>
    <main>
      <h1>Robot testi</h1>
      <p>Siteye devam etmeden önce tarayıcınızın gerçek bir kullanıcıya ait
      olduğunu doğrulamamız gerekiyor.</p>
      <form id="entry-form">
        <img id="captcha-image" alt="Güvenlik doğrulama görseli">
        <button id="reload-captcha" type="button">Yenile</button>
        <label for="captcha-input">Görseldeki karakterler</label>
        <input id="captcha-input" autocomplete="off" required>
        <input id="challenge-input" type="hidden">
        <button id="entry-submit" type="submit" disabled>Devam et</button>
        <p id="entry-status" class="small" role="status" aria-live="polite"></p>
      </form>
    </main>
    <script nonce="${nonce}">${script}</script>
  </body>
</html>`;

  return {
    html,
    csp: [
      'default-src \'none\'',
      'img-src \'self\' blob: data:',
      'style-src \'unsafe-inline\'',
      `script-src 'nonce-${nonce}'`,
      'worker-src \'self\' blob:',
      'connect-src \'self\'',
    ].join('; '),
  };
}
