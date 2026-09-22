const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const scope = { window: {}, TextDecoder, TextEncoder, atob };
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
