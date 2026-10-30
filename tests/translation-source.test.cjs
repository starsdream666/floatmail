const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');

// 与 insight-extraction.test.cjs 相同的按缩进切分方式：
// 只把需要的函数切出来在独立 vm 上下文里跑，不加载整个 popup。
const INDENT = '  ';

function findStart(declaration) {
  const lines = source.split('\n');
  const index = lines.findIndex((line) => line.startsWith(`${INDENT}${declaration}`));
  assert.ok(index >= 0, `未找到声明 ${declaration}`);
  return { lines, index };
}

function extractUnit(declaration) {
  const { lines, index } = findStart(declaration);
  const collected = [];
  for (let i = index; i < lines.length; i += 1) {
    const line = lines[i];
    collected.push(line);
    if (i === index && line.trim().endsWith(';')) {
      break;
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

const MAX_SOURCE_CHARS = 12000;
const IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// htmlToText / 解码函数在真实运行时由 mail-render 模块提供，这里用等价桩替代
//（真实实现有 mail-render.test.cjs 覆盖）。
const rendererStubs = {
  htmlToText: (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  decodeBase64UTF8: (str) => Buffer.from(String(str || '').replace(/\s/g, ''), 'base64').toString('utf8'),
  decodeQuotedPrintable: (str) => String(str || '')
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
};

function sourceEngine() {
  const scope = { MAX_TRANSLATION_SOURCE_CHARS: MAX_SOURCE_CHARS };
  runInNewContext([
    extractConst('MAX_TRANSLATION_SOURCE_CHARS'),
    extractFunction('normalizeTranslationSource')
  ].join('\n'), scope);
  return scope;
}

function fallbackEngine() {
  const scope = { console, ...rendererStubs };
  runInNewContext([
    extractFunction('looksLikeRawMime'),
    extractFunction('extractTextFromRawMimeFallback')
  ].join('\n'), scope);
  return scope;
}

function tempSourceEngine(parsedBody) {
  const scope = {
    console,
    ...rendererStubs,
    parseEmailBody: () => parsedBody,
    isStubPlainText: () => false
  };
  runInNewContext([
    extractConst('MAX_TRANSLATION_SOURCE_CHARS'),
    extractFunction('looksLikeRawMime'),
    extractFunction('extractTextFromRawMimeFallback'),
    extractFunction('normalizeTranslationSource'),
    extractFunction('getTempMailTranslationSource')
  ].join('\n'), scope);
  return scope;
}

// 构造一封 multipart/related 原始邮件；parts 是各分段的内容行。
function multipartRaw(parts) {
  const lines = ['Content-Type: multipart/related; boundary="mix"', 'MIME-Version: 1.0', ''];
  parts.forEach((partLines) => {
    lines.push('--mix');
    lines.push(...partLines);
  });
  lines.push('--mix--', '');
  return lines.join('\r\n');
}

// ── normalizeTranslationSource：二进制载荷清洗 ─────────────────────

test('data URI 形式的图片数据会被剥离，正文与验证码保留', () => {
  const scope = sourceEngine();
  const input = [
    '您的验证码是 483920。',
    `<img src="data:image/png;base64,${IMAGE_BASE64}" alt="code">`,
    '请勿泄露给他人。'
  ].join('\n');
  const out = scope.normalizeTranslationSource(input);
  assert.doesNotMatch(out, /iVBOR/);
  assert.doesNotMatch(out, /base64/i);
  assert.match(out, /483920/);
  assert.match(out, /请勿泄露给他人/);
});

test('MIME 换行的整行 base64 图片数据会被剥离', () => {
  const scope = sourceEngine();
  const wrapped = IMAGE_BASE64.repeat(2).match(/.{1,76}/g).join('\n');
  const out = scope.normalizeTranslationSource(`订单号 A-1024 已发货。\n${wrapped}\n感谢购买。`);
  assert.doesNotMatch(out, /iVBOR/);
  assert.match(out, /订单号 A-1024/);
  assert.match(out, /感谢购买/);
});

test('普通正文、验证码与链接不会被误伤', () => {
  const scope = sourceEngine();
  const text = [
    'Your verification code is 483920.',
    'Verify: https://github.com/verify?token=aaa111bbb222',
    '您的订单号 A-1024 已发货。'
  ].join('\n');
  assert.equal(scope.normalizeTranslationSource(text), text);
});

test('低于阈值的短 token 行不会被误删', () => {
  const scope = sourceEngine();
  const shortLine = '483920ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl';
  assert.equal(scope.normalizeTranslationSource(shortLine), shortLine);
});

// ── extractTextFromRawMimeFallback：兜底取材只采信文本部分 ─────────

test('图片部分的 base64 不会进入兜底取材结果', () => {
  const scope = fallbackEngine();
  const raw = multipartRaw([
    ['Content-Type: text/html; charset=utf-8', '', '<html><body><p>您的验证码是 483920</p></body></html>'],
    ['Content-Type: image/png; name="code.png"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: inline; filename="code.png"', '', IMAGE_BASE64]
  ]);
  const text = scope.extractTextFromRawMimeFallback(raw);
  assert.match(text, /483920/);
  assert.doesNotMatch(text, /iVBOR/);
});

test('正文只有图片时兜底取材返回空，而不是图片数据', () => {
  const scope = fallbackEngine();
  const raw = multipartRaw([
    ['Content-Type: text/html; charset=utf-8', '', '<html><body><img src="cid:code"></body></html>'],
    ['Content-Type: image/png', 'Content-Transfer-Encoding: base64', '', IMAGE_BASE64]
  ]);
  assert.equal(scope.extractTextFromRawMimeFallback(raw), '');
});

test('base64 编码的文本部分会按 charset 解码后取材', () => {
  const scope = fallbackEngine();
  const encoded = Buffer.from('验证码 8842', 'utf8').toString('base64');
  const raw = multipartRaw([
    ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', encoded]
  ]);
  assert.match(scope.extractTextFromRawMimeFallback(raw), /8842/);
});

test('附件部分不会被当作正文取材', () => {
  const scope = fallbackEngine();
  const raw = multipartRaw([
    ['Content-Type: text/plain; charset=utf-8', '', '正文验证码 5521'],
    ['Content-Type: application/pdf; name="a.pdf"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename="a.pdf"', '', Buffer.from('ATTACHMENT').toString('base64')]
  ]);
  assert.equal(scope.extractTextFromRawMimeFallback(raw), '正文验证码 5521');
});

// ── getTempMailTranslationSource：完整取材链路（504 场景回归） ─────

test('正文只有图片的邮件：取材结果为空，绝不会把图片数据发出去', () => {
  const scope = tempSourceEngine({ html: '<html><body><img src="cid:code"></body></html>' });
  const raw = multipartRaw([
    ['Content-Type: text/html; charset=utf-8', '', '<html><body><img src="cid:code"></body></html>'],
    ['Content-Type: image/png; name="code.png"', 'Content-Transfer-Encoding: base64', 'Content-Disposition: inline; filename="code.png"', '', IMAGE_BASE64]
  ]);
  const text = scope.getTempMailTranslationSource({ raw });
  assert.doesNotMatch(text, /iVBOR/);
  assert.equal(text, '');
});

test('解析器没取到内容但 raw 里有文本部分时，兜底取材仍能救回正文', () => {
  const scope = tempSourceEngine({ html: '' });
  const raw = multipartRaw([
    ['Content-Type: text/plain; charset=utf-8', '', '验证码 6633，请在 10 分钟内使用。']
  ]);
  const text = scope.getTempMailTranslationSource({ raw });
  assert.match(text, /6633/);
});

// ── 静态守卫 ──────────────────────────────────────────────────────

test('静态守卫：兜底取材必须走文本过滤函数，不能直接拼接原始分段', () => {
  const fn = extractFunction('getTempMailTranslationSource');
  assert.match(fn, /extractTextFromRawMimeFallback\(/);
  assert.doesNotMatch(fn, /manually strip MIME headers/);
});
