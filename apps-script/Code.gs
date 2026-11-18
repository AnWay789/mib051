/**
 * MIB 051 — приём карточек агентов с лендинга на GitHub Pages.
 *
 * Лендинг отправляет обычный POST (никакого CORS не требуется) в это
 * веб-приложение. Скрипт кладёт присланный PDF во вложение и отправляет
 * письмо на RECIPIENT_EMAIL. Итог сообщается странице через postMessage.
 *
 * ── Что нужно сделать один раз ─────────────────────────────────────────
 * 1. Заполнить RECIPIENT_EMAIL ниже.
 * 2. Развернуть как Web app: Execute as = Me, Who has access = Anyone.
 * 3. Скопировать URL /exec в CONFIG.GAS_URL файла assets/app.js.
 * 4. Запустить testSend() в редакторе и убедиться, что письмо дошло.
 * ───────────────────────────────────────────────────────────────────────
 */

var CONFIG = {
  /** Кому уходит готовая карточка. ОБЯЗАТЕЛЬНО поменяй. */
  RECIPIENT_EMAIL: 'ЗАМЕНИ_НА_ПОЧТУ_ДЕВУШКИ@example.com',

  /** Копия. Пусто — без копии. Можно перечислить через запятую. */
  CC_EMAIL: '',

  SUBJECT: 'MIB 051 // НОВЫЙ АГЕНТ',

  /** Тот же ключ должен быть в assets/app.js (CONFIG.SUBMIT_KEY). */
  SUBMIT_KEY: 'mib051-2026-11-21',

  MAX_PDF_BYTES: 8 * 1024 * 1024
};

var SOURCE = 'mib051';
var REPLY_OK = 'sent';
var REPLY_ERROR = 'error';

/* ==================== ТОЧКИ ВХОДА ==================== */

function doPost(e) {
  try {
    var p = (e && e.parameter) || {};

    // ловушка для ботов: скрытое поле не должно быть заполнено
    if (String(p.website || '').trim() !== '') return reply_(REPLY_OK, 'ok');

    if (String(p.key || '') !== CONFIG.SUBMIT_KEY) {
      throw new Error('Неверный ключ доступа.');
    }
    if (!isEmail_(CONFIG.RECIPIENT_EMAIL)) {
      throw new Error('Получатель не настроен: заполни RECIPIENT_EMAIL в Code.gs.');
    }

    var name = clean_(p.name, 40);
    var codename = clean_(p.codename, 24);
    var agentId = clean_(p.agentId, 20);
    var payload = String(p.pdf || '').replace(/\s+/g, '');

    if (!name) throw new Error('Нет имени агента.');
    if (!codename) throw new Error('Нет позывного.');
    if (payload.length < 200) throw new Error('Файл удостоверения не получен.');

    var bytes = Utilities.base64DecodeWebSafe(payload);
    if (bytes.length > CONFIG.MAX_PDF_BYTES) throw new Error('Файл удостоверения слишком большой.');

    var fileName = 'MIB051-' + slug_(codename) + '.pdf';
    var blob = Utilities.newBlob(bytes, 'application/pdf', fileName);

    var options = {
      attachments: [blob],
      htmlBody: buildHtml_(name, codename, agentId)
    };
    if (isEmail_(CONFIG.CC_EMAIL)) options.cc = CONFIG.CC_EMAIL;

    GmailApp.sendEmail(
      CONFIG.RECIPIENT_EMAIL,
      CONFIG.SUBJECT,
      plainBody_(name, codename, agentId),
      options
    );

    Logger.log('Отправлено: ' + codename + ' (' + agentId + '), ' + bytes.length + ' байт');
    return reply_(REPLY_OK, 'ok');
  } catch (err) {
    var message = String((err && err.message) || err);
    Logger.log('Ошибка: ' + message);
    return reply_(REPLY_ERROR, message);
  }
}

function doGet() {
  return HtmlService.createHtmlOutput(
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
    + '<p style="font-family:monospace">MIB 051 endpoint is active.</p>'
    + '</body></html>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ==================== ПРОВЕРКА ==================== */

/** Запусти вручную из редактора: отправит тестовую карточку на RECIPIENT_EMAIL. */
function testSend() {
  if (!isEmail_(CONFIG.RECIPIENT_EMAIL)) {
    Logger.log('Сначала заполни RECIPIENT_EMAIL.');
    return;
  }
  var pdf = '%PDF-1.4\n'
    + '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n'
    + '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n'
    + '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 243 153]>>endobj\n'
    + 'trailer<</Root 1 0 R>>\n%%EOF\n';
  var blob = Utilities.newBlob(pdf, 'application/pdf', 'MIB051-TEST.pdf');
  GmailApp.sendEmail(CONFIG.RECIPIENT_EMAIL, CONFIG.SUBJECT + ' (ТЕСТ)', 'Тестовая отправка.', {
    attachments: [blob],
    htmlBody: buildHtml_('ТЕСТОВЫЙ АГЕНТ', 'TEST RUN', '051-0000')
  });
  Logger.log('Тестовое письмо отправлено на ' + CONFIG.RECIPIENT_EMAIL);
}

/* ==================== ВНУТРЕННЕЕ ==================== */

function reply_(status, message) {
  var data = JSON.stringify({
    source: SOURCE,
    status: status,
    message: String(message || '').slice(0, 300)
  });
  // HtmlService отдаёт нашу страницу внутри вложенного iframe песочницы Google,
  // поэтому сообщение шлём в window.top — это и есть страница лендинга.
  var script = '(function(){var m=' + data + ';'
    + 'function shout(w){try{if(w)w.postMessage(m,"*");}catch(e){}}'
    + 'shout(window.top);'
    + 'if(window.parent!==window.top)shout(window.parent);'
    + '})();';
  var html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
    + '<p style="font-family:monospace;color:#333">MIB 051 // ' + status + '</p>'
    + '<script>' + script + '</' + 'script>'
    + '</body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function buildHtml_(name, codename, agentId) {
  return ''
    + '<div style="font-family:Arial,Helvetica,sans-serif;background:#0a0e0b;color:#eef2ea;padding:30px">'
    + '<div style="font-family:monospace;color:#b7ff72;letter-spacing:.2em;font-size:12px;margin-bottom:22px">'
    + 'MIB // INTERNAL NETWORK</div>'
    + '<div style="color:#8b978c;font-size:12px;letter-spacing:.12em">НОВЫЙ АГЕНТ ЗАРЕГИСТРИРОВАН</div>'
    + '<div style="font-size:24px;font-weight:bold;margin:10px 0 2px">' + esc_(name) + '</div>'
    + '<div style="font-family:monospace;color:#b7ff72;font-size:19px">' + esc_(codename) + '</div>'
    + '<div style="font-family:monospace;color:#8b978c;font-size:13px;margin-top:18px">'
    + 'AGENT ID: ' + esc_(agentId) + '<br>CASE FILE: 051</div>'
    + '<div style="color:#9aa69b;font-size:14px;margin-top:24px">Удостоверение — во вложении.</div>'
    + '</div>';
}

function plainBody_(name, codename, agentId) {
  return 'MIB 051 // НОВЫЙ АГЕНТ\n\n'
    + 'Имя: ' + name + '\n'
    + 'Позывной: ' + codename + '\n'
    + 'Agent ID: ' + agentId + '\n\n'
    + 'Удостоверение — во вложении.';
}

function clean_(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slug_(value) {
  var s = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 40) || 'agent';
}

function isEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}
