const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const DIR = join(__dirname, '..');
const BACKGROUND_SOURCE = readFileSync(join(DIR, 'background.js'), 'utf8');
const SHARED_UTILS_SOURCE = readFileSync(join(DIR, 'shared-utils.js'), 'utf8');
const MANIFEST = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const EXTENSION_ID = 'floatmail-test-id';

// 在 vm 中加载 background.js，chrome.* 全部用内存实现，便于验证后台纯逻辑与消息处理。
function loadBackground(initialStorage = {}, fetchImpl = null) {
  const store = JSON.parse(JSON.stringify(initialStorage));
  const listeners = { message: null, storageChanged: null };
  const badgeTexts = [];
  const notifications = [];
  const dynamicRuleUpdates = [];
  const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const event = (name) => ({
    addListener(fn) {
      if (name) listeners[name] = fn;
    },
  });

  const chrome = {
    runtime: {
      id: EXTENSION_ID,
      lastError: null,
      onInstalled: event(),
      onStartup: event(),
      onMessage: event('message'),
      getURL: (path) => `chrome-extension://${EXTENSION_ID}/${path}`,
    },
    storage: {
      local: {
        get(keys, callback) {
          const list = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : Object.keys(keys || store));
          const result = {};
          for (const key of list) {
            if (store[key] !== undefined) result[key] = clone(store[key]);
          }
          callback(result);
        },
        set(items, callback) {
          Object.assign(store, clone(items));
          callback();
        },
        remove(keys, callback) {
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]);
          callback();
        },
      },
      onChanged: event('storageChanged'),
    },
    alarms: {
      clear: (name, callback) => callback(true),
      create: async () => {},
      onAlarm: event(),
    },
    notifications: {
      create(id, options, callback) {
        notifications.push({ id, options });
        callback(id);
      },
      clear() {},
      onClicked: event(),
      onClosed: event(),
    },
    action: {
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async ({ text }) => {
        badgeTexts.push(text);
      },
    },
    declarativeNetRequest: {
      async updateDynamicRules(update) {
        dynamicRuleUpdates.push(clone(update));
      },
    },
    tabs: {},
    scripting: {},
  };

  const context = {
    chrome,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    AbortController,
    URL,
    fetch: fetchImpl || (async () => {
      throw new Error('未配置 fetch');
    }),
  };
  context.globalThis = context;
  context.importScripts = () => runInNewContext(SHARED_UTILS_SOURCE, context);
  runInNewContext(BACKGROUND_SOURCE, context);
  return { context, store, listeners, badgeTexts, notifications, dynamicRuleUpdates };
}

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => data };
}

// vm 内创建的对象原型属于另一个 realm，deepStrictEqual 前先转成本 realm 的普通对象。
const plain = (value) => JSON.parse(JSON.stringify(value));

function sendMessage(env, message) {
  return new Promise((resolve) => {
    env.listeners.message(message, { id: EXTENSION_ID, origin: `chrome-extension://${EXTENSION_ID}` }, (response) => {
      resolve(plain(response));
    });
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('Moe 超过 100 封旧邮件重复轮询不会新增未读，新邮件只通知一次', async () => {
  let messages = Array.from({ length: 151 }, (_, index) => ({ id: String(index), subject: 'old', received_at: '2020-01-01T00:00:00Z' }));
  const env = loadBackground({ moeApiUrl: 'https://moe.example.com', moeApiKey: 'test-key',
    moeEmailCache: [{ id: 'box', address: 'box@example.com' }], activeInbox: { type: 'moe', emailId: 'box' } },
  async () => jsonResponse({ messages }));
  for (let index = 0; index < 3; index++) await env.context.pollMailNow();
  assert.equal(env.store.moeKnownMailIds.box.length, 151);
  assert.equal(env.store.moeUnreadCounts.box, 0);
  assert.equal(env.notifications.length, 0);
  messages.push({ id: 'new', subject: 'new', received_at: new Date().toISOString() });
  await env.context.pollMailNow();
  await env.context.pollMailNow();
  assert.equal(env.store.moeUnreadCounts.box, 1);
  assert.equal(env.notifications.length, 1);
  await sendMessage(env, { type: 'clear-moe-unread', emailId: 'box', seenMailKeys: messages.map(mail => mail.id) });
  await env.context.pollMailNow();
  assert.equal(env.store.moeUnreadCounts.box, 0);
  assert.equal(env.notifications.length, 1);
  messages = messages.slice(100);
  await env.context.pollMailNow();
  assert.equal(env.store.moeKnownMailIds.box.length, messages.length, '已删除邮件的去重键应清理');
});

test('Moe 读信与轮询并发时保留完整已读集合，不受原 100 条上限影响', async () => {
  let release;
  const ids = Array.from({ length: 151 }, (_, index) => String(index));
  const env = loadBackground({ moeApiUrl: 'https://moe.example.com', moeApiKey: 'test-key',
    moeEmailCache: [{ id: 'box', address: 'box@example.com' }], moeKnownMailIds: { box: [] },
    activeInbox: { type: 'moe', emailId: 'box' } },
  () => new Promise(resolve => { release = resolve; }));
  const polling = env.context.pollMailNow();
  await flush();
  await sendMessage(env, { type: 'clear-moe-unread', emailId: 'box', seenMailKeys: [...ids, 'just-read'] });
  release(jsonResponse({ messages: ids.map(id => ({ id })) }));
  await polling;
  assert.equal(env.store.moeKnownMailIds.box.length, 152);
  assert.equal(env.store.moeUnreadCounts.box, 0);
  assert.equal(env.notifications.length, 0);
});

test('L10：十六进制形式的 IPv4 映射 IPv6 能识别为内网', () => {
  const { context } = loadBackground();
  const isPrivate = (url) => context.isPrivateNetworkHost(new URL(url).hostname);
  assert.equal(new URL('http://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  assert.equal(isPrivate('http://[::ffff:127.0.0.1]/'), true);
  assert.equal(isPrivate('http://[::ffff:10.1.2.3]/'), true);
  assert.equal(isPrivate('http://[::ffff:c0a8:101]/'), true);
  assert.equal(isPrivate('http://[0:0:0:0:0:ffff:a9fe:1]/'), true);
  assert.equal(isPrivate('http://[::ffff:0:7f00:1]/'), true);
  assert.equal(isPrivate('http://[::127.0.0.1]/'), true);
  assert.equal(isPrivate('http://[::ffff:808:808]/'), false);
  assert.equal(isPrivate('http://[2001:db8::1]/'), false);
  assert.equal(isPrivate('http://[::1]/'), true);
  assert.equal(isPrivate('http://[fd00::1]/'), true);
  assert.equal(isPrivate('https://example.com/'), false);
  assert.equal(context.isPrivateNetworkHost('::ffff:127.0.0.1'), true);
});

test('M1：邮件时间解析（无时区字符串按 UTC）', () => {
  const { context } = loadBackground();
  const parse = context.parseMailTimestamp;
  assert.equal(parse('2026-09-27 01:02:03'), Date.UTC(2026, 8, 27, 1, 2, 3));
  assert.equal(parse('2026-09-27T01:02:03'), Date.UTC(2026, 8, 27, 1, 2, 3));
  assert.equal(parse('2026-09-27T01:02:03.500Z'), Date.UTC(2026, 8, 27, 1, 2, 3, 500));
  assert.equal(parse('2026-09-27T09:02:03+08:00'), Date.UTC(2026, 8, 27, 1, 2, 3));
  assert.equal(parse(1790000000000), 1790000000000);
  assert.equal(parse(1790000000), 1790000000000);
  assert.equal(parse('1790000000000'), 1790000000000);
  assert.ok(Number.isNaN(parse('')));
  assert.ok(Number.isNaN(parse(null)));
  assert.ok(Number.isNaN(parse('not a date')));
});

test('M1：按邮箱创建时间挑出首轮新邮件，并限制在新建窗口内', () => {
  const { context } = loadBackground();
  const now = Date.UTC(2026, 8, 27, 12, 0, 0);
  const base = 5 * 60 * 1000;
  const createdAt = now - 3 * 60 * 1000;
  const toUtcText = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const messages = [
    { id: 1, created_at: toUtcText(createdAt + 30 * 1000) },
    { id: 2, created_at: toUtcText(createdAt - 30 * 1000) },
    { id: 3, created_at: toUtcText(createdAt - 5 * 60 * 1000) },
    { id: 4, created_at: 'bad' },
  ];
  const pick = (created) => plain(context.pickMessagesSinceMailboxCreated(
    messages, created, (m) => m.created_at, now, base
  ).map((m) => m.id));
  assert.deepEqual(pick(createdAt), [1, 2]);
  assert.deepEqual(pick(undefined), []);
  assert.deepEqual(pick(now - 2 * 24 * 60 * 60 * 1000), []);
});

test('M16：轮询跳过判定带容差', () => {
  const { context } = loadBackground();
  const skip = context.shouldSkipAddressPoll;
  const now = 1_000_000_000;
  const base = 5 * 60 * 1000;
  assert.equal(skip(undefined, now, base), false);
  assert.equal(skip({}, now, base), false);
  assert.equal(skip({ nextPollAt: now + 2000 }, now, base), false);
  assert.equal(skip({ nextPollAt: now + 30 * 1000 }, now, base), false);
  assert.equal(skip({ nextPollAt: now + 31 * 1000 }, now, base), true);
  assert.equal(skip({ nextPollAt: now + base }, now, base), true);
  assert.equal(skip({ nextPollAt: now + 10 * 1000 }, now, 30 * 1000), false);
  assert.equal(skip({ nextPollAt: now + 20 * 1000 }, now, 30 * 1000), true);
});

test('M1：新建 Temp 邮箱首轮轮询把创建后到达的邮件计入未读并通知', async () => {
  const createdAt = Date.now() - 60 * 1000;
  const mailAt = new Date(createdAt + 20 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const env = loadBackground({
    apiUrl: 'https://mail.example.com',
    adminToken: 'token',
    emailHistory: ['new@example.com', 'old@example.com'],
    tempMailMeta: { 'new@example.com': { createdAt, expiryMs: 0 } },
  }, async () => jsonResponse({ results: [{ id: 11, subject: '验证码', created_at: mailAt }] }));
  await env.context.pollMailNow();
  assert.equal(env.store.tempUnreadCounts['new@example.com'], 1);
  assert.equal(env.store.tempUnreadCounts['old@example.com'], 0);
  assert.deepEqual(env.store.tempKnownMailIds['new@example.com'], ['11']);
  assert.equal(env.notifications.length, 1);
  assert.match(env.notifications[0].options.message, /new@example\.com/);
});

test('H4：上游删除失败时本地仍清理过期邮箱', async () => {
  const now = Date.now();
  const env = loadBackground({
    apiUrl: 'https://mail.example.com',
    adminToken: 'token',
    emailHistory: ['expired@example.com', 'alive@example.com'],
    tempMailMeta: {
      'expired@example.com': { createdAt: now - 2 * 60 * 60 * 1000, expiryMs: 60 * 60 * 1000 },
      'alive@example.com': { createdAt: now, expiryMs: 60 * 60 * 1000 },
    },
    tempUnreadCounts: { 'expired@example.com': 2 },
    mailPollState: { 'temp:expired@example.com': { nextPollAt: now } },
  }, async () => jsonResponse({}, false, 401));
  const result = await env.context.cleanupExpiredTempAddresses(true);
  assert.equal(result.removed, 1);
  assert.deepEqual(env.store.emailHistory, ['alive@example.com']);
  assert.equal(env.store.tempMailMeta['expired@example.com'], undefined);
  assert.equal(env.store.tempUnreadCounts['expired@example.com'], undefined);
  assert.equal(env.store.mailPollState['temp:expired@example.com'], undefined);
});

test('L2：remove-mail-state 移除指定邮箱的未读 / known / 退避状态', async () => {
  const env = loadBackground({
    tempUnreadCounts: { a: 1, b: 2 },
    tempKnownMailIds: { a: ['1'], b: ['2'] },
    moeUnreadCounts: { 7: 3 },
    moeKnownMailIds: { 7: ['x'] },
    mailPollState: { 'temp:a': { nextPollAt: 1 }, 'temp:b': { nextPollAt: 1 }, 'moe:7': { nextPollAt: 1 } },
  });
  assert.deepEqual(await sendMessage(env, { type: 'remove-mail-state', source: 'temp', keys: ['a'] }), { ok: true });
  assert.deepEqual(env.store.tempUnreadCounts, { b: 2 });
  assert.deepEqual(env.store.tempKnownMailIds, { b: ['2'] });
  assert.deepEqual(Object.keys(env.store.mailPollState).sort(), ['moe:7', 'temp:b']);

  assert.deepEqual(await sendMessage(env, { type: 'remove-mail-state', source: 'moe', keys: ['7'] }), { ok: true });
  assert.deepEqual(env.store.moeUnreadCounts, {});
  assert.deepEqual(env.store.moeKnownMailIds, {});
  assert.deepEqual(Object.keys(env.store.mailPollState), ['temp:b']);

  const invalidSource = await sendMessage(env, { type: 'remove-mail-state', source: 'x', keys: ['a'] });
  assert.equal(invalidSource.ok, false);
  const invalidKeys = await sendMessage(env, { type: 'remove-mail-state', source: 'temp', keys: 'a' });
  assert.equal(invalidKeys.ok, false);
});

test('L3：强制刷新先完成时，晚到的非强制请求不覆盖缓存', async () => {
  const resolvers = [];
  let fetchCount = 0;
  const env = loadBackground({}, () => {
    fetchCount += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  });
  const stale = env.context.fetchCachedJson('k', 'https://a.example/x', {}, 60000, false, 'remoteMoeEmailListCache');
  await flush();
  const fresh = env.context.fetchCachedJson('k', 'https://a.example/x', {}, 60000, true, 'remoteMoeEmailListCache');
  await flush();
  assert.equal(resolvers.length, 2);
  resolvers[1](jsonResponse({ v: 'new' }));
  assert.deepEqual(await fresh, { v: 'new' });
  resolvers[0](jsonResponse({ v: 'old' }));
  assert.deepEqual(await stale, { v: 'old' });
  assert.deepEqual(env.store.remoteMoeEmailListCache.data, { v: 'new' });
  const cached = await env.context.fetchCachedJson('k', 'https://a.example/x', {}, 60000, false, 'remoteMoeEmailListCache');
  assert.deepEqual(cached, { v: 'new' });
  assert.equal(fetchCount, 2);
});

test('L3：连续强制刷新复用在途强制请求时仍会写缓存', async () => {
  const resolvers = [];
  const env = loadBackground({}, () => new Promise((resolve) => resolvers.push(resolve)));
  const first = env.context.fetchCachedJson('k', 'https://a.example/x', {}, 60000, true, 'remoteMoeEmailListCache');
  const second = env.context.fetchCachedJson('k', 'https://a.example/x', {}, 60000, true, 'remoteMoeEmailListCache');
  await flush();
  assert.equal(resolvers.length, 1);
  resolvers[0](jsonResponse({ v: 1 }));
  assert.deepEqual(await first, { v: 1 });
  assert.deepEqual(await second, { v: 1 });
  assert.deepEqual(env.store.remoteMoeEmailListCache.data, { v: 1 });
});

test('L5：SW 启动时按存储恢复角标', async () => {
  const env = loadBackground({ tempUnreadCounts: { a: 2 }, moeUnreadCounts: { 1: 1 } });
  await flush();
  assert.deepEqual(env.badgeTexts, ['3']);
});

test('M16：轮询间隔变化时清空 mailPollState，值未变化时保留', async () => {
  const env = loadBackground({ mailPollState: { 'temp:a': { nextPollAt: Date.now() + 3600000 } } });
  env.listeners.storageChanged({
    mailPollingInterval: { oldValue: { value: 5, unit: 'minutes' }, newValue: 5 },
  }, 'local');
  await flush();
  assert.equal(Object.keys(env.store.mailPollState).length, 1);
  env.listeners.storageChanged({
    mailPollingInterval: { oldValue: { value: 5, unit: 'minutes' }, newValue: { value: 1, unit: 'minutes' } },
  }, 'local');
  await flush();
  await flush();
  assert.deepEqual(env.store.mailPollState, {});
});

test('L1：jev* 配置键已登记到存储代理白名单', async () => {
  const env = loadBackground({ jevEnabled: true });
  const keys = ['jevEnabled', 'jevApiBase', 'jevApiKey', 'jevEndpointPath', 'jevModel', 'jevRecallMode'];
  const response = await sendMessage(env, { type: 'storage-get', keys });
  assert.equal(response.ok, true);
  assert.equal(response.data.jevEnabled, true);
});

test('Clef 和提取方式配置可通过存储代理读写', async () => {
  const env = loadBackground({});
  const items = { mailInsightExtractionMode: 'ai-judge', mailInsightJudgeBackend: 'clef',
    clefAccounts: [{ id: 'account-a', accountId: 'a'.repeat(32), apiToken: 'test-token', name: '测试账号' }],
    clefAccountId: 'a'.repeat(32), clefApiToken: 'test-token', clefModel: 'clef-flash' };
  assert.equal((await sendMessage(env, { type: 'storage-set', items })).ok, true);
  const read = await sendMessage(env, { type: 'storage-get', keys: Object.keys(items) });
  assert.equal(read.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(read.data)), items);
});

test('扩展请求的 Origin 删除规则只匹配 FloatMail 自身的 fetch/XHR', async () => {
  assert.ok(
    MANIFEST.permissions.includes('declarativeNetRequestWithHostAccess'),
    'manifest 必须声明动态修改请求头所需权限'
  );
  const env = loadBackground();
  await flush();
  assert.equal(env.dynamicRuleUpdates.length, 1);
  const update = plain(env.dynamicRuleUpdates[0]);
  assert.deepEqual(update.removeRuleIds, [10001]);
  assert.equal(update.addRules.length, 1);
  const rule = update.addRules[0];
  assert.equal(rule.id, 10001);
  assert.deepEqual(rule.action, {
    type: 'modifyHeaders',
    requestHeaders: [{ header: 'origin', operation: 'remove' }],
  });
  assert.deepEqual(rule.condition, {
    initiatorDomains: [EXTENSION_ID],
    resourceTypes: ['xmlhttprequest'],
  });
  assert.equal(Object.hasOwn(rule.condition, 'tabIds'), false, '不能按 tabId 误伤宿主网页请求');
});

test('M1 复审：面板已展示的邮件经 clear-temp-unread 并入 known，首轮轮询不再重复计未读', async () => {
  const createdAt = Date.now() - 60 * 1000;
  const mailAt = new Date(createdAt + 20 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const env = loadBackground({
    apiUrl: 'https://mail.example.com',
    adminToken: 'token',
    emailHistory: ['new@example.com'],
    tempMailMeta: { 'new@example.com': { createdAt, expiryMs: 0 } },
  }, async () => jsonResponse({ results: [
    { id: 12, subject: '稍后到达', created_at: mailAt },
    { id: 11, subject: '验证码', created_at: mailAt },
  ] }));
  assert.deepEqual(
    await sendMessage(env, { type: 'clear-temp-unread', address: 'new@example.com', seenMailKeys: ['11'] }),
    { ok: true }
  );
  assert.deepEqual(env.store.tempKnownMailIds['new@example.com'], ['11']);
  await env.context.pollMailNow();
  // 只有面板没看过的 12 算新邮件
  assert.equal(env.store.tempUnreadCounts['new@example.com'], 1);
  assert.equal(env.notifications.length, 1);
});

test('M1 复审：clear-moe-unread 同样合并 seenMailKeys，未带时不改动 known', async () => {
  const env = loadBackground({ moeUnreadCounts: { 7: 2 }, moeKnownMailIds: { 7: ['a'] } });
  assert.deepEqual(await sendMessage(env, { type: 'clear-moe-unread', emailId: 7 }), { ok: true });
  assert.deepEqual(env.store.moeKnownMailIds, { 7: ['a'] });
  assert.equal(env.store.moeUnreadCounts[7], 0);
  await sendMessage(env, { type: 'clear-moe-unread', emailId: 7, seenMailKeys: ['b', 'a'] });
  assert.deepEqual(env.store.moeKnownMailIds[7], ['b', 'a']);
});
