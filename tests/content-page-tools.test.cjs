const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

// content.js 纯逻辑回归：规则子集匹配（L25）、缩放几何（M10）、站点名单大小写（L23）。
// 与 fill-rules.test.cjs 相同，只截断悬浮窗启动，直接跑实际 content.js 源码。
const origin = 'https://example.test';
const contentSource = readFileSync(join(__dirname, '../content.js'), 'utf8');

async function createPage(specs, rules = {}) {
  let inputs = [];
  const forms = new Map();
  const storage = { pageFillRules: { [origin]: rules } };
  const window = {
    location: { origin },
    CSS: { escape: value => value },
    getComputedStyle: element => ({ visibility: element.hidden ? 'hidden' : 'visible', display: element.hidden ? 'none' : 'block' }),
    Event: class { constructor(type) { this.type = type; } },
  };
  const document = {
    nodeType: 9, defaultView: window,
    querySelectorAll(selector) {
      if (selector === '*' || selector.startsWith('input, textarea')) return inputs;
      if (selector.startsWith('#')) return inputs.filter(input => input.id === selector.slice(1));
      throw new Error(`Unsupported test selector: ${selector}`);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  function setInputs(nextSpecs) {
    inputs.forEach(input => { input.isConnected = false; });
    inputs = nextSpecs.map(spec => {
      if (spec.form && !forms.has(spec.form)) forms.set(spec.form, { id: spec.form });
      return {
        nodeType: 1, tagName: 'INPUT', id: '', type: 'text', name: '', placeholder: '',
        value: '', hidden: false, disabled: false, readOnly: false, isConnected: true,
        labels: [], attrs: {}, ...spec,
        form: spec.form ? forms.get(spec.form) : null,
        ownerDocument: document,
        getAttribute(key) { return this.attrs[key] ?? (['id', 'type', 'name', 'placeholder'].includes(key) ? this[key] : null); },
        getRootNode() { return document; },
        closest() { return this.form; },
        getBoundingClientRect() { return { width: this.hidden ? 0 : 180, height: this.hidden ? 0 : 30 }; },
        focus() {},
        dispatchEvent() {},
      };
    });
    return inputs;
  }
  const scope = {
    window, document, URL, Node: { ELEMENT_NODE: 1, DOCUMENT_NODE: 9 },
    chrome: { storage: { local: {
      get(keys, callback) { callback(storage); },
      set(patch, callback) { Object.assign(storage, patch); callback(); },
    } } },
  };
  const source = contentSource.replace('  pageToolsController.dispose = disposePageTools;', `
    window.testApi = { getFillContext, fillProfile, fillSingleValue, saveFillRule, handleRuntimeMessage,
      computePanelResizeRect, matchesFloatSitePattern,
      allowSite(allowed) { siteToolsAllowed = allowed; siteToolsPermissionReady = Promise.resolve(allowed); }
    };
    return;
    pageToolsController.dispose = disposePageTools;`);
  assert.notEqual(source, contentSource, 'Test seam must exist');
  runInNewContext(source, scope);
  const api = window.testApi;
  setInputs(specs);
  await Promise.resolve();
  return { api, storage, setInputs, get inputs() { return inputs; } };
}

const values = page => page.inputs.map(input => input.value);
const plain = value => JSON.parse(JSON.stringify(value));
const rule = selector => ({ selector, contextPath: [] });
const getContext = page => new Promise(resolve => page.api.handleRuntimeMessage({ type: 'get-fill-context' }, {}, resolve));
const emailStep = () => [{ id: 'login-email', type: 'email', form: 'login' }];
const passwordStep = () => [{ id: 'login-password', type: 'password', form: 'login', attrs: { autocomplete: 'current-password' } }];
const codeStep = () => [{ id: 'otp', type: 'text', form: 'verify', attrs: { autocomplete: 'one-time-code' } }];

test('L25 分步登录：每步只填当前可解析的字段', async () => {
  const page = await createPage(emailStep());
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  page.setInputs(passwordStep());
  await page.api.saveFillRule('password', page.inputs[0], 'login');

  page.setInputs(emailStep());
  page.api.allowSite(true);
  assert.deepEqual(plain(await getContext(page)), { ok: true, mode: 'login', kinds: ['email'], origin });
  let response = await page.api.fillProfile({ email: 'a@example.test', password: 'secret' });
  assert.equal(response.mode, 'login');
  assert.equal(response.filled, 1);
  assert.deepEqual(values(page), ['a@example.test']);

  page.setInputs(passwordStep());
  response = await page.api.fillProfile({ email: 'a@example.test', password: 'secret' });
  assert.equal(response.filled, 1);
  assert.deepEqual(values(page), ['secret']);
});

test('L25 两套规则都能匹配时，解析字段更多的一套胜出', async () => {
  const specs = [
    { id: 'email', type: 'email', form: 'f' },
    { id: 'password', type: 'password', form: 'f' },
    { id: 'name', type: 'text', form: 'f', attrs: { autocomplete: 'name' } },
  ];
  const page = await createPage(specs);
  for (const [i, kind] of ['email', 'password', 'name'].entries()) await page.api.saveFillRule(kind, page.inputs[i], 'register');
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  const context = page.api.getFillContext();
  assert.equal(context.mode, 'register');
  assert.equal(context.targets.size, 3);
});

test('L25 旧版无 formSignature 的规则仍须全部解析，避免同 ID 登录页被部分命中', async () => {
  const page = await createPage([
    { id: 'signup-email', type: 'email', form: 'f' },
    { id: 'signup-password', type: 'password', form: 'f' },
  ], { email: rule('#signup-email'), password: rule('#signup-password'), name: rule('#signup-name') });
  const response = await page.api.fillProfile({ email: 'a@example.test', password: 'p', fullName: 'N' });
  assert.equal(response.ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('L25 字段指纹对不上视为本页不可解析，而非整套失效', async () => {
  const page = await createPage([...emailStep(), ...passwordStep().map(spec => ({ ...spec, form: 'login' }))]);
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  await page.api.saveFillRule('password', page.inputs[1], 'login');
  // 同表单特征仍一致时，指纹对不上的规则被跳过（这里把保存的指纹改掉模拟）。
  const saved = page.storage.pageFillRules[origin].login;
  saved.password.input = { ...saved.password.input, type: 'text' };
  const context = page.api.getFillContext();
  assert.equal(context.mode, 'login');
  assert.deepEqual([...context.targets.keys()], ['email']);
});

test('L25 独立验证码页：fill-value 回退自动识别，整组填充仍拒绝猜测', async () => {
  const page = await createPage([...emailStep(), ...passwordStep()]);
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  await page.api.saveFillRule('password', page.inputs[1], 'login');
  page.setInputs(codeStep());
  const single = await page.api.fillSingleValue('123456', 'verificationCode');
  assert.equal(single.ok, true);
  assert.equal(single.mode, 'auto');
  assert.deepEqual(values(page), ['123456']);
  page.inputs[0].value = '';
  assert.equal((await page.api.fillProfile({ verificationCode: '999999' })).ok, false);
  assert.deepEqual(values(page), ['']);
});

test('L25 规则集缺少该字段时 fill-value 回退，但不会写入已绑定给其他字段的框', async () => {
  const page = await createPage([
    { id: 'login-email', type: 'email', form: 'login' },
    { id: 'login-password', type: 'password', form: 'login' },
    { id: 'otp', type: 'text', form: 'login', attrs: { autocomplete: 'one-time-code' } },
  ]);
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  await page.api.saveFillRule('password', page.inputs[1], 'login');
  assert.equal((await page.api.fillSingleValue('4321', 'verificationCode')).ok, true);
  assert.equal((await page.api.fillSingleValue('Some Name', 'name')).ok, false);
  const email = await page.api.fillSingleValue('a@example.test', 'email');
  assert.equal(email.mode, 'login');
  assert.deepEqual(values(page), ['a@example.test', '', '4321']);
});

test('L25 注册/登录同时匹配时 fill-value 不回退', async () => {
  const page = await createPage([...emailStep(), ...codeStep().map(spec => ({ ...spec, form: 'login' }))]);
  await page.api.saveFillRule('email', page.inputs[0], 'register');
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  const response = await page.api.fillSingleValue('1', 'verificationCode');
  assert.equal(response.ok, false);
  assert.match(response.error, /同时匹配/);
});

test('M10 从左/上缩放拖出视口时对边固定', async () => {
  const { api } = await createPage([]);
  const viewport = { width: 1200, height: 800 };
  const start = { left: 100, top: 50, width: 400, height: 500 };
  assert.deepEqual(plain(api.computePanelResizeRect(start, 'w', -300, 0, viewport)), { left: 0, top: 50, width: 500, height: 500 });
  assert.deepEqual(plain(api.computePanelResizeRect(start, 'w', 300, 0, viewport)), { left: 180, top: 50, width: 320, height: 500 });
  assert.deepEqual(plain(api.computePanelResizeRect(start, 'n', 0, -200, viewport)), { left: 100, top: 0, width: 400, height: 550 });
  assert.deepEqual(plain(api.computePanelResizeRect(start, 'nw', -300, -200, viewport)), { left: 0, top: 0, width: 500, height: 550 });
  // 右 / 下方向仍受视口限制
  assert.deepEqual(plain(api.computePanelResizeRect(start, 'se', 2000, 2000, viewport)), { left: 100, top: 50, width: 1100, height: 750 });
  assert.deepEqual(plain(api.computePanelResizeRect(start, 'e', -1000, 0, viewport)), { left: 100, top: 50, width: 320, height: 500 });
});

test('L23 黑白名单匹配大小写不敏感', async () => {
  const { api } = await createPage([]);
  const url = 'https://a.example.com/path';
  assert.equal(api.matchesFloatSitePattern(url, '*.Example.COM'), true);
  assert.equal(api.matchesFloatSitePattern('https://example.com/', '*.EXAMPLE.com'), true);
  assert.equal(api.matchesFloatSitePattern(url, 'HTTPS://A.Example.com'), true);
  assert.equal(api.matchesFloatSitePattern(url, 'Https://a.example.com/other'), true);
  assert.equal(api.matchesFloatSitePattern(url, 'EXAMPLE'), true);
  assert.equal(api.matchesFloatSitePattern(url, '*.other.com'), false);
  assert.equal(api.matchesFloatSitePattern(url, 'http://a.example.com'), false);
});

test('L25 复审：登录与注册表单同页并存且两套规则都完整命中时，仍拒绝歧义而非静默选注册', async () => {
  const page = await createPage([
    { id: 'login-email', type: 'email', form: 'login' },
    { id: 'login-password', type: 'password', form: 'login' },
    { id: 'reg-email', type: 'email', form: 'reg' },
    { id: 'reg-password', type: 'password', form: 'reg' },
    { id: 'reg-name', type: 'text', form: 'reg', attrs: { autocomplete: 'name' } },
  ]);
  await page.api.saveFillRule('email', page.inputs[0], 'login');
  await page.api.saveFillRule('password', page.inputs[1], 'login');
  for (const [i, kind] of [[2, 'email'], [3, 'password'], [4, 'name']]) await page.api.saveFillRule(kind, page.inputs[i], 'register');
  const context = page.api.getFillContext();
  assert.match(String(context.error || ''), /同时匹配/);
});
