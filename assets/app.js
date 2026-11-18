/* ============================================================
   MIB 051 — логика лендинга
   1) терминал-интро
   2) отрисовка удостоверения на <canvas>
   3) генерация PDF в браузере
   4) отправка готового PDF по форме в Apps Script
   ============================================================ */
'use strict';

/* ==================== НАСТРОЙКИ ==================== */
const CONFIG = {
  // URL веб-приложения Apps Script (Deploy → Web app → URL, заканчивается на /exec)
  GAS_URL: 'ВСТАВЬ_СЮДА_URL_ВЕБ-ПРИЛОЖЕНИЯ',
  // Тот же ключ должен лежать в Code.gs
  SUBMIT_KEY: 'mib051-2026-11-21',
  MAX_PHOTO_BYTES: 15 * 1024 * 1024,
  PDF_MAX_BYTES: 6 * 1024 * 1024,
  SUBMIT_TIMEOUT_MS: 45000,
  // дату для карточки берём из data-event-date в index.html, чтобы не было двух источников правды
  EVENT_DATE: (document.body && document.body.dataset.eventDate) || '21 NOV 2026',
  CARD_W: 1011,          // 85,6 мм при 300 dpi
  CARD_H: 637            //  54,0 мм при 300 dpi
};

const CARD_MM_W = 85.6;
const CARD_MM_H = 54;

const GREEN = '#b7ff72';
const GREEN_SOFT = 'rgba(183,255,114,.55)';
const MUTED = '#8b978c';
const WHITE = '#eef2ea';
const MONO = '"DM Mono", ui-monospace, monospace';
const SANS = 'Manrope, -apple-system, Arial, sans-serif';
const NAME_RE = /^[\p{L}\p{N} .,'’\-]{2,40}$/u;
const CODENAME_RE = /^[\p{L}\p{N} _.\-]{2,24}$/u;

/* ==================== ЭЛЕМЕНТЫ ==================== */
const $ = (id) => document.getElementById(id);
const canvas = $('card');
const ctx = canvas.getContext('2d');
const W = CONFIG.CARD_W;
const H = CONFIG.CARD_H;

const state = {
  name: '',
  codename: '',
  agentId: '051-' + String(Math.floor(1000 + Math.random() * 9000)),
  caseCode: randomCaseCode(),
  photo: null,
  photoWarn: ''
};

/* ==================== УТИЛИТЫ ==================== */
function randomCaseCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// детерминированный ПСЧ, чтобы штрих-код не «дрожал» при каждом перерисовывании
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'agent';
}

function setStatus(msg, kind) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = 'status mono' + (kind ? ' ' + kind : '');
}

/* ==================== ТЕРМИНАЛ-ИНТРО ==================== */
const LINES = [
  '> ESTABLISHING SECURE CONNECTION…',
  '> IDENTITY CHECK: IN PROGRESS',
  '> CLASSIFICATION: TOP SECRET',
  '> YOU HAVE BEEN SELECTED.',
  '> MISSION FILE 051 IS READY.'
];

const typed = $('typed');
const enterBtn = $('enter');
let typeTimer = null;
let typingDone = false;

function typeNext(li, ci) {
  if (li >= LINES.length) {
    typingDone = true;
    enterBtn.classList.remove('hidden');
    typed.textContent += '\n\n> AWAITING CONFIRMATION_';
    return;
  }
  const line = LINES[li];
  if (ci < line.length) {
    typed.textContent += line.charAt(ci);
    typeTimer = setTimeout(() => typeNext(li, ci + 1), 18);
  } else {
    typed.textContent += '\n';
    typeTimer = setTimeout(() => typeNext(li + 1, 0), 180);
  }
}

function finishTyping() {
  clearTimeout(typeTimer);
  typed.textContent = LINES.join('\n') + '\n\n> AWAITING CONFIRMATION_';
  typingDone = true;
  enterBtn.classList.remove('hidden');
}

function reveal() {
  $('terminal').classList.add('hidden');
  $('main').classList.remove('hidden');
  window.scrollTo(0, 0);
  // каскадом показываем секции
  document.querySelectorAll('#main .reveal').forEach((el, i) => {
    el.style.transitionDelay = Math.min(i * 70, 420) + 'ms';
    el.classList.add('in');
  });
}

enterBtn.addEventListener('click', reveal);
$('terminal').addEventListener('click', () => { if (!typingDone) finishTyping(); });

/* ==================== ШРИФТЫ ДЛЯ CANVAS ==================== */
async function ensureFonts() {
  if (!document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load('800 46px Manrope'),
      document.fonts.load('600 18px Manrope'),
      document.fonts.load('400 15px Manrope'),
      document.fonts.load('500 34px "DM Mono"'),
      document.fonts.load('500 26px "DM Mono"'),
      document.fonts.load('400 12px "DM Mono"')
    ]);
    if (document.fonts.ready) await document.fonts.ready;
  } catch (e) { /* шрифт не загрузился — рисуем системным */ }
}

/* ==================== ХЕЛПЕРЫ РИСОВАНИЯ ==================== */
function font(size, weight, family) {
  ctx.font = weight + ' ' + size + 'px ' + family;
}

function fitFont(text, maxW, size, weight, family, min) {
  let s = size;
  const floor = min || 14;
  while (s > floor) {
    font(s, weight, family);
    if (ctx.measureText(text).width <= maxW) break;
    s -= 1;
  }
  return s;
}

function spacedText(text, x, y, spacing) {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + spacing;
  }
  return cx - x;
}

function spacedWidth(text, spacing) {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + spacing;
  return w - spacing;
}

function label(text, x, y) {
  font(11, '400', MONO);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  spacedText(text, x, y, 2.2);
}

function divider(y, alpha) {
  ctx.strokeStyle = 'rgba(183,255,114,' + (alpha || 0.22) + ')';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(40, y + 0.5);
  ctx.lineTo(W - 40, y + 0.5);
  ctx.stroke();
}

function cornerTicks(x, y, w, h, len, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const pts = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1]
  ];
  pts.forEach(([px, py, dx, dy]) => {
    ctx.beginPath();
    ctx.moveTo(px + dx * len, py);
    ctx.lineTo(px, py);
    ctx.lineTo(px, py + dy * len);
    ctx.stroke();
  });
}

/* ==================== ФОТО ==================== */
function drawPhotoBox(px, py, pw, ph) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  ctx.fillStyle = '#101811';
  ctx.fillRect(px, py, pw, ph);

  if (state.photo) {
    const img = state.photo;
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    // лёгкий зелёный оттенок «архивного снимка»
    ctx.fillStyle = 'rgba(183,255,114,.08)';
    ctx.fillRect(px, py, pw, ph);
  } else {
    // силуэт-заглушка
    ctx.fillStyle = 'rgba(183,255,114,.13)';
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph + 6, pw * 0.44, ph * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + pw / 2, py + ph * 0.40, pw * 0.23, 0, Math.PI * 2);
    ctx.fill();
    font(11, '400', MONO);
    ctx.fillStyle = 'rgba(183,255,114,.45)';
    ctx.textAlign = 'center';
    spacedText('NO PHOTO', px + pw / 2 - spacedWidth('NO PHOTO', 2) / 2, py + ph - 16, 2);
  }

  // сканлайны поверх снимка
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  for (let y = py; y < py + ph; y += 3) ctx.fillRect(px, y, pw, 1);

  ctx.restore();

  ctx.strokeStyle = GREEN_SOFT;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
}

function drawHologram(x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.28);
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, 'rgba(183,255,114,.30)');
  g.addColorStop(.5, 'rgba(183,255,114,.10)');
  g.addColorStop(1, 'rgba(183,255,114,.26)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(183,255,114,.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(.5, .5, size - 1, size - 1);
  font(13, '500', MONO);
  ctx.fillStyle = 'rgba(183,255,114,.85)';
  ctx.textAlign = 'center';
  ctx.fillText('051', size / 2, size / 2 + 5);
  ctx.restore();
}

/* ==================== ШТРИХ-КОД ==================== */
function drawBarcode(x, y, w, h) {
  const rnd = mulberry32(1337);
  ctx.fillStyle = 'rgba(238,242,234,.82)';
  let cx = x;
  // стартовый «стопор»
  ctx.fillRect(cx, y, 4, h); cx += 8;
  ctx.fillRect(cx, y, 2, h); cx += 6;
  while (cx < x + w - 16) {
    const bw = 2 + Math.floor(rnd() * 4);
    const gap = 2 + Math.floor(rnd() * 4);
    if (rnd() > .32) ctx.fillRect(cx, y, Math.min(bw, x + w - 16 - cx), h);
    cx += bw + gap;
  }
  // финальный «стопор»
  ctx.fillRect(x + w - 8, y, 2, h);
  ctx.fillRect(x + w - 4, y, 4, h);
}

/* ==================== ОТРИСОВКА КАРТОЧКИ ==================== */
function renderCard() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);

  /* фон */
  ctx.fillStyle = '#0a0e0b';
  ctx.fillRect(0, 0, W, H);

  /* диагональный «тиснёный» узор */
  ctx.save();
  ctx.strokeStyle = 'rgba(183,255,114,.045)';
  ctx.lineWidth = 1;
  for (let x = -H; x < W; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  ctx.restore();

  /* отсвет справа сверху */
  const glow = ctx.createRadialGradient(W * 0.82, H * 0.05, 0, W * 0.82, H * 0.05, W * 0.85);
  glow.addColorStop(0, 'rgba(183,255,114,.12)');
  glow.addColorStop(1, 'rgba(183,255,114,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  /* рамка */
  ctx.strokeStyle = 'rgba(183,255,114,.28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(16.5, 16.5, W - 33, H - 33);
  cornerTicks(24, 24, W - 48, H - 48, 18, GREEN_SOFT);

  /* шапка */
  font(26, '800', SANS);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  spacedText('MEN IN BLACK', 40, 62, 3);

  font(11, '400', MONO);
  ctx.fillStyle = MUTED;
  spacedText('IDENTIFICATION CARD // CLASSIFIED', 40, 82, 2.2);

  font(24, '500', MONO);
  ctx.fillStyle = GREEN;
  ctx.textAlign = 'right';
  ctx.fillText('MIB 051', W - 40, 62);
  ctx.textAlign = 'left';

  divider(96, 0.3);

  /* фото */
  const PX = 40, PY = 112, PW = 292, PH = 366;
  drawPhotoBox(PX, PY, PW, PH);
  drawHologram(PX + PW - 58, PY + 14, 44);

  /* правая колонка */
  const RX = 372;
  const RW = W - RX - 40;

  const name = (state.name || 'НЕИЗВЕСТНЫЙ АГЕНТ').toUpperCase();
  const codename = (state.codename || '—').toUpperCase();

  label('NAME / ИМЯ', RX, 128);
  const nameSize = fitFont(name, RW, 46, '800', SANS, 20);
  font(nameSize, '800', SANS);
  ctx.fillStyle = WHITE;
  ctx.fillText(name, RX, 172);

  label('CODENAME / ПОЗЫВНОЙ', RX, 216);
  const codeSize = fitFont(codename, RW, 34, '500', MONO, 16);
  font(codeSize, '500', MONO);
  ctx.fillStyle = GREEN;
  ctx.fillText(codename, RX, 254);

  label('AGENT ID', RX, 300);
  font(26, '500', MONO);
  ctx.fillStyle = GREEN;
  ctx.textAlign = 'left';
  ctx.fillText(state.agentId, RX, 334);

  label('DIVISION', RX + 300, 300);
  font(15, '400', MONO);
  ctx.fillStyle = WHITE;
  ctx.fillText('FIELD OPERATIONS', RX + 300, 334);

  label('CLEARANCE', RX, 378);
  // плашка CLEARANCE
  font(13, '500', MONO);
  const chipText = 'ACCESS GRANTED';
  const chipW = ctx.measureText(chipText).width + 26;
  ctx.fillStyle = GREEN;
  ctx.fillRect(RX, 392, chipW, 28);
  ctx.fillStyle = '#0b1209';
  ctx.fillText(chipText, RX + 13, 411);

  label('CASE FILE', RX + 300, 378);
  font(15, '400', MONO);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText('051/' + state.caseCode, RX + 300, 411);

  font(13, '400', MONO);
  ctx.fillStyle = MUTED;
  spacedText('EVENT: ' + CONFIG.EVENT_DATE, RX, 462, 1.6);

  /* нижняя полоса */
  divider(496, 0.22);
  drawBarcode(40, 514, W - 80, 48);

  font(10, '400', MONO);
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  spacedText('AUTHORIZED PERSONNEL ONLY', 40, 592, 1.8);

  ctx.textAlign = 'right';
  font(11, '500', MONO);
  ctx.fillStyle = GREEN_SOFT;
  ctx.textAlign = 'right';
  ctx.fillText('MIB-' + state.agentId + '/' + state.caseCode, W - 40, 592);
  ctx.textAlign = 'left';

  ctx.restore();
}

/* ==================== PDF ==================== */
function buildPdf() {
  const jsPDFCtor = window.jspdf && window.jspdf.jsPDF;
  if (!jsPDFCtor) throw new Error('Модуль PDF не загрузился. Обнови страницу.');
  const pdf = new jsPDFCtor({
    orientation: 'landscape',
    unit: 'mm',
    format: [CARD_MM_W, CARD_MM_H],
    compress: true
  });
  pdf.setProperties({
    title: 'MIB 051 — удостоверение агента',
    subject: state.codename || state.name || 'agent',
    author: 'MIB 051',
    creator: 'MIB 051 Credential Generator'
  });
  const data = canvas.toDataURL('image/jpeg', 0.93);
  pdf.addImage(data, 'JPEG', 0, 0, CARD_MM_W, CARD_MM_H, undefined, 'FAST');
  return pdf;
}

function downloadPdf() {
  try {
    const pdf = buildPdf();
    pdf.save('MIB051-' + slug(state.codename || state.name) + '.pdf');
    setStatus('PDF сохранён. Его можно отправить командиру вручную.', 'ok');
  } catch (e) {
    setStatus(e.message || String(e), 'err');
  }
}

function blobToBase64Url(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const b64 = String(fr.result).split(',')[1] || '';
      resolve(b64.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'));
    };
    fr.onerror = () => reject(new Error('Не удалось подготовить файл.'));
    fr.readAsDataURL(blob);
  });
}

/* ==================== ОТПРАВКА ==================== */
let waiting = false;
let waitTimer = null;

function endWaiting() {
  waiting = false;
  clearTimeout(waitTimer);
  $('sendBtn').disabled = false;
}

function sendCard() {
  if (CONFIG.GAS_URL.indexOf('http') !== 0) {
    setStatus('Канал связи не настроен: укажи GAS_URL в assets/app.js.', 'err');
    return;
  }
  const pdf = buildPdf();
  const blob = pdf.output('blob');
  if (blob.size > CONFIG.PDF_MAX_BYTES) {
    setStatus('Файл получился слишком большим. Попробуй фото поменьше.', 'err');
    return;
  }

  $('sendBtn').disabled = true;
  setStatus('ПЕРЕДАЧА ДАННЫХ В ЦЕНТР…');

  blobToBase64Url(blob)
    .then((b64) => {
      const form = $('sink');
      const f = form.elements;
      f['key'].value = CONFIG.SUBMIT_KEY;
      f['name'].value = state.name.slice(0, 40);
      f['codename'].value = state.codename.slice(0, 24);
      f['agentId'].value = state.agentId;
      f['pdf'].value = b64;
      f['website'].value = '';
      form.action = CONFIG.GAS_URL;

      waiting = true;
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => {
        if (!waiting) return;
        endWaiting();
        setStatus('Ответ не получен за 45 секунд. Нажми «Скачать PDF» — так карточка точно не потеряется.', 'err');
      }, CONFIG.SUBMIT_TIMEOUT_MS);

      form.submit();
    })
    .catch((e) => {
      endWaiting();
      setStatus(e.message || String(e), 'err');
    });
}

window.addEventListener('message', (ev) => {
  const d = ev.data;
  if (!d || d.source !== 'mib051' || !waiting) return;
  endWaiting();
  if (d.status === 'sent') {
    setStatus('ACCESS GRANTED // карточка отправлена директору операции. Можешь скачать себе копию.', 'ok');
  } else {
    setStatus('Сбой передачи: ' + (d.message || 'неизвестная ошибка') + ' — скачай PDF и отправь вручную.', 'err');
  }
});

/* ==================== ВВОД ==================== */
function syncFromInputs() {
  state.name = $('name').value.trim();
  state.codename = $('codename').value.trim();
  renderCard();
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(syncFromInputs, 60);
}

$('name').addEventListener('input', scheduleRender);
$('codename').addEventListener('input', scheduleRender);

$('photo').addEventListener('change', (ev) => {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  if (file.size > CONFIG.MAX_PHOTO_BYTES) {
    setStatus('Фото больше 15 МБ. Выбери файл поменьше.', 'err');
    ev.target.value = '';
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    state.photo = img;
    $('fileName').textContent = file.name;
    setStatus('');
    renderCard();
  };
  img.onerror = () => {
    setStatus('Не удалось прочитать изображение.', 'err');
    URL.revokeObjectURL(url);
  };
  img.src = url;
});

$('idForm').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (waiting) return;

  const name = $('name').value.trim();
  const codename = $('codename').value.trim();

  if (!NAME_RE.test(name)) {
    setStatus('Имя: 2–40 символов, буквы, цифры, дефис, точка или пробел.', 'err');
    $('name').focus();
    return;
  }
  if (!CODENAME_RE.test(codename)) {
    setStatus('Позывной: 2–24 символа, буквы, цифры, пробел, дефис, точка или подчёркивание.', 'err');
    $('codename').focus();
    return;
  }

  state.name = name;
  state.codename = codename;
  renderCard();
  sendCard();
});

$('downloadBtn').addEventListener('click', downloadPdf);

/* ==================== СТАРТ ==================== */
$('previewId').textContent = 'ID ' + state.agentId;

(async function init() {
  renderCard();
  typeNext(0, 0);
  if (!document.fonts || !document.fonts.ready) return;
  await ensureFonts();
  renderCard();
})();

/* включаем анимации появления только после успешной инициализации:
   если что-то упадёт выше, секции останутся просто видимыми */
document.documentElement.classList.add('js');
