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
  GAS_URL: 'https://script.google.com/macros/s/AKfycbyLOmmKsxwdZG0BbAcH73p_Cc6R2w1mtjVE_P7V4nZmf5hYFc1QqLsty8kLcCsIsusu/exec',
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

/* палитра документа: строгий чёрно-белый бланк */
const PAPER = '#f5f4f0';
const INK = '#121212';
const INK_2 = '#4a4a4a';
const RULE = '#b9b8b2';
const WHITE = '#ffffff';
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
  { t: '> ESTABLISHING SECURE CONNECTION…', c: 'sys' },
  { t: '> IDENTITY CHECK: IN PROGRESS', c: 'sys' },
  { t: '> CLASSIFICATION: TOP SECRET', c: 'sys' },
  { t: '', c: '' },
  { t: 'Здравствуйте, кандидат.', c: 'letter' },
  { t: '', c: '' },
  { t: 'В ходе закрытого отбора ваша кандидатура была признана подходящей для участия в специальной операции организации MIB.', c: 'letter' },
  { t: '', c: '' },
  { t: 'Вы были отобраны не случайно.', c: 'letter' },
  { t: '', c: '' },
  { t: 'Вам предстоит стать частью команды, которой поручено выполнение миссии особой важности.', c: 'letter' },
  { t: '', c: '' },
  { t: '> AWAITING CONFIRMATION_', c: 'sys' }
];

const TYPE_MS = 10;      // скорость набора одного символа
const LINE_PAUSE = 150;  // пауза между строками

const typed = $('typed');
const cursor = $('cursor');
const enterBtn = $('enter');
let typeTimer = null;
let typingDone = false;

function appendLine(text, cls) {
  if (!text) { typed.appendChild(document.createTextNode('\n')); return; }
  const span = document.createElement('span');
  span.className = 'line ' + cls;
  span.textContent = text;
  typed.appendChild(span);
  typed.appendChild(document.createTextNode('\n'));
}

function typeNext(li, ci, el) {
  if (li >= LINES.length) {
    typingDone = true;
    cursor.classList.add('hidden');
    enterBtn.classList.remove('hidden');
    return;
  }
  const item = LINES[li];

  if (!item.t) {
    typed.appendChild(document.createTextNode('\n'));
    typeTimer = setTimeout(() => typeNext(li + 1, 0, null), LINE_PAUSE);
    return;
  }
  if (!el) {
    el = document.createElement('span');
    el.className = 'line ' + item.c;
    typed.appendChild(el);
    ci = 0;
  }
  if (ci < item.t.length) {
    el.textContent += item.t.charAt(ci);
    typeTimer = setTimeout(() => typeNext(li, ci + 1, el), TYPE_MS);
  } else {
    typed.appendChild(document.createTextNode('\n'));
    typeTimer = setTimeout(() => typeNext(li + 1, 0, null), LINE_PAUSE);
  }
}

function finishTyping() {
  clearTimeout(typeTimer);
  typed.textContent = '';
  LINES.forEach((item) => appendLine(item.t, item.c));
  typingDone = true;
  cursor.classList.add('hidden');
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
  initMap();
}

enterBtn.addEventListener('click', reveal);
$('terminal').addEventListener('click', () => { if (!typingDone) finishTyping(); });

/* ==================== КАРТА ==================== */
let leafletMap = null;

function initMap() {
  const wrap = $('mapWrap');
  if (!wrap || !window.L || leafletMap) return;

  const lat = parseFloat(wrap.dataset.lat);
  const lon = parseFloat(wrap.dataset.lon);
  const zoom = parseInt(wrap.dataset.zoom, 10) || 15;
  if (!isFinite(lat) || !isFinite(lon)) return;

  leafletMap = L.map('map', {
    center: [lat, lon],
    zoom: zoom,
    scrollWheelZoom: false, // чтобы карта не перехватывала прокрутку страницы
    attributionControl: true,
    zoomControl: true
  });

  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Спутник: Esri, Maxar, Earthstar Geographics' }
  ).addTo(leafletMap);

  L.circleMarker([lat, lon], {
    radius: 7,
    color: '#b7ff72',
    weight: 2,
    fillColor: '#b7ff72',
    fillOpacity: 0.4
  }).addTo(leafletMap);

  // карта инициализируется уже видимой, но на всякий случай пересчитаем размер
  setTimeout(() => { if (leafletMap) leafletMap.invalidateSize(); }, 120);
}

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
  const floor = min || 12;
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

/* разрядка справа налево — для подписей, выровненных по правому краю */
function spacedTextRight(text, xRight, y, spacing) {
  spacedText(text, xRight - spacedWidth(text, spacing), y, spacing);
}

/* пунктирная отбивка между подписью поля и значением — как в типографских бланках */
function dotLeaders(x1, x2, y) {
  if (x2 - x1 < 20) return;
  ctx.strokeStyle = 'rgba(18,18,18,.55)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let x = x1; x < x2; x += 7) {
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x + 1.7, y - 3);
  }
  ctx.stroke();
}

function hRule(x1, x2, y, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width || 1;
  ctx.beginPath();
  ctx.moveTo(x1, y + 0.5);
  ctx.lineTo(x2, y + 0.5);
  ctx.stroke();
}

/* строка бланка: подпись слева, значение справа, между ними пунктир */
function fieldRow(x1, x2, y, labelText, valueText, valueSize) {
  font(10, '400', MONO);
  ctx.fillStyle = INK_2;
  ctx.textAlign = 'left';
  const lw = spacedWidth(labelText, 1.6);
  spacedText(labelText, x1, y, 1.6);

  let vs = valueSize || 15;
  const maxValW = (x2 - x1) * 0.62;
  font(vs, '500', MONO);
  while (vs > 10 && ctx.measureText(valueText).width > maxValW) {
    vs -= 1;
    font(vs, '500', MONO);
  }
  const vw = ctx.measureText(valueText).width;
  ctx.fillStyle = INK;
  ctx.textAlign = 'right';
  ctx.fillText(valueText, x2, y);
  ctx.textAlign = 'left';

  dotLeaders(x1 + lw + 14, x2 - vw - 14, y);
  hRule(x1, x2, y + 11, RULE, 1);
}

/* классический «серый» пришелец: вытянутая голова и раскосые глаза */
function drawAlienHead(cx, cy, w, h, color, eyeColor) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(w / 200, h / 260);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 130);
  ctx.bezierCurveTo(-95, 100, -108, -30, -70, -92);
  ctx.bezierCurveTo(-40, -140, 40, -140, 70, -92);
  ctx.bezierCurveTo(108, -30, 95, 100, 0, 130);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.ellipse(-34, -24, 31, 20, -0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(34, -24, 31, 20, 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* канцелярская печать «ДОПУЩЕН» */
function drawStamp(cx, cy, w, h, angle) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.globalAlpha = 0.40;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.lineWidth = 1;
  ctx.strokeRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  font(19, '500', MONO);
  spacedText('ДОПУЩЕН', -spacedWidth('ДОПУЩЕН', 2.6) / 2, -3, 2.6);
  font(9, '400', MONO);
  spacedText('ACCESS GRANTED', -spacedWidth('ACCESS GRANTED', 1.7) / 2, 14, 1.7);
  ctx.restore();
}

/* подпись от руки */
function drawSignature(x, y, len) {
  const pts = [[0.10, -16], [0.16, 9], [0.24, -23], [0.33, 7], [0.40, -13],
               [0.50, 11], [0.58, -19], [0.66, 5], [0.74, -11], [0.84, 9], [1.00, -7]];
  ctx.save();
  ctx.globalAlpha = 0.75;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  pts.forEach(([f, dy]) => ctx.lineTo(x + len * f, y + dy));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + len * 0.22, y + 6);
  ctx.bezierCurveTo(x + len * 0.5, y + 28, x + len * 0.72, y - 22, x + len * 1.04, y + 1);
  ctx.stroke();
  ctx.restore();
}

/* фото переводим в оттенки серого через offscreen-канву */
function grayDraw(img, sx, sy, sw, sh, dx, dy, dw, dh) {
  try {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(dw));
    off.height = Math.max(1, Math.round(dh));
    const octx = off.getContext('2d');
    octx.drawImage(img, sx, sy, sw, sh, 0, 0, off.width, off.height);
    const imgData = octx.getImageData(0, 0, off.width, off.height);
    const p = imgData.data;
    for (let i = 0; i < p.length; i += 4) {
      const lum = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      const v = Math.max(0, Math.min(255, (lum - 128) * 1.16 + 133));
      p[i] = p[i + 1] = p[i + 2] = v;
    }
    octx.putImageData(imgData, 0, 0);
    ctx.drawImage(off, dx, dy, dw, dh);
    return true;
  } catch (e) {
    return false; // если канва «испорчена» браузером — рисуем как есть
  }
}

function drawPhotoBox(px, py, pw, ph) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();

  ctx.fillStyle = '#e7e6e1';
  ctx.fillRect(px, py, pw, ph);

  if (state.photo) {
    const img = state.photo;
    const scale = Math.max(pw / img.width, ph / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const sx = (img.width - pw / scale) / 2;
    const sy = (img.height - ph / scale) / 2;
    const sw = pw / scale;
    const sh = ph / scale;
    if (!grayDraw(img, sx, sy, sw, sh, px, py, pw, ph)) {
      ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh);
    }
  } else {
    ctx.fillStyle = '#c6c5bf';
    ctx.beginPath();
    ctx.ellipse(px + pw / 2, py + ph + 8, pw * 0.44, ph * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px + pw / 2, py + ph * 0.40, pw * 0.23, 0, Math.PI * 2);
    ctx.fill();
    font(10, '400', MONO);
    ctx.fillStyle = INK_2;
    ctx.textAlign = 'left';
    spacedText('НЕТ ФОТО', px + pw / 2 - spacedWidth('НЕТ ФОТО', 2) / 2, py + ph - 18, 2);
  }
  ctx.restore();

  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);

  // угловые метки вклейки — как на типографских бланках
  const m = 7, L = 11;
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  [[px, py, -1, -1], [px + pw, py, 1, -1], [px, py + ph, -1, 1], [px + pw, py + ph, 1, 1]]
    .forEach(([x, y, dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(x + dx * m, y + dy * (m + L));
      ctx.lineTo(x + dx * m, y + dy * m);
      ctx.lineTo(x + dx * (m + L), y + dy * m);
      ctx.stroke();
    });
}

/* ==================== ШТРИХ-КОД ==================== */
function drawBarcode(x, y, w, h) {
  const rnd = mulberry32(1337);
  ctx.fillStyle = INK;
  let cx = x;
  ctx.fillRect(cx, y, 4, h); cx += 8;
  ctx.fillRect(cx, y, 2, h); cx += 6;
  while (cx < x + w - 16) {
    const bw = 2 + Math.floor(rnd() * 4);
    const gap = 2 + Math.floor(rnd() * 4);
    if (rnd() > .32) ctx.fillRect(cx, y, Math.min(bw, x + w - 16 - cx), h);
    cx += bw + gap;
  }
  ctx.fillRect(x + w - 8, y, 2, h);
  ctx.fillRect(x + w - 4, y, 4, h);
}

/* ==================== ОТРИСОВКА УДОСТОВЕРЕНИЯ ==================== */
function renderCard() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  /* бумага бланка */
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, W, H);

  /* защитная сетка — как на номерных бланках */
  ctx.save();
  ctx.strokeStyle = 'rgba(18,18,18,.035)';
  ctx.lineWidth = 1;
  for (let x = -H; x < W; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
    ctx.stroke();
  }
  ctx.restore();

  /* водяной знак: пришелец */
  drawAlienHead(W * 0.73, H * 0.50, 306, 398, 'rgba(18,18,18,.05)', 'rgba(18,18,18,.016)');

  /* двойная рамка */
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);
  ctx.lineWidth = 1;
  ctx.strokeRect(23.5, 23.5, W - 47, H - 47);

  /* чёрная шапка */
  ctx.fillStyle = INK;
  ctx.fillRect(24, 24, W - 48, 58);

  font(23, '800', SANS);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  spacedText('MEN IN BLACK', 40, 53, 2.6);

  font(8.5, '400', MONO);
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  spacedText('BUREAU OF EXTRATERRESTRIAL AFFAIRS', 40, 70, 1.4);

  font(11, '400', MONO);
  ctx.fillStyle = WHITE;
  spacedTextRight('ФОРМА 051-А', W - 40, 51, 1.4);
  font(8.5, '400', MONO);
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  spacedTextRight('ЛИЧНОЕ ДЕЛО 051', W - 40, 70, 1.4);

  /* значок пришельца в шапке */
  drawAlienHead(858, 53, 26, 34, WHITE, INK);

  /* заголовок документа */
  font(15, '800', SANS);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  spacedText('СЛУЖЕБНОЕ УДОСТОВЕРЕНИЕ АГЕНТА', 40, 106, 1.2);

  font(10, '400', MONO);
  ctx.fillStyle = INK_2;
  spacedTextRight('AGENT IDENTIFICATION', W - 40, 106, 1.8);

  hRule(24, W - 24, 119, INK, 1);

  /* вклейка фотографии */
  const PX = 40, PY = 134, PW = 268, PH = 320;
  drawPhotoBox(PX, PY, PW, PH);

  font(8.5, '400', MONO);
  ctx.fillStyle = INK_2;
  ctx.textAlign = 'left';
  spacedText('ФОТО 4×5', PX, PY + PH + 20, 1.4);
  spacedTextRight('№ ' + state.agentId + '-Ф', PX + PW, PY + PH + 20, 1.4);

  /* графы личного дела */
  const RX = 336, RX2 = W - 40;
  const name = (state.name || 'НЕ УСТАНОВЛЕНО').toUpperCase();
  const codename = (state.codename || '—').toUpperCase();

  const ROWS = [
    ['ФАМИЛИЯ, ИМЯ', name, 16],
    ['ПОЗЫВНОЙ', codename, 16],
    ['ЛИЧНЫЙ НОМЕР', state.agentId, 15],
    ['ПОДРАЗДЕЛЕНИЕ', 'FIELD OPERATIONS', 15],
    ['ВИД / SPECIES', 'НЕ УСТАНОВЛЕН', 15],
    ['ДОПУСК', 'ДОПУЩЕН', 15],
    ['ДЕЛО', '051/' + state.caseCode, 15],
    ['СОБЫТИЕ / EVENT', CONFIG.EVENT_DATE, 14]
  ];
  ROWS.forEach((r, i) => fieldRow(RX, RX2, 148 + i * 36, r[0], r[1], r[2]));

  /* предупреждение */
  const WB_Y = 434, WB_H = 46;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(RX + 0.5, WB_Y + 0.5, RX2 - RX - 1, WB_H);
  ctx.fillStyle = INK;
  ctx.fillRect(RX, WB_Y, 4, WB_H);
  font(9, '400', MONO);
  ctx.fillStyle = INK_2;
  ctx.textAlign = 'left';
  ctx.fillText('ВНИМАНИЕ. При обнаружении инопланетной активности немедленно', RX + 14, WB_Y + 18);
  ctx.fillText('сообщить по внутреннему каналу 051. Разглашение — отзыв допуска.', RX + 14, WB_Y + 34);

  /* печать «допущен» — на свободном поле бланка, справа от предупреждения */
  drawStamp(838, 457, 240, 48, -0.13);

  /* нижний блок */
  hRule(24, W - 24, 496, INK, 1);
  drawBarcode(40, 512, 330, 46);

  font(9, '400', MONO);
  ctx.fillStyle = INK_2;
  spacedText('MIB-' + state.agentId + '/' + state.caseCode, 40, 578, 1.4);
  spacedText('ДЕЙСТВИТЕЛЕН ДО ' + CONFIG.EVENT_DATE, 40, 596, 1.2);

  /* место печати */
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(452, 546, 27, 0, Math.PI * 2);
  ctx.stroke();
  font(10, '400', MONO);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  spacedText('М.П.', 452 - spacedWidth('М.П.', 1.4) / 2, 550, 1.4);
  ctx.restore();

  /* подпись */
  drawSignature(592, 566, 296);
  hRule(560, W - 40, 582, INK, 1);
  font(8.5, '400', MONO);
  ctx.fillStyle = INK_2;
  ctx.textAlign = 'left';
  spacedText('ПОДПИСЬ УПОЛНОМОЧЕННОГО ЛИЦА', 560, 598, 1.4);
  spacedTextRight('AUTHORIZING SIGNATURE', W - 40, 598, 1.4);

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
  // PNG, а не JPEG: у бланка тонкие линейки и пунктиры, JPEG их размывает
  const data = canvas.toDataURL('image/png');
  pdf.addImage(data, 'PNG', 0, 0, CARD_MM_W, CARD_MM_H);
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
let frameArmed = false;
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
      frameArmed = true;
      clearTimeout(waitTimer);
      waitTimer = setTimeout(() => {
        if (!waiting) return;
        endWaiting();
        setStatus('Ответ не получен за 45 секунд. Если письмо не пришло — нажми «Скачать PDF» и отправь карточку вручную.', 'err');
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
  frameArmed = false;
  endWaiting();
  if (d.status === 'sent') {
    setStatus('ACCESS GRANTED // карточка отправлена директору операции. Можешь скачать себе копию.', 'ok');
  } else {
    setStatus('Сбой передачи: ' + (d.message || 'неизвестная ошибка') + ' — скачай PDF и отправь вручную.', 'err');
  }
});

// Запасной сигнал: страница Apps Script загрузилась в iframe — значит запрос дошёл.
// Срабатывает, только если postMessage почему-то не пришёл.
$('sinkFrame').addEventListener('load', () => {
  if (!waiting || !frameArmed) return;
  setTimeout(() => {
    if (!waiting) return;
    endWaiting();
    setStatus('ACCESS GRANTED // карточка передана директору операции. Можешь скачать себе копию.', 'ok');
  }, 900);
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
