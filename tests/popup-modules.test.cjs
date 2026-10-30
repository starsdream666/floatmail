const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

// ---------------- config-io：导入清洗（L11） ----------------

const configScope = { window: {}, URL, console };
runInNewContext(readFileSync(join(__dirname, '../popup-modules/config-io.js'), 'utf8'), configScope);
const { sanitizeImportValue } = configScope.window.PopupConfigIO;

test('bookmarks with non-http(s) url are still dropped', () => {
  const { value, dropped } = sanitizeImportValue('bookmarks', [
    { title: 'ok', url: 'https://example.com' },
    { title: 'js', url: 'javascript:alert(1)' },
    { title: 'chrome', url: 'chrome://settings' },
    { title: 'missing' }
  ]);
  assert.deepEqual(Array.from(value, (item) => item.title), ['ok']);
  assert.equal(dropped, 3);
});

test('generatedToolHistory keeps entries and clears invalid url', () => {
  const { value, dropped } = sanitizeImportValue('generatedToolHistory', [
    { id: 'a', url: 'https://example.com/signup' },
    { id: 'b', url: 'chrome://newtab/' },
    { id: 'c', url: '' },
    { id: 'd', url: 'javascript:alert(1)' },
    { id: 'e' }
  ]);
  assert.equal(dropped, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), [
    { id: 'a', url: 'https://example.com/signup' },
    { id: 'b', url: '' },
    { id: 'c', url: '' },
    { id: 'd', url: '' },
    { id: 'e' }
  ]);
});

// ---------------- mail-inbox-controller：删除在途切换（L15）/ 批量选择收敛（L16） ----------------

function createFakeElement(tag = 'div') {
  const classes = new Set();
  const listeners = {};
  const element = {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    textContent: '',
    disabled: false,
    checked: false,
    listeners,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name); else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name)
    },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    appendChild: (child) => { element.children.push(child); return child; },
    prepend: (child) => { element.children.unshift(child); },
    set innerHTML(value) { element.children = []; },
    get innerHTML() { return ''; }
  };
  return element;
}

function loadController() {
  const scope = {
    window: {},
    console,
    document: { createElement: (tag) => createFakeElement(tag) },
    confirm: () => true,
    alert: () => {}
  };
  runInNewContext(readFileSync(join(__dirname, '../popup-modules/mail-inbox-controller.js'), 'utf8'), scope);
  return scope.window.PopupMailInboxController;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function createHarness(serverMessages) {
  const { createInboxController } = loadController();
  const elements = {
    content: createFakeElement(),
    list: createFakeElement(),
    backToListButton: createFakeElement(),
    backToHomeButton: createFakeElement(),
    refreshButton: createFakeElement(),
    deleteButton: createFakeElement(),
    pane: createFakeElement(),
    tabBar: createFakeElement(),
    mainTitle: createFakeElement(),
    inboxTitle: createFakeElement(),
    homePanes: []
  };
  const batch = {
    toggleButton: createFakeElement(),
    actionBar: createFakeElement(),
    deleteButton: createFakeElement(),
    cancelButton: createFakeElement()
  };
  const state = { deleteGate: null, fetchCount: 0, messages: serverMessages };
  const controller = createInboxController({
    elements,
    deps: {
      renderInlineNotice: () => {},
      getErrorText: (error) => error.message,
      storageSet: () => Promise.resolve(),
      updateHeaderForTab: () => {},
      getActiveTab: () => 'temp-email'
    },
    adapter: {
      type: 'temp',
      title: 'T',
      subtitle: '',
      getTargetIdentity: (value) => value,
      getTargetTitle: (value) => value,
      serializeTarget: (value) => ({ address: value }),
      getMessageIdentity: (message) => message?.id,
      getMessageSubject: (message) => message.subject,
      getMessageTime: () => 0,
      getMessageSender: () => 's',
      fetchMessages: async () => { state.fetchCount += 1; return state.messages.slice(); },
      resetDetail: () => {},
      prepareDetail: () => {},
      renderDetail: () => {},
      renderDetailError: () => {},
      deleteMessage: () => state.deleteGate.promise
    },
    batch
  });
  return { controller, elements, batch, state };
}

function renderedSubjects(elements) {
  return elements.list.children.map((item) => {
    const header = item.children.find((child) => child.className === 'mail-item-header')
      || item.children.find((child) => child.children?.[0]?.className === 'mail-item-header')?.children[0];
    return header.children[0].textContent;
  });
}

test('single delete finishing after user went back to list still removes the row', async () => {
  const messages = [{ id: 1, subject: 'one' }, { id: 2, subject: 'two' }];
  const h = createHarness(messages);
  h.controller.open('box@test');
  await flush();
  assert.deepEqual(renderedSubjects(h.elements), ['one', 'two']);

  h.elements.list.children[0].listeners.click();       // 打开第 1 封
  assert.equal(h.controller.getMode(), 'detail');
  h.state.deleteGate = deferred();
  const clickDone = h.elements.deleteButton.listeners.click();
  h.elements.backToListButton.listeners.click();       // 删除在途时返回列表
  assert.equal(h.controller.getMode(), 'list');

  const fetchesBefore = h.state.fetchCount;
  h.state.deleteGate.resolve();
  await clickDone;
  assert.deepEqual(h.controller.getMessages().map((m) => m.id), [2]);
  assert.deepEqual(renderedSubjects(h.elements), ['two']);
  assert.equal(h.controller.getMode(), 'list');
  assert.equal(h.state.fetchCount, fetchesBefore, '已离开详情时不应强制刷新/切视图');
});

test('single delete finishing while another mail is open keeps that mail open', async () => {
  const h = createHarness([{ id: 1, subject: 'one' }, { id: 2, subject: 'two' }]);
  h.controller.open('box@test');
  await flush();
  h.elements.list.children[0].listeners.click();
  h.state.deleteGate = deferred();
  const clickDone = h.elements.deleteButton.listeners.click();
  h.elements.backToListButton.listeners.click();
  h.elements.list.children[1].listeners.click();       // 打开第 2 封
  h.state.deleteGate.resolve();
  await clickDone;
  assert.equal(h.controller.getMode(), 'detail');
  assert.deepEqual(h.controller.getMessages().map((m) => m.id), [2]);
});

test('single delete finishing while still viewing the same mail goes back and refreshes', async () => {
  const h = createHarness([{ id: 1, subject: 'one' }, { id: 2, subject: 'two' }]);
  h.controller.open('box@test');
  await flush();
  h.elements.list.children[0].listeners.click();
  h.state.deleteGate = deferred();
  const clickDone = h.elements.deleteButton.listeners.click();
  h.state.messages = [{ id: 2, subject: 'two' }];
  h.state.deleteGate.resolve();
  await clickDone;
  assert.equal(h.controller.getMode(), 'list');
  assert.deepEqual(renderedSubjects(h.elements), ['two']);
});

test('refresh drops batch selections that no longer exist and updates the counter', async () => {
  const h = createHarness([{ id: 1, subject: 'one' }, { id: 2, subject: 'two' }, { id: 3, subject: 'three' }]);
  h.controller.open('box@test');
  await flush();
  h.batch.toggleButton.listeners.click();               // 进入批量模式
  assert.equal(h.controller.batch.isActive(), true);
  const rowClick = { target: { closest: () => null } };
  h.elements.list.children[0].listeners.click(rowClick); // 勾选 1
  h.elements.list.children[1].listeners.click(rowClick); // 勾选 2
  assert.equal(h.batch.deleteButton.textContent, '删除所选 (2)');

  h.state.messages = [{ id: 2, subject: 'two' }, { id: 3, subject: 'three' }];
  await h.controller.refresh();
  assert.deepEqual(Array.from(h.controller.batch.getSelected()), [2]);
  assert.equal(h.batch.deleteButton.textContent, '删除所选 (1)');

  h.controller.batch.retain([]);
  assert.equal(h.batch.deleteButton.textContent, '删除所选');
  assert.equal(h.batch.deleteButton.disabled, true);
});
