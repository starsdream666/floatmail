const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup-modules/clef-insight.js'), 'utf8');
const config = { accountId: 'a'.repeat(32), apiToken: 'test-token', model: 'clef' };
const codes = [{ value: '482913', label: 'AI 提取' }];
const links = [{ url: 'https://example.test/verify?token=abc&key=x%2By', anchorText: '验证邮箱' }];
const plain = (value) => JSON.parse(JSON.stringify(value));

function engine(random) {
  const scope = { window: {}, setTimeout };
  if (random) scope.Math = { floor: Math.floor, min: Math.min, random };
  runInNewContext(source, scope);
  return scope.window.PopupClefInsight;
}

function response(answers = {}, status = 200) {
  return {
    ok: status === 200, status,
    json: async () => ({ success: status === 200, result: { model: 'clef', answers }, errors: status === 200 ? [] : [{ code: 3030 }] })
  };
}

function answers(overrides = {}) {
  return {
    otp: { type: 'noul', noul: 0.98 }, magic: { type: 'noul', noul: 0.98 },
    extort: { type: 'noul', noul: 0.01 }, link_0: { type: 'noul', noul: 0.98 },
    real_code: { type: 'choice', choice: '482913', confidence: 0.98, probabilities: { '482913': 0.99, none: 0.01 } },
    ...overrides
  };
}

test('直连官方路径，显式模型名，平铺 payload，且不带网关头', async () => {
  let captured;
  const result = await engine().adjudicate(links, codes, '验证码 482913', config, {
    request: async (url, init) => { captured = { url, init }; return response(answers()); }
  });
  assert.equal(captured.url, `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/run/@cf/cloudflare/clef`);
  assert.equal(captured.init.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(Object.keys(captured.init.headers).sort(), ['Authorization', 'Content-Type']);
  const payload = JSON.parse(captured.init.body);
  assert.equal(payload.model, 'clef');
  assert.equal(payload.input, undefined);
  assert.equal(payload.questions.real_code.criteria['482913'], '类型：AI 提取');
  assert.equal(result.codes[0], '482913');
  assert.equal(result.links[0].url, links[0].url);
  assert.equal(result.judgeVerdict, 'verification');
});

test('Flash 路径和 body 同步切换', async () => {
  await engine().request({ otp: { type: 'noul', instructions: 'test' } }, 'x', { ...config, model: 'clef-flash' }, {
    request: async (url, init) => {
      assert.ok(url.endsWith('/@cf/cloudflare/clef-flash'));
      assert.equal(JSON.parse(init.body).model, 'clef-flash');
      return response(answers());
    }
  });
});

test('仅重试限流与平台错误，采用有限退避', async () => {
  const waits = [];
  let calls = 0;
  await engine().request({}, 'x', config, {
    request: async () => ++calls < 4 ? response({}, calls === 1 ? 429 : 503) : response(answers()),
    sleep: async (ms) => waits.push(ms)
  });
  assert.equal(calls, 4);
  assert.deepEqual(waits, [500, 1000, 2000]);
  calls = 0;
  await assert.rejects(engine().request({}, 'x', config, {
    request: async () => { calls++; return response({}, 422); }
  }), /HTTP 422/);
  assert.equal(calls, 1);
});

test('重试耗尽和 HTTP 200 中 success=false 均不能当成功', async () => {
  let calls = 0;
  await assert.rejects(engine().request({}, 'x', config, {
    request: async () => { calls++; return response({}, 503); }, sleep: async () => {}
  }), /HTTP 503/);
  assert.equal(calls, 4);
  await assert.rejects(engine().request({}, 'x', config, {
    request: async () => ({ ok: true, status: 200, json: async () => ({ success: false }) })
  }), /Clef 请求失败/);
});

test('缺少答案或无效概率要回报失败，不能静默清空结果', async () => {
  for (const override of [{ otp: undefined }, { link_0: { noul: NaN } }, { magic: { noul: 1.5 } },
    { real_code: { type: 'choice', choice: '482913', confidence: 0.9 } }]) {
    await assert.rejects(engine().adjudicate(links, codes, 'x', config, {
      request: async () => response(answers(override))
    }), /缺失或无效的概率/);
  }
});

test('低置信度 choice 进入 unknown，不能当已确认', async () => {
  const result = await engine().adjudicate([], codes, '482913', config, {
    request: async () => response(answers({ real_code: { type: 'choice', choice: '482913', confidence: 0.0297, probabilities: { '482913': 0.4105, none: 0.5895 } } }))
  });
  assert.equal(result.judgeVerdict, 'unknown');
  assert.deepEqual(plain(result.codes), []);
});

test('逐候选链接灰区进入 unknown，整封 magic 高也不能放行', async () => {
  const result = await engine().adjudicate(links, [], 'x', config, {
    request: async () => response(answers({ link_0: { type: 'noul', noul: 0.45 } }))
  });
  assert.equal(result.judgeVerdict, 'unknown');
  assert.deepEqual(plain(result.links), []);
});

test('整封 magic 高但无 URL 候选时绝不产生链接', async () => {
  const result = await engine().adjudicate([], codes, 'Sign in\n482913', config, {
    request: async () => response(answers({ magic: { noul: 0.99 } }))
  });
  assert.deepEqual(plain(result.links), []);
});

test('索码风险优先隔离；明确 none 保持空结论', async () => {
  const quarantined = await engine().adjudicate(links, codes, 'x', config, {
    request: async () => response(answers({ extort: { noul: 0.95 } }))
  });
  assert.equal(quarantined.judgeVerdict, 'quarantine');
  assert.deepEqual(plain([quarantined.codes, quarantined.links]), [[], []]);
  const rejected = await engine().adjudicate(links, codes, 'x', config, {
    request: async () => response(answers({ link_0: { noul: 0.02 }, real_code: { type: 'choice', choice: 'none', confidence: 0.95, probabilities: { none: 0.99, '482913': 0.01 } } }))
  });
  assert.equal(rejected.judgeVerdict, 'not_verification');
});

test('不存在的候选、未配置、无候选分别处理', async () => {
  await assert.rejects(engine().adjudicate([], codes, 'x', config, {
    request: async () => response(answers({ real_code: { type: 'choice', choice: 'invented', confidence: 0.99 } }))
  }), /候选池之外/);
  assert.equal(engine().hasConfig({ accountId: 'invalid', apiToken: 'x' }), false);
  await assert.rejects(engine().request({}, 'x', {}), /Account ID/);
  assert.equal(await engine().adjudicate([], [], 'x', config), null);
});

test('多 Token 自动按行去空去重，并兼容旧单 Token', () => {
  const api = engine();
  const normalized = api.normalizeConfig({ ...config, apiToken: ' token-a \r\n\n token-b\n token-a \n' });
  assert.deepEqual(plain(normalized.accounts.map((account) => account.apiToken)), ['token-a', 'token-b']);
  assert.ok(normalized.accounts.every((account) => account.accountId === config.accountId));
  assert.deepEqual(plain(api.normalizeConfig(config).accounts.map((account) => account.apiToken)), ['test-token']);
  assert.deepEqual(plain(api.normalizeConfig({ ...config, apiToken: ['token-a\ntoken-b', 'token-a', null] }).accounts.map((account) => account.apiToken)), ['token-a', 'token-b']);
  assert.equal(api.hasConfig({ ...config, apiToken: ' \r\n ' }), false);
});

test('随机首选 Token，Authorization 始终只发送一个 Token', async () => {
  const picked = [];
  for (const random of [() => 0, () => 0.9999]) {
    await engine(random).request({}, 'x', { ...config, apiToken: 'token-a\ntoken-b\ntoken-c' }, {
      request: async (_url, init) => {
        picked.push(init.headers.Authorization);
        assert.doesNotMatch(init.headers.Authorization, /[\r\n]/);
        return response(answers());
      }
    });
  }
  assert.notEqual(picked[0], picked[1]);
});

test('401/403 和鉴权失败响应会换 Key，成功后立即停止', async () => {
  const seen = [];
  await engine().request({}, 'x', { ...config, apiToken: 'token-a\ntoken-b\ntoken-c\ntoken-d' }, {
    request: async (_url, init) => {
      seen.push(init.headers.Authorization);
      if (seen.length < 3) return response({}, seen.length === 1 ? 401 : 403);
      if (seen.length === 3) return { ok: true, status: 200, json: async () => ({ success: false }) };
      return response(answers());
    },
    sleep: async () => assert.fail('鉴权失败不需要退避等待')
  });
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen).size, 4);
});

test('网络异常、非法 JSON、缺少 answers 也会换 Key', async () => {
  const seen = [];
  await engine().request({}, 'x', { ...config, apiToken: 'token-a\ntoken-b\ntoken-c\ntoken-d' }, {
    request: async (_url, init) => {
      seen.push(init.headers.Authorization);
      if (seen.length === 1) throw new Error('network failed');
      if (seen.length === 2) return { ok: true, status: 200, json: async () => { throw new Error('invalid JSON'); } };
      if (seen.length === 3) return { ok: true, status: 200, json: async () => ({ success: true, result: {} }) };
      return response(answers());
    }
  });
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen).size, 4);
});

test('多 Key 的 429/5xx 退避时切换 Key，耗尽后不重复失败 Key', async () => {
  const seen = [];
  const waits = [];
  await assert.rejects(engine().request({}, 'x', { ...config, apiToken: 'token-a\ntoken-b' }, {
    request: async (_url, init) => {
      seen.push(init.headers.Authorization);
      return response({}, seen.length === 1 ? 429 : 503);
    },
    sleep: async (ms) => waits.push(ms)
  }), /已尝试 2 组账户与密钥/);
  assert.equal(seen.length, 2);
  assert.equal(new Set(seen).size, 2);
  assert.deepEqual(waits, [500]);
});

test('配置再多 Key 也最多请求四次，最终错误不泄露 Key', async () => {
  const tokens = Array.from({ length: 6 }, (_,i) => `secret-test-token-${i}`);
  const seen = [];
  await assert.rejects(engine().request({}, 'x', { ...config, apiToken: tokens.join('\n') }, {
    request: async (_url, init) => {
      seen.push(init.headers.Authorization);
      throw new Error(`debug headers: ${init.headers.Authorization}`);
    }
  }), (error) => {
    assert.match(error.message, /已尝试 4 组账户与密钥/);
    tokens.forEach((token) => assert.ok(!error.message.includes(token)));
    return true;
  });
  assert.equal(seen.length, 4);
  assert.equal(new Set(seen).size, 4);
});

test('400/422 请求体错误不换 Key，单 Key 鉴权失败不重复请求', async () => {
  for (const status of [400, 422, 401, 403]) {
    let calls = 0;
    await assert.rejects(engine().request({}, 'x', {
      ...config, apiToken: status === 400 || status === 422 ? 'token-a\ntoken-b' : 'token-a'
    }, {
      request: async () => { calls++; return response({}, status); }
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
});

test('单 Key 遇到 HTML 503 也保留原有退避重试', async () => {
  let calls = 0;
  await engine().request({}, 'x', config, {
    request: async () => ++calls < 4
      ? { ok: false, status: 503, json: async () => { throw new Error('HTML error page'); } }
      : response(answers()),
    sleep: async () => {}
  });
  assert.equal(calls, 4);
});

test('跨账号轮换时 URL 的 Account ID 和 Key 严格绑定，失败回调及结果不包含 Key', async () => {
  const accounts = [
    { id: 'primary', name: '主账号', accountId: 'a'.repeat(32), apiToken: 'private-token-a' },
    { id: 'backup', name: '备用账号', accountId: 'b'.repeat(32), apiToken: 'private-token-b' }
  ];
  const failures = [];
  const successes = [];
  const calls = [];
  const result = await engine(() => 0.9999).request({}, 'x', { accounts }, {
    request: async (url, init) => {
      const account = accounts.find((item) => url.includes(`/accounts/${item.accountId}/`));
      assert.ok(account);
      assert.equal(init.headers.Authorization, `Bearer ${account.apiToken}`);
      calls.push(account.id);
      return response(answers(), calls.length === 1 ? 403 : 200);
    },
    onAccountFailure: (failure) => failures.push(failure),
    onAccountSuccess: (account) => successes.push(account)
  });
  assert.deepEqual(calls, ['primary', 'backup']);
  assert.equal(failures[0].id, 'primary');
  assert.equal(failures[0].accountId, accounts[0].accountId);
  assert.equal(failures[0].status, 403);
  assert.equal(successes[0].id, 'backup');
  assert.equal(result.account.id, 'backup');
  assert.equal(result.accountFailures.length, 1);
  accounts.forEach((account) => assert.ok(!JSON.stringify([result, failures, successes]).includes(account.apiToken)));
});

test('全部账号失败时列出各账号与错误，不只保留最后一个失败', async () => {
  const accounts = [
    { id: 'one', name: '账号甲', accountId: 'a'.repeat(32), apiToken: 'private-key-one' },
    { id: 'two', name: '账号乙', accountId: 'b'.repeat(32), apiToken: 'private-key-two' }
  ];
  await assert.rejects(engine().request({}, 'x', { accounts }, {
    request: async () => response({}, 401)
  }), (error) => {
    accounts.forEach((account) => {
      assert.ok(error.message.includes(account.accountId));
      assert.ok(error.message.includes(account.name));
      assert.ok(!error.message.includes(account.apiToken));
    });
    assert.equal(error.accountFailures.length, 2);
    return true;
  });
});

test('显式空账号池不回退旧字段，去重按 ID+Key 而不是单独按 Key', () => {
  const api = engine();
  assert.equal(api.hasConfig({ ...config, accounts: [] }), false);
  const normalized = api.normalizeConfig({ accounts: [
    { id: 'one', accountId: 'a'.repeat(32), apiToken: 'same-key' },
    { id: 'two', accountId: 'b'.repeat(32), apiToken: 'same-key' },
    { id: 'three', accountId: 'a'.repeat(32), apiToken: 'same-key' }
  ] });
  assert.equal(normalized.accounts.length, 2);
  assert.equal(api.hasConfig(normalized), true);
  assert.equal(api.hasConfig({ accounts: [{ accountId: 'bad-id', apiToken: 'x' }] }), false);
});

test('连接测试限定一次请求，不能用 429 自动重试掩盖当前账号不可用', async () => {
  let calls = 0;
  await assert.rejects(engine().request({}, 'test', config, {
    maxAttempts: 1,
    request: async () => { calls++; return response({}, 429); },
    sleep: async () => assert.fail('连接测试不应重试等待')
  }), /429/);
  assert.equal(calls, 1);
});
