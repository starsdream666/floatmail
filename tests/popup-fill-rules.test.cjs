const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');
const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');
const origin = 'https://example.test';
const saved = () => ({ [origin]: {
  email: { selector: '#register-email' }, password: { selector: '#register-password' },
  name: { selector: '#register-name' },
  login: { email: { selector: '#login-email' }, password: { selector: '#login-password' } },
} });
const plain = value => JSON.parse(JSON.stringify(value));
function extractFunction(name) {
  const pattern = new RegExp(`  (?:async )?function ${name}\\(`);
  const start = source.search(pattern);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }', start) + 4;
  return source.slice(start, end);
}
function node() {
  return { children: [], events: {}, value: 'register', textContent: '',
    addEventListener(name, fn) { this.events[name] = fn; },
    appendChild(child) { this.children.push(child); },
    set innerHTML(value) { this.children = []; },
  };
}
function createPopup(mode = 'login', history = [], kinds = ['email', 'password']) {
  const storage = { pageFillRules: saved() };
  const messages = [];
  const notices = [];
  const scope = {
    pageFillRules: storage.pageFillRules, currentSiteOrigin: origin, PAGE_FILL_RULES_KEY: 'pageFillRules',
    fillRuleModeSelect: node(), fillRulesSite: node(), fillRulesList: node(), fillRulesMessage: node(),
    fastFillMessage: node(), fastFillGenerating: false, fastFillHistory: history,
    document: { createElement: node },
    storageGet: async () => storage,
    storageSet: async patch => Object.assign(storage, patch),
    isSiteAllowed: () => true,
    renderFastFillRulesSummary: () => {},
    showMessage: (...args) => notices.push(args),
    sendToActivePage: async message => {
      messages.push(message);
      if (message.type === 'get-fill-context') return { ok: true, mode, kinds, origin };
      return { ok: true, mode, filled: 2 };
    },
  };
  const defs = source.match(/  const PAGE_FILL_FIELD_DEFS = \[[\s\S]*?\n  \];/)[0];
  const functions = ['getCurrentSiteFillRules', 'getEditingRuleMode', 'formatFillResult', 'formatFillRuleSummary',
    'renderFillRuleManager', 'armFieldSelection', 'clearFieldRule', 'fastFillGenerateAndFill'];
  runInNewContext(`${defs}\n${functions.map(extractFunction).join('\n')}`, scope);
  return { scope, storage, messages, notices };
}

test('rule editor shows all ten fields for both registration and login', () => {
  const { scope } = createPopup();
  scope.renderFillRuleManager();
  assert.equal(scope.fillRulesList.children.length, 10);
  const labels = scope.fillRulesList.children.map(card => card.children[0].children[0].textContent);
  scope.fillRuleModeSelect.value = 'login';
  scope.renderFillRuleManager();
  assert.deepEqual(scope.fillRulesList.children.map(card => card.children[0].children[0].textContent), labels);
  assert.deepEqual(labels, ['邮箱', '密码', '重复密码', '验证码', '姓名', '姓', '名', '生日', '年龄', '住址']);
});

test('actual rule-card pick buttons preserve the displayed mode for all ten fields', async () => {
  for (const mode of ['register', 'login']) {
    const { scope, messages } = createPopup();
    scope.fillRuleModeSelect.value = mode;
    scope.renderFillRuleManager();
    const kinds = ['email', 'password', 'confirmPassword', 'verificationCode', 'name', 'lastName', 'firstName', 'birthday', 'age', 'address'];
    for (const [i, card] of scope.fillRulesList.children.entries()) {
      const pick = card.children[1].children[0];
      pick.events.click({ preventDefault() {}, stopPropagation() {} });
      await Promise.resolve();
      assert.equal(messages[i].type, 'start-field-selection');
      assert.equal(messages[i].mode, mode);
      assert.equal(messages[i].kind, kinds[i]);
    }
  }
});

test('login binding message keeps the mode explicit', async () => {
  const { scope, messages } = createPopup();
  await scope.armFieldSelection({ kind: 'email', pickLabel: '邮箱输入框' }, 'login');
  assert.deepEqual(plain(messages[0]), { type: 'start-field-selection', kind: 'email', label: '登录邮箱输入框', mode: 'login' });
});

test('clear login email preserves registration and login password', async () => {
  const { scope, storage } = createPopup();
  await scope.clearFieldRule('email', 'login');
  const rules = storage.pageFillRules[origin];
  assert.equal(rules.email.selector, '#register-email');
  assert.equal(rules.login.email, undefined);
  assert.equal(rules.login.password.selector, '#login-password');
});

test('clear registration email preserves login email', async () => {
  const { scope, storage } = createPopup();
  await scope.clearFieldRule('email', 'register');
  assert.equal(storage.pageFillRules[origin].email, undefined);
  assert.equal(storage.pageFillRules[origin].login.email.selector, '#login-email');
});

test('clear final login binding removes only the empty login group', async () => {
  const { scope, storage } = createPopup();
  await scope.clearFieldRule('email', 'login');
  await scope.clearFieldRule('password', 'login');
  assert.equal(storage.pageFillRules[origin].login, undefined);
  assert.equal(storage.pageFillRules[origin].name.selector, '#register-name');
});

test('login fast-fill reuses same-origin credentials and never calls a mailbox API', async () => {
  const fields = { email: 'existing@example.test', password: 'existing-password', fullName: 'Existing Person' };
  const { scope, messages } = createPopup('login', [
    { origin: 'https://other.test', fields: { email: 'other@example.test', password: 'wrong' } },
    { origin, fields },
  ]);
  // 未提供生成器和网络 API；若误入注册生成分支，这个测试必然失败。
  const response = await scope.fastFillGenerateAndFill();
  assert.equal(response.ok, true);
  assert.equal(messages.length, 2);
  assert.deepEqual(plain(messages[1]), { type: 'fill-profile', fields, rulesOnly: true, expectedMode: 'login', expectedOrigin: origin });
  assert.equal(scope.fastFillGenerating, false);
});

test('login without same-origin history refuses to generate fresh credentials', async () => {
  const { scope, messages, notices } = createPopup('login', []);
  const response = await scope.fastFillGenerateAndFill();
  assert.equal(response.ok, false);
  assert.equal(messages.length, 1);
  assert.match(notices[0][1], /未找到本站与当前登录规则匹配的历史资料/);
  assert.equal(scope.fastFillGenerating, false);
});

test('new login fields can be selected and cleared independently', async () => {
  const { scope, storage, messages } = createPopup();
  storage.pageFillRules[origin].login.name = { selector: '#login-name' };
  await scope.armFieldSelection({ kind: 'name', pickLabel: '姓名输入框' }, 'login');
  assert.equal(messages[0].kind, 'name');
  assert.equal(messages[0].mode, 'login');
  await scope.clearFieldRule('name', 'login');
  assert.equal(storage.pageFillRules[origin].login.name, undefined);
  assert.equal(storage.pageFillRules[origin].name.selector, '#register-name');
  assert.equal(storage.pageFillRules[origin].login.email.selector, '#login-email');
});

test('login summary includes additional fields and enables fast-fill without email domains', () => {
  const { scope } = createPopup();
  scope.pageFillRules = { [origin]: { login: { name: { selector: '#alias' }, verificationCode: { selector: '#code' } } } };
  scope.fastFillRulesSummary = node();
  scope.fastFillGenerateBtn = node();
  scope.getFastFillAvailableDomains = () => [];
  runInNewContext(extractFunction('renderFastFillRulesSummary'), scope);
  scope.renderFastFillRulesSummary();
  assert.match(scope.fastFillRulesSummary.textContent, /登录：验证码、姓名/);
  assert.equal(scope.fastFillGenerateBtn.disabled, false);
});

test('name-only login reuses history fullName without demanding email or password', async () => {
  const fields = { fullName: 'Account Alias' };
  const { scope, messages, notices } = createPopup('login', [{ origin, fields }], ['name']);
  assert.equal((await scope.fastFillGenerateAndFill()).ok, true);
  assert.deepEqual(plain(messages[1].fields), fields);
  assert.equal(notices[0][2], 'success');
});

test('additional fields come from one matching same-origin history entry only', async () => {
  const fields = { fullName: 'Chosen Alias', password: 'chosen-password' };
  const { scope, messages } = createPopup('login', [
    { origin: 'https://other.test', fields: { fullName: 'Other Site' } },
    { origin, fields: { address: 'Unrelated Data' } },
    { origin, fields },
  ], ['name', 'password']);
  assert.equal((await scope.fastFillGenerateAndFill()).ok, true);
  assert.deepEqual(plain(messages[1].fields), fields);
});

test('missing additional login data is reported without synthesizing new values', async () => {
  const fields = { fullName: 'Existing Alias' };
  const { scope, messages, notices } = createPopup('login', [{ origin, fields }], ['name', 'verificationCode']);
  assert.equal((await scope.fastFillGenerateAndFill()).ok, true);
  assert.deepEqual(plain(messages[1].fields), fields);
  assert.match(notices[0][1], /历史中暂无验证码/);
  assert.equal(notices[0][2], 'info');
});

test('standalone confirmation password is accepted by login history selection', async () => {
  const fields = { confirmPassword: 'stored-confirmation' };
  const { scope, messages } = createPopup('login', [{ origin, fields }], ['confirmPassword']);
  assert.equal((await scope.fastFillGenerateAndFill()).ok, true);
  assert.deepEqual(plain(messages[1].fields), fields);
});

test('legacy history without origin is not automatically selected as a login account', async () => {
  const { scope, messages } = createPopup('login', [{ fields: { email: 'old@example.test', password: 'old-password' } }]);
  assert.equal((await scope.fastFillGenerateAndFill()).ok, false);
  assert.equal(messages.length, 1);
});

test('actual login clear button preserves registration mapping', async () => {
  const { scope, storage } = createPopup();
  storage.pageFillRules[origin].login.name = { selector: '#login-name' };
  scope.fillRuleModeSelect.value = 'login';
  scope.renderFillRuleManager();
  const nameCard = scope.fillRulesList.children.find(card => card.children[0].children[0].textContent === '姓名');
  const done = new Promise(resolve => {
    const original = scope.storageSet;
    scope.storageSet = async patch => { await original(patch); resolve(); };
  });
  nameCard.children[1].children[1].events.click({ preventDefault() {}, stopPropagation() {} });
  await done;
  assert.equal(storage.pageFillRules[origin].login.name, undefined);
  assert.equal(storage.pageFillRules[origin].name.selector, '#register-name');
});

test('extension entrypoints and UI reference the same migrated rule feature', () => {
  const content = readFileSync(join(__dirname, '../content.js'), 'utf8');
  const background = readFileSync(join(__dirname, '../background.js'), 'utf8');
  const html = readFileSync(join(__dirname, '../popup.html'), 'utf8');
  const css = readFileSync(join(__dirname, '../popup.css'), 'utf8');
  const version = text => text.match(/const PAGE_TOOLS_VERSION = '([^']+)'/)[1];
  assert.equal(version(content), '2026.09.14-login-rules-main-v3');
  assert.equal(version(background), version(content));
  assert.equal((html.match(/id="fill-rule-mode"/g) || []).length, 1);
  assert.match(html, /<option value="login">登录规则（全部字段）<\/option>/);
  assert.match(css, /\.fill-rule-mode-row/);
});

test('partial-fill messages preserve the warning and actual count', () => {
  const { scope } = createPopup();
  assert.match(scope.formatFillResult({ mode: 'login', filled: 1, partial: true, error: '页面已变化' }), /登录规则：已填入 1 个字段；页面已变化/);
});
