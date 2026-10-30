(function () {
  'use strict';

  const SAMPLE = 'Subject: Verify your email\nYour one-time verification code is 482913. Enter it to complete sign-in.';
  const QUESTIONS = { connection_test: { type: 'noul', instructions: 'Does this email contain a one-time verification code?' } };

  function safeError(error, secrets = []) {
    let message = String(error?.message || error || '未知错误');
    secrets.map((secret) => String(secret || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length)
      .forEach((secret) => { message = message.split(secret).join('[已隐藏]'); });
    return message.slice(0, 300);
  }

  function normalizeKeys(value) {
    return Array.from(new Set(String(value || '').split(/\r?\n/).map((key) => key.trim()).filter(Boolean)));
  }

  function apiBase(value) {
    const base = String(value || '').trim().replace(/\/+$/, '');
    let url;
    try { url = new URL(base); } catch { throw new Error('请填写有效的 API Base 地址'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('API Base 必须使用 HTTP 或 HTTPS');
    return base;
  }

  function checkProbability(answer) {
    if (typeof answer?.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) {
      throw new Error('接口已响应，但没有返回有效的判定结果，请检查模型和端点路径');
    }
  }

  async function measure(task, secrets) {
    const start = Date.now();
    try {
      await task();
      return { ok: true, elapsedMs: Date.now() - start };
    } catch (error) {
      return { ok: false, elapsedMs: Date.now() - start, error: safeError(error, secrets) };
    }
  }

  function batchResult(results) {
    return { ok: results.length > 0 && results.every((result) => result.ok), results,
      error: results.length ? '' : '请先添加要测试的账号或 Key' };
  }

  function describe(result) {
    if (result.stale) return '配置已修改，请重新测试';
    if (result.results?.length) {
      const passed = result.results.filter((item) => item.ok).length;
      return `测试完成：${passed}/${result.results.length} 项连接成功\n` + result.results.map((item, index) =>
        `${item.label || `第 ${index + 1} 项`}：${describe(item)}`).join('\n');
    }
    const time = Number.isFinite(result.elapsedMs) ? `（${result.elapsedMs} ms）` : '';
    return result.ok ? `连接成功${time}` : `连接失败${time}：${result.error || '未知错误'}`;
  }

  function createTester({ requestChatCompletion, request, clef, parseInsight = JSON.parse }) {
    return {
      testChat(config, kind = 'translation') {
        return measure(async () => {
          const base = apiBase(config.apiBase);
          const key = String(config.apiKey || '').trim();
          const model = String(config.model || '').trim();
          if (!key || !model) throw new Error('请先填写 API Key 和模型名称');
          const content = await requestChatCompletion({
            apiBase: base, apiKey: key, model, temperature: 0.1,
            messages: kind === 'insight'
              ? [{ role: 'system', content: '从邮件提取验证码，仅输出 JSON：{"codes":["验证码"],"links":[]}。' }, { role: 'user', content: SAMPLE }]
              : [{ role: 'user', content: 'Connection test. Reply with OK only.' }]
          });
          if (!String(content || '').trim()) throw new Error('接口已响应，但模型返回了空内容');
          if (kind === 'insight') {
            let parsed;
            try { parsed = parseInsight(content); } catch { parsed = null; }
            if (!parsed || !Array.isArray(parsed.codes) || !Array.isArray(parsed.links)) {
              throw new Error('接口已响应，但模型未返回可用的提取 JSON');
            }
          }
        }, [config.apiKey]);
      },

      async testJev(config) {
        const keys = normalizeKeys(config.apiKeys);
        if (!keys.length) return { ok: false, error: '请先填写 JEV API Key' };
        const results = [];
        for (const [index, key] of keys.entries()) {
          const result = await measure(async () => {
            const base = apiBase(config.apiBase);
            const path = String(config.endpointPath || '').trim();
            if (!path.startsWith('/') || path.startsWith('//')) throw new Error('请填写以 / 开头的 JEV 端点路径');
            if (!String(config.model || '').trim()) throw new Error('请先填写 JEV 模型名称');
            // 每个 Key 独立请求，不用其他 Key 的成功掩盖当前 Key 的失败。
            const response = await request(base + path, {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
              body: JSON.stringify({ model: config.model.trim(), state: SAMPLE, questions: QUESTIONS })
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
              const detail = data?.error?.message || data?.detail || data?.message || '';
              throw new Error(`HTTP ${response.status}${detail ? `：${String(detail)}` : ''}`);
            }
            checkProbability(data?.answers?.connection_test);
          }, keys);
          results.push({ ...result, label: `Key ${index + 1}` });
        }
        return batchResult(results);
      },

      testClefAccount(account, model) {
        return measure(async () => {
          if (!['clef', 'clef-flash'].includes(model)) throw new Error('请选择有效的 Clef 模型');
          const result = await clef.request(QUESTIONS, SAMPLE, { accounts: [account], model }, { request, maxAttempts: 1 });
          checkProbability(result.answers?.connection_test);
        }, [account.apiToken]);
      }
    };
  }

  function bindButton(button, status, readConfig, test, controls = []) {
    if (!button || !status) return;
    let lastSignature = '';
    const invalidate = () => {
      if (!lastSignature || button.disabled) return;
      let current;
      try { current = JSON.stringify(readConfig()); } catch { current = ''; }
      if (current !== lastSignature) {
        lastSignature = '';
        status.textContent = '配置已修改，请重新测试';
        status.className = 'message info ai-connection-result';
      }
    };
    controls.filter(Boolean).forEach((control) => ['input', 'change', 'click'].forEach((event) => control.addEventListener(event, invalidate)));
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const originalText = button.textContent;
      let config;
      try { config = readConfig(); } catch (error) {
        status.textContent = safeError(error);
        status.className = 'message error ai-connection-result';
        return;
      }
      button.disabled = true;
      button.textContent = '测试中...';
      status.textContent = '正在使用当前填写的配置测试...';
      status.className = 'message info ai-connection-result';
      try {
        const result = await test(config);
        let current;
        try { current = JSON.stringify(readConfig()); } catch { current = ''; }
        const stale = current !== JSON.stringify(config);
        lastSignature = stale ? '' : JSON.stringify(config);
        status.textContent = describe(stale ? { stale: true } : result);
        status.className = `message ${stale ? 'info' : result.ok ? 'success' : 'error'} ai-connection-result`;
      } catch {
        status.textContent = '测试失败，请检查网络和配置后重试';
        status.className = 'message error ai-connection-result';
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });
  }

  window.PopupAiConnectionTest = { createTester, bindButton, describe, batchResult };
})();
