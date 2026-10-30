const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup-modules/ai-connection-test.js'), 'utf8');
function engine(deps = {}) {
  const scope = { window: {}, URL };
  runInNewContext(source, scope);
  const api = scope.window.PopupAiConnectionTest;
  return { api, tester: api.createTester(deps) };
}

const config = { apiBase: 'https://ai.example.test/v1/', apiKey: 'private-test-key', model: 'draft-model' };
const answer = { connection_test: { type: 'noul', noul: 0.98 } };

test('Chat 测试实际调用所填模型并发送固定短样例', async () => {
  let sent;
  const { tester } = engine({ requestChatCompletion: async (value) => { sent = value; return 'OK'; } });
  const result = await tester.testChat(config);
  assert.equal(result.ok, true);
  assert.equal(sent.apiBase, 'https://ai.example.test/v1');
  assert.equal(sent.model, 'draft-model');
  assert.equal(sent.apiKey, config.apiKey);
  assert.match(sent.messages[0].content, /Connection test/);
  assert.ok(result.elapsedMs >= 0);
});

test('未配置、地址非法或空响应不会误报成功，错误中的 Key 会隐藏', async () => {
  let calls = 0;
  const { tester } = engine({ requestChatCompletion: async () => { calls++; return ''; } });
  for (const invalid of [{ ...config, apiBase: '' }, { ...config, apiBase: 'javascript:alert(1)' },
    { ...config, apiKey: '' }, { ...config, model: '' }]) {
    assert.equal((await tester.testChat(invalid)).ok, false);
  }
  assert.equal(calls, 0);
  assert.match((await tester.testChat(config)).error, /空内容/);
  const failed = engine({ requestChatCompletion: async () => { throw new Error(`Unauthorized: ${config.apiKey}`); } });
  const result = await failed.tester.testChat(config);
  assert.equal(result.ok, false);
  assert.ok(!result.error.includes(config.apiKey));
  assert.match(result.error, /Unauthorized/);
});

test('提取 API 测试检查响应格式，普通文本不能当提取接口可用', async () => {
  let response = 'OK';
  let sent;
  const { tester } = engine({ requestChatCompletion: async (value) => { sent = value; return response; } });
  assert.match((await tester.testChat(config, 'insight')).error, /提取 JSON/);
  assert.match(sent.messages[1].content, /482913/);
  response = '{"codes":["482913"],"links":[]}';
  assert.equal((await tester.testChat(config, 'insight')).ok, true);
});

test('JEV 每个 Key 独立测试、去空去重，失败不被另一个 Key 的成功掩盖', async () => {
  const calls = [];
  const { tester, api } = engine({ request: async (url, init) => {
    calls.push({ url, init });
    const failed = calls.length === 1;
    return { ok: !failed, status: failed ? 401 : 200, json: async () => failed
      ? { error: { message: 'invalid private-one' } } : { answers: answer } };
  } });
  const result = await tester.testJev({ apiBase: config.apiBase, apiKeys: ' private-one\n private-two\nprivate-one ',
    endpointPath: '/typesafe/v1/systemone', model: 'jev-latest' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://ai.example.test/v1/typesafe/v1/systemone');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer private-one');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer private-two');
  assert.equal(JSON.parse(calls[0].init.body).model, 'jev-latest');
  assert.equal(result.ok, false);
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[1].ok, true);
  assert.match(api.describe(result), /1\/2/);
  assert.ok(!JSON.stringify(result).includes('private-one'));
});

test('JEV HTTP 200 的错误协议或错误路径不能判成功', async () => {
  let calls = 0;
  const { tester } = engine({ request: async () => { calls++; return { ok: true, status: 200, json: async () => ({ choices: [] }) }; } });
  const base = { apiBase: config.apiBase, apiKeys: 'x', endpointPath: '/systemone', model: 'jev' };
  assert.equal((await tester.testJev({ ...base, endpointPath: '//other.test' })).ok, false);
  assert.equal(calls, 0);
  assert.match((await tester.testJev(base)).results[0].error, /有效的判定结果/);
});

test('Clef 测试严格指定单个账号与模型，并关闭自动重试', async () => {
  const account = { id: 'draft', name: '未保存账号', accountId: 'a'.repeat(32), apiToken: 'private-clef-key' };
  let captured;
  const { tester } = engine({ request() {}, clef: { request: async (...args) => { captured = args; return { answers: answer }; } } });
  assert.equal((await tester.testClefAccount(account, 'clef-flash')).ok, true);
  assert.equal(captured[2].accounts.length, 1);
  assert.equal(captured[2].accounts[0], account);
  assert.equal(captured[2].model, 'clef-flash');
  assert.equal(captured[3].maxAttempts, 1);
});

test('Clef 空判定或异常报失败，错误不泄露 Key', async () => {
  const account = { apiToken: 'private-clef-key' };
  const empty = engine({ clef: { request: async () => ({ answers: {} }) } });
  assert.match((await empty.tester.testClefAccount(account, 'clef')).error, /有效的判定结果/);
  const failed = engine({ clef: { request: async () => { throw new Error(`HTTP 403 ${account.apiToken}`); } } });
  const result = await failed.tester.testClefAccount(account, 'clef');
  assert.equal(result.ok, false);
  assert.match(result.error, /403/);
  assert.ok(!result.error.includes(account.apiToken));
});

function element() {
  return { textContent: '测试连接', disabled: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
}

test('测试按钮防止重复请求，改动配置后不显示旧配置的成功结论', async () => {
  const { api } = engine();
  const button = element();
  const status = element();
  let model = 'old-model';
  let finish;
  let calls = 0;
  api.bindButton(button, status, () => ({ model }), () => {
    calls++;
    return new Promise((resolve) => { finish = resolve; });
  });
  const pending = button.handlers.click();
  assert.equal(button.disabled, true);
  await button.handlers.click();
  assert.equal(calls, 1);
  model = 'new-model';
  finish({ ok: true, elapsedMs: 10 });
  await pending;
  assert.match(status.textContent, /配置已修改/);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, '测试连接');
});

test('已完成的成功提示在配置再次编辑后失效；空池不报告全部成功', async () => {
  const { api } = engine();
  const button = element();
  const status = element();
  const control = element();
  let key = 'old-key';
  api.bindButton(button, status, () => ({ key }), async () => ({ ok: true }), [control]);
  await button.handlers.click();
  assert.match(status.textContent, /连接成功/);
  key = 'new-key';
  control.handlers.input();
  assert.match(status.textContent, /配置已修改/);
  assert.equal(api.batchResult([]).ok, false);
});
