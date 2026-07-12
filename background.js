const VERIFY_ALARM_NAME = 'temp-email-verify';
const MAIL_ALARM_NAME = 'temp-email-mail-poll';
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
let verifyRunPromise = null;
let mailPollRunPromise = null;
let cleanupExpiredPromise = null;
let lastExpiredCleanupAt = 0;
const remoteDataCache = new Map();
const remoteDataRequests = new Map();
let remoteDataCacheEpoch = 0;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

function storageRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

function clearAlarm(name) {
  return new Promise((resolve) => chrome.alarms.clear(name, resolve));
}

function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
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

function insertCss(tabId, files) {
  return new Promise((resolve, reject) => {
    chrome.scripting.insertCSS({ target: { tabId }, files }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function createNotification(notificationId, options) {
  return new Promise((resolve) => {
    chrome.notifications.create(notificationId, options, resolve);
  });
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

function isHttpUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeOrigin(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return url.origin;
  } catch {
    return '';
  }
}

function normalizeOriginList(list) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeOrigin)
    .filter(Boolean);
}

/**
 * 从 URL 或 origin 中提取 hostname（不含端口）
 * 支持: 'https://example.com:8080/path' → 'example.com'
 *       'https://example.com' → 'example.com'
 *       'example.com' → 'example.com'
 */
function extractHostname(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const url = new URL(rawUrl);
    return url.hostname || '';
  } catch {
    // 可能是纯 hostname 或 origin 不带协议
    const cleaned = rawUrl.trim();
    if (cleaned.includes('://')) {
      const afterProtocol = cleaned.split('://')[1];
      return afterProtocol.split('/')[0].split(':')[0];
    }
    return cleaned.split(':')[0];
  }
}

/**
 * 判断 URL 是否匹配某条黑名单/白名单规则
 *
 * 支持三种匹配模式：
 * 1. 完整域名（origin）: 'https://mail.google.com' — 精确匹配 origin
 * 2. 通配符: '*.example.com' — 匹配 example.com 及其所有子域名
 * 3. 域名关键词: 'spam' — 匹配 hostname 中包含该关键词的任意域名（忽略大小写）
 */
function matchesSitePattern(rawUrl, pattern) {
  if (!rawUrl || !pattern) return false;
  const p = String(pattern).trim();
  if (!p) return false;

  // 1. 完整 origin 精确匹配 (http:// 或 https:// 开头)
  if (p.startsWith('http://') || p.startsWith('https://')) {
    try {
      const patternOrigin = new URL(p).origin;
      let origin;
      try {
        origin = new URL(rawUrl).origin;
      } catch {
        // rawUrl 可能本身就已经是 origin
        origin = rawUrl;
      }
      return patternOrigin === origin;
    } catch {
      return false;
    }
  }

  const hostname = extractHostname(rawUrl);
  if (!hostname) return false;

  // 2. 通配符匹配: '*.example.com'
  if (p.startsWith('*.')) {
    const suffix = p.slice(2); // 移除 '*.' → 'example.com'
    if (!suffix) return false;
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }

  // 3. 关键词匹配（忽略大小写）
  return hostname.toLowerCase().includes(p.toLowerCase());
}

/**
 * 判断 URL 是否匹配规则列表中的任意一条
 */
function matchesAnySitePattern(rawUrl, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  return patterns.some(pattern => matchesSitePattern(rawUrl, pattern));
}

function shouldAllowSite(url, settings) {
  const origin = normalizeOrigin(url);
  if (!origin) {
    return false;
  }

  // 黑名单：支持完整域名、通配符、关键词三种模式
  const blocklist = Array.isArray(settings.siteBlocklist) ? settings.siteBlocklist : [];
  if (matchesAnySitePattern(url, blocklist)) {
    return false;
  }

  if (settings.siteAccessMode === 'whitelist') {
    const allowlist = Array.isArray(settings.siteAllowlist) ? settings.siteAllowlist : [];
    // 白名单同时也尝试模式匹配（兼容新格式），以及旧的 origin 精确匹配
    if (matchesAnySitePattern(url, allowlist)) return true;
    const allowlistOrigins = new Set(normalizeOriginList(allowlist));
    return allowlistOrigins.has(origin);
  }

  return true;
}

function buildAddressString(record) {
  if (!record || typeof record !== 'object') {
    return '';
  }
  if (record.address) {
    return String(record.address).trim();
  }
  if (record.name && record.domain) {
    return `${record.name}@${record.domain}`.trim();
  }
  return String(record.name || '').trim();
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
        await worker(item);
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

async function fetchJson(url, init) {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchWithTimeout(url, init = {}, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, init = {}, timeoutMs = REMOTE_REQUEST_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, init, timeoutMs);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
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

  const existingRequest = remoteDataRequests.get(cacheKey);
  if (existingRequest) {
    return existingRequest.request;
  }

  const requestEpoch = remoteDataCacheEpoch;
  const request = fetchJsonWithTimeout(url, init)
    .then(async (data) => {
      if (remoteDataCacheEpoch !== requestEpoch) {
        return data;
      }
      const entry = { cacheKey, data, fetchedAt: Date.now() };
      remoteDataCache.set(cacheKey, entry);
      if (storageKey) {
        await storageSet({ [storageKey]: entry });
      }
      return data;
    })
    .finally(() => {
      if (remoteDataRequests.get(cacheKey)?.request === request) {
        remoteDataRequests.delete(cacheKey);
      }
    });
  remoteDataRequests.set(cacheKey, { request, epoch: requestEpoch });
  return request;
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
  if (!force && now - lastExpiredCleanupAt < 60 * 1000) {
    return { removed: 0 };
  }

  const settings = await storageGet([
    'apiUrl',
    'adminToken',
    'emailHistory',
    'verifyStatusCache',
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

  lastExpiredCleanupAt = now;
  if (expiredAddresses.length === 0) {
    return { removed: 0 };
  }

  if (apiUrl && adminToken) {
    await runWithConcurrency(expiredAddresses, 3, async (address) => {
      try {
        const data = await fetchJsonWithTimeout(
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
      } catch (error) {
        console.warn('过期邮箱服务端删除失败:', error.message);
      }
    });
  }

  // 服务端删除期间，其他 popup 可能新增邮箱或更新状态；提交前重新读取并合并，
  // 避免用清理开始时的旧快照覆盖较新的数据。
  const latest = await storageGet([
    'emailHistory',
    'verifyStatusCache',
    'tempUnreadCounts',
    'tempKnownMailIds',
    'tempMailMeta',
    'mailPollState',
  ]);
  const latestHistory = Array.isArray(latest.emailHistory) ? latest.emailHistory : [];
  const latestTempMailMeta = { ...(latest.tempMailMeta || {}) };
  const confirmedExpired = expiredAddresses.filter((address) => {
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
  return { removed: confirmedExpired.length };
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

async function proxyFetch(url, init = {}) {
  const parsedUrl = new URL(String(url || ''));
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('仅支持 HTTP/HTTPS 请求');
  }

  const response = await fetchWithTimeout(parsedUrl.href, {
    method: init.method || 'GET',
    headers: init.headers || {},
    body: init.body,
  });
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

async function verifyAddress(apiUrl, adminToken, address) {
  const maxRetry = 3;
  const timeoutMs = 8000;

  for (let attempt = 1; attempt <= maxRetry; attempt += 1) {
    let timer = null;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const data = await fetchJson(
        `${apiUrl}/admin/address?query=${encodeURIComponent(address)}&limit=10&offset=0`,
        {
          headers: { 'x-admin-auth': adminToken },
          signal: controller.signal,
        }
      );

      const matched = (data.results || []).find((record) => matchesAddressRecord(record, address));
      return matched ? 'valid' : 'invalid';
    } catch (error) {
      if (attempt === maxRetry) {
        return 'error';
      }
      await sleep(1000 * attempt);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  return 'error';
}

async function verifyAddressesNow() {
  const settings = await storageGet([
    'apiUrl',
    'adminToken',
    'emailHistory',
    'verifyStatusCache',
  ]);

  const apiUrl = (settings.apiUrl || '').trim().replace(/\/$/, '');
  const adminToken = (settings.adminToken || '').trim();
  const history = Array.isArray(settings.emailHistory) ? settings.emailHistory : [];

  if (!apiUrl || !adminToken || history.length === 0) {
    await storageSet({ verifyStatusCache: {} });
    return;
  }

  const verifyStatusCache = {};
  for (const address of history) {
    verifyStatusCache[address] = await verifyAddress(apiUrl, adminToken, address);
  }

  await storageSet({
    verifyStatusCache,
    lastVerifyAt: Date.now(),
  });
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

  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeText({ text: total > 0 ? String(Math.min(total, 99)) : '' });
}

async function pollMailNow() {
  await runCleanupExpiredTempAddresses();
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
        const data = await fetchJsonWithTimeout(
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
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: newMessages.length > 0,
          failed: false,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
      } catch (error) {
        console.warn('Temp Email 轮询失败:', error.message);
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: false,
          failed: true,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
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
        const data = await fetchJsonWithTimeout(`${moeApiUrl}/api/emails/${emailId}`, {
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
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: newMessages.length > 0,
          failed: false,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
      } catch (error) {
        console.warn('MoeMail 轮询失败:', error.message);
        updateAddressPollState(mailPollState, stateKey, {
          hasNewMail: false,
          failed: true,
          isActive,
          baseIntervalMs: basePollIntervalMs,
          now,
        });
      }
    });
  }

  await storageSet({
    tempKnownMailIds,
    moeKnownMailIds,
    tempUnreadCounts,
    moeUnreadCounts,
    mailPollState,
    lastMailPollAt: Date.now(),
  });

  if (!notificationsEnabled) {
    return;
  }
  if (notifications.length === 0) {
    return;
  }

  const storedTargets = await storageGet([MAIL_NOTIFICATION_TARGETS_KEY]);
  const notificationTargets = { ...(storedTargets[MAIL_NOTIFICATION_TARGETS_KEY] || {}) };
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  Object.keys(notificationTargets).forEach((id) => {
    if (Number(notificationTargets[id]?.createdAt) < recentCutoff) {
      delete notificationTargets[id];
    }
  });

  for (const notification of notifications.slice(0, 5)) {
    const notificationId = `mail-${Date.now()}-${Math.random()}`;
    notificationTargets[notificationId] = {
      inbox: notification.inbox,
      createdAt: Date.now(),
    };
    await createNotification(notificationId, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `收到 ${notification.count} 封新邮件`,
      message: `${notification.source}\n最新主题: ${notification.subject}`,
    });
  }
  await storageSet({ [MAIL_NOTIFICATION_TARGETS_KEY]: notificationTargets });
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

async function isPageToolsReady(tabId) {
  try {
    const response = await tabsSendMessage(tabId, { type: 'page-tools-ping' });
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function ensurePageToolsInjected(tabId, url) {
  if (!isHttpUrl(url)) {
    return false;
  }

  if (await isPageToolsReady(tabId)) {
    return true;
  }

  try {
    await insertCss(tabId, ['content.css']);
  } catch (error) {
    // 重复注入 CSS 时无需中断脚本注入。
  }

  await executeScript(tabId, ['content.js']);
  return true;
}

async function refreshPageToolsForOpenTabs() {
  const settings = await storageGet([
    'floatWindowEnabled',
    'siteAccessMode',
    'siteAllowlist',
    'siteBlocklist',
  ]);
  const autoInjectEnabled = settings.floatWindowEnabled !== false;
  const tabs = await tabsQuery({});

  for (const tab of tabs) {
    if (!tab.id || !tab.url || !isHttpUrl(tab.url)) {
      continue;
    }

    if (autoInjectEnabled && shouldAllowSite(tab.url, settings)) {
      try {
        await ensurePageToolsInjected(tab.id, tab.url);
      } catch (error) {
        console.warn('页面工具注入失败:', error.message);
      }
      continue;
    }

    try {
      await tabsSendMessage(tab.id, { type: 'teardown-page-tools' });
    } catch {
      // 页面上尚未注入，无需处理。
    }
  }
}

async function configureAlarms() {
  const settings = await storageGet([
    'verifyInterval',
    'apiUrl',
    'adminToken',
    'emailHistory',
    'mailPollingInterval',
    'moeApiUrl',
    'moeApiKey',
    'moeEmailCache',
  ]);

  await clearAlarm(VERIFY_ALARM_NAME);
  const verifyIntervalSeconds = resolveIntervalSeconds(settings.verifyInterval, DISABLED_INTERVAL_SETTING);
  const hasTempVerifyConfig = Boolean(settings.apiUrl && settings.adminToken)
    && Array.isArray(settings.emailHistory)
    && settings.emailHistory.length > 0;
  if (verifyIntervalSeconds > 0 && hasTempVerifyConfig) {
    const verifyIntervalMinutes = verifyIntervalSeconds / 60;
    chrome.alarms.create(VERIFY_ALARM_NAME, {
      delayInMinutes: Math.min(1, verifyIntervalMinutes),
      periodInMinutes: verifyIntervalMinutes,
    });
  }

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
    chrome.alarms.create(MAIL_ALARM_NAME, {
      delayInMinutes: Math.min(1, mailPollingIntervalMinutes),
      periodInMinutes: mailPollingIntervalMinutes,
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  configureAlarms().catch((error) => console.warn('配置告警失败:', error.message));
  refreshPageToolsForOpenTabs().catch((error) => console.warn('刷新页面工具失败:', error.message));
  updateBadgeFromStorage().catch((error) => console.warn('更新角标失败:', error.message));
});

chrome.runtime.onStartup.addListener(() => {
  configureAlarms().catch((error) => console.warn('配置告警失败:', error.message));
  refreshPageToolsForOpenTabs().catch((error) => console.warn('刷新页面工具失败:', error.message));
  updateBadgeFromStorage().catch((error) => console.warn('更新角标失败:', error.message));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === VERIFY_ALARM_NAME) {
    runVerifyAddressesNow().catch((error) => console.warn('后台验证失败:', error.message));
    return;
  }

  if (alarm.name === MAIL_ALARM_NAME) {
    runPollMailNow().catch((error) => console.warn('后台轮询失败:', error.message));
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  (async () => {
    const stored = await storageGet([MAIL_NOTIFICATION_TARGETS_KEY]);
    const targets = { ...(stored[MAIL_NOTIFICATION_TARGETS_KEY] || {}) };
    const target = targets[notificationId];
    if (!target?.inbox) {
      return;
    }

    delete targets[notificationId];
    await storageSet({
      activeInbox: target.inbox,
      activeTab: target.inbox.type === 'moe' ? 'moe-mail' : 'temp-email',
      [MAIL_NOTIFICATION_TARGETS_KEY]: targets,
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

  const alarmKeys = [
    'verifyInterval',
    'apiUrl',
    'adminToken',
    'emailHistory',
    'mailPollingInterval',
    'moeApiUrl',
    'moeApiKey',
    'moeEmailCache',
  ];
  if (alarmKeys.some((key) => changes[key] !== undefined)) {
    configureAlarms().catch((error) => console.warn('重新配置告警失败:', error.message));
  }

  const pageKeys = [
    'floatWindowEnabled',
    'siteAccessMode',
    'siteAllowlist',
    'siteBlocklist',
  ];
  if (pageKeys.some((key) => changes[key] !== undefined)) {
    refreshPageToolsForOpenTabs().catch((error) => console.warn('刷新页面工具失败:', error.message));
  }

  if (changes.tempUnreadCounts || changes.moeUnreadCounts) {
    updateBadgeFromStorage().catch((error) => console.warn('更新角标失败:', error.message));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'storage-get') {
      sendResponse({ ok: true, data: await storageGet(message.keys) });
      return;
    }

    if (message?.type === 'storage-set') {
      await storageSet(message.items || {});
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'storage-remove') {
      await storageRemove(message.keys);
      sendResponse({ ok: true });
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

    if (message?.type === 'invalidate-remote-data-cache') {
      const scope = String(message.scope || '');
      if (scope === 'temp') {
        clearRemoteDataCache('temp-domains:');
        await storageRemove([TEMP_DOMAIN_CACHE_STORAGE_KEY]);
      } else if (scope === 'moe') {
        clearRemoteDataCache('moe-');
        await storageRemove([
          MOE_CONFIG_CACHE_STORAGE_KEY,
          MOE_EMAIL_LIST_CACHE_STORAGE_KEY,
        ]);
      } else {
        clearRemoteDataCache();
        await storageRemove([
          TEMP_DOMAIN_CACHE_STORAGE_KEY,
          MOE_CONFIG_CACHE_STORAGE_KEY,
          MOE_EMAIL_LIST_CACHE_STORAGE_KEY,
        ]);
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'run-verify-now') {
      await runVerifyAddressesNow();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'run-mail-poll-now') {
      await runPollMailNow();
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'cleanup-expired-temp-addresses') {
      const result = await runCleanupExpiredTempAddresses(message.force === true);
      sendResponse({ ok: true, data: result });
      return;
    }

    if (message?.type === 'clear-temp-unread' && message.address) {
      const { tempUnreadCounts = {} } = await storageGet(['tempUnreadCounts']);
      if (tempUnreadCounts[message.address]) {
        tempUnreadCounts[message.address] = 0;
        await storageSet({ tempUnreadCounts });
      }
      sendResponse({ ok: true });
      return;
    }

    if (message?.type === 'clear-moe-unread' && message.emailId !== undefined && message.emailId !== null) {
      const key = String(message.emailId);
      const { moeUnreadCounts = {} } = await storageGet(['moeUnreadCounts']);
      if (moeUnreadCounts[key]) {
        moeUnreadCounts[key] = 0;
        await storageSet({ moeUnreadCounts });
      }
      sendResponse({ ok: true });
      return;
    }

    sendResponse({ ok: false, error: 'Unsupported message' });
  })().catch((error) => {
    sendResponse({ ok: false, error: error.message });
  });

  return true;
});
