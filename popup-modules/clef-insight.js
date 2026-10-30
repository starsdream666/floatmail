(function () {
  'use strict';

  const MODELS = ['clef', 'clef-flash'];
  const QUESTIONS = {
    otp: {
      type: 'noul',
      instructions: 'Does this email contain a one-time verification code the recipient must type in to prove they control the account?'
    },
    magic: {
      type: 'noul',
      instructions: "Does this email contain a link whose purpose is to verify the recipient's email address or complete a sign-in, as opposed to a marketing or informational link?"
    },
    extort: {
      type: 'noul',
      instructions: 'Does this email pressure the recipient to reveal a verification code or credentials to another person, which is a phishing pattern?'
    }
  };

  function normalizeAccounts(records) {
    const seen = new Set();
    const ids = new Set();
    return (Array.isArray(records) ? records : []).filter((record) => record && typeof record === 'object')
      .map((record, index) => {
        let id = typeof record.id === 'string' && /^[\w-]{1,80}$/.test(record.id) ? record.id : `clef-${index + 1}`;
        let suffix = 1;
        while (ids.has(id)) id = `clef-${index + 1}-${suffix++}`;
        ids.add(id);
        return {
          id,
          name: typeof record.name === 'string' ? record.name.trim().slice(0, 60) : '',
          accountId: typeof record.accountId === 'string' ? record.accountId.trim().toLowerCase() : '',
          apiToken: typeof record.apiToken === 'string' ? record.apiToken.trim() : ''
        };
      }).filter((record) => {
        const key = `${record.accountId}\n${record.apiToken}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function normalizeConfig(config = {}) {
    const values = Array.isArray(config.apiToken) ? config.apiToken : [config.apiToken];
    const legacyTokens = values.flatMap((value) => typeof value === 'string' ? value.split(/\r?\n/) : [])
      .map((value) => value.trim()).filter(Boolean);
    const accounts = normalizeAccounts(Object.hasOwn(config, 'accounts') ? config.accounts : legacyTokens.map((apiToken, index) => ({
      id: `clef-legacy-${index + 1}`, accountId: config.accountId, apiToken
    })));
    return {
      accounts,
      model: MODELS.includes(config.model) ? config.model : 'clef'
    };
  }

  function hasConfig(config) {
    const normalized = normalizeConfig(config);
    return normalized.accounts.length > 0 && normalized.accounts.every((record) =>
      /^[a-f0-9]{32}$/i.test(record.accountId) && record.apiToken && !/[\r\n]/.test(record.apiToken));
  }

  async function request(questions, state, config, options = {}) {
    const normalized = normalizeConfig(config);
    if (!hasConfig(normalized)) throw new Error('请填写有效的 Cloudflare Account ID 和 API Token');
    const send = options.request || fetch;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const accounts = [...normalized.accounts];
    // 轮换完整账号记录，URL 与 Authorization 必须来自同一条绑定。
    for (let index = accounts.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [accounts[index], accounts[randomIndex]] = [accounts[randomIndex], accounts[index]];
    }
    const multiple = accounts.length > 1;
    // 与 JEV 一样最多四次请求；单 Key 保留原有 429/5xx 退避重试。
    const requestedAttempts = Number.isInteger(options.maxAttempts) ? Math.max(1, Math.min(options.maxAttempts, 4)) : 4;
    const maxAttempts = multiple ? Math.min(accounts.length, requestedAttempts) : requestedAttempts;
    const attemptedAccounts = new Set();
    const failures = [];
    let lastError;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const account = accounts[multiple ? attempt : 0];
      const { id, name, accountId, apiToken } = account;
      const accountInfo = { id, name, accountId };
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/cloudflare/${normalized.model}`;
      attemptedAccounts.add(id);
      const failed = (message, status) => {
        lastError = new Error(message);
        const failure = { ...accountInfo, message, ...(status ? { status } : {}) };
        failures.push(failure);
        options.onAccountFailure?.(failure);
      };
      let response;
      let body;
      // 第一方直连：不经过 AI Gateway，不发送网关计费头。
      try {
        response = await send(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: normalized.model, state: String(state || '').slice(0, 12000), questions })
        });
      } catch {
        // 不转抛可能带有请求细节的异常，错误提示不包含任何密钥。
        failed('网络请求失败或超时');
        if (multiple && attempt + 1 < maxAttempts) continue;
        break;
      }
      // 错误响应可能是 HTML；仍按 HTTP 状态处理 401/429/5xx。
      body = await response.json().catch(() => null);
      if (!response.ok || body?.success !== true) {
        const code = body?.errors?.[0]?.code;
        failed(`HTTP ${response.status}${code ? `，错误码 ${code}` : ''}`, response.status);
        const transient = response.status === 429 || response.status >= 500;
        const keyFailure = response.status === 401 || response.status === 403 || response.status === 200;
        if (attempt + 1 < maxAttempts && (transient || (multiple && keyFailure))) {
          if (transient) await sleep(Math.min(500 * (2 ** attempt), 5000));
          continue;
        }
        // 400/422 等请求体错误与 Key 无关，不轮换重试。
        break;
      }
      if (!body.result?.answers || typeof body.result.answers !== 'object' || Array.isArray(body.result.answers)) {
        failed('Clef 响应缺少有效的 answers');
        if (multiple && attempt + 1 < maxAttempts) continue;
        break;
      }
      options.onAccountSuccess?.(accountInfo);
      return { ...body.result, account: accountInfo, accountFailures: failures };
    }
    const attemptsNote = attemptedAccounts.size > 1 ? `（已尝试 ${attemptedAccounts.size} 组账户与密钥）` : '';
    const details = Array.from(new Map(failures.map((failure) => [failure.id, failure])).values())
      .map((failure) => `${failure.name || failure.id} [${failure.accountId}]：${failure.message}`).join('；');
    const error = new Error(`Clef 请求失败：${details || lastError.message}${attemptsNote}`);
    error.accountFailures = failures;
    throw error;
  }

  function probability(answer, key) {
    const value = answer?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error('Clef 响应包含缺失或无效的概率');
    }
    return value;
  }

  async function adjudicate(links, codes, state, config, options = {}) {
    if (!links.length && !codes.length) return null;
    const questions = { ...QUESTIONS };
    links.forEach((record, index) => {
      questions[`link_${index}`] = {
        type: 'noul',
        instructions: {
          candidate: { url: record.url, anchorText: record.anchorText || '' },
          question: '这个候选是否是邮件中用于验证、确认、激活、登录或密码重置的操作链接？退订、账户设置、隐私政策、营销及信息页面不算。'
        },
        criteria: { true: '是验证类操作链接', false: '不是验证类操作链接' }
      };
    });
    if (codes.length) {
      const criteria = Object.create(null);
      codes.forEach((record) => { criteria[record.value] = `类型：${record.label || '候选'}`; });
      criteria.none = '候选中没有真正可用的验证码';
      questions.real_code = {
        type: 'choice',
        instructions: '候选中哪个是这封邮件真正可用的验证码？订单号、金额、促销码、日期、过期旧码都不算；没有就选 none。',
        criteria
      };
    }
    const result = await request(questions, state, config, options);
    try {
      return interpretResult(result, links, codes, questions);
    } catch (error) {
      const account = result.account;
      const failure = { ...account, message: error.message };
      options.onAccountFailure?.(failure);
      error.message = `Clef ${account.name || account.id} [${account.accountId}]：${error.message}`;
      error.accountFailures = [...result.accountFailures, failure];
      throw error;
    }
  }

  function interpretResult(result, links, codes, questions) {
    const answers = result.answers;
    const signals = {
      otp: probability(answers.otp, 'noul'),
      magic: probability(answers.magic, 'noul'),
      extort: probability(answers.extort, 'noul')
    };
    const metadata = { source: 'clef', judgeBackend: 'clef', judgeModel: result.model, judgeSignals: signals,
      judgeAccount: result.account, judgeAccountFailures: result.accountFailures };
    if (signals.extort >= 0.8) {
      return { ...metadata, codes: [], links: [], judgeVerdict: 'quarantine' };
    }
    let unknown = false;
    const keptLinks = [];
    links.forEach((record, index) => {
      const score = probability(answers[`link_${index}`], 'noul');
      if (score >= 0.6) keptLinks.push({ url: record.url, label: record.label || record.anchorText || record.url });
      else if (score > 0.35) unknown = true;
    });
    const keptCodes = [];
    if (codes.length) {
      const answer = answers.real_code;
      const confidence = probability(answer, 'confidence');
      if (answer?.type !== 'choice' || !Object.hasOwn(questions.real_code.criteria, answer.choice)) {
        throw new Error('Clef 返回了候选池之外的验证码');
      }
      probability(answer.probabilities, answer.choice);
      if (confidence < 0.5) unknown = true;
      else if (answer.choice !== 'none') keptCodes.push(answer.choice);
    }
    // 整封 otp/magic 仅作辅助信号，不能凭它们虚构候选或覆盖逐候选证据。
    return {
      ...metadata,
      codes: keptCodes,
      links: keptLinks,
      judgeVerdict: unknown ? 'unknown' : keptCodes.length || keptLinks.length ? 'verification' : 'not_verification'
    };
  }

  window.PopupClefInsight = { normalizeAccounts, normalizeConfig, hasConfig, request, adjudicate };
})();
