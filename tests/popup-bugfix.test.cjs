const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

// 针对 BUG-REVIEW-2026-09-26 中 popup.js 修复项的回归测试。
// 沿用 jev-insight.test.cjs 的切分方式：按缩进（两个空格）截取顶层函数单元。
const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');
const html = readFileSync(join(__dirname, '../popup.html'), 'utf8');
const INDENT = '  ';

function extractUnit(declaration) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${INDENT}${declaration}`));
  if (index < 0) return null;
  const collected = [];
  for (let i = index; i < lines.length; i += 1) {
    const line = lines[i];
    collected.push(line);
    if (i === index && line.trim().endsWith(';')) break;
    if (i > index && line.startsWith(INDENT) && !line.startsWith(INDENT + ' ')) {
      const trimmed = line.trim();
      if (trimmed === '}' || trimmed === '];' || trimmed === '};' || trimmed.endsWith(';')) break;
    }
  }
  return collected.join('\n');
}

function extractFunction(name) {
  const unit = extractUnit(`function ${name}(`) || extractUnit(`async function ${name}(`);
  assert.ok(unit, `未找到函数 ${name}`);
  return unit;
}

const plain = (value) => JSON.parse(JSON.stringify(value));

// ── H2：保存设置必须落库独立提取 API 地址与 Key ─────────────────────
test('H2 保存 AI 配置同步 mailInsightApiKey 并写入地址与 Key', () => {
  const start = source.indexOf("saveAiSettingsBtn.addEventListener('click'");
  const end = source.indexOf("currentSiteToggleBtn.addEventListener('click'", start);
  const block = source.slice(start, end);
  assert.match(block, /mailInsightApiKey = newMailInsightApiKey;/);
  assert.match(block, /\[MAIL_INSIGHT_API_BASE_KEY\]: mailInsightApiBase/);
  assert.match(block, /\[MAIL_INSIGHT_API_KEY_KEY\]: mailInsightApiKey/);
});

// ── H3：MoeMail「永久」(0) 不能被 || 兜底成 1 天 ────────────────────
test('H3 全文件不再出现 parseInt(...) || 86400000 / expiryMs || 86400000 写法', () => {
  assert.doesNotMatch(source, /\|\|\s*86400000/);
  assert.match(source, /Number\.isNaN\(parsedMoeExpiry\) \? 86400000 : parsedMoeExpiry/);
  assert.match(source, /Number\.isNaN\(parsedExpiry\) \? 86400000 : parsedExpiry/);
});

// ── M2：初始化读取姓名地区 / 性别 ───────────────────────────────────
test('M2 初始化 storageGet 列表包含姓名地区与性别', () => {
  const start = source.indexOf('// ===================== 初始化加载 =====================');
  const block = source.slice(start, source.indexOf(']).then((result) => {', start));
  assert.match(block, /FAST_FILL_NAME_REGION_KEY/);
  assert.match(block, /FAST_FILL_NAME_GENDER_KEY/);
});

// ── M3：翻译在途状态显式记录，切换邮件时重置 ───────────────────────
function translationEngine() {
  const buttonStates = [];
  let token = 0;
  let mail = { id: 1 };
  let resolveTranslate;
  const reader = {
    elements: {
      translateButton: { id: 'translate' },
      translation: { classList: { add() {}, remove() {}, contains: () => true } },
      translationTitle: {}, translationBody: {},
      copyTranslationButton: { classList: { add() {}, remove() {} } },
      retranslateButton: { classList: { add() {}, remove() {} } },
      insights: { classList: { add() {} }, innerHTML: '' },
      viewButton: {}, imagesButton: {}
    },
    begin(next) { token += 1; mail = next; },
    getMail: () => mail,
    setMail: (value) => { mail = value; },
    getIdentity: () => mail?.id ?? null,
    getTranslationSource: () => 'hello',
    getMetadata: () => ({}),
    getTranslationText: () => '',
    setTranslationText() {},
    nextTranslationToken: () => ++token,
    isTranslationTokenCurrent: (value) => value === token,
    getViewMode: () => 'safe-html',
    getAllowRemoteImages: () => false,
    isDeletePending: () => false
  };
  const scope = {
    WeakMap,
    reader,
    translationTargetLanguage: '简体中文',
    hasTranslationConfig: () => true,
    resetTranslationPanel() {},
    renderTranslationPanel() {},
    getMailActionIconMarkup: () => '',
    setMailActionButtonState: (button, options) => {
      if (button === reader.elements.translateButton) buttonStates.push(options);
    },
    translateTextWithApi: () => new Promise((resolve) => { resolveTranslate = resolve; })
  };
  const code = [
    extractUnit('const mailTranslationInFlight = '),
    ...['isMailTranslationInFlight', 'settleMailTranslation', 'resetMailTranslateButton',
      'beginMailReader', 'requestMailTranslation', 'updateMailActionButtons'].map(extractFunction)
  ].join('\n');
  runInNewContext(code, scope);
  return { scope, reader, buttonStates, finish: (text) => resolveTranslate(text) };
}

test('M3 翻译进行中切换邮件：按钮被重置，旧请求完成后不再改动新邮件的按钮', async () => {
  const { scope, reader, buttonStates, finish } = translationEngine();
  const pending = scope.requestMailTranslation(reader);
  assert.equal(buttonStates.at(-1).title, '翻译中...');
  assert.equal(scope.isMailTranslationInFlight(reader), true);

  // 切到另一封邮件
  scope.beginMailReader(reader, { id: 2 });
  assert.equal(scope.isMailTranslationInFlight(reader), false, '切换邮件后不应仍处于在途状态');
  assert.equal(buttonStates.at(-1).icon, 'translate', '切换邮件时翻译按钮应被重置');

  // 新邮件渲染后按钮应可用（不再因为「disabled + 翻译中」被跳过）
  scope.updateMailActionButtons(reader, null);
  assert.equal(buttonStates.at(-1).icon, 'translate');
  assert.equal(buttonStates.at(-1).disabled, false);

  const countBefore = buttonStates.length;
  finish('旧邮件的翻译');
  await pending;
  assert.equal(buttonStates.length, countBefore, '旧请求完成后不应覆盖新邮件的按钮状态');
});

test('M3 同一封邮件翻译进行中时，重绘不会把按钮提前恢复', () => {
  const { scope, reader, buttonStates } = translationEngine();
  scope.requestMailTranslation(reader);
  const countBefore = buttonStates.length;
  scope.updateMailActionButtons(reader, null);
  assert.equal(buttonStates.length, countBefore, '在途时 updateMailActionButtons 不应改动翻译按钮');
});

// ── M9：Jev 裁决前按分数排序再截断 ─────────────────────────────────
test('M9 靠后的高分候选不会被文档顺序截断挤掉', async () => {
  let askedQuestions = null;
  const scope = {
    URL,
    JEV_LINK_THRESHOLD: 0.5,
    getInsightLinkLimit: () => 8,
    formatInsightLinkLabel: (url) => url,
    callJev: async (questions) => {
      askedQuestions = questions;
      return { model: 'jev-test', answers: {} };
    }
  };
  runInNewContext([
    extractFunction('normalizeUrlKey'),
    extractFunction('dedupeLinksByNormalizedKey'),
    extractFunction('adjudicateInsightsWithJev')
  ].join('\n'), scope);

  const links = Array.from({ length: 10 }, (_, i) => ({
    value: `https://a.test/nav${i}`, url: `https://a.test/nav${i}`, score: 1, index: i
  }));
  links.push({ value: 'https://a.test/verify?token=x', url: 'https://a.test/verify?token=x', score: 99, index: -1 });
  const codes = Array.from({ length: 10 }, (_, i) => ({ value: `10000${i}`, key: `10000${i}`, score: 0, index: i }));
  codes.push({ value: '483920', key: '483920', score: 99, index: -1, label: 'AI 提取' });

  await scope.adjudicateInsightsWithJev(links, codes, 'text');
  const askedUrls = Object.keys(askedQuestions)
    .filter((key) => key.startsWith('link_'))
    .map((key) => askedQuestions[key].instructions.candidate.url);
  assert.equal(askedUrls.length, 8);
  assert.equal(askedUrls[0], 'https://a.test/verify?token=x', '最高分链接必须进入裁决并排在最前');
  // 同分保持原文档顺序（稳定排序）
  assert.deepEqual(askedUrls.slice(1), links.slice(0, 7).map((l) => l.url));
  assert.ok(Object.keys(askedQuestions.real_code.criteria).includes('483920'), 'AI 验证码必须进入候选');
});

// ── M13 / L28：快填域名 ──────────────────────────────────────────
function fastFillDomainEngine(overrides = {}) {
  const scope = {
    fastFillEmailSource: 'temp',
    fastFillDomainMode: 'specific',
    fastFillDomainSpecific: '',
    fastFillDomainWhitelist: [],
    fastFillDomainBlacklist: [],
    fastFillTempDomains: ['t1.test', 't2.test'],
    fastFillMoeDomains: ['m1.test', 'm2.test'],
    ...overrides
  };
  runInNewContext(extractFunction('getFastFillAvailableDomains'), scope);
  return scope;
}

test('M13 指定域名不属于当前来源时不会被使用', () => {
  const scope = fastFillDomainEngine({ fastFillEmailSource: 'moe', fastFillDomainSpecific: 't1.test' });
  assert.deepEqual(plain(scope.getFastFillAvailableDomains()), []);
  scope.fastFillDomainSpecific = 'm2.test';
  assert.deepEqual(plain(scope.getFastFillAvailableDomains()), ['m2.test']);
});

test('M13 刷新下拉框时把不在列表中的指定域名同步为实际显示值并保存', () => {
  const makeSelect = () => ({
    options: [], value: '',
    set innerHTML(v) { this.options = []; this.value = ''; },
    appendChild(opt) { this.options.push(opt); if (!this.value || opt.selected) this.value = opt.value; }
  });
  let saved = 0;
  const scope = {
    fastFillEmailSource: 'moe', fastFillDomainMode: 'specific', fastFillDomainSpecific: 't1.test',
    fastFillDomainWhitelist: [], fastFillDomainBlacklist: [],
    fastFillTempDomains: ['t1.test'], fastFillMoeDomains: ['m1.test', 'm2.test'],
    fastFillDomainsLoaded: true,
    fastFillDomainSelect: makeSelect(),
    fastFillDomainWhitelistList: null, fastFillDomainBlacklistList: null,
    fastFillDomainStatus: { textContent: '' },
    document: { createElement: () => ({}) },
    saveFastFillConfig: () => { saved += 1; },
    renderDomainChecklist() {},
    renderFastFillRulesSummary() {}
  };
  runInNewContext([
    extractFunction('getFastFillAvailableDomains'),
    extractFunction('fastFillRefreshDomainUI')
  ].join('\n'), scope);
  scope.fastFillRefreshDomainUI();
  assert.equal(scope.fastFillDomainSpecific, 'm1.test', '状态应同步为下拉框实际显示的值');
  assert.equal(saved, 1);
  assert.match(scope.fastFillDomainStatus.textContent, /1 个/);
});

test('L28 勾选白/黑名单只增删当前项，保留另一来源的条目', () => {
  const created = [];
  const container = {
    children: [],
    set innerHTML(v) { this.children = []; },
    appendChild(child) { this.children.push(child); }
  };
  const scope = {
    document: {
      createElement: (tag) => {
        const el = { tag, children: [], events: {}, checked: false,
          appendChild(c) { this.children.push(c); },
          addEventListener(name, fn) { this.events[name] = fn; } };
        created.push(el);
        return el;
      },
      createTextNode: (text) => ({ text })
    }
  };
  runInNewContext(extractFunction('renderDomainChecklist'), scope);
  let result = null;
  scope.renderDomainChecklist(container, ['m1.test', 'm2.test'], ['t1.test', 'm1.test'], (next) => { result = next; });
  const checkboxes = created.filter((el) => el.tag === 'input');
  // 勾选 m2
  checkboxes[1].checked = true;
  checkboxes[1].events.change();
  assert.deepEqual(plain(result).sort(), ['m1.test', 'm2.test', 't1.test']);
  // 取消 m1
  checkboxes[0].checked = false;
  checkboxes[0].events.change();
  assert.deepEqual(plain(result), ['t1.test'], '另一来源的 t1.test 必须保留');
});

// ── M14：注册规则未绑定邮箱时不要求域名 ─────────────────────────────
test('M14 注册规则不含邮箱时，没有可用域名也不禁用一键填充按钮', () => {
  const origin = 'https://example.test';
  const scope = {
    currentSiteOrigin: origin,
    pageFillRules: { [origin]: { password: { selector: '#pwd' } } },
    fastFillRulesSummary: { textContent: '' },
    fastFillGenerateBtn: { disabled: true },
    getFastFillAvailableDomains: () => []
  };
  const defs = source.match(/  const PAGE_FILL_FIELD_DEFS = \[[\s\S]*?\n  \];/)[0];
  runInNewContext(`${defs}\n${extractFunction('getCurrentSiteFillRules')}\n${extractFunction('renderFastFillRulesSummary')}`, scope);
  scope.renderFastFillRulesSummary();
  assert.equal(scope.fastFillGenerateBtn.disabled, false);

  scope.pageFillRules = { [origin]: { email: { selector: '#email' } } };
  scope.renderFastFillRulesSummary();
  assert.equal(scope.fastFillGenerateBtn.disabled, true, '需要邮箱但无域名时仍应禁用');
});

test('M14 生成流程只在需要邮箱时才取域名', () => {
  const fn = extractFunction('fastFillGenerateAndFill');
  assert.match(fn, /const domain = needsEmail \? pickRandomDomain\(\) : null;/);
  assert.match(fn, /if \(needsEmail && !domain\)/);
});

// ── L23：黑白名单大小写不敏感 ─────────────────────────────────────
test('L23 通配符 / 完整 origin / 关键词匹配均不区分大小写', () => {
  const scope = { URL };
  runInNewContext(`${extractFunction('extractHostname')}\n${extractFunction('matchesSitePattern')}`, scope);
  assert.equal(scope.matchesSitePattern('https://www.example.com', '*.Example.com'), true);
  assert.equal(scope.matchesSitePattern('https://example.com', 'HTTPS://Example.COM'), true);
  assert.equal(scope.matchesSitePattern('https://shop.example.com', 'EXAMPLE'), true);
  assert.equal(scope.matchesSitePattern('https://other.test', '*.example.com'), false);
});

// ── L30：复制按钮连点不会停在对勾 ─────────────────────────────────
test('L30 复制按钮 1.5 秒内连点，最终恢复为原始图标', async () => {
  const timers = [];
  const scope = {
    navigator: {},
    document: {},
    setTimeout: (fn, ms) => { timers.push({ fn, cleared: false }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    Number, String
  };
  runInNewContext(`${extractFunction('copyToClipboard')}\n${extractFunction('fallbackCopy')}`, scope);
  // 替换掉依赖 DOM 的兜底复制，直接触发成功回调
  scope.fallbackCopy = (text, onSuccess) => onSuccess();
  const button = { innerHTML: 'ORIGINAL', dataset: {} };
  scope.copyToClipboard('a', button);
  scope.copyToClipboard('a', button);
  assert.notEqual(button.innerHTML, 'ORIGINAL');
  timers.filter((t) => !t.cleared).forEach((t) => t.fn());
  assert.equal(button.innerHTML, 'ORIGINAL', '连点后必须恢复为原始图标，而不是对勾');
  assert.equal(timers.filter((t) => !t.cleared).length, 1, '上一个恢复定时器应被清除');
});

// ── L8：域名加载器 ───────────────────────────────────────────────
function domainLoaderEngine() {
  const calls = [];
  const select = { disabled: false, innerHTML: '', options: [], appendChild(o) { this.options.push(o); } };
  const createButton = { disabled: false };
  const scope = {
    document: { createElement: () => ({}) },
    showMessage() {}
  };
  runInNewContext(extractFunction('createDomainLoader'), scope);
  const loader = scope.createDomainLoader({
    select, createButton, messageElement: {},
    fetchDomains: (force) => new Promise((resolve) => { calls.push({ force, resolve }); })
  });
  return { loader, calls, select, createButton };
}

test('L8 强制刷新不复用在途的非强制请求', async () => {
  const { loader, calls, select } = domainLoaderEngine();
  const first = loader.load();
  const second = loader.load({ forceRefresh: true });
  assert.equal(calls.length, 2, '强制刷新必须重新发起请求');
  assert.equal(calls[1].force, true);
  calls[1].resolve(['new.test']);
  await second;
  calls[0].resolve(['old.test']);
  await first;
  assert.equal(select.disabled, false);
  assert.deepEqual(select.options.map((o) => o.value), ['new.test'], '旧请求结果不能覆盖强制刷新结果');
});

test('L8 加载期间被 reset 且无新请求接管时，界面恢复可用而不是卡在加载中', async () => {
  const { loader, calls, select, createButton } = domainLoaderEngine();
  const pending = loader.load();
  assert.equal(select.disabled, true);
  loader.reset();
  calls[0].resolve(['x.test']);
  await pending;
  assert.equal(select.disabled, false);
  assert.equal(createButton.disabled, false);
  assert.doesNotMatch(select.innerHTML, /加载中/);
});

// ── L7：超时覆盖响应体读取 ─────────────────────────────────────────
test('L7 fetchWithTimeout 在读取响应体时超时也会中止并报超时', async () => {
  const scope = {
    AbortController, Response, setTimeout, clearTimeout,
    INTERACTIVE_REQUEST_TIMEOUT_MS: 15000,
    fetch: async (url, init) => ({
      status: 200, statusText: 'OK', headers: new Headers(),
      // 响应头已到，但 body 永远不结束，直到被 abort
      arrayBuffer: () => new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })
    })
  };
  runInNewContext(extractFunction('fetchWithTimeout'), scope);
  await assert.rejects(scope.fetchWithTimeout('https://x.test', {}, 30), /请求超时/);
});

test('L7 fetchWithTimeout 返回的对象仍可 res.ok / res.status / res.json()', async () => {
  const scope = {
    AbortController, Response, setTimeout, clearTimeout,
    INTERACTIVE_REQUEST_TIMEOUT_MS: 15000,
    fetch: async () => new Response(JSON.stringify({ a: 1 }), { status: 201, statusText: 'Created' })
  };
  runInNewContext(extractFunction('fetchWithTimeout'), scope);
  const res = await scope.fetchWithTimeout('https://x.test');
  assert.equal(res.ok, true);
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { a: 1 });
});

// ── M15：tempMailMeta 合并写回 ─────────────────────────────────────
test('M15 写 tempMailMeta 前先读最新值合并，不用旧快照覆盖其他实例的条目', async () => {
  const storage = { tempMailMeta: { 'other@x.test': { createdAt: 1, expiryMs: 3600000 } } };
  const scope = {
    TEMP_MAIL_META_KEY: 'tempMailMeta',
    tempMailMeta: {}, // 本实例的旧快照，不含 other@x.test
    storageGet: async () => JSON.parse(JSON.stringify(storage)),
    storageSet: async (patch) => Object.assign(storage, patch),
    console
  };
  runInNewContext(`let tempMailMetaWriteChain = Promise.resolve();\n${extractFunction('updateTempMailMeta')}`, scope);
  await scope.updateTempMailMeta((meta) => { meta['mine@x.test'] = { createdAt: 2, expiryMs: 0 }; });
  assert.deepEqual(Object.keys(storage.tempMailMeta).sort(), ['mine@x.test', 'other@x.test']);
  await scope.updateTempMailMeta((meta) => { delete meta['mine@x.test']; });
  assert.deepEqual(Object.keys(storage.tempMailMeta), ['other@x.test']);
});

test('M15 onChanged 同步 tempMailMeta', () => {
  assert.match(source, /if \(changes\[TEMP_MAIL_META_KEY\]\) \{/);
});

// ── L2：popup 不再整对象写未读计数 ────────────────────────────────
test('L2 popup 不再整对象写入 tempUnreadCounts / moeUnreadCounts', () => {
  assert.doesNotMatch(source, /storage\.local\.set\(\{[^}]*\b(tempUnreadCounts|moeUnreadCounts)\b/);
  assert.doesNotMatch(source, /storageSet\(\{[^}]*\b(tempUnreadCounts|moeUnreadCounts)\b/);
  assert.match(source, /type: 'remove-mail-state', source, keys: list/);
});

// ── M11：执行前认领悬浮球命令 ──────────────────────────────────────
test('M11 执行命令前从 storage 移除同 requestId 的命令', async () => {
  const order = [];
  const storage = { floatPanelCommand: { requestId: 'r1' } };
  const scope = {
    PANEL_COMMAND_KEY: 'floatPanelCommand',
    PANEL_COMMAND_RESULT_KEY: 'floatPanelCommandResult',
    floatPanelToken: 'tok',
    handledPanelCommandIds: new Set(),
    panelInitReady: Promise.resolve(),
    isFreshPanelCommand: () => true,
    storageGet: async () => ({ ...storage }),
    storageRemove: async (key) => { order.push('remove'); delete storage[key]; },
    storageSet: async () => {},
    runFloatPanelCommand: async () => { order.push('run'); return { ok: true }; },
    Date, Number, Boolean
  };
  runInNewContext(extractFunction('handlePanelCommandRequest'), scope);
  await scope.handlePanelCommandRequest({ requestId: 'r1', token: 'tok', command: 'run-fast-fill' });
  assert.deepEqual(order, ['remove', 'run']);
  assert.equal(storage.floatPanelCommand, undefined);
});

// ── L6 / L9 / L32 / L33 等静态守卫 ────────────────────────────────
test('L6 兜底接口失败时报告 fallbackRes.status', () => {
  const fn = extractFunction('fetchTempMailById');
  assert.match(fn, /throw new Error\(`\$\{fallbackRes\.status\}`\)/);
});

test('L9 generatedResultAutoCloseSeconds 已显式声明', () => {
  assert.match(source, /^ {2}let generatedResultAutoCloseSeconds = DEFAULT_GENERATED_RESULT_AUTO_CLOSE_SECONDS;/m);
});

test('L32 快填历史保留更多条目，界面只展示前几条', () => {
  assert.match(source, /const FAST_FILL_HISTORY_MAX = 50;/);
  assert.match(extractFunction('saveFastFillHistory'), /FAST_FILL_HISTORY_MAX/);
  assert.match(extractFunction('renderFastFillHistory'), /slice\(0, FAST_FILL_HISTORY_DISPLAY_COUNT\)/);
});

test('L33 清空全部前需要确认', () => {
  const start = source.indexOf("clearHistoryBtn.addEventListener('click'");
  const block = source.slice(start, start + 800);
  assert.match(block, /confirm\(/);
});

test('新增 DOM id 在 popup.html 中存在', () => {
  for (const id of ['themes-message', 'popup-toast']) {
    assert.ok(html.includes(`id="${id}"`), `popup.html 缺少 #${id}`);
  }
});
