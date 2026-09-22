const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');

// 说明：popup.js 是一个 IIFE。本测试沿用 popup-fill-rules.test.cjs 的思路，
// 只把需要的常量与函数切出来在独立 vm 上下文里跑，不加载整个 popup。
//
// 切分按「缩进」判定边界，而不是按括号/正则扫描 —— 候选引擎里的正则含有
// `[-/.]` 这样的字符类，任何朴素的括号/斜杠扫描都会被它骗到。
const INDENT = '  ';

function findStart(declaration) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${INDENT}${declaration}`));
  assert.ok(index >= 0, `未找到声明 ${declaration}`);
  return { lines, index };
}

// 从起始行往下吃，直到遇到「缩进正好为 2 且是收尾」的那一行。
function extractUnit(declaration) {
  const { lines, index } = findStart(declaration);
  const collected = [];
  for (let i = index; i < lines.length; i += 1) {
    const line = lines[i];
    collected.push(line);
    if (i === index && line.trim().endsWith(';')) {
      break; // 单行声明
    }
    if (i > index && line.startsWith(INDENT) && !line.startsWith(INDENT + ' ')) {
      const trimmed = line.trim();
      if (trimmed === '}' || trimmed === '];' || trimmed === '};' || trimmed.endsWith(';')) {
        break;
      }
    }
  }
  return collected.join('\n');
}

const extractFunction = (name) => extractUnit(`function ${name}(`);
const extractConst = (name) => extractUnit(`const ${name} = `);

const CONST_NAMES = [
  'INSIGHT_MAX_ITEMS', 'INSIGHT_CODE_MIN_SCORE', 'INSIGHT_LINK_MIN_SCORE',
  'INSIGHT_VERIFY_KEYWORDS', 'INSIGHT_FALSE_PROMPT_PATTERN', 'INSIGHT_PROMPT_PATTERN',
  'INSIGHT_ANCHOR_VERIFY_PATTERN', 'INSIGHT_ANCHOR_DEMOTE_PATTERN', 'INSIGHT_URL_DEMOTE_PATTERN',
  'INSIGHT_URL_SIGNAL_PATTERN', 'INSIGHT_URL_TOKEN_PATTERN', 'INSIGHT_DATE_LIKE_PATTERN',
  'INSIGHT_YEAR_LIKE_PATTERN', 'INSIGHT_PHONE_LIKE_PATTERN', 'INSIGHT_NOISE_CONTEXT_PATTERN'
];

const FUNCTION_NAMES = [
  'getCodePrecedingContext', 'normalizeAnchorText', 'hasVerifyKeywordNearby',
  'collectCodeCandidates', 'collectLinkCandidates', 'rankInsightCandidates',
  'trimUrlPunctuation', 'formatInsightLinkLabel', 'normalizeTranslationSource',
  'mergeInsightValues', 'buildLocalInsightResult', 'parseMailInsightJson'
];

function engine() {
  const scope = { MAX_TRANSLATION_SOURCE_CHARS: 12000, URL };
  // vm 里的顶层 `const` 不会挂到上下文对象上（只有 `function` 会），
  // 所以把 const 声明改写成赋值，让它们能被测试读到。
  const code = [
    ...CONST_NAMES.map((name) => extractConst(name).replace(/^(\s*)const /m, '$1')),
    ...FUNCTION_NAMES.map(extractFunction)
  ].join('\n');
  runInNewContext(code, scope);
  return scope;
}

// vm 里造出来的对象/数组原型来自另一个 realm，strict deepEqual 会比原型而失败。
// 比较前统一 JSON 往返一次，变成当前 realm 的普通结构。
const plain = (value) => JSON.parse(JSON.stringify(value));

const values = (records) => records.map((record) => record.value);
// 显式指定用哪个收集器，不再靠字符串猜（裸 URL 里没有 "->" 会猜错）。
const codeRank = (scope, text, limit = 3) => scope.rankInsightCandidates(
  scope.collectCodeCandidates(text),
  { limit, minScore: scope.INSIGHT_CODE_MIN_SCORE }
);
const linkRank = (scope, text, limit = 3) => scope.rankInsightCandidates(
  scope.collectLinkCandidates(text),
  { limit, minScore: scope.INSIGHT_LINK_MIN_SCORE }
);

test('纯字母十六进制单词不会被当成验证码', () => {
  const scope = engine();
  const text = 'In the last decade, the facade of the building was refaced.';
  const codes = values(scope.collectCodeCandidates(text));
  for (const word of ['decade', 'facade', 'refaced']) {
    assert.ok(!codes.includes(word), `英文单词被误抓: ${word}`);
  }
});

test('年份得分低于阈值', () => {
  const scope = engine();
  const candidates = scope.collectCodeCandidates('Copyright 2026 Example Inc.');
  assert.ok(
    !candidates.some((record) => record.value === '2026' && record.score >= scope.INSIGHT_CODE_MIN_SCORE),
    '年份不应达标'
  );
});

test('订单号附近的数字会被降权到阈值以下', () => {
  const scope = engine();
  const result = codeRank(scope, '订单号 order id: 8842013 已发出');
  assert.deepEqual(plain(values(result)), [], `订单号不该入选: ${JSON.stringify(values(result))}`);
});

test('提示词附近的真实验证码被选出且排最前', () => {
  const scope = engine();
  const text = [
    'Your order 7788120 has shipped.',
    '',
    'Your verification code is 483920',
    '',
    'Enter it to continue.'
  ].join('\n');
  const result = codeRank(scope, text);
  assert.ok(result.length > 0, '应该选出至少一个验证码');
  assert.equal(result[0].value, '483920');
  assert.ok(!values(result).includes('7788120'), '订单号不应出现在结果里');
});

test('带分隔符的验证码保留原文分组', () => {
  const scope = engine();
  const result = codeRank(scope, '验证码：123-456');
  assert.equal(result[0].value, '123-456');
});

test('紧贴 Code: 提示词的十六进制串正常入选', () => {
  const scope = engine();
  const result = codeRank(scope, 'Code: a1b2c3  expires in 10 minutes');
  assert.ok(values(result).includes('a1b2c3'), `未入选: ${JSON.stringify(values(result))}`);
});

// 下面这组是真实邮件里最常见、也最容易误判的形态（对抗性用例）。
const ADVERSARIAL = [
  ['Use promo code SAVE20 for 10% off', null],
  ['Your zip code 94107 is on file', null],
  ['Your country code is 0086', null],
  ['Your order code is 7788120', null],
  ['Your tracking number is 1Z999AA10123456784', null],
  ['Call us at +1 415 555 0132 today', null],
  ['Copyright 2026 Example Inc.', null],
  ['Your order 7788120 has shipped', null],
  ['Your verification code is 483920', '483920'],
  ['123456 is your Amazon OTP. Do not share it.', '123456'],
  ['Enter code 8842 to verify your account', '8842'],
  ['您的验证码是 8842，请勿泄露', '8842'],
  ['G-483920 is your Google verification code', 'G-483920'],
  ['Security code: 9981', '9981'],
  ['Your verification code is 483920. Use promo code SAVE20 for 10% off.', '483920']
];

ADVERSARIAL.forEach(([text, expected]) => {
  test(`对抗用例: ${text.slice(0, 40)}`, () => {
    const scope = engine();
    const top = codeRank(scope, text, 1).map((record) => record.value);
    if (expected === null) {
      assert.deepEqual(plain(top), [], `不该选出验证码，却得到 ${JSON.stringify(top)}`);
    } else {
      assert.equal(top[0], expected, `期望 ${expected}，得到 ${JSON.stringify(top)}`);
    }
  });
});

// ── 链接：锚文本优先 + 退订排除 ──────────────────────────────────────
test('锚文本是验证链接时优先于页脚账户链接', () => {
  const scope = engine();
  const text = [
    '欢迎注册',
    '',
    '[邮件中的完整原始链接...]',
    'Verify your email -> https://mail.example.com/verify?token=abc123',
    'Manage account -> https://example.com/account',
    'Unsubscribe -> https://example.com/unsubscribe'
  ].join('\n');
  const result = linkRank(scope, text);
  assert.ok(result.length > 0, '应该选出链接');
  assert.match(result[0].url, /\/verify\?token=abc123$/);
});

test('退订与追踪链接被硬性排除', () => {
  const scope = engine();
  const text = [
    'Unsubscribe -> https://example.com/unsubscribe?id=1',
    'Tracking pixel -> https://track.example.com/pixel.png',
    'Confirm -> https://example.com/confirm?code=xyz'
  ].join('\n');
  const result = linkRank(scope, text, 5);
  assert.deepEqual(plain(result.map((record) => record.url)), ['https://example.com/confirm?code=xyz']);
});

test('锚文本被完整保留供展示', () => {
  const scope = engine();
  const result = linkRank(
    scope,
    'Verify your email -> https://example.com/verify?token=t',
    1
  );
  assert.equal(result[0].anchorText, 'Verify your email');
});

test('没有锚文本时退化为 URL 特征打分', () => {
  const scope = engine();
  const result = linkRank(scope, '点这里 https://example.com/reset?token=abc 重置密码');
  assert.ok(result.length > 0);
  assert.match(result[0].url, /reset\?token=abc$/);
});

// ── 排序 ────────────────────────────────────────────────────────────
test('同分时按出现顺序稳定排序，相同候选只保留得分更高的一条', () => {
  const scope = engine();
  const result = scope.rankInsightCandidates([
    { value: 'AAA', key: 'AAA', score: 5, index: 10 },
    { value: 'BBB', key: 'BBB', score: 5, index: 2 },
    { value: 'AAA', key: 'AAA', score: 4, index: 1 }
  ], { limit: 3, minScore: 0 });
  assert.deepEqual(plain(values(result)), ['BBB', 'AAA']);
});

test('排序不修改传入的候选数组', () => {
  const scope = engine();
  const input = [{ value: 'Z', key: 'Z', score: 1, index: 9 }, { value: 'A', key: 'A', score: 9, index: 1 }];
  const snapshot = values(input);
  scope.rankInsightCandidates(input, { limit: 2, minScore: 0 });
  assert.deepEqual(values(input), snapshot);
});

test('limit 生效', () => {
  const scope = engine();
  const result = scope.rankInsightCandidates([
    { value: 'A', key: 'A', score: 9, index: 1 },
    { value: 'B', key: 'B', score: 8, index: 2 },
    { value: 'C', key: 'C', score: 7, index: 3 }
  ], { limit: 2, minScore: 0 });
  assert.equal(result.length, 2);
});

// ── 兜底：永远不抛错、永远返回可展示结构 ──────────────────────────────
test('本地兜底对空输入与垃圾输入都返回稳定结构', () => {
  const scope = engine();
  for (const input of ['', '   ', null, undefined, '<<<=====>>>', { not: 'text' }, 42]) {
    const result = scope.buildLocalInsightResult(input);
    assert.deepEqual(Object.keys(result).sort(), ['codes', 'links', 'source']);
    assert.equal(result.source, 'local');
    assert.ok(Array.isArray(result.codes));
    assert.ok(Array.isArray(result.links));
  }
});

test('本地兜底同时给出验证码与链接，且各自不超过上限', () => {
  const scope = engine();
  const text = [
    'Your verification code is 483920',
    '[邮件中的完整原始链接...]',
    'Verify your email -> https://example.com/verify?token=abc123'
  ].join('\n');
  const result = scope.buildLocalInsightResult(text);
  assert.equal(result.codes[0], '483920');
  assert.equal(result.links[0].url, 'https://example.com/verify?token=abc123');
  assert.ok(result.codes.length <= scope.INSIGHT_MAX_ITEMS);
  assert.ok(result.links.length <= scope.INSIGHT_MAX_ITEMS);
});

test('链接兜底带出可读 label', () => {
  const scope = engine();
  const result = scope.buildLocalInsightResult('Verify -> https://example.com/verify?token=abc123');
  assert.equal(result.links[0].label, 'Verify');
});

// ── AI 空/非法回应的解析容错 ─────────────────────────────────────────
test('空内容与非法 JSON 返回 null 而不是抛错', () => {
  const scope = engine();
  for (const input of ['', '   ', null, undefined, '抱歉，我无法处理', '{"codes":']) {
    assert.equal(scope.parseMailInsightJson(input), null);
  }
});
test('合法 JSON 仍能解析，且支持代码块包裹与前后噪声', () => {
  const scope = engine();
  assert.deepEqual(plain(scope.parseMailInsightJson('{"codes":["123456"],"links":[]}')), {
    codes: ['123456'],
    links: []
  });
  assert.deepEqual(
    plain(scope.parseMailInsightJson('```json\n{"codes":[],"links":[]}\n```')),
    { codes: [], links: [] }
  );
  assert.deepEqual(
    plain(scope.parseMailInsightJson('好的，结果如下：{"codes":["7788"],"links":[]} 完成')),
    { codes: ['7788'], links: [] }
  );
});

test('顶层数组不是合法提取结果', () => {
  const scope = engine();
  assert.equal(scope.parseMailInsightJson('[1,2,3]'), null);
});
