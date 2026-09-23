const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');

// 与 insight-extraction.test.cjs 相同的切分方式：按缩进取单元，
// 避开候选正则里 `[-/.]` 这类会骗到朴素括号扫描的字符类。
const INDENT = '  ';

function findStart(declaration) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${INDENT}${declaration}`));
  // 这里不能 assert：extractFunction 会先用「function」探一次，找不到再试「async function」。
  return { lines, index };
}

function extractUnit(declaration) {
  const { lines, index } = findStart(declaration);
  if (index < 0) {
    return null;
  }
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

// 注意：有些函数是 `async function`，只找 `function name(` 会漏掉。
function extractFunction(name) {
  const plain = extractUnit(`function ${name}(`);
  if (plain) {
    return plain;
  }
  const async = extractUnit(`async function ${name}(`);
  assert.ok(async, `未找到函数 ${name}`);
  return async;
}

const extractConst = (name) => extractUnit(`const ${name} = `);

const plain = (value) => JSON.parse(JSON.stringify(value));

// ── 归一化去重（独立于网络） ────────────────────────────────────────
function dedupeEngine() {
  // normalizeUrlKey 用到 URL，必须把宿主环境的 URL 传进 vm 上下文。
  const scope = { URL };
  runInNewContext(
    [extractFunction('normalizeUrlKey'), extractFunction('dedupeLinksByNormalizedKey')].join('\n'),
    scope
  );
  return scope;
}

test('同一链接的写法差异会被折叠成一个 key', () => {
  const scope = dedupeEngine();
  const same = [
    'https://github.com/verify?token=aaa',
    'https://GitHub.com/verify?token=aaa',
    'http://github.com/verify?token=aaa',
    'https://www.github.com/verify?token=aaa',
    'https://github.com/verify/?token=aaa',
    'https://github.com/verify?token=aaa#section'
  ];
  const keys = new Set(same.map(scope.normalizeUrlKey));
  assert.equal(keys.size, 1, `应折叠成 1 个 key，实际 ${keys.size}: ${[...keys]}`);
});

test('token 取值不同绝不能被折叠（不同验证链接）', () => {
  const scope = dedupeEngine();
  const a = scope.normalizeUrlKey('https://github.com/verify?token=aaa');
  const b = scope.normalizeUrlKey('https://github.com/verify?token=bbb');
  assert.notEqual(a, b, 'token 不同必须是不同链接');
});

test('不同路径不会被折叠', () => {
  const scope = dedupeEngine();
  assert.notEqual(
    scope.normalizeUrlKey('https://github.com/verify?token=a'),
    scope.normalizeUrlKey('https://github.com/confirm?token=a')
  );
});

test('query 参数顺序不同折叠为同一链接，但多出参数不折叠', () => {
  const scope = dedupeEngine();
  assert.equal(
    scope.normalizeUrlKey('https://a.com/x?b=2&a=1'),
    scope.normalizeUrlKey('https://a.com/x?a=1&b=2')
  );
  assert.notEqual(
    scope.normalizeUrlKey('https://a.com/x?a=1'),
    scope.normalizeUrlKey('https://a.com/x?a=1&utm=x')
  );
});

test('同一邮件里的变体链接只保留一条，且保留分数更高的', () => {
  const scope = dedupeEngine();
  const records = [
    { value: 'https://github.com/verify?token=a', url: 'https://github.com/verify?token=a', score: 3, index: 0 },
    { value: 'https://www.github.com/verify?token=a', url: 'https://www.github.com/verify?token=a', score: 9, index: 1 }
  ];
  const out = scope.dedupeLinksByNormalizedKey(records);
  assert.equal(out.length, 1, '应折叠成 1 条');
  assert.equal(out[0].score, 9, '应保留分数更高的那条');
});

test('去重对空输入与非法 URL 不抛错', () => {
  const scope = dedupeEngine();
  for (const input of [[], null, undefined, [{ value: '' }], [{ value: 'not a url' }], [null]]) {
    const out = scope.dedupeLinksByNormalizedKey(input);
    assert.ok(Array.isArray(out));
  }
});

// ── Jev 可选性：这是本次改动最重要的不变量 ──────────────────────────
function configEngine(overrides = {}) {
  const scope = {
    normalizeTranslationSetting: (value, fallback = '') => {
      const text = typeof value === 'string' ? value.trim() : '';
      return text || fallback;
    },
    DEFAULT_JEV_ENDPOINT_PATH: '/typesafe/v1/systemone',
    DEFAULT_JEV_MODEL: 'jev-latest',
    ...overrides
  };
  runInNewContext(
    [extractConst('DEFAULT_JEV_ENDPOINT_PATH'), extractConst('DEFAULT_JEV_MODEL'),
      extractFunction('getJevConfig'), extractFunction('hasJevConfig')].join('\n'),
    scope
  );
  return scope;
}

test('未启用时 hasJevConfig 必须为 false', () => {
  const scope = configEngine();
  scope.jevEnabled = false;
  scope.jevApiBase = 'https://gw.example.com';
  scope.jevApiKey = 'sk-x';
  scope.jevEndpointPath = '/typesafe/v1/systemone';
  scope.jevModel = 'jev-latest';
  assert.equal(scope.hasJevConfig(), false, '开关关闭时绝不能启用 Jev');
});

test('启用但缺任一项配置时为 false（不能因为半配置就去发请求）', () => {
  // 每个 case 都把四项都设齐，只留一项为空 —— 这才是「半配置」的真实形态。
  const base = {
    jevApiBase: 'https://gw.example.com',
    jevApiKey: 'sk-x',
    jevEndpointPath: '/typesafe/v1/systemone',
    jevModel: 'jev-latest'
  };
  const cases = [
    { jevApiBase: '' },
    { jevApiBase: '   ' },
    { jevApiKey: '' },
    { jevApiKey: '   ' }
  ];
  cases.forEach((partial, index) => {
    const scope = configEngine();
    scope.jevEnabled = true;
    Object.assign(scope, base, partial);
    assert.equal(scope.hasJevConfig(), false,
      `case#${index} 半配置不该算可用: ${JSON.stringify(partial)}`);
  });
});

test('四项齐全且开关打开时才算可用', () => {
  const scope = configEngine();
  scope.jevEnabled = true;
  scope.jevApiBase = 'https://newapi.example.com';
  scope.jevApiKey = 'sk-x';
  scope.jevEndpointPath = '/typesafe/v1/systemone';
  scope.jevModel = 'jev-latest';
  assert.equal(scope.hasJevConfig(), true);
});

test('端点路径与模型有默认值', () => {
  const scope = configEngine();
  scope.jevEnabled = true;
  scope.jevApiBase = 'https://gw.example.com';
  scope.jevApiKey = 'sk-x';
  scope.jevEndpointPath = '';
  scope.jevModel = '';
  const config = scope.getJevConfig();
  assert.equal(config.endpointPath, '/typesafe/v1/systemone');
  assert.equal(config.model, 'jev-latest');
});

test('apiBase 结尾的斜杠会被归一，避免拼出双斜杠', () => {
  const scope = configEngine();
  scope.jevEnabled = true;
  scope.jevApiBase = 'https://gw.example.com///';
  scope.jevApiKey = 'sk-x';
  scope.jevEndpointPath = '/typesafe/v1/systemone';
  scope.jevModel = 'jev-latest';
  assert.equal(scope.getJevConfig().apiBase, 'https://gw.example.com');
});

// ── 静态守卫：这些约束一旦被改坏，测试要立刻报警 ────────────────────
test('Jev 配置键已注册进 storage 读取列表', () => {
  ['jevEnabled', 'jevApiBase', 'jevApiKey', 'jevEndpointPath', 'jevModel'].forEach((key) => {
    assert.ok(source.includes(`const JEV_${key.replace('jev', '').toUpperCase()}_KEY`) || source.includes(key),
      `storage 列表缺少 ${key}`);
  });
});

test('Jev 密钥走脱敏导出，端点路径校验以 / 开头', () => {
  const configIo = readFileSync(join(__dirname, '../popup-modules/config-io.js'), 'utf8');
  assert.match(configIo, /'jevApiKey'/, 'jevApiKey 必须在 SECRET_KEYS 里（导出需脱敏）');
  assert.match(configIo, /jevEnabled/, 'jevEnabled 必须注册（否则导不出）');
  assert.match(configIo, /jevEndpointPath/, 'jevEndpointPath 必须注册');
  assert.match(configIo, /startsWith\('\/'\)/, '端点路径必须校验以 / 开头');
});

test('链接判定用多个 noul（而非单个 choice），否则会丢链接', () => {
  const fn = extractFunction('adjudicateInsightsWithJev');
  assert.match(fn, /type: 'noul'/, '链接判定必须是 noul');
  assert.match(fn, /link_\$\{index\}/, '应为每个链接候选生成独立问题');
  assert.match(fn, /JEV_LINK_THRESHOLD/, '必须走阈值判定');
  // 验证码天生唯一，应继续用 choice + none
  assert.match(fn, /type: 'choice'/, '验证码应使用 choice');
  assert.match(fn, /criteria\.none/, 'choice 必须提供 none 选项');
});

test('Jev 失败必须回落，不能把异常抛给调用方', () => {
  const fn = extractFunction('extractMailInsightsWithApi');
  // 两处 Jev 调用点都必须被 try/catch 包住
  const tryCount = (fn.match(/hasJevConfig\(\)/g) || []).length;
  const catchCount = (fn.match(/jevError = /g) || []).length;
  assert.ok(tryCount >= 2, `应有至少两处 Jev 接入点，实际 ${tryCount}`);
  assert.ok(catchCount >= 1, 'Jev 失败必须被捕获并记录');
  assert.match(fn, /return \{ \.\.\.localResult/, 'Jev 失败要退回本地结果');
});

// ── 回归：Jev 的结果必须被当作「模型已确认」──────────────────────────
// 曾经的 bug：状态判定只认 source === 'ai'，于是 Jev 判出的结果被贴上
// 「以下结果由本地规则提取，未经模型确认」的标签（数据是 Jev 的，标签是错的）。
function triggerEngine(extractedResult, options = {}) {
  const reader = {
    insightStatus: 'idle',
    insights: null,
    insightError: '',
    getMail: () => ({ id: 1 }),
    getInsightStatus() { return this.insightStatus; },
    setInsightStatus(value) { this.insightStatus = value; },
    getInsights() { return this.insights; },
    setInsights(value) { this.insights = value; },
    getInsightError() { return this.insightError; },
    setInsightError(value) { this.insightError = value; },
    nextInsightToken: () => 1,
    isInsightTokenCurrent: () => true,
    getIdentity: () => 'identity',
    getTranslationSource: () => 'your code is 123456',
    getMetadata: () => ({})
  };
  const scope = {
    reader,
    extractMailInsightsWithApi: async () => extractedResult,
    buildLocalInsightResult: () => ({ codes: ['LOCALONLY'], links: [] }),
    renderMailInsightPanel: () => {},
    renderCurrentMail: () => {},
    hasJevConfig: () => options.hasJev !== false
  };
  runInNewContext(extractFunction('triggerMailAiInsights'), scope);
  return scope;
}

test('Jev 判定出的结果必须是 success，绝不能是 fallback', async () => {
  const scope = triggerEngine({
    codes: ['123456'],
    links: [{ url: 'https://github.com/verify?token=a', label: '验证' }],
    source: 'jev',
    jevModel: 'jev-1.13.0'
  });
  await scope.triggerMailAiInsights(scope.reader, true);
  assert.equal(scope.reader.getInsightStatus(), 'success',
    'Jev 结果被判成 fallback —— UI 会错误显示「未经模型确认」');
  assert.equal(scope.reader.getInsights().source, 'jev', '应原样保留 Jev 结果');
});

test('Jev 明确说「都没有」也算 success（模型确认过，只是结论为空）', async () => {
  const scope = triggerEngine({ codes: [], links: [], source: 'jev', jevEmpty: true });
  await scope.triggerMailAiInsights(scope.reader, true);
  assert.equal(scope.reader.getInsightStatus(), 'success',
    'Jev 的空结论不是本地回落，不该走 fallback 文案');
});

test('AI 结果仍然是 success（原有行为不能被改坏）', async () => {
  const scope = triggerEngine({ codes: ['654321'], links: [], source: 'ai' });
  await scope.triggerMailAiInsights(scope.reader, true);
  assert.equal(scope.reader.getInsightStatus(), 'success');
});

test('模型完全不可用时仍然回落 fallback（回落链路不能被改坏）', async () => {
  // 真实契约：extractMailInsightsWithApi 失败时返回的是 { ...localResult, error }，
  // 本地结果本身已内含在返回对象里，所以这里要按这个形状构造桩。
  const scope = triggerEngine(
    { codes: ['LOCALONLY'], links: [], error: '网关 502' },
    { hasJev: false }
  );
  await scope.triggerMailAiInsights(scope.reader, true);
  assert.equal(scope.reader.getInsightStatus(), 'fallback');
  assert.equal(scope.reader.getInsights().codes[0], 'LOCALONLY', '应回落到本地结果');
});

// ── 回归：success 文案里绝不能出现「本地规则提取」──────────────────
function renderEngine(readerState) {
  const scope = {
    triggerMailAiInsights: () => {},
    hasJevConfig: () => true,
    hasMailInsightConfig: () => true,
    reader: {
      getInsightStatus: () => readerState.status,
      getInsights: () => readerState.insights,
      getInsightError: () => readerState.error || ''
    }
  };
  runInNewContext(extractFunction('buildMailInsightRenderOptions'), scope);
  return scope;
}

test('source=jev 的 success 不出现「本地规则提取」字样', () => {
  const scope = renderEngine({
    status: 'success',
    insights: { source: 'jev', codes: ['123'], links: [], jevOnly: true }
  });
  const options = scope.buildMailInsightRenderOptions(scope.reader);
  assert.equal(options.statusType, 'success');
  assert.doesNotMatch(options.noteText, /本地规则提取/);
  assert.match(options.statusText, /Jev/);
});

test('AI 成功但 Jev 失败时，success 文案要说明 Jev 没生效', () => {
  const scope = renderEngine({
    status: 'success',
    insights: { source: 'ai', codes: ['123'], links: [], jevError: '网关 400' }
  });
  const options = scope.buildMailInsightRenderOptions(scope.reader);
  assert.equal(options.statusType, 'success', 'AI 成功就是成功，不该降级成 fallback');
  assert.match(options.noteText, /网关 400/);
  assert.doesNotMatch(options.noteText, /本地规则提取/);
});

// ── 回归：提取验证码时绝不能重载邮件正文 ────────────────────────────
// 洞察区（#mail-insights）是邮件正文（#mail-body）的兄弟节点，两者渲染独立。
// 曾经的 bug：提取的「开始」和「完成」都调 renderCurrentMail，导致整封邮件重建
// iframe（innerHTML='' + new iframe + 重设 srcdoc），正文被重载两次。
test('triggerMailAiInsights 不得调用 renderCurrentMail（只准重绘洞察面板）', () => {
  const fn = extractFunction('triggerMailAiInsights');
  assert.doesNotMatch(fn, /renderCurrentMail/, '提示提取时要重绘洞察面板，不能重建邮件正文');
  const panelCalls = (fn.match(/renderMailInsightPanel\(reader\)/g) || []).length;
  assert.equal(panelCalls, 2, `开始与完成各应重绘一次洞察面板，实际 ${panelCalls}`);
});

test('renderMailInsightPanel 只写洞察容器，不碰正文容器', () => {
  const fn = extractFunction('renderMailInsightPanel');
  assert.match(fn, /reader\.elements\.insights/, '必须只操作洞察容器');
  assert.doesNotMatch(fn, /elements\.body/, '绝不能碰正文容器');
  // 渲染选项要和 renderCurrentMail 用的是同一套，否则状态文案会不一致。
  assert.match(fn, /getMailInsightsOverride\(reader\)/);
  assert.match(fn, /buildMailInsightRenderOptions\(reader\)/);
});

// 切视图 / 切远程图片时重建正文是正确的（那本来就要求重新渲染 HTML），必须保留。
test('切换视图与远程图片仍走 renderCurrentMail（正文确实需要重建）', () => {
  const fn = extractFunction('bindMailReaderActions');
  assert.equal((fn.match(/renderCurrentMail\(reader\)/g) || []).length, 2,
    '视图切换与图片开关各需一次正文重建');
});

// ── 回归：召回优先 / 精确优先 ───────────────────────────────────────
// 设计约束（实测得出）：放宽本地阈值必然让噪声候选变多，必须由 Jev 兜底去误报。
// 所以「召回优先」只在 Jev 可用时生效；Jev 不可用时一律回到精确优先。
function samplingEngine(recall, jevOk) {
  const scope = {
    jevRecallMode: recall,
    hasJevConfig: () => jevOk,
    INSIGHT_CODE_MIN_SCORE: 3,
    INSIGHT_CODE_MIN_SCORE_RECALL: -3,
    JEV_MAX_CANDIDATES: 8,
    JEV_MAX_CANDIDATES_RECALL: 16
  };
  runInNewContext(
    [extractFunction('getInsightSamplingParams'), extractFunction('getInsightLinkLimit')].join('\n'),
    scope
  );
  return scope;
}

test('精确优先（默认）：javRecallMode 关闭时用旧参数，行为与改动前一致', () => {
  const s = samplingEngine(false, true);
  const p = s.getInsightSamplingParams();
  assert.equal(p.minScore, 3, '关闭召回优先必须保持 minScore=3');
  assert.equal(p.limit, 8, '关闭召回优先必须保持 limit=8');
  assert.equal(p.recall, false);
  assert.equal(s.getInsightLinkLimit(), 8);
});

test('召回优先开启且 Jev 可用：阈值放宽到 -3、上限提到 16', () => {
  const s = samplingEngine(true, true);
  const p = s.getInsightSamplingParams();
  assert.equal(p.minScore, -3, '召回优先应放宽阈值，让无提示词的裸验证码进池');
  assert.equal(p.limit, 16, '放宽阈值后候选变多，上限要同步提高，否则真候选会被截断');
  assert.equal(p.recall, true);
  assert.equal(s.getInsightLinkLimit(), 16);
});

test('召回优先开关打开但 Jev 不可用时，必须回落到精确优先', () => {
  // 这是硬约束：没有模型兜底就放宽阈值 = 面板变脏 + 误报。
  const s = samplingEngine(true, false);
  const p = s.getInsightSamplingParams();
  assert.equal(p.minScore, 3, 'Jev 不可用时绝不能放宽阈值');
  assert.equal(p.limit, 8, 'Jev 不可用时绝不能提高上限');
  assert.equal(p.recall, false, 'recall 必须为 false');
  assert.equal(s.getInsightLinkLimit(), 8);
});

test('阈值必须是有限数（rankInsightCandidates 用 isFinite 判断，-Infinity 会静默回落）', () => {
  for (const recall of [false, true]) {
    const p = samplingEngine(recall, true).getInsightSamplingParams();
    assert.ok(Number.isFinite(p.minScore), `minScore 必须是有限数，实际 ${p.minScore}`);
    assert.ok(Number.isFinite(p.limit));
  }
});

// ── 回归：噪声词表必须能让房号/套房号下沉 ────────────────────────────
// 房号 Room 4408 与裸验证码 5521 原先同分（都是 -1），任何阈值都分不开。
// 补 room/suite 后房号下沉到 -6，得分差拉出 5 分空档。
test('噪声词表覆盖房间号类词（否则与裸验证码同分无法区分）', () => {
  const pattern = extractConst('INSIGHT_NOISE_CONTEXT_PATTERN');
  for (const word of ['room', 'suite', '房号', '房间']) {
    assert.ok(pattern.includes(word), `噪声词表缺少 ${word}`);
  }
});

// ── 回归：调用点必须走统一的取样参数，不能各写各的 ──────────────────
test('候选池构造走 getInsightSamplingParams，不再硬编码阈值', () => {
  const fn = extractFunction('extractMailInsightsWithApi');
  const uses = (fn.match(/getInsightSamplingParams\(\)/g) || []).length;
  assert.ok(uses >= 2, `两处候选池构造都应走统一参数，实际 ${uses} 处`);
  assert.doesNotMatch(fn, /minScore: INSIGHT_CODE_MIN_SCORE\b/, '不得再硬编码 minScore');
});

test('adjudicateInsightsWithJev 不得把调用方给的池二次截断回 8', () => {
  // 实测缺陷：调用方按召回优先给了 16 个候选，这里若固定 slice(0,8)，
  // 同分噪声淹没时真码会被截断漏掉。
  const fn = extractFunction('adjudicateInsightsWithJev');
  assert.doesNotMatch(fn, /slice\(0, JEV_MAX_CANDIDATES\)/,
    '应使用 getInsightLinkLimit()，不能再固定截断到 JEV_MAX_CANDIDATES');
  assert.match(fn, /getInsightLinkLimit\(\)/, '必须尊重调用方的取样上限');
});

// ── 回归：噪声词回溯不能跨行 ────────────────────────────────────────
// 实测缺陷：房号在真码上一行时，40 字符回溯窗口把上一行内容算进来，
// 真码 5521 被误打成 -6（和房号同分），连候选池都进不去，召回优先也救不回。
test('getCodePrecedingContext 只回溯到本行行首，不跨行污染', () => {
  const s = {};
  runInNewContext(extractFunction('getCodePrecedingContext'), s);
  const text = 'Room 4411 is ready\nPlease enter 5521';
  const idx = text.indexOf('5521');
  const ctx = s.getCodePrecedingContext(text, idx);
  assert.ok(!ctx.includes('Room'), `回溯不得跨越换行，实际拿到 ${JSON.stringify(ctx)}`);
  assert.equal(ctx, 'Please enter ');
});

test('同一行内的噪声词仍然能被识别（跨行截断不能把同行判断也废掉）', () => {
  const s = {};
  runInNewContext(extractFunction('getCodePrecedingContext'), s);
  const text = 'Order number 5521 shipped';
  const idx = text.indexOf('5521');
  assert.match(s.getCodePrecedingContext(text, idx), /Order/,
    '同行噪声词必须仍然可见，否则房号/订单号无法下沉');
});

test('房号在上一行时，真码分数必须高于房号且进得了候选池', () => {
  const scope = {};
  const names = ['INSIGHT_VERIFY_KEYWORDS', 'INSIGHT_FALSE_PROMPT_PATTERN', 'INSIGHT_PROMPT_PATTERN',
    'INSIGHT_DATE_LIKE_PATTERN', 'INSIGHT_YEAR_LIKE_PATTERN', 'INSIGHT_PHONE_LIKE_PATTERN',
    'INSIGHT_NOISE_CONTEXT_PATTERN'];
  const code = [
    ...names.map((n) => extractConst(n).replace(/^(\s*)const /m, '$1')),
    extractFunction('getCodePrecedingContext'),
    extractFunction('hasVerifyKeywordNearby'),
    extractFunction('collectCodeCandidates')
  ].join('\n');
  runInNewContext(code, scope);
  const records = scope.collectCodeCandidates('Room 4411 is ready\nPlease enter 5521 to continue');
  const room = records.find((r) => r.value === '4411');
  const truth = records.find((r) => r.value === '5521');
  assert.ok(room, '房号应仍是候选（只是分数更低）');
  assert.ok(truth, '真码必须保留为候选');
  assert.ok(truth.score > room.score,
    `真码分数(${truth.score})必须高于房号(${room.score})，否则无法区分`);
  assert.ok(truth.score >= -3,
    `真码分数(${truth.score})应不低于召回优先阈值 -3，否则进不了候选池`);
});

// ── 回归：四种配置组合的产品约定 ────────────────────────────────────
//   AI 不可用 + Jev 不可用 → 正则
//   AI 不可用 + Jev 可用   → 正则 + Jev
//   AI 可用   + Jev 不可用 → 正则 + AI
//   AI 可用   + Jev 可用   → 正则 + AI + Jev
// 关键不变量：**只要 Jev 可用就一定会被调用**，包括 AI 请求失败时。
// 曾经的缺陷：AI 配置存在但请求失败（网络错误/非 2xx/非法 JSON）时在 Jev
// 之前就 return，导致网关侧完全没有 Jev 调用记录，面板只剩正则结果。

const COMBO_SOURCE = readFileSync(join(__dirname, '../popup.js'), 'utf8');

function extractComboUnit(decl) {
  const lines = COMBO_SOURCE.split('\n');
  const i = lines.findIndex((l) => l.startsWith(INDENT + decl));
  if (i < 0) return null;
  const out = [];
  for (let k = i; k < lines.length; k += 1) {
    const line = lines[k];
    out.push(line);
    if (k === i && line.trim().endsWith(';')) break;
    if (k > i && line.startsWith(INDENT) && !line.startsWith(INDENT + ' ')) {
      const t = line.trim();
      if (t === '}' || t === '];' || t === '};' || t.endsWith(';')) break;
    }
  }
  return out.join('\n');
}

const COMBO_CONSTS = [
  'INSIGHT_MAX_ITEMS', 'INSIGHT_CODE_MIN_SCORE', 'INSIGHT_LINK_MIN_SCORE', 'INSIGHT_CODE_MIN_SCORE_RECALL',
  'INSIGHT_VERIFY_KEYWORDS', 'INSIGHT_FALSE_PROMPT_PATTERN', 'INSIGHT_PROMPT_PATTERN',
  'INSIGHT_ANCHOR_VERIFY_PATTERN', 'INSIGHT_ANCHOR_DEMOTE_PATTERN', 'INSIGHT_URL_DEMOTE_PATTERN',
  'INSIGHT_URL_SIGNAL_PATTERN', 'INSIGHT_URL_TOKEN_PATTERN', 'INSIGHT_DATE_LIKE_PATTERN',
  'INSIGHT_YEAR_LIKE_PATTERN', 'INSIGHT_PHONE_LIKE_PATTERN', 'INSIGHT_NOISE_CONTEXT_PATTERN',
  'JEV_MAX_CANDIDATES', 'JEV_MAX_CANDIDATES_RECALL', 'JEV_LINK_THRESHOLD',
  'DEFAULT_JEV_ENDPOINT_PATH', 'DEFAULT_JEV_MODEL', 'DEFAULT_TRANSLATION_API_BASE',
  'DEFAULT_MAIL_INSIGHT_API_MODE', 'MAX_TRANSLATION_SOURCE_CHARS', 'AI_REQUEST_TIMEOUT_MS'
];

const COMBO_FNS = [
  'normalizeTranslationSetting', 'getCodePrecedingContext', 'normalizeAnchorText',
  'hasVerifyKeywordNearby', 'collectCodeCandidates', 'collectLinkCandidates',
  'rankInsightCandidates', 'trimUrlPunctuation', 'formatInsightLinkLabel', 'normalizeUrlKey',
  'dedupeLinksByNormalizedKey', 'getJevConfig', 'hasJevConfig', 'getInsightSamplingParams',
  'getInsightLinkLimit', 'callJev', 'adjudicateInsightsWithJev', 'normalizeMailInsightApiMode',
  'getMailInsightApiConfig', 'hasMailInsightConfig', 'normalizeTranslationSource',
  'buildLocalInsightResult', 'mergeInsightValues', 'parseMailInsightJson', 'normalizeAiInsightResult',
  'normalizeAiInsightCode', 'verifyCodesAgainstSource', 'verifyLinksAgainstSource',
  'extractHttpUrlsFromText', 'fallbackToJevOrLocal', 'extractMailInsightsWithApi'
];

const COMBO_MAIL = [
  'Your verification code is 483920',
  '[邮件中的完整原始链接]',
  'Verify your email -> https://github.com/verify?token=aaa111bbb222'
].join('\n');

function comboEngine(options) {
  const calls = [];
  const scope = {
    URL,
    AbortController,
    MAX_TRANSLATION_SOURCE_CHARS: 12000,
    AI_REQUEST_TIMEOUT_MS: 30000,
    fetchWithTimeout: async (url) => {
      calls.push(url);
      if (url.includes('/chat/completions')) {
        if (options.ai === 'fail500') return { ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) };
        if (options.ai === 'throw') throw new Error('连接被拒绝');
        if (options.ai === 'badjson') return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '不是 JSON' } }] }) };
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"codes":["483920"],"links":[]}' } }] }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'jev-1.13.0',
          answers: {
            real_code: { type: 'choice', choice: '483920', confidence: 0.99 },
            link_0: { type: 'noul', noul: 0.78 }
          }
        })
      };
    }
  };
  const hasAi = options.mode === 'custom' || options.mode === 'translation';
  runInNewContext([
    ...COMBO_CONSTS.map((n) => extractComboUnit('const ' + n + ' = ').replace(/^(\s*)const /m, '$1')),
    ...COMBO_FNS.map((n) => extractComboUnit('function ' + n + '(') || extractComboUnit('async function ' + n + '(')),
    'var mailInsightApiMode = ' + JSON.stringify(options.mode) + ';',
    'var mailInsightApiBase = "https://ai.example.com/v1";',
    'var mailInsightApiKey = "sk-ai";',
    'var mailInsightModel = "gpt-4.1-mini";',
    'var translationApiBase = ' + JSON.stringify(hasAi ? 'https://ai.example.com/v1' : '') + ';',
    'var translationApiKey = ' + JSON.stringify(hasAi ? 'sk-tr' : '') + ';',
    'var translationModel = ' + JSON.stringify(hasAi ? 'gpt-4.1-mini' : '') + ';',
    'var jevEnabled = ' + (options.jev ? 'true' : 'false') + ';',
    "var jevApiBase = 'https://newapi.cfwork.cc.cd';",
    "var jevApiKey = 'sk-jev';",
    "var jevEndpointPath = '/typesafe/v1/systemone';",
    "var jevModel = 'jev-latest';",
    'var jevRecallMode = false;'
  ].join('\n'), scope);
  return { scope, calls };
}

async function runCombo(options) {
  const { scope, calls } = comboEngine(options);
  const result = await scope.extractMailInsightsWithApi(COMBO_MAIL, {});
  return {
    result,
    aiCalled: calls.some((u) => u.includes('chat/completions')),
    jevCalled: calls.some((u) => u.includes('systemone'))
  };
}

test('① AI 不可用 + Jev 不可用 → 只用正则，两者都不调用', async () => {
  const { result, aiCalled, jevCalled } = await runCombo({ mode: 'none', jev: false, ai: 'ok' });
  assert.equal(aiCalled, false);
  assert.equal(jevCalled, false);
  assert.equal(result.source, 'local');
  assert.deepEqual(JSON.parse(JSON.stringify(result.codes)), ['483920'], '正则应照常给出结果');
});

test('② AI 不可用 + Jev 已配 → 正则 + Jev（不调 AI）', async () => {
  const { result, aiCalled, jevCalled } = await runCombo({ mode: 'none', jev: true, ai: 'ok' });
  assert.equal(aiCalled, false, '明确不使用 AI 时绝不能发起 AI 请求');
  assert.equal(jevCalled, true, 'Jev 必须被调用');
  assert.equal(result.source, 'jev');
});

test('③ AI 可用 + Jev 未配 → 正则 + AI（不调 Jev）', async () => {
  const { result, aiCalled, jevCalled } = await runCombo({ mode: 'custom', jev: false, ai: 'ok' });
  assert.equal(aiCalled, true);
  assert.equal(jevCalled, false, 'Jev 未启用时不得发起请求');
  assert.equal(result.source, 'ai');
});

test('④ AI 可用 + Jev 已配 → 正则 + AI + Jev', async () => {
  const { result, aiCalled, jevCalled } = await runCombo({ mode: 'custom', jev: true, ai: 'ok' });
  assert.equal(aiCalled, true);
  assert.equal(jevCalled, true);
  assert.equal(result.source, 'jev', 'Jev 结果优先于 AI');
});

test('⑤ AI 请求失败(500) + Jev 已配 → 仍必须走 Jev（本轮修复的核心缺陷）', async () => {
  const { result, jevCalled } = await runCombo({ mode: 'custom', jev: true, ai: 'fail500' });
  assert.equal(jevCalled, true, 'AI 失败不能挡在 Jev 前面');
  assert.equal(result.source, 'jev');
  assert.ok(result.aiError, '应保留 AI 失败原因供 UI 说明');
});

test('⑥ AI 网络异常 + Jev 已配 → 仍必须走 Jev', async () => {
  const { result, jevCalled } = await runCombo({ mode: 'custom', jev: true, ai: 'throw' });
  assert.equal(jevCalled, true);
  assert.equal(result.source, 'jev');
});

test('⑦ AI 返回非法 JSON + Jev 已配 → 仍必须走 Jev', async () => {
  const { result, jevCalled } = await runCombo({ mode: 'custom', jev: true, ai: 'badjson' });
  assert.equal(jevCalled, true);
  assert.equal(result.source, 'jev');
});

test('⑧ AI 失败 + Jev 不可用 → 回落正则，且不抛错', async () => {
  const { result, jevCalled } = await runCombo({ mode: 'custom', jev: false, ai: 'fail500' });
  assert.equal(jevCalled, false);
  assert.equal(result.source, 'local');
  assert.ok(result.error, '应带出 AI 失败原因');
});

test('⑨ 复用翻译 API 模式 + Jev 已配 → 正则 + AI + Jev', async () => {
  const { result, aiCalled, jevCalled } = await runCombo({ mode: 'translation', jev: true, ai: 'ok' });
  assert.equal(aiCalled, true);
  assert.equal(jevCalled, true);
  assert.equal(result.source, 'jev');
});

test('静态守卫：AI 段落里的失败路径必须先经过 Jev 兜底', () => {
  const fn = extractFunction('extractMailInsightsWithApi');
  // 只看 AI 段落：配置读取那一行之后的部分。
  // 之前的「AI 未配置 + Jev 失败」分支允许直接返回本地结果 —— 那时既没有 AI
  // 也没有可用的 Jev，回落本地是唯一正确行为，不该被这条断言误伤。
  const marker = 'const config = getMailInsightApiConfig();';
  const idx = fn.indexOf(marker);
  assert.ok(idx > 0, '未找到 AI 段落起点');
  const aiSection = fn.slice(idx);
  const directReturns = (aiSection.match(/return \{ \.\.\.localResult/g) || []).length;
  assert.equal(directReturns, 0,
    'AI 失败时必须走 fallbackToJevOrLocal，不能直接返回本地结果');
  const fallbackCalls = (aiSection.match(/fallbackToJevOrLocal\(/g) || []).length;
  assert.ok(fallbackCalls >= 3, `三处 AI 失败出口都应走统一兜底，实际 ${fallbackCalls} 处`);
});

test('fallbackToJevOrLocal 在 Jev 不可用时退回本地、可用时必须调用 Jev', () => {
  const fn = extractFunction('fallbackToJevOrLocal');
  assert.match(fn, /hasJevConfig\(\)/, '必须先判断 Jev 是否可用');
  assert.match(fn, /adjudicateInsightsWithJev\(/, 'Jev 可用时必须裁决');
  assert.match(fn, /jevOnly: true/, '应标记为 Jev 独立工作');
});

test('新增的 none 模式：normalize 与配置读取都要正确处理', () => {
  const scope = {
    DEFAULT_MAIL_INSIGHT_API_MODE: 'translation',
    mailInsightApiMode: 'none',
    mailInsightApiBase: 'https://x/v1',
    mailInsightApiKey: 'sk-x',
    mailInsightModel: 'm',
    translationApiBase: 'https://y/v1',
    translationApiKey: 'sk-y',
    translationModel: 'm2',
    DEFAULT_TRANSLATION_API_BASE: 'https://api.openai.com/v1',
    normalizeTranslationSetting: (v, f = '') => (typeof v === 'string' && v.trim()) || f
  };
  runInNewContext([
    extractFunction('normalizeMailInsightApiMode'),
    extractFunction('getMailInsightApiConfig'),
    extractFunction('hasMailInsightConfig')
  ].join('\n'), scope);
  assert.equal(scope.normalizeMailInsightApiMode('none'), 'none');
  assert.equal(scope.normalizeMailInsightApiMode('bogus'), 'translation', '非法值仍回落默认');
  assert.equal(scope.hasMailInsightConfig(), false, 'none 模式必须让 AI 视为不可用');
});

test('洞察相关配置变更后必须重新触发判定（否则启用 Jev 后旧邮件不刷新）', () => {
  assert.match(COMBO_SOURCE, /insightConfigChanged/,
    '缺少配置变更后的重新判定，启用 Jev 后已打开的邮件不会重新提取');
  assert.match(COMBO_SOURCE, /triggerMailAiInsights\(reader, true\)/,
    '重新判定必须用 force=true 绕过状态短路');
});

// ── 静态守卫：onChanged 里每个 changes 分支都必须有 if 守卫 ──────────
// 实测踩到的坑：给 JEV_RECALL_MODE_KEY 加分支时，误删了下一条
// `if (changes[GENERATED_RESULT_AUTO_CLOSE_KEY]) {` 的头部。因为后面还留着
// 一个 `}`，整体**恰好语法合法**（node --check 能过），但那些语句变成了
// 无条件执行 —— 每次任何 storage 变更都会重跑一遍自动关闭计时器逻辑。
// 所以这里逐条校验「被赋值的 changes 分支」都有对应的 if。
test('onChanged 的每个 changes 分支都带 if 守卫（防误删导致的静默无条件执行）', () => {
  const lines = COMBO_SOURCE.split('\n');
  const start = lines.findIndex((l) => l.includes('chrome.storage.onChanged.addListener'));
  assert.ok(start > 0, '未找到 onChanged 监听');

  const offenders = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    // 形如  `changes[XXX_KEY].newValue` 出现在赋值右侧，且上一行不是 if
    if (!/^\s{4}\w[\w.]*\s*=\s*.*changes\[/.test(line)) continue;
    const prev = lines[i - 1] || '';
    if (!/if \(changes\[/.test(prev)) {
      offenders.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
    }
  }
  assert.deepEqual(offenders, [],
    `这些 changes 赋值缺少 if 守卫（会无条件执行）:\n${offenders.join('\n')}`);
});

test('生成的自动关闭计时器分支必须带 if 守卫（历史 bug 的精确回归）', () => {
  const lines = COMBO_SOURCE.split('\n');
  const idx = lines.findIndex((l) => /^\s+generatedResultAutoCloseSeconds = normalizeGeneratedResultAutoCloseSeconds\(changes/.test(l));
  assert.ok(idx > 0, '未找到该分支');
  assert.match(lines[idx - 1], /^\s+if \(changes\[GENERATED_RESULT_AUTO_CLOSE_KEY\]\) \{/,
    '该分支必须紧跟在自己的 if 之后，否则会无条件执行');
});
