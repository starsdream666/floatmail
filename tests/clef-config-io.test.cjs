const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup-modules/config-io.js'), 'utf8');
const accounts = [
  { id: 'one', name: '主账号', accountId: 'a'.repeat(32), apiToken: 'private-token-one' },
  { id: 'two', name: '备用账号', accountId: 'b'.repeat(32), apiToken: 'private-token-two' }
];
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness(initial = {}) {
  const store = plain(initial);
  const messages = [];
  let exported;
  const button = () => ({ handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, click() {} });
  const exportBtn = button();
  const importBtn = button();
  const importFileInput = button();
  const scope = {
    window: { confirm: () => true },
    document: { getElementById: () => null, createElement: button },
    chrome: { storage: { local: {
      get(_keys, callback) { callback(store); },
      set(values, callback) { Object.assign(store, plain(values)); callback(); }
    } } },
    Blob: class { constructor(parts) { this.text = parts.join(''); } },
    URL: { createObjectURL(blob) { exported = JSON.parse(blob.text); return 'blob:test'; }, revokeObjectURL() {} },
    FileReader: class { readAsText(file) { this.onload({ target: { result: file.text } }); } }
  };
  runInNewContext(source, scope);
  const controller = scope.window.PopupConfigIO.initConfigIO({
    exportBtn, importBtn, importFileInput, ioMessage: {},
    configChecks: [{ checked: true, value: 'mailDisplay' }],
    showMessage: (_element, message) => messages.push(message)
  });
  return {
    store, messages, controller,
    export() { exportBtn.handlers.click(); return exported; },
    import(mailDisplay) {
      const text = JSON.stringify({ _meta: { categories: ['mailDisplay'] }, mailDisplay });
      importFileInput.handlers.change({ target: { files: [{ text, size: text.length }] } });
    }
  };
}

test('账号池默认导出保留账号信息并逐项脱敏 Key，脱敏导入不覆盖原池', () => {
  const env = harness({ clefAccounts: accounts, clefModel: 'clef' });
  const exported = env.export();
  assert.equal(exported.mailDisplay.clefAccounts.length, 2);
  accounts.forEach((account, index) => {
    assert.equal(exported.mailDisplay.clefAccounts[index].accountId, account.accountId);
    assert.equal(exported.mailDisplay.clefAccounts[index].apiToken.__redacted, true);
    assert.ok(!JSON.stringify(exported).includes(account.apiToken));
  });
  env.import(exported.mailDisplay);
  assert.deepEqual(env.store.clefAccounts, accounts);
  assert.ok(env.messages.some((message) => message.includes('脱敏')));
});

test('明确导出明文时保留完整绑定，明文导入能往返', () => {
  const env = harness({ clefAccounts: accounts });
  env.controller.setIncludePlaintextSecrets(true);
  const exported = env.export();
  const other = harness();
  other.import(exported.mailDisplay);
  assert.deepEqual(other.store.clefAccounts, accounts);
});

test('导入旧 ID+多 Key 时原子迁移账号池，不留下旧新配置冲突', () => {
  const env = harness({ clefAccounts: accounts });
  env.import({ clefAccountId: 'c'.repeat(32), clefApiToken: ' old-one\r\n old-two\n old-one ' });
  assert.deepEqual(env.store.clefAccounts.map((item) => [item.accountId, item.apiToken]), [
    ['c'.repeat(32), 'old-one'], ['c'.repeat(32), 'old-two']
  ]);
});

test('非法绑定和部分脱敏账号池均不能破坏当前绑定', () => {
  const env = harness({ clefAccounts: accounts });
  env.import({ clefAccounts: [{ accountId: '../other-account', apiToken: 'x' }], clefModel: 'clef' });
  assert.deepEqual(env.store.clefAccounts, accounts);
  env.import({ clefAccounts: [{ accountId: 'a'.repeat(32), apiToken: 'token-a\ntoken-b' }], clefModel: 'clef' });
  assert.deepEqual(env.store.clefAccounts, accounts);
  env.import({ clefAccounts: [accounts[0], { ...accounts[1], apiToken: { __redacted: true } }],
    clefAccountId: '', clefApiToken: '', clefModel: 'clef' });
  assert.deepEqual(env.store.clefAccounts, accounts);
});
