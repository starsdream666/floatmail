const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const DIR = join(__dirname, '..');
const source = readFileSync(join(DIR, 'popup.js'), 'utf8');

// 这些是 popup.js 依赖的顶层常量。曾因为一次编辑误删 DEFAULT_TRANSLATION_API_BASE
// 和 fetchTranslationModelsBtn，导致 DOMContentLoaded 里抛 ReferenceError，
// 后面所有 addEventListener 都绑不上 —— 症状就是「所有按钮点不动」。
// 这组测试就是专门守住这类误伤的。
const REQUIRED_CONSTS = [
  'DEFAULT_TRANSLATION_API_BASE',
  'DEFAULT_TRANSLATION_TARGET_LANGUAGE',
  'DEFAULT_MAIL_INSIGHT_API_MODE',
  'DEFAULT_JEV_ENDPOINT_PATH',
  'DEFAULT_JEV_MODEL',
  'JEV_LINK_THRESHOLD',
  'JEV_MAX_CANDIDATES',
  'INSIGHT_MAX_ITEMS',
  'INSIGHT_CODE_MIN_SCORE',
  'INSIGHT_LINK_MIN_SCORE',
  'MAX_TRANSLATION_SOURCE_CHARS',
  'AI_REQUEST_TIMEOUT_MS',
  'INTERACTIVE_REQUEST_TIMEOUT_MS'
];

const REQUIRED_DOM_REFS = [
  'translationApiBaseInput',
  'translationApiKeyInput',
  'translationModelInput',
  'translationTargetLanguageInput',
  'mailInsightApiModeSelect',
  'mailInsightCustomApiFields',
  'mailInsightApiBaseInput',
  'mailInsightApiKeyInput',
  'mailInsightModelInput',
  'fetchTranslationModelsBtn',
  'translationModelSelect',
  'fetchInsightModelsBtn',
  'mailInsightModelSelect',
  'jevEnabledToggle',
  'jevSettingsFields',
  'jevApiBaseInput',
  'jevApiKeyInput',
  'jevEndpointPathInput',
  'jevModelInput',
  'generatedResultAutoCloseSecondsInput',
  'siteAccessModeSelect'
];

test('所有必需的顶层常量都已声明', () => {
  const missing = REQUIRED_CONSTS.filter(
    (name) => !new RegExp(`^  const ${name}\\s*=`, 'm').test(source)
  );
  assert.deepEqual(missing, [], `缺少声明: ${missing.join(', ')}`);
});

test('所有必需的 DOM 引用都已声明', () => {
  const missing = REQUIRED_DOM_REFS.filter(
    (name) => !new RegExp(`^  const ${name}\\s*=`, 'm').test(source)
  );
  assert.deepEqual(missing, [], `缺少声明: ${missing.join(', ')}`);
});

test('被引用但从未声明的顶层常量（防误删）', () => {
  const declared = new Set();
  for (const m of source.matchAll(/^  (?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);
  for (const m of source.matchAll(/^  (?:async )?function\s+([A-Za-z_$][\w$]*)/gm)) declared.add(m[1]);

  // 只看「常量式」引用。先剥掉注释与字符串字面量，否则字符串里的错误码
  // （'MAILBOX_NOT_FOUND' / 'CAPABILITY_MISSING' 这类）会被误判成未声明常量，
  // 而中文注释里的词（如 preview…REVIEW）也会造成假阳性。
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')  // 行注释（保留 http:// 里的 //）
    .replace(/`(?:\\.|[^`\\])*`/g, '``')    // 模板字符串
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")  // 单引号字符串
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""'); // 双引号字符串

  const IGNORE = new Set([
    'DOMContentLoaded', 'JSON', 'URL', 'URLSearchParams', 'API', 'HTTP', 'HTTPS', 'HTML', 'CSS',
    'MIME', 'UTF', 'SPA', 'UUID', 'TTL', 'CORS', 'XHR', 'NONE', 'RFC', 'POST', 'GET', 'PUT', 'HEAD',
    'PERF', 'SAVE20', 'XXXXX', 'CONTENT', 'TYPE', 'TRANSFER', 'ENCODING', 'VERSION', 'BOUNDARY', 'DELETE'
  ]);
  const suspects = new Set();
  for (const m of stripped.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) {
    const name = m[1];
    if (!declared.has(name) && !IGNORE.has(name)) suspects.add(name);
  }
  assert.deepEqual([...suspects].sort(), [], `这些常量被引用但没声明: ${[...suspects].join(', ')}`);
});

// ---- 真正的回归防线：完整加载 + 触发 DOMContentLoaded ----
function loadPopup() {
  const listeners = [];
  const domReady = [];
  function makeEl(id) {
    return {
      id, style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
      checked: false, disabled: false, hidden: false, type: '', name: '', href: '', src: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener() { listeners.push(id); },
      removeEventListener() {}, appendChild(c) { this.children.push(c); return c; },
      insertBefore(c) { this.children.push(c); return c; }, removeChild() {}, remove() {},
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; }, focus() {}, blur() {}, click() {}, contains() { return false; },
      scrollIntoView() {}, dispatchEvent() { return true; }, insertAdjacentElement() { return null; },
      getElementsByTagName() { return []; },
      getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
      cloneNode() { return makeEl(id); }, replaceChildren() {},
      parentElement: null, parentNode: null, files: [], accept: '', multiple: false,
      options: [], selectedIndex: 0
    };
  }
  const cache = new Map();
  const document = {
    getElementById(id) { if (!cache.has(id)) cache.set(id, makeEl(id)); return cache.get(id); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(t) { return makeEl('el:' + t); },
    createDocumentFragment() { return makeEl('frag'); },
    addEventListener(type, fn) { if (type === 'DOMContentLoaded') domReady.push(fn); },
    removeEventListener() {}, body: makeEl('body'), head: makeEl('head'),
    documentElement: makeEl('html'), activeElement: null, readyState: 'complete',
    createTextNode(t) { return { textContent: t }; }
  };
  const noopStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const scope = {
    document, console,
    window: { addEventListener() {}, removeEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }) },
    location: { href: 'chrome-extension://x/popup.html', search: '', hash: '' },
    navigator: { userAgent: 'node', languages: ['zh-CN'], clipboard: { writeText: async () => {} } },
    localStorage: noopStorage, sessionStorage: noopStorage,
    chrome: {
      storage: {
        local: {
          get(_k, cb) { if (typeof cb === 'function') cb({}); else return Promise.resolve({}); },
          set(_o, cb) { if (typeof cb === 'function') cb(); else return Promise.resolve(); }
        },
        onChanged: { addListener() {} }
      },
      runtime: { sendMessage(_m, cb) { if (typeof cb === 'function') cb({ ok: true }); },
        lastError: null, getURL: (p) => 'chrome-extension://x/' + p, id: 'x', onMessage: { addListener() {} } },
      tabs: { query(_q, cb) { if (typeof cb === 'function') cb([]); },
        sendMessage(_i, _m, cb) { if (typeof cb === 'function') cb({ ok: true }); } },
      alarms: { create() {}, clear() {}, onAlarm: { addListener() {} } },
      notifications: { create() {}, onClicked: { addListener() {} } },
      scripting: { executeScript() { return Promise.resolve([]); } },
      permissions: { contains(_p, cb) { if (cb) cb(true); } }
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    fetch: () => Promise.reject(new Error('stub: no network in test')),
    URL, URLSearchParams, AbortController, TextDecoder, TextEncoder, atob, btoa,
    Blob: class {}, DOMException: class extends Error {},
    DOMParser: class { parseFromString() { return { querySelectorAll: () => [], querySelector: () => null,
      documentElement: { outerHTML: '' }, body: { textContent: '' } }; } },
    MutationObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    crypto: { randomUUID: () => 'uuid-0000' },
    structuredClone: (v) => v,
    IntersectionObserver: class { observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    FileReader: class { readAsText() {} },
    confirm: () => true, alert: () => {}, prompt: () => null
  };
  scope.globalThis = scope;
  scope.self = scope;
  scope.window.chrome = scope.chrome;
  scope.window.location = scope.location;
  scope.window.document = scope.document;
  scope.window.navigator = scope.navigator;
  scope.window.localStorage = scope.localStorage;

  // 按 popup.html 的 <script> 顺序加载
  const files = ['shared-utils.js', 'popup-modules/mail-render.js',
    'popup-modules/mail-inbox-controller.js', 'popup-modules/config-io.js',
    'popup-modules/tool-generators.js', 'popup.js'];
  for (const f of files) {
    runInNewContext(readFileSync(join(DIR, f), 'utf8'), scope, { filename: f });
  }
  return { scope, domReady, listeners };
}

test('popup 完整加载并按 DOMContentLoaded 初始化，且绑上监听器', async () => {
  const { domReady, listeners } = loadPopup();
  assert.ok(domReady.length > 0, '应捕获到 DOMContentLoaded 回调');
  for (const fn of domReady) {
    await fn();   // 这里抛出任何 ReferenceError/TypeError 都会让测试失败
  }
  assert.ok(listeners.length > 20,
    `初始化后应绑上大量监听器（实际 ${listeners.length}）—— 太少说明中途抛错，按钮会点不动`);
});
