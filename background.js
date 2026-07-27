importScripts('shared-utils.js');

const { buildAddressString, isHttpUrl } = globalThis.FloatMailSharedUtils;
const VERIFY_ALARM_NAME = 'temp-email-verify';
const MAIL_ALARM_NAME = 'temp-email-mail-poll';
const CLEANUP_ALARM_NAME = 'temp-email-expired-cleanup';
const CLEANUP_ALARM_INTERVAL_MINUTES = 30;
const EXPIRED_CLEANUP_THROTTLE_MS = 5 * 60 * 1000;
const LAST_EXPIRED_CLEANUP_AT_KEY = 'lastExpiredCleanupAt';
const MIN_ALARM_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
const DISABLED_INTERVAL_SETTING = Object.freeze({ value: 0, unit: 'minutes' });
const DEFAULT_MAIL_POLL_INTERVAL = Object.freeze({ value: 5, unit: 'minutes' });
const REMOTE_REQUEST_TIMEOUT_MS = 10000;
const TEMP_DOMAIN_CACHE_TTL_MS = 10 * 60 * 1000;
const MOE_CONFIG_CACHE_TTL_MS = 10 * 60 * 1000;
const MOE_EMAIL_LIST_CACHE_TTL_MS = 60 * 1000;
const TEMP_DOMAIN_CACHE_STORAGE_KEY = 'remoteTempDomainCache';
const MOE_CONFIG_CACHE_STORAGE_KEY = 'remoteMoeConfigCache';
const MOE_EMAIL_LIST_CACHE_STORAGE_KEY = 'remoteMoeEmailListCache';
const MAIL_NOTIFICATION_TARGETS_KEY = 'mailNotificationTargets';
const INTERVAL_UNIT_FACTORS = Object.freeze({
  seconds: 1,
  minutes: 60,
  hours: 3600,
});

// 允许通过消息代理读写的 storage 键白名单。
// 收集范围：background.js、popup.js、content.js、popup-modules/config-io.js 里
// 所有 chrome.storage.local.get/set/remove 与 storageGet/storageSet/storageRemove 的键，
// 以及 config-io.js 的 CATEGORY_KEYS 导入导出清单。新增配置项时必须同步登记，否则会被拒绝。
const ALLOWED_STORAGE_KEYS = new Set([
  // Temp Email
  'apiUrl',
  'adminToken',
  'emailHistory',
  'verifyStatusCache',
  'verifyInterval',
  'tempUnreadCounts',
  'tempKnownMailIds',
  'tempMailMeta',
  'defaultTempExpiry',
  'defaultFfTempExpiry',
  // MoeMail
  'moeApiUrl',
  'moeApiKey',
  'moeEmailCache',
  'moeUnreadCounts',
  'moeKnownMailIds',
  'defaultMoeExpiry',
  'defaultFfMoeExpiry',
  // 后台轮询 / 通知
  'mailPollingInterval',
  'mailPollState',
  'notificationsEnabled',
  'activeInbox',
  'lastExpiredCleanupAt',
  'mailNotificationTargets',
  // 远端数据缓存
  'remoteTempDomainCache',
  'remoteMoeConfigCache',
  'remoteMoeEmailListCache',
  // 悬浮窗
  'floatWindowEnabled',
  'floatLayout',
  'floatWindowStyle',
  // 邮件展示 / AI
  'defaultRemoteImagesEnabled',
  'translationApiBase',
  'translationApiKey',
  'translationModel',
  'translationTargetLanguage',
  'mailInsightApiMode',
  'mailInsightApiBase',
  'mailInsightApiKey',
  'mailInsightModel',
  // 站点控制
  'siteAccessMode',
  'siteAllowlist',
  'siteBlocklist',
  // 填表规则
  'pageFillRules',
  'fastFillEmailSource',
  'fastFillDomainMode',
  'fastFillDomainSpecific',
  'fastFillDomainWhitelist',
  'fastFillDomainBlacklist',
  'fastFillHistory',
  'fastFillNameRegion',
  'fastFillNameGender',
  // 生成工具
  'generatedProfile',
  'generatedToolAutoCloseSeconds',
  'generatedToolHistory',
  // 界面偏好
  'defaultTab',
  'activeTab',
  'tabLayoutMode',
  'theme',
  'selectedStyle',
  'selectedTheme',
  // 书签
  'bookmarks',
  'bookmarkSort',
]);

// content.js 只在 chrome.storage.local 不可用时回退到消息代理，且仅发送这两类消息；
// 其余消息（proxy-fetch、storage-remove、ensure-page-tools 等）仅限扩展自身页面。
const CONTENT_SCRIPT_MESSAGE_TYPES = new Set(['storage-get', 'storage-set']);

// proxy-fetch 允许转发的方法与请求头；Host/Cookie/Origin/Referer 等敏感或可伪造头一律丢弃。
const PROXY_FETCH_ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
const PROXY_FETCH_ALLOWED_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-type',
  'x-api-key',
  'x-admin-auth',
]);
// proxy-fetch 目标主机白名单来源：用户已保存的后端地址。
const PROXY_FETCH_ORIGIN_SETTING_KEYS = [
  'apiUrl',
  'moeApiUrl',
  'translationApiBase',
  'mailInsightApiBase',
];

let verifyRunPromise = null;
let mailPollRunPromise = null;
let cleanupExpiredPromise = null;
let mailStateMutationPromise = Promise.resolve();
let notificationTargetsMutationPromise = Promise.resolve();
const remoteDataCache = new Map();
const remoteDataRequests = new Map();
let remoteDataCacheEpoch = 0;

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageSet(items) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function clearAlarm(name) {
  return new Promise((resolve, reject) => {
    chrome.alarms.clear(name, (wasCleared) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(wasCleared);
    });
  });
}

function tabsQuery(queryInfo) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryInfo, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs);
    });
  });
}

function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function tabsReload(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.reload(tabId, {}, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function tabsSendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function executeScript(tabId, files) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files }, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

function executeScriptFunction(tabId, func) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, func }, (results) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(results?.[0]?.result);
    });
  });
}

function createNotification(notificationId, options) {
  return new Promise((resolve, reject) => {
    chrome.notifications.create(notificationId, options, (createdId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(createdId);
    });
  });
}

function runMailStateMutation(worker) {
  const task = mailStateMutationPromise.then(worker, worker);
  mailStateMutationPromise = task.catch(() => {});
  return task;
}

function runNotificationTargetsMutation(worker) {
  const task = notificationTargetsMutationPromise.then(async () => {
    const stored = await storageGet([MAIL_NOTIFICATION_TARGETS_KEY]);
    const targets = { ...(stored[MAIL_NOTIFICATION_TARGETS_KEY] || {}) };
    const result = await worker(targets);
    await storageSet({ [MAIL_NOTIFICATION_TARGETS_KEY]: targets });
    return result;
  }, async () => {
    const stored = await storageGet([MAIL_NOTIFICATION_TARGETS_KEY]);
    const targets = { ...(stored[MAIL_NOTIFICATION_TARGETS_KEY] || {}) };
    const result = await worker(targets);
    await storageSet({ [MAIL_NOTIFICATION_TARGETS_KEY]: targets });
    return result;
  });
  notificationTargetsMutationPromise = task.catch(() => {});
  return task;
}

function parseIntSetting(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getIntervalUnitFactor(unit) {
  return INTERVAL_UNIT_FACTORS[unit] || INTERVAL_UNIT_FACTORS.minutes;
}

function resolveIntervalSeconds(rawValue, fallbackSetting = DISABLED_INTERVAL_SETTING) {
  if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
    const unit = Object.prototype.hasOwnProperty.call(INTERVAL_UNIT_FACTORS, rawValue.unit)
      ? rawValue.unit
      : fallbackSetting.unit;
    const parsedValue = parseIntSetting(rawValue.value, NaN);
    if (Number.isFinite(parsedValue)) {
      if (parsedValue <= 0) {
        return 0;
      }
      return Math.max(
        MIN_ALARM_INTERVAL_SECONDS,
        Math.min(MAX_INTERVAL_SECONDS, parsedValue * getIntervalUnitFactor(unit))
      );
    }
  }

  const legacyMinutes = parseIntSetting(rawValue, NaN);
  if (Number.isFinite(legacyMinutes)) {
    if (legacyMinutes <= 0) {
      return 0;
    }
    return Math.max(
      MIN_ALARM_INTERVAL_SECONDS,
      Math.min(MAX_INTERVAL_SECONDS, legacyMinutes * INTERVAL_UNIT_FACTORS.minutes)
    );
  }

  const fallbackValue = parseIntSetting(fallbackSetting?.value, 0);
  if (fallbackValue <= 0) {
    return 0;
  }
  return Math.max(
    MIN_ALARM_INTERVAL_SECONDS,
    Math.min(
      MAX_INTERVAL_SECONDS,
      fallbackValue * getIntervalUnitFactor(fallbackSetting?.unit)
    )
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesAddressRecord(record, address) {
  if (!record || !address) {
    return false;
  }
  const normalizedAddress = String(address).trim().toLowerCase();
  const variants = [
    buildAddressString(record),
    record.name,
    record.email,
  ]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase());

  return variants.includes(normalizedAddress);
}

function buildTempMailKey(mail) {
  if (mail?.id !== undefined && mail?.id !== null) {
    return String(mail.id);
  }
  return [
    mail?.created_at || '',
    mail?.source || '',
    mail?.subject || '',
  ].join('|');
}

function buildMoeMailKey(message) {
  if (message?.id !== undefined && message?.id !== null) {
    return String(message.id);
  }
  return [
    message?.received_at || '',
    message?.from_address || '',
    message?.subject || '',
  ].join('|');
}

async function runWithConcurrency(items, concurrency, worker) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), queue.length) },
    async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        try {
          await worker(item);
        } catch (error) {
          // 单个任务失败不应让 Promise.all 提前 reject，其余 worker 仍在消费队列；
          // 业务异常由各自的 worker 内部处理，这里只兜底记录。
          console.warn('并发任务执行失败:', error?.message || error);
        }
      }
    }
  );
  await Promise.all(workers);
}

function getPollBackoffMultiplier(idleRounds, failureCount) {
  if (failureCount > 0) {
    return Math.min(12, 2 ** Math.min(failureCount, 4));
  }
  if (idleRounds >= 6) return 12;
  if (idleRounds >= 4) return 6;
  if (idleRounds >= 2) return 2;
  return 1;
}

function updateAddressPollState(state, key, options) {
  const previous = state[key] || {};
  const idleRounds = options.hasNewMail ? 0 : (Number(previous.idleRounds) || 0) + 1;
  const failureCount = options.failed ? (Number(previous.failureCount) || 0) + 1 : 0;
  const multiplier = options.isActive
    ? 1
    : getPollBackoffMultiplier(idleRounds, failureCount);
  const delayMs = Math.min(
    60 * 60 * 1000,
    Math.max(30 * 1000, options.baseIntervalMs * multiplier)
  );
  state[key] = {
    idleRounds,
    failureCount,
    lastPollAt: options.now,
    nextPollAt: options.now + delayMs,
  };
}

async function fetchJson(url, init = {}, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS) {
  // 把 body 读取放进 consume 回调，让超时定时器覆盖到 JSON 解析完成为止。
  return fetchWithTimeoutInternal(url, init, timeoutMs, async (response) => {
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return response.json();
  });
}

function fetchWithTimeout(url, init = {}, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS) {
  return fetchWithTimeoutInternal(url, init, timeoutMs, null);
}

// consume 为空时返回 Response 本身（调用方自行读取 body，不受超时保护）；
// 传入 consume 时，超时会一直生效到 consume 返回，body 读取同样受控。
async function fetchWithTimeoutInternal(url, init = {}, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS, consume = null) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  let abortSource = '';
  const abortFromExternal = () => {
    if (!abortSource) abortSource = 'external';
    controller.abort(externalSignal?.reason);
  };
  if (externalSignal?.aborted) {
    abortFromExternal();
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  const timer = setTimeout(() => {
    if (!abortSource) abortSource = 'timeout';
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return consume ? await consume(response) : response;
  } catch (error) {
    if (abortSource === 'timeout' && error?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

function clearRemoteDataCache(prefix = '') {
  remoteDataCacheEpoch += 1;
  for (const key of remoteDataCache.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      remoteDataCache.delete(key);
    }
  }
  for (const key of remoteDataRequests.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      remoteDataRequests.delete(key);
    }
  }
}

function hashCacheIdentity(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function fetchCachedJson(
  cacheKey,
  url,
  init,
  ttlMs,
  forceRefresh = false,
  storageKey = ''
) {
  const now = Date.now();
  const lookupEpoch = remoteDataCacheEpoch;
  const cached = remoteDataCache.get(cacheKey);
  if (!forceRefresh && cached && now - cached.fetchedAt < ttlMs) {
    return cached.data;
  }

  if (!forceRefresh && storageKey) {
    const stored = await storageGet([storageKey]);
    const entry = stored[storageKey];
    if (
      remoteDataCacheEpoch === lookupEpoch
      && entry?.cacheKey === cacheKey
      && now - Number(entry.fetchedAt) < ttlMs
    ) {
      remoteDataCache.set(cacheKey, entry);
      return entry.data;
    }
  }

  const pendingRequest = remoteDataRequests.get(cacheKey);
  // 强制刷新不复用在途的非强制请求，否则会搭车拿到刷新前的旧数据。
  if (pendingRequest && (!forceRefresh || pendingRequest.forceRefresh)) {
    return pendingRequest.promise;
  }

  const requestEpoch = remoteDataCacheEpoch;
  const pending = { forceRefresh, promise: null };
  pending.promise = fetchJson(url, init)
    .then(async (data) => {
      if (remoteDataCacheEpoch !== requestEpoch) {
        return data;
      }
      const entry = { cacheKey, data, fetchedAt: Date.now() };
      remoteDataCache.set(cacheKey, entry);
      if (storageKey) {
        await storageSet({ [storageKey]: entry });
        // storageSet 期间配置可能被切换：此时 epoch 已变，说明这份数据属于旧配置，
        // 必须回滚，否则会复活 clearRemoteDataCache/storageRemove 刚删掉的缓存。
        if (remoteDataCacheEpoch !== requestEpoch) {
          if (remoteDataCache.get(cacheKey) === entry) {
            remoteDataCache.delete(cacheKey);
          }
          try {
            const stored = await storageGet([storageKey]);
            const current = stored[storageKey];
            // 只回滚自己写进去的那条，避免误删更新配置写入的新缓存。
            if (current?.cacheKey === entry.cacheKey && current?.fetchedAt === entry.fetchedAt) {
              await storageRemove([storageKey]);
            }
          } catch (error) {
            console.warn('回滚过期远端缓存失败:', error.message);
          }
        }
      }
      return data;
    })
    .finally(() => {
      if (remoteDataRequests.get(cacheKey) === pending) {
        remoteDataRequests.delete(cacheKey);
      }
    });
  remoteDataRequests.set(cacheKey, pending);
  return pending.promise;
}

async function getTempDomains(forceRefresh = false) {
  const { apiUrl = '' } = await storageGet(['apiUrl']);
  const baseUrl = String(apiUrl).trim().replace(/\/$/, '');
  if (!baseUrl) {
    return { domains: [] };
  }
  return fetchCachedJson(
    `temp-domains:${baseUrl}`,
    `${baseUrl}/open_api/settings`,
    {},
    TEMP_DOMAIN_CACHE_TTL_MS,
    forceRefresh,
    TEMP_DOMAIN_CACHE_STORAGE_KEY
  );
}

async function getMoeConfig(forceRefresh = false) {
  const { moeApiUrl = '', moeApiKey = '' } = await storageGet(['moeApiUrl', 'moeApiKey']);
  const baseUrl = String(moeApiUrl).trim().replace(/\/$/, '');
  const apiKey = String(moeApiKey).trim();
  if (!baseUrl || !apiKey) {
    return { emailDomains: '' };
  }
  return fetchCachedJson(
    `moe-config:${baseUrl}:${hashCacheIdentity(apiKey)}`,
    `${baseUrl}/api/config`,
    { headers: { 'X-API-Key': apiKey } },
    MOE_CONFIG_CACHE_TTL_MS,
    forceRefresh,
    MOE_CONFIG_CACHE_STORAGE_KEY
  );
}

async function getMoeEmailList(forceRefresh = false) {
  const { moeApiUrl = '', moeApiKey = '' } = await storageGet(['moeApiUrl', 'moeApiKey']);
  const baseUrl = String(moeApiUrl).trim().replace(/\/$/, '');
  const apiKey = String(moeApiKey).trim();
  if (!baseUrl || !apiKey) {
    return { emails: [] };
  }
  return fetchCachedJson(
    `moe-emails:${baseUrl}:${hashCacheIdentity(apiKey)}`,
    `${baseUrl}/api/emails`,
    { headers: { 'X-API-Key': apiKey } },
    MOE_EMAIL_LIST_CACHE_TTL_MS,
    forceRefresh,
    MOE_EMAIL_LIST_CACHE_STORAGE_KEY
  );
}

async function cleanupExpiredTempAddresses(force = false) {
  const now = Date.now();
  const cleanupState = await storageGet([LAST_EXPIRED_CLEANUP_AT_KEY]);
  const lastCleanupAt = Number(cleanupState[LAST_EXPIRED_CLEANUP_AT_KEY]) || 0;
  if (!force && now - lastCleanupAt < EXPIRED_CLEANUP_THROTTLE_MS) {
    return { removed: 0 };
  }

  const settings = await storageGet([
    'apiUrl',
    'adminToken',
    'emailHistory',
    'tempUnreadCounts',
    'tempKnownMailIds',
    'tempMailMeta',
    'mailPollState',
  ]);
  const apiUrl = String(settings.apiUrl || '').trim().replace(/\/$/, '');
  const adminToken = String(settings.adminToken || '').trim();
  const history = Array.isArray(settings.emailHistory) ? settings.emailHistory : [];
  const tempMailMeta = { ...(settings.tempMailMeta || {}) };
  const expiredAddresses = history.filter((address) => {
    const meta = tempMailMeta[address];
    return meta && Number(meta.expiryMs) > 0
      && now >= Number(meta.createdAt) + Number(meta.expiryMs);
  });

  if (expiredAddresses.length === 0) {
    // 无过期邮箱本身就是一次成功的清理，可以正常推进节流时间戳。
    await storageSet({ [LAST_EXPIRED_CLEANUP_AT_KEY]: now });
    return { removed: 0 };
  }

  const deletableAddresses = new Set();
  if (apiUrl && adminToken) {
    await runWithConcurrency(expiredAddresses, 3, async (address) => {
      try {
        const data = await fetchJson(
          `${apiUrl}/admin/address?query=${encodeURIComponent(address)}&limit=10&offset=0`,
          { headers: { 'x-admin-auth': adminToken } }
        );
        const match = (data.results || []).find((record) => matchesAddressRecord(record, address));
        if (match?.id !== undefined && match?.id !== null) {
          const response = await fetchWithTimeout(`${apiUrl}/admin/delete_address/${match.id}`, {
            method: 'DELETE',
            headers: { 'x-admin-auth': adminToken },
          });
          if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
          }
        }
        deletableAddresses.add(address);
      } catch (error) {
        console.warn('过期邮箱服务端删除失败:', error.message);
      }
    });
  } else {
    // 未配置服务端地址或管理员令牌时无法调用删除接口，
    // 但本地的过期 history / meta / 未读状态仍然必须清理，否则会永远残留。
    expiredAddresses.forEach((address) => deletableAddresses.add(address));
  }

  // 服务端删除期间，其他 popup 可能新增邮箱或更新状态；提交前重新读取并合并，
  // 避免用清理开始时的旧快照覆盖较新的数据。
  const cleanupResult = await runMailStateMutation(async () => {
    const latest = await storageGet([
      'apiUrl',
      'adminToken',
      'emailHistory',
      'verifyStatusCache',
      'tempUnreadCounts',
      'tempKnownMailIds',
      'tempMailMeta',
      'mailPollState',
    ]);
    const latestApiUrl = String(latest.apiUrl || '').trim().replace(/\/$/, '');
    const latestAdminToken = String(latest.adminToken || '').trim();
    if (latestApiUrl !== apiUrl || latestAdminToken !== adminToken) {
      return { removed: 0, pending: expiredAddresses.length };
    }

    const latestHistory = Array.isArray(latest.emailHistory) ? latest.emailHistory : [];
    const latestTempMailMeta = { ...(latest.tempMailMeta || {}) };
    const confirmedExpired = expiredAddresses.filter((address) => {
      if (!deletableAddresses.has(address)) {
        return false;
      }
      const before = tempMailMeta[address];
      const current = latestTempMailMeta[address];
      return current
        && Number(current.createdAt) === Number(before?.createdAt)
        && Number(current.expiryMs) === Number(before?.expiryMs)
        && Number(current.expiryMs) > 0
        && now >= Number(current.createdAt) + Number(current.expiryMs);
    });
    const expiredSet = new Set(confirmedExpired);
    const verifyStatusCache = { ...(latest.verifyStatusCache || {}) };
    const tempUnreadCounts = { ...(latest.tempUnreadCounts || {}) };
    const tempKnownMailIds = { ...(latest.tempKnownMailIds || {}) };
    const mailPollState = { ...(latest.mailPollState || {}) };
    for (const address of confirmedExpired) {
      delete verifyStatusCache[address];
      delete tempUnreadCounts[address];
      delete tempKnownMailIds[address];
      delete latestTempMailMeta[address];
      delete mailPollState[`temp:${address}`];
    }
    await storageSet({
      emailHistory: latestHistory.filter((address) => !expiredSet.has(address)),
      verifyStatusCache,
      tempUnreadCounts,
      tempKnownMailIds,
      tempMailMeta: latestTempMailMeta,
      mailPollState,
    });
    return {
      removed: confirmedExpired.length,
      pending: expiredAddresses.length - confirmedExpired.length,
    };
  });
  // 删除工作成功后再推进节流时间戳；中途抛错时保持原值，下次调用可立即重试。
  await storageSet({ [LAST_EXPIRED_CLEANUP_AT_KEY]: now });
  return cleanupResult;
}

function runCleanupExpiredTempAddresses(force = false) {
  if (cleanupExpiredPromise) {
    return cleanupExpiredPromise;
  }
  cleanupExpiredPromise = cleanupExpiredTempAddresses(force)
    .finally(() => {
      cleanupExpiredPromise = null;
    });
  return cleanupExpiredPromise;
}

// 判断主机名是否指向本机 / 私有网段 / 链路本地，避免代理被当作内网探测跳板（SSRF）。
function isPrivateNetworkHost(rawHostname) {
  const hostname = String(rawHostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return true;
  }
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return true;
  }
  // IPv6：::1（本机）、::（未指定）、fc00::/7（唯一本地）、fe80::/10（链路本地）
  if (hostname.includes(':')) {
    if (hostname === '::1' || hostname === '::') {
      return true;
    }
    if (/^f[cd][0-9a-f]{2}:/.test(hostname)) {
      return true;
    }
    if (/^fe[89ab][0-9a-f]:/.test(hostname)) {
      return true;
    }
    // IPv4-mapped IPv6，如 ::ffff:127.0.0.1
    const mapped = hostname.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    return mapped ? isPrivateNetworkHost(mapped[1]) : false;
  }
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) {
    return false;
  }
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part > 255)) {
    // 非法 IPv4 字面量按不可信处理。
    return true;
  }
  const [a, b] = parts;
  if (a === 0 || a === 127 || a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

// 动态白名单：只允许访问用户已保存的后端地址所在的 origin。
async function getProxyFetchAllowedOrigins() {
  const settings = await storageGet(PROXY_FETCH_ORIGIN_SETTING_KEYS);
  const origins = new Set();
  for (const key of PROXY_FETCH_ORIGIN_SETTING_KEYS) {
    const raw = String(settings[key] || '').trim();
    if (!raw) {
      continue;
    }
    try {
      const parsed = new URL(raw);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:')
        && !isPrivateNetworkHost(parsed.hostname)) {
        origins.add(parsed.origin);
      }
    } catch {
      // 配置里可能存着非法地址，忽略即可。
    }
  }
  return origins;
}

// 只透传必要请求头，丢弃 Host/Cookie/Origin/Referer 等敏感或可伪造头。
function sanitizeProxyFetchHeaders(rawHeaders) {
  const headers = {};
  if (!rawHeaders || typeof rawHeaders !== 'object') {
    return headers;
  }
  const entries = typeof rawHeaders.entries === 'function'
    ? Array.from(rawHeaders.entries())
    : Object.entries(rawHeaders);
  for (const [name, value] of entries) {
    const normalized = String(name || '').trim().toLowerCase();
    if (!PROXY_FETCH_ALLOWED_HEADERS.has(normalized)) {
      continue;
    }
    if (value === undefined || value === null) {
      continue;
    }
    headers[normalized] = String(value);
  }
  return headers;
}

async function proxyFetch(url, init = {}) {
  const parsedUrl = new URL(String(url || ''));
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('仅支持 HTTP/HTTPS 请求');
  }
  if (isPrivateNetworkHost(parsedUrl.hostname)) {
    throw new Error('禁止访问本机或内网地址');
  }

  const allowedOrigins = await getProxyFetchAllowedOrigins();
  if (allowedOrigins.size === 0) {
    // 白名单为空时一律拒绝，不能退化为放行。
    throw new Error('尚未配置任何后端地址，已拒绝转发请求');
  }
  if (!allowedOrigins.has(parsedUrl.origin)) {
    throw new Error('目标地址不在已配置的后端白名单内，请先保存 API 地址后重试');
  }

  const method = String(init.method || 'GET').trim().toUpperCase();
  if (!PROXY_FETCH_ALLOWED_METHODS.has(method)) {
    throw new Error(`不支持的请求方法: ${method}`);
  }

  const requestInit = {
    method,
    headers: sanitizeProxyFetchHeaders(init.headers),
  };
  if (method !== 'GET' && method !== 'HEAD' && init.body !== undefined && init.body !== null) {
    requestInit.body = init.body;
  }

  return fetchWithTimeoutInternal(
    parsedUrl.href,
    requestInit,
    REMOTE_REQUEST_TIMEOUT_MS,
    async (response) => {
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        text,
        data,
      };
    }
  );
}

async function verifyAddress(apiUrl, adminToken, address) {
  const maxRetry = 3;
  const timeoutMs = 8000;

  for (let attempt = 1; attempt <= maxRetry; attempt += 1) {
    try {
      const data = await fetchJson(
        `${apiUrl}/admin/address?query=${encodeURIComponent(address)}&limit=10&offset=0`,
        { headers: { 'x-admin-auth': adminToken } },
        timeoutMs
      );

      const matched = (data.results || []).find((record) => matchesAddressRecord(record, address));
      return matched ? 'valid' : 'invalid';
    } catch (error) {
      if (attempt === maxRetry) {
        return 'error';
      }
      await sleep(1000 * attempt);
    }
  }

  return 'error';
}

async function verifyAddressesNow() {
  const settings = await storageGet([
    'apiUrl',
    'adminToken',
    'emailHistory',
  ]);

  const apiUrl = (settings.apiUrl || '').trim().replace(/\/$/, '');
  const adminToken = (settings.adminToken || '').trim();
  const history = Array.isArray(settings.emailHistory) ? settings.emailHistory : [];

  const verificationResults = {};
  if (apiUrl && adminToken && history.length > 0) {
    await runWithConcurrency(history, 3, async (address) => {
      verificationResults[address] = await verifyAddress(apiUrl, adminToken, address);
    });
  }

  // 验证期间配置、邮箱列表和状态都可能被 popup 修改；只把本次结果合并到最新状态。
  const latest = await storageGet(['apiUrl', 'adminToken', 'emailHistory', 'verifyStatusCache']);
  const latestApiUrl = String(latest.apiUrl || '').trim().replace(/\/$/, '');
  const latestAdminToken = String(latest.adminToken || '').trim();
  if (!latestApiUrl || !latestAdminToken) {
    await storageSet({ verifyStatusCache: {} });
    return;
  }
  if (latestApiUrl !== apiUrl || latestAdminToken !== adminToken) {
    return;
  }

  const latestHistory = Array.isArray(latest.emailHistory) ? latest.emailHistory : [];
  const activeAddresses = new Set(latestHistory);
  const verifyStatusCache = { ...(latest.verifyStatusCache || {}) };
  Object.keys(verifyStatusCache).forEach((address) => {
    if (!activeAddresses.has(address)) {
      delete verifyStatusCache[address];
    }
  });
  for (const [address, status] of Object.entries(verificationResults)) {
    if (activeAddresses.has(address)) {
      verifyStatusCache[address] = status;
    }
  }
  await storageSet({ verifyStatusCache });
}

function runVerifyAddressesNow() {
  if (verifyRunPromise) {
    return verifyRunPromise;
  }

  verifyRunPromise = verifyAddressesNow()
    .finally(() => {
      verifyRunPromise = null;
    });

  return verifyRunPromise;
}

async function updateBadgeFromStorage() {
  const { tempUnreadCounts = {}, moeUnreadCounts = {} } = await storageGet([
    'tempUnreadCounts',
    'moeUnreadCounts',
  ]);

  const total = Object.values(tempUnreadCounts).reduce((sum, count) => sum + (Number(count) || 0), 0)
    + Object.values(moeUnreadCounts).reduce((sum, count) => sum + (Number(count) || 0), 0);

  // MV3 下这两个 API 返回 Promise，未处理会产生 unhandled rejection。
  await Promise.all([
    chrome.action.setBadgeBackgroundColor({ color: '#d93025' })
      .catch((error) => console.warn('设置角标背景色失败:', error.message)),
    chrome.action.setBadgeText({ text: total > 0 ? String(Math.min(total, 99)) : '' })
      .catch((error) => console.warn('设置角标文本失败:', error.message)),
  ]);
}

async function pollMailNow() {
  const settings = await storageGet([
    'apiUrl',
    'adminToken',
    'emailHistory',
    'moeApiUrl',
    'moeApiKey',
    'moeEmailCache',
    'tempKnownMailIds',
    'moeKnownMailIds',
    'tempUnreadCounts',
    'moeUnreadCounts',
    'notificationsEnabled',
    'mailPollingInterval',
    'mailPollState',
    'activeInbox',
  ]);

  const apiUrl = (settings.apiUrl || '').trim().replace(/\/$/, '');
  const adminToken = (settings.adminToken || '').trim();
  const history = Array.isArray(settings.emailHistory) ? settings.emailHistory : [];
  const moeApiUrl = (settings.moeApiUrl || '').trim().replace(/\/$/, '');
  const moeApiKey = (settings.moeApiKey || '').trim();
  const moeEmailCache = Array.isArray(settings.moeEmailCache) ? settings.moeEmailCache : [];
  const notificationsEnabled = settings.notificationsEnabled !== false;
  const basePollIntervalMs = resolveIntervalSeconds(
    settings.mailPollingInterval,
    DEFAULT_MAIL_POLL_INTERVAL
  ) * 1000;
  const activeInbox = settings.activeInbox || null;

  const tempKnownMailIds = { ...(settings.tempKnownMailIds || {}) };
  const moeKnownMailIds = { ...(settings.moeKnownMailIds || {}) };
  const tempUnreadCounts = { ...(settings.tempUnreadCounts || {}) };
  const moeUnreadCounts = { ...(settings.moeUnreadCounts || {}) };
  const mailPollState = { ...(settings.mailPollState || {}) };
  const initialTempUnreadCounts = { ...tempUnreadCounts };
  const initialMoeUnreadCounts = { ...moeUnreadCounts };
  const updatedTempAddresses = new Set();
  const updatedMoeIds = new Set();
  const updatedPollStateKeys = new Set();
  const notifications = [];

  const activeTempAddresses = new Set(history);
  Object.keys(tempKnownMailIds).forEach((address) => {
    if (!activeTempAddresses.has(address)) {
      delete tempKnownMailIds[address];
      delete tempUnreadCounts[address];
      delete mailPollState[`temp:${address}`];
    }
  });

  const now = Date.now();

  const activeMoeIds = new Set(moeEmailCache.map((email) => String(email.id)));
  Object.keys(moeKnownMailIds).forEach((emailId) => {
    if (!activeMoeIds.has(String(emailId))) {
      delete moeKnownMailIds[emailId];
      delete moeUnreadCounts[emailId];
      delete mailPollState[`moe:${emailId}`];
    }
  });

  if (apiUrl && adminToken) {
    await runWithConcurrency(history, 3, async (address) => {
      const stateKey = `temp:${address}`;
      const isActive = activeInbox?.type === 'temp' && activeInbox.address === address;
      if (!isActive && Number(mailPollState[stateKey]?.nextPollAt) > now) {
        return;
      }
      try {
        const data = await fetchJson(
          `${apiUrl}/admin/mails?address=${encodeURIComponent(address)}&limit=20&offset=0&summary_only=true`,
          { headers: { 'x-admin-auth': adminToken } }
        );
        const messages = Array.isArray(data.results) ? data.results : [];
        const ids = messages.map(buildTempMailKey);
        const previousIds = Array.isArray(tempKnownMailIds[address]) ? tempKnownMailIds[address] : null;
        let newMessages = [];

        if (previousIds) {
          const previousSet = new Set(previousIds);
          newMessages = messages.filter((message) => !previousSet.has(buildTempMailKey(message)));
          if (newMessages.length > 0) {
            tempUnreadCounts[address] = (tempUnreadCounts[address] || 0) + newMessages.length;
            notifications.push({
              source: address,
              count: newMessages.length,
              subject: newMessages[0]?.subject || '(无主题)',
              inbox: { type: 'temp', address },
            });
          }
        } else {
          tempUnreadCounts[address] = tempUnreadCounts[address] || 0;
        }

        tempKnownMailIds[address] = ids.slice(0, 50);
        updatedTempAddresses.add(address);
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: newMessages.length > 0,
          failed: false,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
        updatedPollStateKeys.add(stateKey);
      } catch (error) {
        console.warn('Temp Email 轮询失败:', error.message);
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: false,
          failed: true,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
        updatedPollStateKeys.add(stateKey);
      }
    });
  }

  if (moeApiUrl && moeApiKey) {
    await runWithConcurrency(moeEmailCache, 3, async (email) => {
      const emailId = String(email.id);
      const stateKey = `moe:${emailId}`;
      const isActive = activeInbox?.type === 'moe'
        && String(activeInbox.emailId) === emailId;
      if (!isActive && Number(mailPollState[stateKey]?.nextPollAt) > now) {
        return;
      }
      try {
        const data = await fetchJson(`${moeApiUrl}/api/emails/${emailId}`, {
          headers: { 'X-API-Key': moeApiKey },
        });
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const ids = messages.map(buildMoeMailKey);
        const previousIds = Array.isArray(moeKnownMailIds[emailId]) ? moeKnownMailIds[emailId] : null;
        let newMessages = [];

        if (previousIds) {
          const previousSet = new Set(previousIds);
          newMessages = messages.filter((message) => !previousSet.has(buildMoeMailKey(message)));
          if (newMessages.length > 0) {
            moeUnreadCounts[emailId] = (moeUnreadCounts[emailId] || 0) + newMessages.length;
            notifications.push({
              source: email.address || `MoeMail #${emailId}`,
              count: newMessages.length,
              subject: newMessages[0]?.subject || '(无主题)',
              inbox: { type: 'moe', emailId, address: email.address || '' },
            });
          }
        } else {
          moeUnreadCounts[emailId] = moeUnreadCounts[emailId] || 0;
        }

        moeKnownMailIds[emailId] = ids.slice(0, 50);
        updatedMoeIds.add(emailId);
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: newMessages.length > 0,
          failed: false,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
        updatedPollStateKeys.add(stateKey);
      } catch (error) {
        console.warn('MoeMail 轮询失败:', error.message);
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: false,
          failed: true,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
        updatedPollStateKeys.add(stateKey);
      }
    });
  }

  // 轮询网络请求期间 popup 可能清零未读、删除邮箱或切换服务配置。
  // 提交前基于最新值按地址合并，避免旧快照整对象覆盖用户操作。
  const mergeResult = await runMailStateMutation(async () => {
    const latest = await storageGet([
      'apiUrl',
      'adminToken',
      'emailHistory',
      'moeApiUrl',
      'moeApiKey',
      'moeEmailCache',
      'tempKnownMailIds',
      'moeKnownMailIds',
      'tempUnreadCounts',
      'moeUnreadCounts',
      'mailPollState',
      'notificationsEnabled',
    ]);
    const latestHistory = Array.isArray(latest.emailHistory) ? latest.emailHistory : [];
    const latestMoeEmailCache = Array.isArray(latest.moeEmailCache) ? latest.moeEmailCache : [];
    const latestTempAddresses = new Set(latestHistory);
    const latestMoeIds = new Set(latestMoeEmailCache.map((email) => String(email.id)));
    const mergedTempKnownMailIds = { ...(latest.tempKnownMailIds || {}) };
    const mergedMoeKnownMailIds = { ...(latest.moeKnownMailIds || {}) };
    const mergedTempUnreadCounts = { ...(latest.tempUnreadCounts || {}) };
    const mergedMoeUnreadCounts = { ...(latest.moeUnreadCounts || {}) };
    const mergedMailPollState = { ...(latest.mailPollState || {}) };
    const tempConfigUnchanged = String(latest.apiUrl || '').trim().replace(/\/$/, '') === apiUrl
      && String(latest.adminToken || '').trim() === adminToken;
    const moeConfigUnchanged = String(latest.moeApiUrl || '').trim().replace(/\/$/, '') === moeApiUrl
      && String(latest.moeApiKey || '').trim() === moeApiKey;

    Object.keys(mergedTempKnownMailIds).forEach((address) => {
      if (!latestTempAddresses.has(address)) delete mergedTempKnownMailIds[address];
    });
    Object.keys(mergedTempUnreadCounts).forEach((address) => {
      if (!latestTempAddresses.has(address)) delete mergedTempUnreadCounts[address];
    });
    Object.keys(mergedMoeKnownMailIds).forEach((emailId) => {
      if (!latestMoeIds.has(String(emailId))) delete mergedMoeKnownMailIds[emailId];
    });
    Object.keys(mergedMoeUnreadCounts).forEach((emailId) => {
      if (!latestMoeIds.has(String(emailId))) delete mergedMoeUnreadCounts[emailId];
    });
    Object.keys(mergedMailPollState).forEach((stateKey) => {
      if (stateKey.startsWith('temp:') && !latestTempAddresses.has(stateKey.slice(5))) {
        delete mergedMailPollState[stateKey];
      } else if (stateKey.startsWith('moe:') && !latestMoeIds.has(stateKey.slice(4))) {
        delete mergedMailPollState[stateKey];
      }
    });

    // 未读计数改为增量式合并：把本轮真正新发现的邮件数（delta）加到最新计数上，
    // 而不是用本轮快照整值覆盖。整值覆盖时，一旦 latestCount 被其他写入改动过就会
    // 整段跳过落账，而 known 集合仍被推进，新邮件从此不会再被检测到 → 角标永久少计。
    // known 集合与 delta 现在始终同时落账，保证「要么都生效要么都不生效」。
    if (tempConfigUnchanged) {
      for (const address of updatedTempAddresses) {
        if (!latestTempAddresses.has(address)) continue;
        const initialCount = Number(initialTempUnreadCounts[address]) || 0;
        const polledCount = Number(tempUnreadCounts[address]) || 0;
        const delta = Math.max(0, polledCount - initialCount);
        const latestCount = Number(mergedTempUnreadCounts[address]) || 0;
        mergedTempKnownMailIds[address] = tempKnownMailIds[address];
        mergedTempUnreadCounts[address] = latestCount + delta;
      }
    }
    if (moeConfigUnchanged) {
      for (const emailId of updatedMoeIds) {
        if (!latestMoeIds.has(emailId)) continue;
        const initialCount = Number(initialMoeUnreadCounts[emailId]) || 0;
        const polledCount = Number(moeUnreadCounts[emailId]) || 0;
        const delta = Math.max(0, polledCount - initialCount);
        const latestCount = Number(mergedMoeUnreadCounts[emailId]) || 0;
        mergedMoeKnownMailIds[emailId] = moeKnownMailIds[emailId];
        mergedMoeUnreadCounts[emailId] = latestCount + delta;
      }
    }
    for (const stateKey of updatedPollStateKeys) {
      const isTemp = stateKey.startsWith('temp:');
      const id = stateKey.slice(stateKey.indexOf(':') + 1);
      if ((isTemp && tempConfigUnchanged && latestTempAddresses.has(id))
        || (!isTemp && moeConfigUnchanged && latestMoeIds.has(id))) {
        mergedMailPollState[stateKey] = mailPollState[stateKey];
      }
    }

    await storageSet({
      tempKnownMailIds: mergedTempKnownMailIds,
      moeKnownMailIds: mergedMoeKnownMailIds,
      tempUnreadCounts: mergedTempUnreadCounts,
      moeUnreadCounts: mergedMoeUnreadCounts,
      mailPollState: mergedMailPollState,
    });
    return {
      latestTempAddresses,
      latestMoeIds,
      tempConfigUnchanged,
      moeConfigUnchanged,
      latestNotificationsEnabled: latest.notificationsEnabled !== false,
    };
  });
  const {
    latestTempAddresses,
    latestMoeIds,
    tempConfigUnchanged,
    moeConfigUnchanged,
    latestNotificationsEnabled,
  } = mergeResult;

  const activeNotifications = notifications.filter((notification) => {
    if (notification.inbox?.type === 'temp') {
      return tempConfigUnchanged && latestTempAddresses.has(notification.inbox.address);
    }
    return moeConfigUnchanged && latestMoeIds.has(String(notification.inbox?.emailId));
  });
  if (!notificationsEnabled || !latestNotificationsEnabled) {
    return;
  }
  if (activeNotifications.length === 0) {
    return;
  }

  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  await runNotificationTargetsMutation((targets) => {
    Object.keys(targets).forEach((id) => {
      if (Number(targets[id]?.createdAt) < recentCutoff) delete targets[id];
    });
  });

  for (const notification of activeNotifications.slice(0, 5)) {
    const notificationId = `mail-${Date.now()}-${Math.random()}`;
    await runNotificationTargetsMutation((targets) => {
      targets[notificationId] = {
        inbox: notification.inbox,
        createdAt: Date.now(),
      };
    });
    try {
      await createNotification(notificationId, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: `收到 ${notification.count} 封新邮件`,
        message: `${notification.source}\n最新主题: ${notification.subject}`,
      });
    } catch (error) {
      await runNotificationTargetsMutation((targets) => {
        delete targets[notificationId];
      });
      console.warn('创建新邮件通知失败:', error.message);
    }
  }
}

function runPollMailNow() {
  if (mailPollRunPromise) {
    return mailPollRunPromise;
  }

  mailPollRunPromise = pollMailNow()
    .finally(() => {
      mailPollRunPromise = null;
    });

  return mailPollRunPromise;
}

const PAGE_TOOLS_VERSION = '2026.07.27-shadow-v3';
const pageToolsReconcileRuns = new Map();

async function getPageToolsStatus(tabId) {
  try {
    const response = await tabsSendMessage(tabId, { type: 'page-tools-ping' });
    return response?.ok ? response : null;
  } catch {
    return null;
  }
}

async function getPageToolsDomState(tabId) {
  try {
    return await executeScriptFunction(tabId, () => {
      const hostMarker = Symbol.for('floatmail.page-tools.host');
      return {
        legacyButtons: document.querySelectorAll('#temp-email-float-btn').length,
        legacyPanels: document.querySelectorAll('#temp-email-float-panel').length,
        shadowHosts: Array.from(document.body?.children || [])
          .filter((node) => Boolean(node[hostMarker])).length,
      };
    });
  } catch {
    return { legacyButtons: 0, legacyPanels: 0, shadowHosts: 0 };
  }
}

async function waitForCurrentPageTools(tabId, attempts = 40, intervalMs = 250) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const status = await getPageToolsStatus(tabId);
    if (status?.version === PAGE_TOOLS_VERSION) {
      return true;
    }
    if (attempt < attempts - 1) {
      await sleep(intervalMs);
    }
  }
  return false;
}

async function reloadTabForPageToolsMigration(tabId) {
  await tabsReload(tabId);
  if (!await waitForCurrentPageTools(tabId)) {
    throw new Error('页面刷新后页面助手未能及时加载');
  }
  return true;
}

async function reconcilePageToolsInTabInternal(tabId, url) {
  if (!isHttpUrl(url)) {
    return false;
  }

  const status = await getPageToolsStatus(tabId);
  const domState = await getPageToolsDomState(tabId);
  const hasLegacyDom = domState.legacyButtons > 0 || domState.legacyPanels > 0;
  const hasDuplicateDom = domState.legacyButtons > 1
    || domState.legacyPanels > 1
    || domState.shadowHosts > 1;
  const hasOrphanedDom = !status && (hasLegacyDom || domState.shadowHosts > 0);

  // 无版本的旧脚本无法移除匿名监听器，其 observer 会不断复挂遗留 DOM；
  // 这种实例以及已出现重复 UI 的页面只能通过一次整页刷新安全迁移。
  if ((status?.ok && !status.version)
    || hasDuplicateDom
    || hasOrphanedDom) {
    return reloadTabForPageToolsMigration(tabId);
  }

  if (status?.version === PAGE_TOOLS_VERSION) {
    return true;
  }

  if (status) {
    try {
      const disposeResponse = await tabsSendMessage(tabId, { type: 'dispose-page-tools' });
      if (disposeResponse?.ok !== true) {
        throw new Error(disposeResponse?.error || '旧页面助手不支持释放');
      }
    } catch {
      try {
        await tabsSendMessage(tabId, { type: 'teardown-page-tools' });
      } catch {
        // 旧实例上下文可能已失效，新脚本会清理遗留 DOM。
      }
    }
  }

  await executeScript(tabId, ['content.js']);
  const nextStatus = await getPageToolsStatus(tabId);
  if (nextStatus?.version !== PAGE_TOOLS_VERSION) {
    throw new Error('页面助手版本校验失败');
  }
  return true;
}

function reconcilePageToolsInTab(tabId, url) {
  if (pageToolsReconcileRuns.has(tabId)) {
    return pageToolsReconcileRuns.get(tabId);
  }
  const run = reconcilePageToolsInTabInternal(tabId, url)
    .finally(() => {
      if (pageToolsReconcileRuns.get(tabId) === run) {
        pageToolsReconcileRuns.delete(tabId);
      }
    });
  pageToolsReconcileRuns.set(tabId, run);
  return run;
}

async function reconcilePageToolsInOpenTabs() {
  const tabs = await tabsQuery({});
  tabs.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));

  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isHttpUrl(tab.url)) {
      continue;
    }

    try {
      await reconcilePageToolsInTab(tab.id, tab.url);
    } catch (error) {
      console.warn('页面工具兼容注入失败:', error.message);
    }
  }
}

async function configureVerifyAlarm() {
  const settings = await storageGet(['verifyInterval', 'apiUrl', 'adminToken', 'emailHistory']);
  await clearAlarm(VERIFY_ALARM_NAME);
  const verifyIntervalSeconds = resolveIntervalSeconds(settings.verifyInterval, DISABLED_INTERVAL_SETTING);
  const hasTempVerifyConfig = Boolean(settings.apiUrl && settings.adminToken)
    && Array.isArray(settings.emailHistory)
    && settings.emailHistory.length > 0;
  if (verifyIntervalSeconds > 0 && hasTempVerifyConfig) {
    const verifyIntervalMinutes = verifyIntervalSeconds / 60;
    await chrome.alarms.create(VERIFY_ALARM_NAME, {
      delayInMinutes: Math.min(1, verifyIntervalMinutes),
      periodInMinutes: verifyIntervalMinutes,
    }).catch((error) => console.warn('创建验证告警失败:', error.message));
  }

}

async function configureMailAlarm() {
  const settings = await storageGet([
    'mailPollingInterval',
    'apiUrl',
    'adminToken',
    'emailHistory',
    'moeApiUrl',
    'moeApiKey',
    'moeEmailCache',
  ]);
  await clearAlarm(MAIL_ALARM_NAME);
  const mailPollingIntervalSeconds = resolveIntervalSeconds(settings.mailPollingInterval, DEFAULT_MAIL_POLL_INTERVAL);
  const hasTempMailSource = Boolean(settings.apiUrl && settings.adminToken)
    && Array.isArray(settings.emailHistory)
    && settings.emailHistory.length > 0;
  const hasMoeMailSource = Boolean(settings.moeApiUrl && settings.moeApiKey)
    && Array.isArray(settings.moeEmailCache)
    && settings.moeEmailCache.length > 0;
  if (mailPollingIntervalSeconds > 0 && (hasTempMailSource || hasMoeMailSource)) {
    const mailPollingIntervalMinutes = mailPollingIntervalSeconds / 60;
    await chrome.alarms.create(MAIL_ALARM_NAME, {
      delayInMinutes: Math.min(1, mailPollingIntervalMinutes),
      periodInMinutes: mailPollingIntervalMinutes,
    }).catch((error) => console.warn('创建邮件轮询告警失败:', error.message));
  }
}

function configureAlarms() {
  return Promise.all([configureVerifyAlarm(), configureMailAlarm()]);
}

async function configureCleanupAlarm() {
  await clearAlarm(CLEANUP_ALARM_NAME);
  await chrome.alarms.create(CLEANUP_ALARM_NAME, {
    delayInMinutes: CLEANUP_ALARM_INTERVAL_MINUTES,
    periodInMinutes: CLEANUP_ALARM_INTERVAL_MINUTES,
  }).catch((error) => console.warn('创建过期清理告警失败:', error.message));
}

function initializeBackground() {
  configureAlarms().catch((error) => console.warn('配置告警失败:', error.message));
  configureCleanupAlarm().catch((error) => console.warn('配置过期清理告警失败:', error.message));
  runCleanupExpiredTempAddresses().catch((error) => console.warn('初始化过期邮箱清理失败:', error.message));
  updateBadgeFromStorage().catch((error) => console.warn('更新角标失败:', error.message));
}

chrome.runtime.onInstalled.addListener((details) => {
  initializeBackground();
  if (details.reason === 'install' || details.reason === 'update') {
    // 声明式 content script 不会补注入安装/升级前已打开的页面。
    reconcilePageToolsInOpenTabs()
      .catch((error) => console.warn('页面工具兼容注入失败:', error.message));
  }
});

chrome.runtime.onStartup.addListener(initializeBackground);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === VERIFY_ALARM_NAME) {
    runVerifyAddressesNow().catch((error) => console.warn('后台验证失败:', error.message));
    return;
  }

  if (alarm.name === MAIL_ALARM_NAME) {
    runPollMailNow().catch((error) => console.warn('后台轮询失败:', error.message));
    return;
  }

  if (alarm.name === CLEANUP_ALARM_NAME) {
    runCleanupExpiredTempAddresses().catch((error) => console.warn('过期邮箱清理失败:', error.message));
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  (async () => {
    const target = await runNotificationTargetsMutation((targets) => {
      const matched = targets[notificationId];
      if (matched) delete targets[notificationId];
      return matched;
    });
    if (!target?.inbox) {
      return;
    }

    await storageSet({
      activeInbox: target.inbox,
      activeTab: target.inbox.type === 'moe' ? 'moe-mail' : 'temp-email',
    });
    chrome.notifications.clear(notificationId);

    if (typeof chrome.action.openPopup === 'function') {
      try {
        await chrome.action.openPopup();
        return;
      } catch {
        // 某些 Chrome 版本或窗口状态不允许直接打开 popup，回退到扩展页。
      }
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') });
  })().catch((error) => console.warn('打开通知对应收件箱失败:', error.message));
});

chrome.notifications.onClosed.addListener((notificationId) => {
  runNotificationTargetsMutation((targets) => {
    delete targets[notificationId];
  }).catch((error) => console.warn('清理通知映射失败:', error.message));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return;
  }

  if (changes.apiUrl) {
    clearRemoteDataCache('temp-domains:');
    storageRemove([TEMP_DOMAIN_CACHE_STORAGE_KEY]).catch(() => {});
  }
  if (changes.moeApiUrl || changes.moeApiKey) {
    clearRemoteDataCache('moe-');
    storageRemove([
      MOE_CONFIG_CACHE_STORAGE_KEY,
      MOE_EMAIL_LIST_CACHE_STORAGE_KEY,
    ]).catch(() => {});
  }

  const verifyAlarmKeys = [
    'verifyInterval',
    'apiUrl',
    'adminToken',
    'emailHistory',
  ];
  if (verifyAlarmKeys.some((key) => changes[key] !== undefined)) {
    configureVerifyAlarm().catch((error) => console.warn('重新配置验证告警失败:', error.message));
  }

  const mailAlarmKeys = [
    'apiUrl',
    'adminToken',
    'emailHistory',
    'mailPollingInterval',
    'moeApiUrl',
    'moeApiKey',
    'moeEmailCache',
  ];
  if (mailAlarmKeys.some((key) => changes[key] !== undefined)) {
    configureMailAlarm().catch((error) => console.warn('重新配置邮件告警失败:', error.message));
  }

  if (changes.tempUnreadCounts || changes.moeUnreadCounts) {
    updateBadgeFromStorage().catch((error) => console.warn('更新角标失败:', error.message));
  }
});

// 判断消息是否来自扩展自身页面（action popup、独立标签页，以及内容页里嵌入的
// popup.html iframe）。注意：悬浮窗把 popup.html 以 iframe 形式挂在普通网页上，
// 这种扩展页的 sender.tab 同样有值，因此必须用 origin/url 而不是 sender.tab 判定，
// 否则悬浮窗里的所有后台请求都会被误杀。
function isExtensionPageSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id) {
    return false;
  }
  const extensionOrigin = `chrome-extension://${chrome.runtime.id}`;
  if (typeof sender.origin === 'string' && sender.origin) {
    return sender.origin === extensionOrigin;
  }
  if (typeof sender.url === 'string' && sender.url) {
    return sender.url.startsWith(`${extensionOrigin}/`);
  }
  // 既无 origin 又无 url 时，只有 action popup 这类无 tab 的扩展页可信。
  return sender.tab === undefined;
}

function isAllowedMessageSender(message, sender) {
  // 拒绝任何非本扩展的发送方（未配置 externally_connectable，正常不会出现）。
  if (!sender || sender.id !== chrome.runtime.id) {
    return false;
  }
  if (isExtensionPageSender(sender)) {
    return true;
  }
  // 内容脚本只放行 content.js 实际会发送的消息类型。
  return CONTENT_SCRIPT_MESSAGE_TYPES.has(message?.type);
}

// storage 代理只接受白名单里的键；keys 可能是字符串、数组或带默认值的对象。
function normalizeStorageKeys(rawKeys) {
  if (typeof rawKeys === 'string') {
    return [rawKeys];
  }
  if (Array.isArray(rawKeys)) {
    return rawKeys.map((key) => String(key));
  }
  if (rawKeys && typeof rawKeys === 'object') {
    return Object.keys(rawKeys);
  }
  throw new Error('缺少有效的存储键');
}

function assertAllowedStorageKeys(rawKeys) {
  const keys = normalizeStorageKeys(rawKeys);
  const rejected = keys.filter((key) => !ALLOWED_STORAGE_KEYS.has(key));
  if (rejected.length > 0) {
    throw new Error(`不允许访问的存储键: ${rejected.join(', ')}`);
  }
  return keys;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAllowedMessageSender(message, sender)) {
    sendResponse({ ok: false, error: '拒绝来自未授权发送方的消息' });
    return false;
  }

  (async () => {
    if (message?.type === 'storage-get') {
      assertAllowedStorageKeys(message.keys);
      sendResponse({ ok: true, data: await storageGet(message.keys) });
      return;
    }

    if (message?.type === 'storage-set') {
      const items = message.items || {};
      assertAllowedStorageKeys(items);
      await storageSet(items);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'storage-remove') {
      assertAllowedStorageKeys(message.keys);
      await storageRemove(message.keys);
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'ensure-page-tools') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) {
        throw new Error('缺少有效的标签页 ID');
      }
      const tab = await tabsGet(tabId);
      const ready = await reconcilePageToolsInTab(tabId, tab?.url || '');
      sendResponse({ ok: true, data: { ready, version: ready ? PAGE_TOOLS_VERSION : '' } });
      return;
    }

    if (message?.type === 'proxy-fetch') {
      sendResponse({ ok: true, data: await proxyFetch(message.url, message.init) });
      return;
    }

    if (message?.type === 'get-temp-domains') {
      sendResponse({ ok: true, data: await getTempDomains(message.forceRefresh === true) });
      return;
    }

    if (message?.type === 'get-moe-config') {
      sendResponse({ ok: true, data: await getMoeConfig(message.forceRefresh === true) });
      return;
    }

    if (message?.type === 'get-moe-email-list') {
      sendResponse({ ok: true, data: await getMoeEmailList(message.forceRefresh === true) });
      return;
    }

    if (message?.type === 'cleanup-expired-temp-addresses') {
      const result = await runCleanupExpiredTempAddresses(message.force === true);
      sendResponse({ ok: true, data: result });
      return;
    }

    if (message?.type === 'clear-temp-unread' && message.address) {
      await runMailStateMutation(async () => {
        const { tempUnreadCounts = {} } = await storageGet(['tempUnreadCounts']);
        if (tempUnreadCounts[message.address]) {
          tempUnreadCounts[message.address] = 0;
          await storageSet({ tempUnreadCounts });
        }
      });
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'clear-moe-unread' && message.emailId !== undefined && message.emailId !== null) {
      const key = String(message.emailId);
      await runMailStateMutation(async () => {
        const { moeUnreadCounts = {} } = await storageGet(['moeUnreadCounts']);
        if (moeUnreadCounts[key]) {
          moeUnreadCounts[key] = 0;
          await storageSet({ moeUnreadCounts });
        }
      });
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'Unsupported message' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
