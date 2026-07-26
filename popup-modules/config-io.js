(function () {
  'use strict';

  const CATEGORY_KEYS = {
    tempEmail: ['apiUrl', 'adminToken', 'tempMailMeta', 'defaultTempExpiry'],
    moemail: ['moeApiUrl', 'moeApiKey', 'moeEmailCache', 'moeUnreadCounts', 'defaultMoeExpiry'],
    floatWindow: ['floatWindowEnabled', 'floatLayout', 'floatWindowStyle'],
    backgroundMail: ['verifyInterval', 'mailPollingInterval', 'notificationsEnabled'],
    mailDisplay: ['defaultRemoteImagesEnabled', 'translationApiBase', 'translationApiKey', 'translationModel', 'translationTargetLanguage', 'mailInsightApiMode', 'mailInsightApiBase', 'mailInsightApiKey', 'mailInsightModel'],
    siteControl: ['siteAccessMode', 'siteAllowlist', 'siteBlocklist'],
    pageFillRules: ['pageFillRules', 'fastFillEmailSource', 'fastFillDomainMode', 'fastFillDomainSpecific', 'fastFillDomainWhitelist', 'fastFillDomainBlacklist', 'fastFillNameRegion', 'fastFillNameGender', 'defaultFfTempExpiry', 'defaultFfMoeExpiry'],
    generatedProfile: ['generatedProfile', 'generatedToolAutoCloseSeconds', 'generatedToolHistory'],
    defaultTab: ['defaultTab', 'activeTab', 'tabLayoutMode', 'theme', 'selectedStyle', 'selectedTheme'],
    emailHistory: ['emailHistory', 'verifyStatusCache', 'tempUnreadCounts'],
    bookmarks: ['bookmarks'],
    bookmarkSort: ['bookmarkSort']
  };

  const ARRAY_KEYS = new Set([
    'moeEmailCache',
    'siteAllowlist',
    'siteBlocklist',
    'fastFillDomainWhitelist',
    'fastFillDomainBlacklist',
    'generatedToolHistory',
    'emailHistory',
    'bookmarks'
  ]);

  const OBJECT_KEYS = new Set([
    'tempMailMeta',
    'floatLayout',
    'pageFillRules',
    'generatedProfile',
    'verifyStatusCache',
    'tempUnreadCounts',
    'moeUnreadCounts'
  ]);

  // ===================== SEC-5：密钥脱敏 =====================

  // 导出时默认脱敏、导入时拒绝写回占位符的敏感键。
  const SECRET_KEYS = new Set([
    'adminToken',
    'moeApiKey',
    'translationApiKey',
    'mailInsightApiKey'
  ]);

  const REDACTED_MARK = '***';
  // 页面上不存在该 checkbox 时由本模块补建；若 popup.html 之后自带同 id 元素则直接复用。
  const SECRET_TOGGLE_ID = 'export-include-secrets';

  const EXPORT_WARNING_REDACTED = '⚠️ 本文件中的 API 密钥 / 令牌已脱敏（仅保留首尾各 4 位），无法直接使用；导入时这些字段会被跳过，不会覆盖你已保存的真实密钥。';
  const EXPORT_WARNING_PLAINTEXT = '🚨 危险：本文件包含可直接使用的 API 密钥 / 令牌明文。请勿分享、上传或提交到代码仓库，并妥善加密保存。';

  // ===================== SEC-6：值级校验白名单 =====================

  // 取值来源：popup.js 的 VALID_THEMES / MAIN_TABS / normalizeMailInsightApiMode
  // 以及 popup.html 中对应 <select> 的 <option value>。
  const VALID_THEMES = [
    'ocean-blue', 'sakura-pink', 'emerald-green', 'lavender-purple', 'midnight-dark',
    'sunset-orange', 'cyber-neon', 'mocha-brown', 'arctic-ice', 'rose-gold'
  ];

  const ENUM_KEYS = {
    siteAccessMode: ['all', 'whitelist'],
    defaultTab: ['temp-email', 'moe-mail'],
    activeTab: [
      'fast-fill', 'temp-email', 'moe-mail', 'bookmarks', 'tools',
      'generated-history', 'fill-rules', 'themes', 'settings', 'config-io'
    ],
    theme: VALID_THEMES,
    selectedTheme: VALID_THEMES,
    selectedStyle: ['neumorphism', 'glassmorphism', 'flat-minimal', 'soft-gradient', 'card-grid', 'cyberpunk'],
    fastFillEmailSource: ['temp', 'moe'],
    fastFillDomainMode: ['random', 'specific', 'whitelist', 'blacklist'],
    fastFillNameRegion: ['zh', 'en'],
    fastFillNameGender: ['random', 'male', 'female'],
    mailInsightApiMode: ['translation', 'custom'],
    bookmarkSort: ['custom', 'time-desc', 'time-asc', 'name-asc']
  };

  const URL_KEYS = new Set(['apiUrl', 'moeApiUrl', 'translationApiBase', 'mailInsightApiBase']);

  const BOOLEAN_KEYS = new Set([
    'floatWindowEnabled',
    'notificationsEnabled',
    'defaultRemoteImagesEnabled'
  ]);

  // 过期时间以毫秒字符串保存（popup.html 的 <option value> 全部是毫秒数）。
  const EXPIRY_KEYS = new Set([
    'defaultTempExpiry',
    'defaultMoeExpiry',
    'defaultFfTempExpiry',
    'defaultFfMoeExpiry'
  ]);
  const MAX_EXPIRY_MS = 365 * 24 * 60 * 60 * 1000;

  // 间隔既可能是 { value, unit } 对象，也可能是旧版的“分钟数”。
  const INTERVAL_KEYS = new Set(['verifyInterval', 'mailPollingInterval']);
  const INTERVAL_UNITS = new Set(['seconds', 'minutes', 'hours']);
  const MAX_INTERVAL_VALUE = 24 * 60 * 60; // 与 popup.js / background.js 的 MAX_INTERVAL_SECONDS 对齐

  // 这两项落库时会被强制归一（sidebar / modern），只做字符串校验以兼容旧配置。
  const LEGACY_STRING_KEYS = new Set(['tabLayoutMode', 'floatWindowStyle']);

  const MIN_AUTO_CLOSE_SECONDS = 1;
  const MAX_AUTO_CLOSE_SECONDS = 3600;

  // ===================== SEC-15 / L-2：体积与原型污染防护 =====================

  const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB
  const MAX_ARRAY_LENGTH = 2000;
  const MAX_OBJECT_ENTRIES = 5000;
  const MAX_SANITIZE_DEPTH = 20;
  const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isValidHttpUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  /**
   * L-2：递归剔除 __proto__ / constructor / prototype 键，并限制递归深度，
   * 保证进入 chrome.storage 的对象结构完全由字面量重建。
   */
  function sanitizeDeep(value, depth = 0) {
    if (depth > MAX_SANITIZE_DEPTH) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeDeep(item, depth + 1));
    }
    if (isPlainObject(value)) {
      const cleaned = {};
      Object.keys(value).forEach((key) => {
        if (FORBIDDEN_KEYS.has(key)) {
          return;
        }
        cleaned[key] = sanitizeDeep(value[key], depth + 1);
      });
      return cleaned;
    }
    return value;
  }

  function maskSecretValue(rawValue) {
    const text = typeof rawValue === 'string' ? rawValue : String(rawValue ?? '');
    if (!text) {
      return { __redacted: true, preview: '', length: 0 };
    }
    // 太短的密钥若还保留首尾各 4 位就等于泄露全文，直接整体隐藏。
    if (text.length <= 8) {
      return { __redacted: true, preview: REDACTED_MARK, length: text.length };
    }
    return {
      __redacted: true,
      preview: `${text.slice(0, 4)}${REDACTED_MARK}${text.slice(-4)}`,
      length: text.length
    };
  }

  /**
   * 判断导入文件里的密钥字段是否是脱敏占位符。
   * 命中则必须跳过，否则会把 “abcd***wxyz” 写回 storage 毁掉用户真实密钥。
   */
  function isRedactedSecretValue(value) {
    if (isPlainObject(value)) {
      if (value.__redacted === true) {
        return true;
      }
      return typeof value.preview === 'string' && value.preview.includes(REDACTED_MARK);
    }
    if (typeof value === 'string') {
      return value.includes(REDACTED_MARK);
    }
    return false;
  }

  function isIntegerLike(value) {
    if (typeof value === 'number') {
      return Number.isInteger(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed !== '' && /^-?\d+$/.test(trimmed);
    }
    return false;
  }

  function toInteger(value) {
    return typeof value === 'number' ? value : Number.parseInt(String(value).trim(), 10);
  }

  function isIntegerInRange(value, min, max) {
    if (!isIntegerLike(value)) {
      return false;
    }
    const parsed = toInteger(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max;
  }

  function isValidIntervalSetting(value) {
    if (isPlainObject(value)) {
      if (value.unit !== undefined && !INTERVAL_UNITS.has(value.unit)) {
        return false;
      }
      return isIntegerInRange(value.value, 0, MAX_INTERVAL_VALUE);
    }
    // 旧版直接存分钟数
    return isIntegerInRange(value, 0, MAX_INTERVAL_VALUE);
  }

  /**
   * SEC-6：值级校验。返回 false 的键会被跳过并汇总提示，不再整体中断导入。
   */
  function validateImportValue(key, value) {
    if (ARRAY_KEYS.has(key)) {
      return Array.isArray(value) && value.length <= MAX_ARRAY_LENGTH;
    }
    if (OBJECT_KEYS.has(key)) {
      return isPlainObject(value) && Object.keys(value).length <= MAX_OBJECT_ENTRIES;
    }
    if (URL_KEYS.has(key)) {
      return typeof value === 'string' && (!value.trim() || isValidHttpUrl(value));
    }
    if (Object.prototype.hasOwnProperty.call(ENUM_KEYS, key)) {
      return typeof value === 'string' && ENUM_KEYS[key].indexOf(value) !== -1;
    }
    if (BOOLEAN_KEYS.has(key)) {
      return typeof value === 'boolean';
    }
    if (EXPIRY_KEYS.has(key)) {
      return isIntegerInRange(value, 0, MAX_EXPIRY_MS);
    }
    if (INTERVAL_KEYS.has(key)) {
      return isValidIntervalSetting(value);
    }
    if (key === 'generatedToolAutoCloseSeconds') {
      return isIntegerInRange(value, MIN_AUTO_CLOSE_SECONDS, MAX_AUTO_CLOSE_SECONDS);
    }
    if (LEGACY_STRING_KEYS.has(key)) {
      return typeof value === 'string';
    }
    if (SECRET_KEYS.has(key)) {
      return typeof value === 'string';
    }
    // 其余为自由文本（模型名、目标语言、指定域名等）
    return typeof value === 'string';
  }

  /**
   * 数组项级清洗：书签等条目自带 url 时必须是 http/https，非法条目直接丢弃。
   * 返回 { value, dropped }，dropped 用于导入结果汇总。
   */
  function sanitizeImportValue(key, value) {
    if (!Array.isArray(value)) {
      return { value, dropped: 0 };
    }

    const kept = [];
    let dropped = 0;

    value.forEach((item) => {
      if (isPlainObject(item)) {
        // 含 url 字段的条目（bookmarks、以及其他历史类数组）统一校验协议
        if (Object.prototype.hasOwnProperty.call(item, 'url') && !isValidHttpUrl(item.url)) {
          dropped += 1;
          return;
        }
        kept.push(item);
        return;
      }
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
        kept.push(item);
        return;
      }
      // null / 数组 / 其他异常类型一律丢弃
      dropped += 1;
    });

    // bookmarks 必须带合法 url，缺字段的条目同样过滤
    if (key === 'bookmarks') {
      const filtered = kept.filter((item) => isPlainObject(item) && isValidHttpUrl(item.url));
      dropped += kept.length - filtered.length;
      return { value: filtered, dropped };
    }

    return { value: kept, dropped };
  }

  function initConfigIO(options) {
    const {
      exportBtn,
      importBtn,
      importFileInput,
      ioMessage,
      configChecks,
      showMessage,
      onImportApplied
    } = options;

    // 「包含密钥原文」开关：默认关闭，只有显式勾选 + confirm 二次确认才导出明文。
    let includePlaintextSecrets = false;

    function ensureSecretToggle() {
      const existing = document.getElementById(SECRET_TOGGLE_ID);
      if (existing) {
        return existing;
      }
      const buttonRow = exportBtn?.parentElement;
      if (!buttonRow || typeof buttonRow.insertAdjacentElement !== 'function') {
        return null;
      }
      const label = document.createElement('label');
      label.className = 'config-check config-io-secret-toggle';
      label.style.display = 'block';
      label.style.marginBottom = '8px';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = SECRET_TOGGLE_ID;
      label.appendChild(input);
      label.appendChild(document.createTextNode(' 导出时包含 API 密钥原文（危险，默认脱敏）'));
      buttonRow.insertAdjacentElement('beforebegin', label);
      return input;
    }

    const secretToggle = ensureSecretToggle();

    function wantsPlaintextSecrets() {
      if (secretToggle) {
        return Boolean(secretToggle.checked);
      }
      return includePlaintextSecrets;
    }

    function getSelectedCategories() {
      const selected = [];
      configChecks.forEach((checkbox) => {
        if (checkbox.checked) {
          selected.push(checkbox.value);
        }
      });
      return selected;
    }

    exportBtn.addEventListener('click', () => {
      const categories = getSelectedCategories();
      if (categories.length === 0) {
        showMessage(ioMessage, '请至少选择一个导出项', 'error');
        return;
      }

      const allKeys = Array.from(new Set(categories.flatMap((category) => CATEGORY_KEYS[category] || [])));
      chrome.storage.local.get(allKeys, (result) => {
        const secretKeysInScope = allKeys.filter((key) => SECRET_KEYS.has(key) && result[key]);

        // SEC-5：默认脱敏；仅在显式勾选开关后再用 confirm() 做二次确认。
        let includeSecrets = false;
        let confirmCancelled = false;
        if (secretKeysInScope.length > 0 && wantsPlaintextSecrets()) {
          includeSecrets = window.confirm(
            '⚠️ 高危操作确认\n\n'
            + '导出文件将包含可直接使用的 API 密钥 / 令牌明文（'
            + secretKeysInScope.join('、')
            + '）。\n\n'
            + '任何拿到该文件的人都能直接调用你的接口并产生费用，请勿分享、上传网盘或提交到代码仓库。\n\n'
            + '确定要导出明文密钥吗？（取消则继续导出，但密钥会被脱敏）'
          );
          confirmCancelled = !includeSecrets;
        }

        const exportData = {
          _warning: includeSecrets ? EXPORT_WARNING_PLAINTEXT : EXPORT_WARNING_REDACTED,
          _meta: {
            version: '2.6',
            exportedAt: new Date().toISOString(),
            categories,
            secretsRedacted: !includeSecrets
          }
        };

        let redactedCount = 0;
        categories.forEach((category) => {
          const keys = CATEGORY_KEYS[category];
          if (!keys) {
            return;
          }
          exportData[category] = {};
          keys.forEach((key) => {
            if (result[key] === undefined) {
              return;
            }
            if (SECRET_KEYS.has(key) && !includeSecrets) {
              exportData[category][key] = maskSecretValue(result[key]);
              redactedCount += 1;
              return;
            }
            exportData[category][key] = result[key];
          });
        });

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        anchor.href = url;
        anchor.download = `email-tool-config-${timestamp}.json`;
        anchor.click();
        URL.revokeObjectURL(url);

        let tip = `已导出 ${categories.length} 个分类`;
        if (includeSecrets) {
          tip += '（含密钥明文，请勿分享该文件）';
        } else if (redactedCount > 0) {
          tip += confirmCancelled
            ? `（已取消明文导出，${redactedCount} 项密钥已脱敏）`
            : `（${redactedCount} 项密钥已脱敏）`;
        }
        showMessage(ioMessage, tip, 'success');
      });
    });

    importBtn.addEventListener('click', () => {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      // SEC-15：先卡体积再读文件，避免超大 JSON 直接进 JSON.parse。
      if (typeof file.size === 'number' && file.size > MAX_IMPORT_FILE_BYTES) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        showMessage(
          ioMessage,
          `配置文件过大（${sizeMb}MB），上限 ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB`,
          'error'
        );
        importFileInput.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const parsed = JSON.parse(loadEvent.target.result);
          if (!isPlainObject(parsed)) {
            showMessage(ioMessage, '无效的配置文件格式', 'error');
            return;
          }

          // L-2：入库前统一剔除原型污染键
          const data = sanitizeDeep(parsed);
          if (!data._meta || !Array.isArray(data._meta.categories)) {
            showMessage(ioMessage, '无效的配置文件格式', 'error');
            return;
          }

          const categories = getSelectedCategories();
          if (categories.length === 0) {
            showMessage(ioMessage, '请勾选要导入的项目', 'error');
            return;
          }

          const toStore = {};
          const skippedKeys = [];
          const droppedNotes = [];
          let importedCount = 0;
          let skippedSecretCount = 0;

          categories.forEach((category) => {
            // 旧版曾把 bookmarkSort 同时写入 bookmarks 分类；导入时继续兼容。
            const categoryData = data[category]
              || (category === 'bookmarkSort' && data.bookmarks?.bookmarkSort !== undefined
                ? data.bookmarks
                : null);
            if (!isPlainObject(categoryData) || !CATEGORY_KEYS[category]) {
              return;
            }
            CATEGORY_KEYS[category].forEach((key) => {
              const rawValue = categoryData[key];
              if (rawValue === undefined) {
                return;
              }

              // SEC-5：脱敏占位符绝不能写回 storage，否则会毁掉用户的真实密钥。
              if (SECRET_KEYS.has(key) && isRedactedSecretValue(rawValue)) {
                skippedSecretCount += 1;
                return;
              }

              if (!validateImportValue(key, rawValue)) {
                skippedKeys.push(key);
                return;
              }

              const { value, dropped } = sanitizeImportValue(key, rawValue);
              if (dropped > 0) {
                droppedNotes.push(`${key} 丢弃 ${dropped} 条非法条目`);
              }
              toStore[key] = value;
            });
            importedCount += 1;
          });

          if (importedCount === 0) {
            showMessage(ioMessage, '配置文件中无匹配的勾选项', 'error');
            return;
          }

          if (Object.keys(toStore).length === 0) {
            const reason = skippedSecretCount > 0
              ? '（密钥为脱敏占位符，已跳过以保护现有密钥）'
              : '';
            showMessage(ioMessage, `没有任何配置项通过校验，未写入数据${reason}`, 'error');
            return;
          }

          // 已下线的旧布局只做兼容读取，落库时统一迁移到当前模式。
          if (toStore.tabLayoutMode !== undefined) toStore.tabLayoutMode = 'sidebar';
          if (toStore.floatWindowStyle !== undefined) toStore.floatWindowStyle = 'modern';

          chrome.storage.local.set(toStore, () => {
            let tip = `已导入 ${importedCount} 个分类`;
            if (skippedSecretCount > 0) {
              tip += `，${skippedSecretCount} 项密钥为脱敏值已跳过（保留原密钥）`;
            }
            if (skippedKeys.length > 0) {
              const preview = skippedKeys.slice(0, 4).join('、');
              tip += `，${skippedKeys.length} 项校验失败已跳过：${preview}${skippedKeys.length > 4 ? ' 等' : ''}`;
            }
            if (droppedNotes.length > 0) {
              tip += `，${droppedNotes.slice(0, 2).join('；')}`;
            }
            tip += '，刷新中...';
            showMessage(ioMessage, tip, 'success');
            if (typeof onImportApplied === 'function') {
              onImportApplied(toStore);
            }
          });
        } catch (error) {
          showMessage(ioMessage, `解析文件失败: ${error.message}`, 'error');
        }
      };
      reader.readAsText(file);
      importFileInput.value = '';
    });

    return {
      getSelectedCategories,
      categoryKeys: CATEGORY_KEYS,
      // 无 UI 场景下的程序化开关（默认关闭）
      setIncludePlaintextSecrets(enabled) {
        includePlaintextSecrets = Boolean(enabled);
        if (secretToggle) {
          secretToggle.checked = includePlaintextSecrets;
        }
      }
    };
  }

  window.PopupConfigIO = {
    CATEGORY_KEYS,
    SECRET_KEYS,
    initConfigIO
  };
})();
