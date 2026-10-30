const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(join(__dirname, '../popup.js'), 'utf8');

// 与 translation-source.test.cjs 相同的按缩进切分方式：
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

const extractConst = (name) => extractUnit(`const ${name} = `);
// 翻译链路里既有普通函数也有 async 函数，两种声明形态都要能切出来。
function extractFunction(name) {
  for (const declaration of [`function ${name}(`, `async function ${name}(`]) {
    try {
      return extractUnit(declaration);
    } catch {
      // 换下一个形态
    }
  }
  throw new Error(`未找到函数声明 ${name}`);
}

const TRANSLATION_FNS = [
  'normalizeTranslationSetting',
  'normalizeTranslationSource',
  'splitTranslationChunks',
  'requestChatCompletion',
  'translateTextWithApi'
];

const TRANSLATION_CONSTS = [
  'MAX_TRANSLATION_SOURCE_CHARS',
  'TRANSLATION_CHUNK_MAX_CHARS',
  'DEFAULT_TRANSLATION_API_BASE',
  'DEFAULT_TRANSLATION_TARGET_LANGUAGE',
  'AI_REQUEST_TIMEOUT_MS'
];

const encoder = new TextEncoder();

function sseResponse(pieces) {
  const body = new ReadableStream({
    start(controller) {
      pieces.forEach((piece) => controller.enqueue(encoder.encode(piece)));
      controller.close();
    }
  });
  return { ok: true, status: 200, headers: { get: () => 'text/event-stream; charset=utf-8' }, body };
}

const sseData = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
const SSE_DONE = 'data: [DONE]\n\n';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload
  };
}

function htmlErrorResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => 'text/html' },
    json: async () => {
      throw new Error('不是 JSON');
    }
  };
}

// 建立只含翻译链路的 vm 上下文；respond(请求序号, 请求体) 返回假响应。
function translationEngine(respond) {
  const requests = [];
  const scope = {
    AbortController,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    ReadableStream,
    translationApiBase: 'https://translate.example.com/v1',
    translationApiKey: 'sk-test',
    translationModel: 'test-model',
    translationTargetLanguage: '简体中文',
    hasTranslationConfig: () => true,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ url, body, headers: init.headers });
      return respond(requests.length, body);
    }
  };
  runInNewContext([
    ...TRANSLATION_CONSTS.map((name) => extractConst(name).replace(/^(\s*)const /m, '$1')),
    ...TRANSLATION_FNS.map((name) => extractFunction(name))
  ].join('\n'), scope);
  return { scope, requests };
}

// 生成 n 段、每段约 lineChars 字符的正文（段内无换行，段落之间用空行分隔）。
function longBody(paragraphCount, lineChars) {
  return Array.from({ length: paragraphCount }, (_, i) => {
    const marker = `PARA${i + 1}`;
    return `${marker} ${'x'.repeat(Math.max(0, lineChars - marker.length - 1))}`;
  }).join('\n\n');
}

// ── splitTranslationChunks ────────────────────────────────────────

test('长正文按上限切成多段，拼回来内容不变', () => {
  const { scope } = translationEngine(() => sseResponse([SSE_DONE]));
  const text = longBody(6, 700);
  const chunks = scope.splitTranslationChunks(text);
  assert.ok(chunks.length > 1, `应切成多段，实际 ${chunks.length}`);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= scope.TRANSLATION_CHUNK_MAX_CHARS, `分段超长: ${chunk.length}`);
  }
  assert.equal(chunks.join('\n'), text, '分段拼接后应与原文一致');
});

test('超过上限的单行会被硬切，且不丢字符', () => {
  const { scope } = translationEngine(() => sseResponse([SSE_DONE]));
  const line = 'y'.repeat(scope.TRANSLATION_CHUNK_MAX_CHARS * 2 + 137);
  const chunks = scope.splitTranslationChunks(line);
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= scope.TRANSLATION_CHUNK_MAX_CHARS);
  }
  assert.equal(chunks.join(''), line);
});

test('短正文保持单段', () => {
  const { scope } = translationEngine(() => sseResponse([SSE_DONE]));
  const text = '验证码 483920，请在 10 分钟内使用。';
  // vm 里造出来的数组原型来自另一个 realm，展开成当前 realm 的数组再比较。
  assert.deepEqual([...scope.splitTranslationChunks(text)], [text]);
});

// ── requestChatCompletion ─────────────────────────────────────────

test('流式响应按 SSE 累积分片，并回传增量', async () => {
  const { scope, requests } = translationEngine(() => sseResponse([
    sseData('第一段'),
    sseData('，第二段'),
    SSE_DONE
  ]));
  const deltas = [];
  const text = await scope.requestChatCompletion({
    apiBase: 'https://translate.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    temperature: 0.2,
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: (delta, accumulated) => deltas.push([delta, accumulated])
  });
  assert.equal(text, '第一段，第二段');
  assert.deepEqual(deltas, [['第一段', '第一段'], ['，第二段', '第一段，第二段']]);
  assert.equal(requests[0].body.stream, true, '必须声明 stream:true，否则网关会 504');
  assert.equal(requests[0].url, 'https://translate.example.com/v1/chat/completions');
});

test('SSE 分片被网络切成两半时仍能正确解析', async () => {
  const payload = sseData('完整译文');
  const cut = Math.floor(payload.length / 2);
  const { scope } = translationEngine(() => sseResponse([payload.slice(0, cut), payload.slice(cut), SSE_DONE]));
  const text = await scope.requestChatCompletion({
    apiBase: 'https://translate.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    temperature: 0.2,
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(text, '完整译文');
});

test('服务端忽略 stream 参数时回退到 JSON 解析', async () => {
  const { scope } = translationEngine(() => jsonResponse({ choices: [{ message: { content: '  JSON 译文  ' } }] }));
  const text = await scope.requestChatCompletion({
    apiBase: 'https://translate.example.com/v1',
    apiKey: 'sk-test',
    model: 'test-model',
    temperature: 0.2,
    messages: [{ role: 'user', content: 'hi' }]
  });
  assert.equal(text, 'JSON 译文');
});

test('非 2xx 响应抛出服务端错误信息', async () => {
  const { scope } = translationEngine(() => jsonResponse({ error: { message: '模型不可用' } }, 503));
  await assert.rejects(
    () => scope.requestChatCompletion({
      apiBase: 'https://translate.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
      temperature: 0.2,
      messages: [{ role: 'user', content: 'hi' }]
    }),
    /模型不可用/
  );
});

// ── translateTextWithApi：长邮件按段翻译 ───────────────────────────

test('长邮件按段翻译：每段独立请求，译文按顺序拼接', async () => {
  const { scope, requests } = translationEngine((index) => sseResponse([sseData(`【第${index}段译文】`), SSE_DONE]));
  const text = longBody(6, 700);
  const progress = [];
  const translated = await scope.translateTextWithApi(text, {
    subject: '主题A',
    from: 'a@b.com',
    onProgress: (partial) => progress.push(partial)
  });

  assert.ok(requests.length > 1, `长邮件应拆成多次请求，实际 ${requests.length}`);
  const expected = requests.map((_, i) => `【第${i + 1}段译文】`).join('\n');
  assert.equal(translated, expected, '译文必须按分段顺序拼接');

  // 每段请求正文都不超过上限（提示词占少量固定字符）。
  for (const request of requests) {
    const userContent = request.body.messages[1].content;
    assert.ok(
      userContent.length <= scope.TRANSLATION_CHUNK_MAX_CHARS + 300,
      `分段请求正文过长: ${userContent.length}`
    );
    assert.equal(request.body.stream, true);
    assert.match(request.body.messages[0].content, /简体中文/);
  }

  // 主题/发件人只出现在第一段，避免每段译文都重复邮件头。
  assert.match(requests[0].body.messages[1].content, /主题：主题A/);
  assert.match(requests[0].body.messages[1].content, /发件人：a@b\.com/);
  for (const request of requests.slice(1)) {
    assert.doesNotMatch(request.body.messages[1].content, /主题：主题A/);
  }

  // 进度回调逐段增长，最后一段等于完整译文。
  assert.equal(progress.length, requests.length);
  assert.equal(progress.at(-1), expected);
  for (let i = 1; i < progress.length; i += 1) {
    assert.ok(progress[i].length > progress[i - 1].length, '进度文本应单调增长');
  }
});

test('短邮件只发一次请求，且带上主题与发件人', async () => {
  const { scope, requests } = translationEngine(() => sseResponse([sseData('短译文'), SSE_DONE]));
  const translated = await scope.translateTextWithApi('验证码 483920。', { subject: '短主题', from: 'x@y.com' });
  assert.equal(translated, '短译文');
  assert.equal(requests.length, 1);
  const userContent = requests[0].body.messages[1].content;
  assert.match(userContent, /主题：短主题/);
  assert.match(userContent, /发件人：x@y\.com/);
  assert.match(userContent, /验证码 483920。/);
});

test('网关 504（HTML 错误页）时报出可读错误，而不是崩溃', async () => {
  const { scope } = translationEngine(() => htmlErrorResponse(504));
  await assert.rejects(
    () => scope.translateTextWithApi('验证码 483920。', {}),
    /翻译请求失败: 504/
  );
});

test('分段翻译中途失败时，错误信息带上是第几段', async () => {
  const { scope } = translationEngine((index) => (
    index === 1 ? sseResponse([sseData('第一段'), SSE_DONE]) : htmlErrorResponse(504)
  ));
  await assert.rejects(
    () => scope.translateTextWithApi(longBody(6, 700), {}),
    /第 2\/\d+ 段翻译失败: 504/
  );
});

// ── 静态守卫 ──────────────────────────────────────────────────────

test('静态守卫：翻译请求必须走流式通道，不能再用 fetchWithTimeout', () => {
  const fn = extractFunction('translateTextWithApi');
  assert.match(fn, /requestChatCompletion\(/, '翻译必须经统一流式请求函数');
  assert.doesNotMatch(fn, /fetchWithTimeout\(/, '非流式请求在长邮件上会被网关 504');

  const helper = extractFunction('requestChatCompletion');
  assert.match(helper, /stream: true/, '必须声明 stream:true');
  assert.match(helper, /text\/event-stream/, '必须识别 SSE 响应');
});
