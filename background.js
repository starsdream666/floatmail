const VERIFY_ALARM_NAME = 'temp-email-verify';
const MAIL_ALARM_NAME = 'temp-email-mail-poll';
const MIN_ALARM_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
const DISABLED_INTERVAL_SETTING = Object.freeze({ value: 0, unit: 'minutes' });
const DEFAULT_MAIL_POLL_INTERVAL = Object.freeze({ value: 5, unit: 'minutes' });
const INTERVAL_UNIT_FACTORS = Object.freeze({
  seconds: 1,
  minutes: 60,
  hours: 3600,
});
let verifyRunPromise = null;
let mailPollRunPromise = null;

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
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

function shouldAllowSite(url, settings) {
  const origin = normalizeOrigin(url);
  if (!origin) {
    return false;
  }

  const blocklist = new Set(normalizeOriginList(settings.siteBlocklist));
  if (blocklist.has(origin)) {
    return false;
  }

  if (settings.siteAccessMode === 'whitelist') {
    const allowlist = new Set(normalizeOriginList(settings.siteAllowlist));
    return allowlist.has(origin);
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

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
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
    'tempMailMeta',
  ]);

  const apiUrl = (settings.apiUrl || '').trim().replace(/\/$/, '');
  const adminToken = (settings.adminToken || '').trim();
  const history = Array.isArray(settings.emailHistory) ? settings.emailHistory : [];
  const moeApiUrl = (settings.moeApiUrl || '').trim().replace(/\/$/, '');
  const moeApiKey = (settings.moeApiKey || '').trim();
  const moeEmailCache = Array.isArray(settings.moeEmailCache) ? settings.moeEmailCache : [];
  const notificationsEnabled = settings.notificationsEnabled !== false;

  const tempKnownMailIds = { ...(settings.tempKnownMailIds || {}) };
  const moeKnownMailIds = { ...(settings.moeKnownMailIds || {}) };
  const tempUnreadCounts = { ...(settings.tempUnreadCounts || {}) };
  const moeUnreadCounts = { ...(settings.moeUnreadCounts || {}) };
  const notifications = [];

  const activeTempAddresses = new Set(history);
  Object.keys(tempKnownMailIds).forEach((address) => {
    if (!activeTempAddresses.has(address)) {
      delete tempKnownMailIds[address];
      delete tempUnreadCounts[address];
    }
  });

  // Check for expired temp mail addresses
  const tempMailMeta = settings.tempMailMeta || {};
  const now = Date.now();
  const expiredAddrs = [];
  for (const addr of history) {
    const meta = tempMailMeta[addr];
    if (meta && meta.expiryMs > 0 && now >= meta.createdAt + meta.expiryMs) {
      expiredAddrs.push(addr);
    }
  }
  if (expiredAddrs.length > 0) {
    console.log('[Background] Auto-deleting expired temp addresses:', expiredAddrs);
    for (const addr of expiredAddrs) {
      // Try server-side deletion
      try {
        const queryRes = await fetch(`${apiUrl}/admin/address?query=${encodeURIComponent(addr)}&limit=10&offset=0`, {
          headers: { 'x-admin-auth': adminToken }
        });
        if (queryRes.ok) {
          const queryData = await queryRes.json();
          const match = (queryData.results || []).find(a => {
            const recordAddr = String(a.address || a.email || '').trim();
            return recordAddr.toLowerCase() === addr.toLowerCase();
          });
          if (match) {
            await fetch(`${apiUrl}/admin/delete_address/${match.id}`, {
              method: 'DELETE',
              headers: { 'x-admin-auth': adminToken }
            });
          }
        }
      } catch (e) { /* ignore */ }
      // Remove from local state
      activeTempAddresses.delete(addr);
      delete tempKnownMailIds[addr];
      delete tempUnreadCounts[addr];
      delete tempMailMeta[addr];
    }
    // Update history array
    const newHistory = history.filter(a => !expiredAddrs.includes(a));
    await storageSet({ emailHistory: newHistory, tempMailMeta });
    // Sync the cleaned history for subsequent polling in this run
    history.length = 0;
    history.push(...newHistory);
    activeTempAddresses.clear();
    newHistory.forEach(a => activeTempAddresses.add(a));
  }

  const activeMoeIds = new Set(moeEmailCache.map((email) => String(email.id)));
  Object.keys(moeKnownMailIds).forEach((emailId) => {
    if (!activeMoeIds.has(String(emailId))) {
      delete moeKnownMailIds[emailId];
      delete moeUnreadCounts[emailId];
    }
  });

  if (apiUrl && adminToken) {
    for (const address of history) {
      try {
        const data = await fetchJson(
          `${apiUrl}/admin/mails?address=${encodeURIComponent(address)}&limit=20&offset=0`,
          { headers: { 'x-admin-auth': adminToken } }
        );
        const messages = Array.isArray(data.results) ? data.results : [];
        const ids = messages.map(buildTempMailKey);
        const previousIds = Array.isArray(tempKnownMailIds[address]) ? tempKnownMailIds[address] : null;

        if (previousIds) {
          const previousSet = new Set(previousIds);
          const newMessages = messages.filter((message) => !previousSet.has(buildTempMailKey(message)));
          if (newMessages.length > 0) {
            tempUnreadCounts[address] = (tempUnreadCounts[address] || 0) + newMessages.length;
            notifications.push({
              source: address,
              count: newMessages.length,
              subject: newMessages[0]?.subject || '(无主题)',
            });
          }
        } else {
          tempUnreadCounts[address] = tempUnreadCounts[address] || 0;
        }

        tempKnownMailIds[address] = ids.slice(0, 50);
      } catch (error) {
        console.warn(`Temp Email 轮询失败 (${address}):`, error.message);
      }
    }
  }

  if (moeApiUrl && moeApiKey) {
    for (const email of moeEmailCache) {
      const emailId = String(email.id);
      try {
        const data = await fetchJson(`${moeApiUrl}/api/emails/${emailId}`, {
          headers: { 'X-API-Key': moeApiKey },
        });
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const ids = messages.map(buildMoeMailKey);
        const previousIds = Array.isArray(moeKnownMailIds[emailId]) ? moeKnownMailIds[emailId] : null;

        if (previousIds) {
          const previousSet = new Set(previousIds);
          const newMessages = messages.filter((message) => !previousSet.has(buildMoeMailKey(message)));
          if (newMessages.length > 0) {
            moeUnreadCounts[emailId] = (moeUnreadCounts[emailId] || 0) + newMessages.length;
            notifications.push({
              source: email.address || `MoeMail #${emailId}`,
              count: newMessages.length,
              subject: newMessages[0]?.subject || '(无主题)',
            });
          }
        } else {
          moeUnreadCounts[emailId] = moeUnreadCounts[emailId] || 0;
        }

        moeKnownMailIds[emailId] = ids.slice(0, 50);
      } catch (error) {
        console.warn(`MoeMail 轮询失败 (${emailId}):`, error.message);
      }
    }
  }

  await storageSet({
    tempKnownMailIds,
    moeKnownMailIds,
    tempUnreadCounts,
    moeUnreadCounts,
    lastMailPollAt: Date.now(),
  });

  await updateBadgeFromStorage();

  if (!notificationsEnabled) {
    return;
  }

  for (const notification of notifications.slice(0, 5)) {
    await createNotification(`mail-${Date.now()}-${Math.random()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `收到 ${notification.count} 封新邮件`,
      message: `${notification.source}\n最新主题: ${notification.subject}`,
    });
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
        console.warn(`页面工具注入失败 (${tab.url}):`, error.message);
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

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'loading' || !tab.url) {
    return;
  }

  storageGet([
    'floatWindowEnabled',
    'siteAccessMode',
    'siteAllowlist',
    'siteBlocklist',
  ]).then((settings) => {
    if (settings.floatWindowEnabled === false) {
      return;
    }
    if (!shouldAllowSite(tab.url, settings)) {
      return;
    }
    ensurePageToolsInjected(tabId, tab.url).catch((error) => {
      console.warn(`自动注入失败 (${tab.url}):`, error.message);
    });
  }).catch((error) => {
    console.warn('读取页面设置失败:', error.message);
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') {
    return;
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
