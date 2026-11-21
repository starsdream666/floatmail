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
  'aiSettingsPage',
  'saveAiSettingsBtn',
  'aiSettingsMessage',
  'aiConnectionTester',
  'testTranslationApiBtn',
  'testInsightApiBtn',
  'testJevApiBtn',
  'testClefAccountsBtn',
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
  'mailInsightExtractionModeSelect',
  'insightJudgeSettings',
  'insightJudgeBackendSelect',
  'clefSettingsFields',
  'clefAccountsList',
  'clefAddAccountButton',
  'clefAccountsEditor',
  'clefModelSelect',
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

  // 只看「常量式」引用，并排除正则/字符串字面量与外部 API 名。
  // 只看「常量式」引用，并排除正则/字符串字面量与外部 API 名。
  const IGNORE = new Set([
    'DOMContentLoaded', 'JSON', 'URL', 'URLSearchParams', 'API', 'HTTP', 'HTTPS', 'HTML', 'CSS',
    'MIME', 'UTF', 'SPA', 'UUID', 'TTL', 'CORS', 'XHR', 'NONE', 'RFC', 'POST', 'GET', 'PUT', 'HEAD',
    'PERF', 'SAVE20', 'XXXXX', 'CONTENT', 'TYPE', 'TRANSFER', 'ENCODING', 'VERSION', 'BOUNDARY', 'DELETE',
    // SSE 结束标记（流式响应里的 data: [DONE]），不是项目常量。
    'DONE'
  ]);
  const suspects = new Set();
  for (const m of source.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) {
    const name = m[1];
    if (!declared.has(name) && !IGNORE.has(name)) suspects.add(name);
  }
  assert.deepEqual([...suspects].sort(), [], `这些常量被引用但没声明: ${[...suspects].join(', ')}`);
});

// ---- 真正的回归防线：完整加载 + 触发 DOMContentLoaded ----
function loadPopup(initial = {}) {
  const listeners = [];
  const domReady = [];
  const store = { ...initial };
  const storageChanges = [];
  let tabButtons = [];
  function makeEl(id) {
    const classes = new Set();
    const handlers = {};
    return {
      id, style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
      checked: false, disabled: false, hidden: false, type: '', name: '', href: '', src: '',
      handlers,
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        toggle(name, force) { const enabled = force ?? !classes.has(name); if (enabled) classes.add(name); else classes.delete(name); return enabled; },
        contains(name) { return classes.has(name); }
      },
      addEventListener(type, fn) {
        const previous = handlers[type];
        handlers[type] = previous ? (...args) => { const result = previous(...args); return fn(...args) ?? result; } : fn;
        listeners.push(id);
      },
      removeEventListener() {}, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((child) => child !== c); c.parentNode = null; return c; },
      remove() { this.parentNode?.removeChild(this); },
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      querySelector(selector) {
        const match = selector.match(/^\[data-tab="([^"]+)"\]$/);
        return this.id === 'tab-bar' && match ? tabButtons.find((button) => button.dataset.tab === match[1]) || null : null;
      },
      querySelectorAll(selector) { return this.id === 'tab-bar' && selector === '.tab-btn' ? tabButtons : []; },
      closest() { return null; }, focus() {}, blur() {}, click() {}, contains() { return false; },
      scrollIntoView() {}, dispatchEvent() { return true; }, insertAdjacentElement() { return null; },
      getElementsByTagName() { return []; },
      getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
      cloneNode() { return makeEl(id); }, replaceChildren(...children) { this.children = children; children.forEach((c) => { c.parentNode = this; }); },
      parentElement: null, parentNode: null, files: [], accept: '', multiple: false,
      options: [], selectedIndex: 0
    };
  }
  const cache = new Map();
  const html = readFileSync(join(DIR, 'popup.html'), 'utf8');
  tabButtons = Array.from(html.matchAll(/<button class="tab-btn[^\"]*" data-tab="([^\"]+)" data-title="([^\"]+)" data-subtitle="([^\"]+)"/g), (match) => {
    const button = makeEl(`tab:${match[1]}`);
    button.dataset = { tab: match[1], title: match[2], subtitle: match[3] };
    return button;
  });
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
          get(_k, cb) { if (typeof cb === 'function') cb({ ...store }); else return Promise.resolve({ ...store }); },
          set(items, cb) { Object.assign(store, items); if (typeof cb === 'function') cb(); else return Promise.resolve(); }
        },
        onChanged: { addListener(fn) { storageChanges.push(fn); } }
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
    URL, URLSearchParams, AbortController, TextDecoder, TextEncoder, Response, atob, btoa,
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
    'popup-modules/clef-insight.js',
    'popup-modules/ai-connection-test.js',
    'popup-modules/clef-accounts.js',
    'popup-modules/tool-generators.js', 'popup.js'];
  for (const f of files) {
    runInNewContext(readFileSync(join(DIR, f), 'utf8'), scope, { filename: f });
  }
  let clefEditor;
  const createEditor = scope.window.PopupClefAccounts.createEditor;
  scope.window.PopupClefAccounts.createEditor = (...args) => { clefEditor = createEditor(...args); return clefEditor; };
  return { scope, domReady, listeners, store, storageChanges, tabButtons, get clefEditor() { return clefEditor; },
    element: (id) => document.getElementById(id) };
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

async function initializedPopup(initial) {
  const env = loadPopup(initial);
  for (const fn of env.domReady) await fn();
  await new Promise((resolve) => setImmediate(resolve));
  return env;
}

const settleMailPopup = () => new Promise(resolve => setImmediate(resolve));
function changeMailConfig(env, values) {
  const changes = Object.fromEntries(Object.entries(values).map(([key, newValue]) => [key, { oldValue: env.store[key], newValue }]));
  Object.assign(env.store, values);
  env.storageChanges.forEach(callback => callback(changes, 'local'));
}
async function mailRacePopup(initial = {}, respond = () => null) {
  const env = loadPopup({ activeTab: 'settings', ...initial });
  const batches = [];
  const inboxes = [];
  const module = env.scope.window.PopupMailInboxController;
  const createBatch = module.createBatchSelectionController;
  const createInbox = module.createInboxController;
  module.createBatchSelectionController = options => { batches.push(options); return createBatch(options); };
  module.createInboxController = options => {
    const instance = createInbox(options);
    inboxes.push({ ...options, instance });
    return instance;
  };
  env.scope.chrome.runtime.sendMessage = (message, callback) => {
    if (respond(message, callback, env) === true) return;
    const data = message.type === 'get-moe-config' ? { emailDomains: 'example.test' }
      : message.type === 'get-temp-domains' ? { domains: ['example.test'] }
      : message.type === 'get-moe-email-list' ? { emails: [] } : {};
    callback({ ok: true, data });
  };
  for (const callback of env.domReady) await callback();
  await settleMailPopup();
  return { ...env, batches, inboxes };
}
const moeListResponse = address => ({ ok: true, data: { emails: [{ id: address, address, expiresAt: '9999-01-01' }] } });

test('Moe 列表切换服务后立即加载新配置，旧响应晚到不能覆盖新缓存', async () => {
  const pending = [];
  const env = await mailRacePopup({ activeTab: 'moe-mail', moeApiUrl: 'https://old.test', moeApiKey: 'key-a' }, (message, callback) => {
    if (message.type === 'get-moe-email-list') { pending.push(callback); return true; }
  });
  assert.equal(pending.length, 1);
  changeMailConfig(env, { moeApiUrl: 'https://new.test' });
  await settleMailPopup();
  assert.equal(pending.length, 2);
  pending[1](moeListResponse('new@example.test'));
  await settleMailPopup();
  pending[0](moeListResponse('old@example.test'));
  await settleMailPopup();
  assert.equal(env.store.moeEmailCache[0].address, 'new@example.test');
});

test('Moe 仅换 Key 并切回原 Key 时也不复用旧请求，迟到错误不覆盖成功结果', async () => {
  const pending = [];
  const env = await mailRacePopup({ activeTab: 'moe-mail', moeApiUrl: 'https://moe.test', moeApiKey: 'key-a' }, (message, callback) => {
    if (message.type === 'get-moe-email-list') { pending.push(callback); return true; }
  });
  changeMailConfig(env, { moeApiKey: 'key-b' }); await settleMailPopup();
  changeMailConfig(env, { moeApiKey: 'key-a' }); await settleMailPopup();
  assert.equal(pending.length, 3);
  pending[0](moeListResponse('old-a@example.test')); await settleMailPopup();
  assert.equal(env.store.moeEmailCache, undefined);
  pending[2](moeListResponse('latest-a@example.test')); await settleMailPopup();
  pending[1]({ ok: false, error: 'stale failure' }); await settleMailPopup();
  assert.equal(env.store.moeEmailCache[0].address, 'latest-a@example.test');
  assert.ok(!env.element('moe-email-list').children.some(child => child.textContent.includes('stale failure')));
});

test('Moe 强制刷新不搭车旧的普通请求，普通请求不能覆盖刷新结果', async () => {
  const pending = [];
  const env = await mailRacePopup({ activeTab: 'moe-mail', moeApiUrl: 'https://moe.test', moeApiKey: 'key' }, (message, callback) => {
    if (message.type === 'get-moe-email-list') { pending.push({ message, callback }); return true; }
  });
  const refreshing = env.element('moe-refresh-btn').handlers.click();
  await settleMailPopup();
  assert.equal(pending.length, 2);
  assert.equal(pending[1].message.forceRefresh, true);
  pending[1].callback(moeListResponse('fresh@example.test')); await refreshing;
  pending[0].callback(moeListResponse('old@example.test')); await settleMailPopup();
  assert.equal(env.store.moeEmailCache[0].address, 'fresh@example.test');
});

test('切换到没有邮箱的服务也会清空持久化缓存，不能保留上一服务的邮箱', async () => {
  const env = await mailRacePopup({ activeTab: 'moe-mail', moeApiUrl: 'https://old.test', moeApiKey: 'key' }, (message, callback, popup) => {
    if (message.type === 'get-moe-email-list') {
      callback(popup.store.moeApiUrl === 'https://old.test' ? moeListResponse('old@example.test') : { ok: true, data: { emails: [] } });
      return true;
    }
  });
  assert.equal(env.store.moeEmailCache.length, 1);
  changeMailConfig(env, { moeApiUrl: 'https://empty.test' }); await settleMailPopup();
  assert.deepEqual(env.store.moeEmailCache, []);
});

test('Moe 刷新返回错误结构时保留已有缓存并显示失败，不当作空列表成功', async () => {
  let malformed = false;
  const env = await mailRacePopup({ activeTab: 'moe-mail', moeApiUrl: 'https://moe.test', moeApiKey: 'key' }, (message, callback) => {
    if (message.type === 'get-moe-email-list') {
      callback(malformed ? { ok: true, data: { emails: {} } } : moeListResponse('saved@example.test'));
      return true;
    }
  });
  malformed = true;
  await env.element('moe-refresh-btn').handlers.click();
  assert.equal(env.store.moeEmailCache[0].address, 'saved@example.test');
  assert.ok(env.element('moe-email-list').children.some(child => /加载失败.*emails/.test(child.textContent)));
});

test('快填同一来源切换 API 后只展示新域名，旧请求结束不清掉新请求', async () => {
  const pending = [];
  const env = await mailRacePopup({ activeTab: 'fast-fill', apiUrl: 'https://old.test', adminToken: 'key' }, (message, callback) => {
    if (message.type === 'get-temp-domains') { pending.push(callback); return true; }
  });
  assert.equal(pending.length, 1);
  changeMailConfig(env, { apiUrl: 'https://new.test' }); await settleMailPopup();
  assert.equal(pending.length, 2);
  pending[0]({ ok: true, data: { domains: ['old.test'] } }); await settleMailPopup();
  pending[1]({ ok: true, data: { domains: ['new.test'] } }); await settleMailPopup();
  const values = env.element('fast-fill-domain-select').children.map(child => child.value);
  assert.ok(values.includes('new.test'));
  assert.ok(!values.includes('old.test'));
});

test('Temp 批量删邮箱等待查询时换配置，取消剩余请求且不清本地历史', async () => {
  const env = await mailRacePopup({ apiUrl: 'https://old.test', adminToken: 'old-key', emailHistory: ['a@test', 'b@test'] });
  let release;
  const calls = [];
  env.scope.fetch = (url, init) => { calls.push({ url, init }); return new Promise(resolve => { release = resolve; }); };
  const deleting = env.batches[0].deleteSelected(new Set(['a@test', 'b@test']));
  changeMailConfig(env, { apiUrl: 'https://new.test', adminToken: 'new-key' });
  release(new Response(JSON.stringify({ results: [{ id: 7, address: 'a@test' }] }), { status: 200 }));
  await deleting;
  assert.equal(calls.length, 1);
  assert.deepEqual(env.store.emailHistory, ['a@test', 'b@test']);
});

test('Temp 批量删邮件过程中换配置，后续 ID 不发送到新后端', async () => {
  const env = await mailRacePopup({ apiUrl: 'https://old.test', adminToken: 'old-key' });
  let release;
  const calls = [];
  env.scope.fetch = (url, init) => { calls.push({ url, init }); return new Promise(resolve => { release = resolve; }); };
  const deleting = env.inboxes.find(inbox => inbox.adapter.type === 'temp').batch.deleteSelected(new Set([1, 2]));
  changeMailConfig(env, { apiUrl: 'https://new.test', adminToken: 'new-key' });
  release(new Response(null, { status: 204 }));
  await deleting;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://old.test/admin/mails/1');
  assert.equal(calls[0].init.headers['x-admin-auth'], 'old-key');
});

test('Moe 批量删邮箱过程中换配置，停止剩余 DELETE 和未读清理', async () => {
  const calls = [];
  let release;
  const env = await mailRacePopup({ moeApiUrl: 'https://old.test', moeApiKey: 'old-key' }, (message, callback) => {
    calls.push(message);
    if (message.type === 'proxy-fetch') { release = callback; return true; }
  });
  const deleting = env.batches[1].deleteSelected(new Set(['a', 'b']));
  changeMailConfig(env, { moeApiUrl: 'https://new.test', moeApiKey: 'new-key' });
  release({ ok: true, data: { ok: true, status: 204, text: '' } });
  await deleting;
  assert.equal(calls.filter(message => message.type === 'proxy-fetch').length, 1);
  assert.equal(calls.filter(message => message.type === 'remove-mail-state').length, 0);
});

test('换配置后关闭旧邮件视图，旧邮件删除按钮不能使用新服务', async () => {
  const env = await mailRacePopup({ activeTab: 'temp-email', apiUrl: 'https://old.test', adminToken: 'old-key' });
  let requestCount = 0;
  env.scope.fetch = async url => {
    requestCount++;
    const data = url.includes('?') ? { results: [{ id: 7, subject: 'test', source: 'sender@test' }] }
      : { id: 7, raw: 'Content-Type: text/plain\n\nhello' };
    return new Response(JSON.stringify(data), { status: 200 });
  };
  const controller = env.inboxes.find(inbox => inbox.adapter.type === 'temp');
  // 通过真实收件箱入口建立旧视图，之后检查配置变更触发的关闭与按钮处理器。
  controller.instance.open('a@test'); await settleMailPopup();
  env.element('mail-list').children.at(-1).handlers.click(); await settleMailPopup();
  assert.equal(controller.instance.getMode(), 'detail');
  assert.equal(env.element('inbox-pane').classList.contains('hidden'), false);
  changeMailConfig(env, { apiUrl: 'https://new.test' });
  assert.equal(env.element('inbox-pane').classList.contains('hidden'), true);
  const count = requestCount;
  await env.element('delete-mail-btn').handlers.click();
  assert.equal(requestCount, count);
});

test('Moe 创建接口返回 HTML 或缺少邮箱字段时显示失败，合法响应仍可成功', async () => {
  let text = '<html>Login required</html>';
  const env = await mailRacePopup({ moeApiUrl: 'https://moe.test', moeApiKey: 'key' }, (message, callback) => {
    if (message.type === 'proxy-fetch') { callback({ ok: true, data: { ok: true, status: 200, text } }); return true; }
  });
  env.element('moe-domain-select').value = 'example.test';
  env.element('moe-expiry-select').value = '86400000';
  for (const invalid of [text, '{}', '{"email":123}', 'null']) {
    text = invalid;
    await env.element('moe-create-btn').handlers.click();
    assert.match(env.element('moe-create-message').textContent, /创建失败/);
    assert.doesNotMatch(env.element('moe-create-message').textContent, /创建成功/);
  }
  text = '{"email":"new@example.test"}';
  await env.element('moe-create-btn').handlers.click();
  assert.equal(env.element('moe-create-message').textContent, '创建成功: new@example.test');
});

function clefRow(env, index = 0) {
  const card = env.element('clef-accounts-list').children[index];
  return { card, name: card.children[1], accountId: card.children[2], apiToken: card.children[3], status: card.children[4],
    remove: card.children[0].children[1], testButton: card.children[5] };
}

test('旧 JEV 配置迁移到判定下拉选项，仅 AI 模式隐藏整块判定设置', async () => {
  const env = await initializedPopup({ jevEnabled: true });
  assert.equal(env.element('mail-insight-judge-backend').value, 'jev');
  assert.equal(env.element('jev-settings-fields').classList.contains('hidden'), false);
  const mode = env.element('mail-insight-extraction-mode');
  mode.value = 'ai-only';
  mode.handlers.change();
  assert.equal(env.element('mail-insight-judge-settings').classList.contains('hidden'), true);
  mode.value = 'ai-judge';
  mode.handlers.change();
  assert.equal(env.element('mail-insight-judge-settings').classList.contains('hidden'), false);
});

test('Clef 与提取方式保存后可重新加载，并在另一个面板通过 storage 同步', async () => {
  const env = await initializedPopup({ mailInsightApiMode: 'custom', mailInsightApiBase: 'https://ai.example.test/v1',
    mailInsightApiKey: 'test-ai-key', mailInsightModel: 'test-model' });
  env.element('mail-insight-extraction-mode').value = 'ai-judge';
  env.element('mail-insight-extraction-mode').handlers.change();
  env.element('mail-insight-judge-backend').value = 'clef';
  env.element('mail-insight-judge-backend').handlers.change();
  assert.equal(env.element('clef-settings-fields').classList.contains('hidden'), false);
  assert.equal(env.element('jev-settings-fields').classList.contains('hidden'), true);
  clefRow(env).accountId.value = 'a'.repeat(32);
  clefRow(env).apiToken.value = 'test-clef-token';
  env.element('clef-model').value = 'clef-flash';
  await env.element('save-ai-settings').handlers.click();
  assert.equal(env.store.mailInsightJudgeBackend, 'clef');
  assert.equal(env.store.mailInsightExtractionMode, 'ai-judge');
  assert.equal(env.store.clefAccounts[0].apiToken, 'test-clef-token');
  assert.equal(env.store.clefApiToken, '');
  assert.equal(env.store.jevEnabled, false);
  const reloaded = await initializedPopup(env.store);
  assert.equal(reloaded.element('clef-model').value, 'clef-flash');
  assert.equal(reloaded.element('mail-insight-extraction-mode').value, 'ai-judge');
  reloaded.storageChanges.forEach((fn) => fn({ mailInsightExtractionMode: { newValue: 'ai-only' } }, 'local'));
  assert.equal(reloaded.element('mail-insight-judge-settings').classList.contains('hidden'), true);
});

test('Clef 导入值校验与默认密钥脱敏已登记', () => {
  const scope = { window: {}, URL };
  const configSource = readFileSync(join(DIR, 'popup-modules/config-io.js'), 'utf8');
  runInNewContext(configSource.replace('window.PopupConfigIO = {',
    'window.PopupConfigIO = { validateImportValue, maskSecretValue, isRedactedSecretValue,'), scope);
  const io = scope.window.PopupConfigIO;
  assert.ok(io.SECRET_KEYS.has('clefApiToken'));
  assert.ok(io.CATEGORY_KEYS.mailDisplay.includes('clefApiToken'));
  for (const [key, value] of [['mailInsightExtractionMode', 'ai-judge'], ['mailInsightJudgeBackend', 'clef'],
    ['clefAccountId', 'a'.repeat(32)], ['clefModel', 'clef-flash'], ['activeTab', 'ai-settings']]) {
    assert.equal(io.validateImportValue(key, value), true);
  }
  assert.equal(io.validateImportValue('clefModel', 'arbitrary-model'), false);
  assert.equal(io.validateImportValue('mailInsightJudgeBackend', 'other'), false);
  assert.equal(io.validateImportValue('clefAccountId', '../other-account'), false);
  const tokenText = 'sample-clef-token-only-for-test\nsecond-clef-token-only-for-test';
  assert.equal(io.validateImportValue('clefApiToken', tokenText), true);
  const masked = io.maskSecretValue(tokenText);
  assert.equal(io.isRedactedSecretValue(masked), true);
  tokenText.split('\n').forEach((token) => assert.ok(!JSON.stringify(masked).includes(token)));
});

test('Clef 旧多 Key 迁移为绑定账号，添加删除后保存重载与跨面板同步', async () => {
  const env = await initializedPopup({ mailInsightJudgeBackend: 'clef', clefAccountId: 'a'.repeat(32),
    clefApiToken: ' token-a \r\n token-b\n token-a ' });
  assert.equal(env.element('clef-accounts-list').children.length, 2);
  assert.equal(clefRow(env).accountId.value, 'a'.repeat(32));
  assert.equal(clefRow(env).apiToken.value, 'token-a');
  assert.equal(clefRow(env, 1).apiToken.value, 'token-b');
  env.element('clef-add-account').handlers.click();
  clefRow(env, 2).name.value = '备用账号';
  clefRow(env, 2).accountId.value = 'b'.repeat(32);
  clefRow(env, 2).apiToken.value = 'token-c';
  clefRow(env, 1).remove.handlers.click();
  await env.element('save-ai-settings').handlers.click();
  assert.equal(env.store.clefAccounts.length, 2);
  assert.equal(env.store.clefAccounts[1].accountId, 'b'.repeat(32));
  assert.equal(env.store.clefAccounts[1].apiToken, 'token-c');
  assert.equal(env.store.clefAccounts[1].name, '备用账号');
  assert.equal(env.store.clefApiToken, '');
  const reloaded = await initializedPopup(env.store);
  assert.equal(clefRow(reloaded, 1).apiToken.value, 'token-c');
  const next = [{ id: 'other-account', accountId: 'c'.repeat(32), apiToken: 'token-d', name: '另一个账号' }];
  reloaded.storageChanges.forEach((fn) => fn({ clefAccounts: { newValue: next } }, 'local'));
  assert.equal(clefRow(reloaded).accountId.value, 'c'.repeat(32));
  assert.equal(clefRow(reloaded).apiToken.type, 'password');
  assert.equal(clefRow(reloaded).apiToken.value, 'token-d');
});

test('删光账号后显式保存空池，旧字段不会使账号复活', async () => {
  const env = await initializedPopup({ clefAccountId: 'a'.repeat(32), clefApiToken: 'old-token' });
  clefRow(env).remove.handlers.click();
  await env.element('save-ai-settings').handlers.click();
  assert.equal(env.store.clefAccounts.length, 0);
  const reloaded = await initializedPopup({ ...env.store, clefAccountId: 'a'.repeat(32), clefApiToken: 'stale-token' });
  assert.equal(clefRow(reloaded).apiToken.value, '');
});

test('失败和成功状态显示在对应账号下，编辑 Key 后忽略旧请求状态', async () => {
  const accounts = [
    { id: 'one', name: '主账号', accountId: 'a'.repeat(32), apiToken: 'private-one' },
    { id: 'two', name: '备用账号', accountId: 'b'.repeat(32), apiToken: 'private-two' }
  ];
  const env = await initializedPopup({ clefAccounts: accounts });
  let calls = 0;
  let failure;
  await env.scope.window.PopupClefInsight.request({}, 'x', { accounts }, {
    request: async () => {
      const status = ++calls === 1 ? 403 : 200;
      return { ok: status === 200, status, json: async () => ({ success: status === 200, result: { answers: {} } }) };
    },
    onAccountFailure(account) { failure = account; env.clefEditor.setAccountStatus(account, false); },
    onAccountSuccess(account) { env.clefEditor.setAccountStatus(account, true); }
  });
  const index = accounts.findIndex((account) => account.id === failure.id);
  assert.match(clefRow(env, index).status.textContent, /403/);
  assert.match(clefRow(env, 1 - index).status.textContent, /成功/);
  const row = clefRow(env, index);
  row.apiToken.value = 'replacement-key';
  row.apiToken.handlers.input();
  env.clefEditor.setAccountStatus(failure, false);
  assert.equal(row.status.classList.contains('hidden'), true);
});

test('半填账号阻止保存，不能把 Key 偷配给其他 ID', async () => {
  const env = await initializedPopup();
  clefRow(env).apiToken.value = 'unpaired-key';
  await env.element('save-ai-settings').handlers.click();
  assert.equal(env.store.clefAccounts, undefined);
});

test('旧字段变动不会覆盖已经保存的新账号池', async () => {
  const env = await initializedPopup({ clefAccounts: [
    { id: 'saved', accountId: 'a'.repeat(32), apiToken: 'saved-key', name: '已保存账号' }
  ] });
  env.storageChanges.forEach((fn) => fn({ clefAccountId: { newValue: '' }, clefApiToken: { newValue: '' } }, 'local'));
  assert.equal(clefRow(env).accountId.value, 'a'.repeat(32));
  assert.equal(clefRow(env).apiToken.value, 'saved-key');
});

test('AI 标签可以切换、恢复，并保留切换前的未保存草稿', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings' });
  assert.equal(env.element('ai-settings-page').classList.contains('hidden'), false);
  assert.equal(env.element('settings-page').classList.contains('hidden'), true);
  assert.equal(env.element('main-title').textContent, 'AI 配置');
  env.element('translation-model').value = 'unsaved-model';
  env.tabButtons.find((button) => button.dataset.tab === 'settings').handlers.click();
  assert.equal(env.element('ai-settings-page').classList.contains('hidden'), true);
  assert.equal(env.element('settings-page').classList.contains('hidden'), false);
  env.tabButtons.find((button) => button.dataset.tab === 'ai-settings').handlers.click();
  assert.equal(env.element('translation-model').value, 'unsaved-model');
  assert.equal(env.store.activeTab, 'ai-settings');
  const reloaded = await initializedPopup(env.store);
  assert.equal(reloaded.element('ai-settings-page').classList.contains('hidden'), false);
});

test('保存通用设置不校验或覆盖 AI 页未保存的草稿', async () => {
  const env = await initializedPopup({ translationApiKey: 'saved-ai-key', mailInsightApiMode: 'none' });
  env.element('translation-api-key').value = 'unsaved-ai-key';
  clefRow(env).apiToken.value = 'half-filled-key';
  env.element('notifications-toggle').checked = false;
  await env.element('save-settings').handlers.click();
  assert.equal(env.store.notificationsEnabled, false);
  assert.equal(env.store.translationApiKey, 'saved-ai-key');
  assert.equal(env.store.clefAccounts, undefined);
  assert.match(env.element('settings-message').textContent, /保存成功/);
});

test('保存 AI 配置不读取或覆盖通用设置草稿', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings', apiUrl: 'https://mail.saved.test', adminToken: 'saved-admin',
    mailInsightApiMode: 'custom', mailInsightApiBase: 'https://ai.saved.test/v1', mailInsightApiKey: 'old-ai-key', mailInsightModel: 'old-model' });
  env.element('api-url').value = 'https://mail.unsaved.test';
  env.element('generated-result-auto-close-seconds').value = 'invalid-number';
  env.element('mail-insight-api-key').value = 'new-ai-key';
  env.element('mail-insight-model').value = 'new-model';
  await env.element('save-ai-settings').handlers.click();
  assert.equal(env.store.apiUrl, 'https://mail.saved.test');
  assert.equal(env.store.adminToken, 'saved-admin');
  assert.equal(env.store.generatedToolAutoCloseSeconds, undefined);
  assert.equal(env.store.mailInsightApiKey, 'new-ai-key');
  assert.equal(env.store.mailInsightModel, 'new-model');
  assert.equal(env.element('ai-settings-message').textContent, 'AI 配置已保存');
});

test('获取 AI 模型失败时在 AI 页显示提示', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings' });
  for (const id of ['fetch-translation-models-btn', 'fetch-insight-models-btn']) {
    env.element('ai-settings-message').textContent = '';
    await env.element(id).handlers.click();
    assert.ok(env.element('ai-settings-message').textContent);
    assert.equal(env.element('settings-message').textContent, '');
  }
});

test('AI 控件只属于 AI 页面，控件 ID 没有因迁移而重复', () => {
  const html = readFileSync(join(DIR, 'popup.html'), 'utf8');
  const start = html.indexOf('<div id="ai-settings-page"');
  const end = html.indexOf('<div id="settings-page"');
  assert.ok(start > 0 && end > start);
  for (const id of ['translation-api-base', 'translation-api-key', 'mail-insight-api-mode',
    'mail-insight-judge-settings', 'clef-accounts-list', 'save-ai-settings', 'ai-settings-message']) {
    const position = html.indexOf(`id="${id}"`);
    assert.ok(position > start && position < end, `${id} 应在 AI 页面`);
    assert.equal(html.indexOf(`id="${id}"`, position + 1), -1, `${id} 不应重复`);
  }
});

test('翻译与提取连接测试使用未保存草稿和当前 API 来源，不写入配置', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings', translationApiBase: 'https://old.test/v1',
    translationApiKey: 'saved-key', translationModel: 'saved-model' });
  const before = JSON.stringify(env.store);
  const calls = [];
  env.scope.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, payload });
    const insight = payload.messages[0].content.includes('JSON');
    return new Response(JSON.stringify({ choices: [{ message: { content: insight ? '{"codes":["482913"],"links":[]}' : 'OK' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  env.element('translation-api-base').value = 'https://draft.test/v1/';
  env.element('translation-api-key').value = 'draft-key';
  env.element('translation-model').value = 'draft-model';
  await env.element('test-translation-api-btn').handlers.click();
  assert.equal(calls[0].url, 'https://draft.test/v1/chat/completions');
  assert.equal(calls[0].headers.Authorization, 'Bearer draft-key');
  assert.equal(calls[0].payload.model, 'draft-model');
  assert.match(env.element('translation-api-test-message').textContent, /连接成功/);
  env.element('translation-model-select').value = 'draft-model-v2';
  env.element('translation-model-select').handlers.change();
  assert.equal(env.element('translation-model').value, 'draft-model-v2');
  assert.match(env.element('translation-api-test-message').textContent, /配置已修改/);
  await env.element('test-insight-api-btn').handlers.click();
  assert.equal(calls[1].url, calls[0].url);
  env.element('mail-insight-api-mode').value = 'custom';
  env.element('mail-insight-api-mode').handlers.change();
  env.element('mail-insight-api-base').value = 'https://custom-draft.test/v1';
  env.element('mail-insight-api-key').value = 'custom-draft-key';
  env.element('mail-insight-model').value = 'custom-draft-model';
  await env.element('test-insight-api-btn').handlers.click();
  assert.equal(calls[2].url, 'https://custom-draft.test/v1/chat/completions');
  assert.equal(calls[2].headers.Authorization, 'Bearer custom-draft-key');
  assert.equal(calls[2].payload.model, 'custom-draft-model');
  env.element('mail-insight-api-mode').value = 'none';
  await env.element('test-insight-api-btn').handlers.click();
  assert.equal(calls.length, 3);
  assert.match(env.element('insight-api-test-message').textContent, /先选择/);
  assert.equal(JSON.stringify(env.store), before);
});

test('JEV 测试逐项展示全部 Key 的结果，不借助轮换掩盖失败', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings' });
  const before = JSON.stringify(env.store);
  const requests = [];
  env.element('jev-api-base').value = 'https://jev-draft.test';
  env.element('jev-api-key').value = 'bad-draft-key\ngood-draft-key';
  env.element('jev-model').value = 'jev-draft-model';
  env.scope.fetch = async (url, init) => {
    requests.push({ url, init });
    const bad = init.headers.Authorization.includes('bad-draft-key');
    return new Response(JSON.stringify(bad ? { error: { message: 'Unauthorized bad-draft-key' } }
      : { answers: { connection_test: { type: 'noul', noul: 0.98 } } }),
    { status: bad ? 401 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  await env.element('test-jev-api-btn').handlers.click();
  assert.equal(requests.length, 2);
  assert.equal(JSON.parse(requests[0].init.body).model, 'jev-draft-model');
  const text = env.element('jev-api-test-message').textContent;
  assert.match(text, /1\/2/);
  assert.match(text, /Key 1.*401/);
  assert.match(text, /Key 2.*连接成功/);
  assert.ok(!text.includes('bad-draft-key'));
  assert.equal(JSON.stringify(env.store), before);
});

test('Clef 单账号测试和全部测试使用对应绑定，一次测试仅请求一次', async () => {
  const accounts = [
    { id: 'one', accountId: 'a'.repeat(32), apiToken: 'bad-clef-key' },
    { id: 'two', accountId: 'b'.repeat(32), apiToken: 'good-clef-key' }
  ];
  const env = await initializedPopup({ activeTab: 'ai-settings', clefAccounts: accounts });
  const before = JSON.stringify(env.store);
  const requests = [];
  env.element('clef-model').value = 'clef-flash';
  env.scope.fetch = async (url, init) => {
    const account = accounts.find((record) => url.includes(`/accounts/${record.accountId}/`));
    assert.equal(init.headers.Authorization, `Bearer ${account.apiToken}`);
    assert.ok(url.endsWith('/clef-flash'));
    requests.push(account.id);
    const bad = account.id === 'one';
    return new Response(JSON.stringify({ success: !bad, errors: bad ? [{ code: 3040 }] : [],
      result: bad ? {} : { answers: { connection_test: { type: 'noul', noul: 0.98 } } } }),
    { status: bad ? 429 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  await clefRow(env).testButton.handlers.click();
  assert.deepEqual(requests, ['one']);
  assert.match(clefRow(env).status.textContent, /429/);
  await env.element('test-clef-accounts-btn').handlers.click();
  assert.deepEqual(requests, ['one', 'one', 'two']);
  assert.match(env.element('clef-api-test-message').textContent, /1\/2/);
  assert.match(clefRow(env, 1).status.textContent, /连接成功/);
  env.element('clef-model').value = 'clef';
  env.element('clef-model').handlers.change();
  assert.equal(clefRow(env, 1).status.classList.contains('hidden'), true);
  assert.equal(JSON.stringify(env.store), before);
});

test('Clef 测试过程中修改 Key，不把旧请求标为新 Key 成功', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings', clefAccounts: [
    { id: 'saved', accountId: 'a'.repeat(32), apiToken: 'old-key' }
  ] });
  let finish;
  env.scope.fetch = () => new Promise((resolve) => { finish = resolve; });
  const row = clefRow(env);
  const pending = row.testButton.handlers.click();
  assert.equal(row.testButton.disabled, true);
  row.apiToken.value = 'new-key';
  row.apiToken.handlers.input();
  finish(new Response(JSON.stringify({ success: true, result: { answers: { connection_test: { noul: 0.98 } } } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await pending;
  assert.match(row.status.textContent, /配置已修改/);
  assert.equal(row.testButton.disabled, false);
});

test('测试全部 Clef 账号时，未填完整的行不会阻止其他账号测试', async () => {
  const env = await initializedPopup({ activeTab: 'ai-settings', clefAccounts: [
    { id: 'valid', accountId: 'a'.repeat(32), apiToken: 'valid-key' }
  ] });
  env.element('clef-add-account').handlers.click();
  clefRow(env, 1).apiToken.value = 'unpaired-key';
  let calls = 0;
  env.scope.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ success: true, result: { answers: { connection_test: { noul: 0.98 } } } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  await env.element('test-clef-accounts-btn').handlers.click();
  assert.equal(calls, 1);
  assert.match(env.element('clef-api-test-message').textContent, /1\/2/);
  assert.match(clefRow(env, 1).status.textContent, /请填写/);
});
