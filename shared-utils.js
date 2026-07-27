(function (root) {
  'use strict';

  function isHttpUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
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

  // popup 页面与经典 Service Worker 共用，保持无打包器的全局模块加载方式。
  root.FloatMailSharedUtils = Object.freeze({
    isHttpUrl,
    buildAddressString
  });
})(globalThis);
