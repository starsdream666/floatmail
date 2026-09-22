const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const origin = 'https://example.test';
const profile = { email: 'registered@example.test', password: 'existing-password', fullName: 'Test Person', verificationCode: '654321' };
const contentSource = readFileSync(join(__dirname, '../content.js'), 'utf8');

// 只截断悬浮窗启动，不复制业务实现。模拟 DOM 验证实际 content.js 的匹配、存储、写入与消息逻辑。
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
      if (selector === 'input') return inputs;
      const index = /^input:nth-of-type\((\d+)\)$/.exec(selector);
      if (index) return inputs[Number(index[1]) - 1] ? [inputs[Number(index[1]) - 1]] : [];
      const type = /^input\[type="(.+)"\]$/.exec(selector);
      if (type) return inputs.filter(input => input.type === type[1]);
      throw new Error(`Unsupported test selector: ${selector}`);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  };
  function setInputs(nextSpecs) {
    inputs.forEach(input => { input.isConnected = false; });
    inputs = nextSpecs.map(spec => {
      if (spec.form && !forms.has(spec.form)) forms.set(spec.form, { id: spec.form });
      const input = {
        nodeType: 1, tagName: 'INPUT', id: '', type: 'text', name: '', placeholder: '',
        value: '', hidden: false, disabled: false, readOnly: false, isConnected: true,
        labels: [], writes: [], attrs: {}, ...spec,
        form: spec.form ? forms.get(spec.form) : null,
        ownerDocument: document,
        getAttribute(key) { return this.attrs[key] ?? (['id', 'type', 'name', 'placeholder'].includes(key) ? this[key] : null); },
        getRootNode() { return document; },
        closest() { return this.form; },
        getBoundingClientRect() { return { width: this.hidden ? 0 : 180, height: this.hidden ? 0 : 30 }; },
        focus() { api.focus(this); },
        dispatchEvent(event) {
          if (event.type === 'input') { this.writes.push(this.value); this.onInput?.(this); }
        },
      };
      return input;
    });
    return inputs;
  }
  const scope = {
    window, document, Node: { ELEMENT_NODE: 1, DOCUMENT_NODE: 9 },
    chrome: { storage: { local: {
      get(keys, callback) { callback(storage); },
      set(patch, callback) { Object.assign(storage, patch); callback(); },
    } } },
  };
  const source = contentSource.replace('  pageToolsController.dispose = disposePageTools;', `
    window.testApi = { getFillContext, buildFillPlan, fillProfile, fillSingleValue, saveFillRule,
      getRuleFields, getFormSignature, getInputFingerprint, queryEditableElement, handleRuntimeMessage,
      focus(element) { lastFocusedElement = element; },
      setRules(rules) { allFillRules = { [window.location.origin]: rules }; },
      allowSite(allowed) { siteToolsAllowed = allowed; siteToolsPermissionReady = Promise.resolve(allowed); }
    };
    return;
    pageToolsController.dispose = disposePageTools;`);
  assert.notEqual(source, contentSource, 'Test seam must exist');
  runInNewContext(source, scope);
  const api = window.testApi;
  setInputs(specs);
  await Promise.resolve();
  return { api, storage, window, document, setInputs, get inputs() { return inputs; } };
}

const registration = () => [
  { id: 'signup-email', type: 'email', form: 'account' },
  { id: 'signup-password', type: 'password', form: 'account', attrs: { autocomplete: 'new-password' } },
  { id: 'signup-name', type: 'text', form: 'account', attrs: { autocomplete: 'name' } },
  { id: 'signup-code', type: 'text', form: 'account', attrs: { autocomplete: 'one-time-code' } },
];
const login = () => [
  { id: 'login-email', type: 'email', form: 'account' },
  { id: 'login-password', type: 'password', form: 'account', attrs: { autocomplete: 'current-password' } },
];
const rule = selector => ({ selector, contextPath: [] });
const legacyRules = () => ({
  email: rule('#signup-email'), password: rule('#signup-password'), name: rule('#signup-name'), verificationCode: rule('#signup-code'),
});
async function bind(page, mode, kinds) {
  for (let i = 0; i < kinds.length; i++) await page.api.saveFillRule(kinds[i], page.inputs[i], mode);
}
const values = page => page.inputs.map(input => input.value);
const plain = value => JSON.parse(JSON.stringify(value));

// 用户报告的主场景：旧注册规则 + 新登录规则 + 同一批历史凭据。
test('four-field legacy registration -> login -> registration stays isolated', async () => {
  const page = await createPage(registration(), legacyRules());
  let response = await page.api.fillProfile(profile, { rulesOnly: true });
  assert.equal(response.filled, 4);
  assert.equal(response.mode, 'register');
  page.setInputs(login());
  await bind(page, 'login', ['email', 'password']);
  response = await page.api.fillProfile(profile, { rulesOnly: true });
  assert.equal(response.mode, 'login');
  assert.equal(response.filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password]);
  assert.deepEqual(page.inputs.map(input => input.writes.length), [1, 1]);
  assert.deepEqual(plain(page.api.getRuleFields('register')), legacyRules());
  page.setInputs(registration());
  response = await page.api.fillProfile(profile);
  assert.equal(response.mode, 'register');
  assert.equal(response.filled, 4);
  assert.deepEqual(values(page), [profile.email, profile.password, profile.fullName, profile.verificationCode]);
});

test('new registration stores input fingerprints and form counts without field values', async () => {
  const page = await createPage(registration());
  await bind(page, 'register', ['email', 'password', 'name', 'verificationCode']);
  const saved = page.storage.pageFillRules[origin];
  assert.equal(saved.email.input.type, 'email');
  assert.equal(saved.email.formSignature.length, 4);
  assert.equal(JSON.stringify(saved).includes(profile.password), false);
  assert.equal((await page.api.fillProfile(profile)).filled, 4);
});

test('unbound login cannot fall back to registration selectors or focused email', async () => {
  const page = await createPage(login(), {
    email: rule('input:nth-of-type(1)'), password: rule('input:nth-of-type(2)'),
    name: rule('input:nth-of-type(1)'), verificationCode: rule('input:nth-of-type(4)'),
  });
  page.api.focus(page.inputs[0]);
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.equal((await page.api.fillSingleValue(profile.fullName, 'name')).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('login with only email/password bindings ignores other supplied fields', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  const response = await page.api.fillProfile({ ...profile, confirmPassword: 'must-not-write', address: 'must-not-write' });
  assert.equal(response.filled, 2);
  assert.equal((await page.api.fillSingleValue(profile.fullName, 'name')).ok, false);
  assert.equal((await page.api.fillSingleValue('must-not-write', 'confirmPassword')).ok, false);
  assert.deepEqual(values(page), [profile.email, profile.password]);
});

test('a single available password is not treated as confirmation', async () => {
  const page = await createPage(login());
  assert.equal((await page.api.fillSingleValue('bad', 'confirmPassword')).ok, false);
  assert.equal((await page.api.fillProfile(profile)).filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password]);
});

test('focus and username text do not make an email field a person name', async () => {
  const page = await createPage([{ id: 'username', type: 'text' }, { id: 'password', type: 'password' }]);
  page.api.focus(page.inputs[0]);
  assert.equal((await page.api.fillSingleValue(profile.fullName, 'name')).ok, false);
  assert.equal((await page.api.fillProfile(profile)).filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password]);
});

test('duplicate target binding is rejected at save time', async () => {
  const page = await createPage([{ id: 'a', type: 'text' }]);
  await page.api.saveFillRule('email', page.inputs[0]);
  await assert.rejects(page.api.saveFillRule('name', page.inputs[0]), /已绑定/);
  assert.equal(page.storage.pageFillRules[origin].name, undefined);
});

test('imported rules sharing one target fail before writing anything', async () => {
  const page = await createPage([{ id: 'a', type: 'text' }], { email: rule('#a'), name: rule('#a') });
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['']);
});

test('manual registration mappings override native types and field semantics', async () => {
  const page = await createPage([
    { id: 'email', type: 'email', form: 'account' },
    { id: 'name', type: 'text', form: 'account', attrs: { autocomplete: 'name' } },
  ]);
  await bind(page, 'register', ['name', 'email']);
  const plan = page.api.buildFillPlan(profile);
  assert.deepEqual(plain(plan.map(item => [item.operation.kind, item.target.id])), [['email', 'name'], ['name', 'email']]);
  assert.equal((await page.api.fillProfile(profile)).filled, 2);
  assert.deepEqual(values(page), [profile.fullName, profile.email]);
  assert.deepEqual(page.inputs.map(input => input.writes.length), [1, 1]);
  assert.equal((await page.api.fillSingleValue('Another Person', 'name')).ok, true);
  assert.equal(page.inputs[0].value, 'Another Person');
});

test('manual login mappings can override both email and password target types', async () => {
  const page = await createPage(login());
  await page.api.saveFillRule('email', page.inputs[1], 'login');
  await page.api.saveFillRule('password', page.inputs[0], 'login');
  const response = await page.api.fillProfile(profile);
  assert.equal(response.mode, 'login');
  assert.equal(response.filled, 2);
  assert.deepEqual(values(page), [profile.password, profile.email]);
});

test('login can bind unlabeled plain text inputs without password semantics', async () => {
  const page = await createPage([{ id: 'a', type: 'text' }, { id: 'b', type: 'text' }]);
  await bind(page, 'login', ['email', 'password']);
  assert.equal((await page.api.fillProfile(profile)).mode, 'login');
  assert.deepEqual(values(page), [profile.email, profile.password]);
});

test('custom login forms with more than three inputs match the saved actual shape', async () => {
  const page = await createPage([
    { id: 'a', type: 'text' }, { id: 'b', type: 'text' },
    { id: 'name', type: 'text' }, { id: 'captcha', type: 'text' }, { id: 'tenant', type: 'text' },
  ]);
  await bind(page, 'login', ['email', 'password']);
  const response = await page.api.fillProfile(profile);
  assert.equal(response.mode, 'login');
  assert.equal(response.filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password, '', '', '']);
});

test('textarea and contenteditable targets accept explicit bindings', async () => {
  const page = await createPage([
    { id: 'a', tagName: 'TEXTAREA', type: 'textarea' },
    { id: 'b', tagName: 'DIV', type: '', isContentEditable: true },
  ]);
  await bind(page, 'login', ['email', 'password']);
  assert.equal((await page.api.fillProfile(profile)).filled, 2);
  assert.equal(page.inputs[0].value, profile.email);
  assert.equal(page.inputs[1].textContent, profile.password);
});

test('legacy manual rules without fingerprints also honor the chosen target', async () => {
  const page = await createPage([{ id: 'email', type: 'email' }], { name: rule('#email') });
  assert.equal((await page.api.fillSingleValue(profile.fullName, 'name')).ok, true);
  assert.equal(page.inputs[0].value, profile.fullName);
});

test('binding still rejects non-editable targets and unsupported login fields', async () => {
  for (const spec of [
    { type: 'hidden' }, { type: 'text', hidden: true }, { type: 'text', disabled: true },
    { type: 'text', readOnly: true }, { type: 'checkbox' },
  ]) {
    const page = await createPage([{ id: 'a', ...spec }]);
    await assert.rejects(page.api.saveFillRule('email', page.inputs[0]), /可编辑/);
  }
  const page = await createPage(login());
  await assert.rejects(page.api.saveFillRule('unsupported-field', page.inputs[0], 'login'), /不支持/);
});

test('duplicate selector matches are not silently resolved to the first field', async () => {
  const page = await createPage([{ id: 'email', type: 'email' }, { id: 'email', type: 'email' }], { email: rule('#email') });
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('invalid selector does not trigger heuristic fallback', async () => {
  const page = await createPage(login(), { email: rule('[') });
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('new visible input changes count and invalidates a saved login form', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  page.setInputs([...login(), { id: 'extra', type: 'text', form: 'account' }]);
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['', '', '']);
});

test('same count but changed input type/role invalidates the rule', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  page.inputs[0].type = 'password';
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('count comes from the matched form, not unrelated search/newsletter forms', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  page.setInputs([...login(), { id: 'search', type: 'search', form: 'search' }, { id: 'newsletter', type: 'email', form: 'newsletter' }]);
  assert.equal((await page.api.fillProfile(profile)).filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password, '', '']);
});

test('hidden and disabled inputs do not count as usable fields', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  page.setInputs([...login(), { id: 'csrf', type: 'hidden', form: 'account' },
    { id: 'hidden-name', type: 'text', form: 'account', hidden: true },
    { id: 'disabled-name', type: 'text', form: 'account', disabled: true }]);
  assert.equal((await page.api.fillProfile(profile)).filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password, '', '', '']);
});

test('bindings in different forms cannot form one credential pair', async () => {
  const page = await createPage([{ ...login()[0], form: 'one' }, { ...login()[1], form: 'two' }],
    { login: { email: rule('#login-email'), password: rule('#login-password') } });
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('registration/login simultaneously matching refuses ambiguity', async () => {
  const page = await createPage(login());
  await bind(page, 'register', ['email', 'password']);
  await bind(page, 'login', ['email', 'password']);
  const response = await page.api.fillProfile(profile);
  assert.equal(response.ok, false);
  assert.match(response.error, /同时匹配/);
  assert.deepEqual(values(page), ['', '']);
});

test('new-password annotation does not override an explicit login binding', async () => {
  const page = await createPage([registration()[0], registration()[1]]);
  await bind(page, 'login', ['email', 'password']);
  const response = await page.api.fillProfile(profile);
  assert.equal(response.mode, 'login');
  assert.equal(response.filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password]);
});

test('single-value fill and preview plan share login isolation', async () => {
  const page = await createPage(login(), legacyRules());
  await bind(page, 'login', ['email', 'password']);
  const plan = page.api.buildFillPlan(profile);
  assert.deepEqual(plain(plan.map(item => item.operation.kind)), ['email', 'password']);
  assert.equal((await page.api.fillSingleValue(profile.email, 'email')).mode, 'login');
  assert.equal((await page.api.fillSingleValue(profile.password, 'password')).ok, true);
  assert.deepEqual(values(page), [profile.email, profile.password]);
});

test('synchronous DOM replacement stops the batch instead of remapping remaining fields', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  const oldInputs = page.inputs.slice();
  page.inputs[0].onInput = () => page.setInputs(login());
  const response = await page.api.fillProfile(profile);
  assert.equal(response.partial, true);
  assert.equal(response.filled, 1);
  assert.equal(oldInputs[0].value, profile.email);
  assert.equal(oldInputs[1].value, '');
  assert.deepEqual(values(page), ['', '']);
});

test('changed mode or origin between generation and fill rejects pending credentials', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  assert.equal((await page.api.fillProfile(profile, { expectedMode: 'register' })).ok, false);
  assert.equal((await page.api.fillProfile(profile, { expectedOrigin: 'https://other.test' })).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('empty contextPath stays in the top document instead of another iframe', async () => {
  const page = await createPage([]);
  let queriedChild = false;
  const childRoot = { querySelectorAll() { queriedChild = true; return [{}]; } };
  assert.equal(page.api.queryEditableElement('#email', [], () => [childRoot]), null);
  assert.equal(queriedChild, false);
});

test('rulesOnly fill with no rules cannot silently use automatic heuristics', async () => {
  const page = await createPage(login());
  assert.equal((await page.api.fillProfile(profile, { rulesOnly: true })).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('history fill handler sends a single profile request rather than independent field writes', () => {
  const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');
  const historyHandler = source.slice(source.indexOf('  function renderFastFillHistory()'), source.indexOf('  async function fastFillJumpToInbox'));
  assert.match(historyHandler, /type: 'fill-profile'/);
  assert.match(historyHandler, /rulesOnly: true/);
  assert.doesNotMatch(historyHandler, /type: 'fill-value'/);
});

test('runtime get-fill-context message returns active mode and permitted fields', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  page.api.allowSite(true);
  const response = await new Promise(resolve => page.api.handleRuntimeMessage({ type: 'get-fill-context' }, {}, resolve));
  assert.deepEqual(plain(response), { ok: true, mode: 'login', kinds: ['email', 'password'], origin });
});

test('same URL and selectors distinguish new-password registration from current-password login', async () => {
  const page = await createPage(login());
  page.inputs[1].attrs.autocomplete = 'new-password';
  await bind(page, 'register', ['email', 'password']);
  page.inputs[1].attrs.autocomplete = 'current-password';
  await bind(page, 'login', ['email', 'password']);
  assert.equal((await page.api.fillProfile(profile)).mode, 'login');
  page.inputs[1].attrs.autocomplete = 'new-password';
  assert.equal((await page.api.fillProfile(profile)).mode, 'register');
});

test('focus-triggered replacement is not counted as a successful write', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  page.inputs[0].focus = () => page.setInputs(login());
  const response = await page.api.fillProfile(profile);
  assert.equal(response.ok, false);
  assert.equal(response.filled, 0);
  assert.deepEqual(values(page), ['', '']);
});

test('hidden iframe fields are excluded even when child rectangles have dimensions', async () => {
  const page = await createPage(login());
  await bind(page, 'login', ['email', 'password']);
  const frame = { nodeType: 1, ownerDocument: page.document, hidden: true,
    getBoundingClientRect: () => ({ width: 0, height: 0 }) };
  const childDocument = { defaultView: { ...page.window, frameElement: frame } };
  page.inputs.forEach(input => { input.ownerDocument = childDocument; });
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['', '']);
});

test('login supports all ten fields in storage, previews, single and batch fills', async () => {
  const kinds = ['email', 'password', 'confirmPassword', 'verificationCode', 'name',
    'lastName', 'firstName', 'birthday', 'age', 'address'];
  const fields = { ...profile, confirmPassword: 'separate-confirmation', lastName: 'Person',
    firstName: 'Test', birthday: '1990-01-02', age: '36', address: 'Test Street' };
  const page = await createPage(kinds.map((kind, i) => ({ id: `custom-${i}`, type: 'text', form: 'custom' })), legacyRules());
  await bind(page, 'login', kinds);
  assert.deepEqual(Object.keys(page.storage.pageFillRules[origin].login).sort(), [...kinds].sort());
  assert.deepEqual(plain(page.api.getRuleFields('register')), legacyRules());
  const plan = page.api.buildFillPlan(fields);
  assert.equal(plan.length, 10);
  assert.equal(new Set(plan.map(item => item.target)).size, 10);
  assert.equal((await page.api.fillProfile(fields, { rulesOnly: true })).filled, 10);
  assert.deepEqual(values(page), kinds.map(kind => fields[kind === 'name' ? 'fullName' : kind]));
  assert.deepEqual(page.inputs.map(input => input.writes.length), kinds.map(() => 1));
  for (const kind of kinds) {
    assert.equal((await page.api.fillSingleValue(`single-${kind}`, kind)).mode, 'login');
  }
  assert.deepEqual(values(page), kinds.map(kind => `single-${kind}`));
  page.api.allowSite(true);
  const result = await new Promise(resolve => page.api.handleRuntimeMessage({ type: 'get-fill-context' }, {}, resolve));
  assert.equal(result.mode, 'login');
  assert.deepEqual(plain(result.kinds).sort(), [...kinds].sort());
});

test('four-field login and registration have independent name and verification mappings', async () => {
  const page = await createPage(registration());
  const kinds = ['email', 'password', 'name', 'verificationCode'];
  await bind(page, 'register', kinds);
  const loginSpecs = [
    ...login(), { id: 'login-name', type: 'text', form: 'account' },
    { id: 'login-code', type: 'text', form: 'account', attrs: { autocomplete: 'one-time-code' } },
  ];
  page.setInputs(loginSpecs);
  await bind(page, 'login', kinds);
  assert.equal((await page.api.fillProfile(profile)).mode, 'login');
  assert.deepEqual(values(page), [profile.email, profile.password, profile.fullName, profile.verificationCode]);
  page.setInputs(registration());
  assert.equal((await page.api.fillProfile(profile)).mode, 'register');
  assert.deepEqual(values(page), [profile.email, profile.password, profile.fullName, profile.verificationCode]);
});

test('login with only a name or code needs no email or password binding', async () => {
  for (const [kind, fields, expected] of [
    ['name', { fullName: 'Account Alias' }, 'Account Alias'],
    ['verificationCode', { verificationCode: '009911' }, '009911'],
    ['confirmPassword', { confirmPassword: 'standalone-confirm' }, 'standalone-confirm'],
  ]) {
    const page = await createPage([{ id: 'custom', type: 'text' }]);
    await bind(page, 'login', [kind]);
    const response = await page.api.fillProfile(fields, { rulesOnly: true });
    assert.equal(response.mode, 'login');
    assert.equal(response.filled, 1);
    assert.deepEqual(values(page), [expected]);
  }
});

test('missing login field values do not overwrite existing values or use registration data', async () => {
  const page = await createPage([
    ...login(), { id: 'custom-name', type: 'text', form: 'account', value: 'keep-name' },
    { id: 'custom-code', type: 'text', form: 'account', value: 'keep-code' },
  ], legacyRules());
  await bind(page, 'login', ['email', 'password', 'name', 'verificationCode']);
  const response = await page.api.fillProfile({ email: profile.email, password: profile.password });
  assert.equal(response.filled, 2);
  assert.deepEqual(values(page), [profile.email, profile.password, 'keep-name', 'keep-code']);
});

test('new login fields share the same duplicate target protection', async () => {
  const page = await createPage([{ id: 'target', type: 'text' }]);
  await bind(page, 'login', ['name']);
  await assert.rejects(page.api.saveFillRule('verificationCode', page.inputs[0], 'login'), /已绑定/);
  page.api.setRules({ login: { name: rule('#target'), verificationCode: rule('#target') } });
  assert.equal((await page.api.fillProfile(profile)).ok, false);
  assert.deepEqual(values(page), ['']);
});

test('runtime rules and fill messages respect site access restrictions', async () => {
  const page = await createPage(login());
  page.api.allowSite(false);
  for (const type of ['get-fill-context', 'fill-profile', 'start-field-selection']) {
    const response = await new Promise(resolve => page.api.handleRuntimeMessage({ type, fields: profile }, {}, resolve));
    assert.equal(response.ok, false);
    assert.match(response.error, /禁用/);
  }
  assert.deepEqual(values(page), ['', '']);
});
