(function installChromeStorageFallback() {
  const chromeApi = globalThis.chrome;
  if (!chromeApi || chromeApi.storage?.local) {
    return;
  }

  const callStorageProxy = (message, callback, fallback) => {
    if (!chromeApi.runtime?.sendMessage) {
      if (typeof callback === 'function') {
        callback(fallback);
      }
      return;
    }

    chromeApi.runtime.sendMessage(message, (response) => {
      if (chromeApi.runtime.lastError || response?.ok === false) {
        console.warn('FloatMail storage proxy failed:', chromeApi.runtime.lastError?.message || response?.error);
        if (typeof callback === 'function') {
          callback(fallback);
        }
        return;
      }
      if (typeof callback === 'function') {
        callback(response?.data ?? fallback);
      }
    });
  };

  const local = {
    get(keys, callback) {
      callStorageProxy({ type: 'storage-get', keys }, callback, {});
    },
    set(items, callback) {
      callStorageProxy({ type: 'storage-set', items }, () => {
        if (typeof callback === 'function') {
          callback();
        }
      }, null);
    },
    remove(keys, callback) {
      callStorageProxy({ type: 'storage-remove', keys }, () => {
        if (typeof callback === 'function') {
          callback();
        }
      }, null);
    }
  };

  chromeApi.storage = chromeApi.storage || {};
  chromeApi.storage.local = local;
  chromeApi.storage.onChanged = chromeApi.storage.onChanged || {
    addListener() {},
    removeListener() {}
  };
})();

document.addEventListener('DOMContentLoaded', async () => {
  // 安全超时：如果初始化超过 3 秒仍未完成，强制显示页面避免白屏
  const initSafetyTimer = setTimeout(() => {
    document.body.classList.remove('js-loading');
  }, 3000);

  const { createMailRenderer } = window.PopupMailRenderer;
  const { initConfigIO } = window.PopupConfigIO;
  const { initGeneratedTools } = window.PopupToolGenerators;

  // ===================== 元素引用 =====================
  const backToHomeBtn = document.getElementById('back-to-home');
  const mainTitle = document.getElementById('main-title');
  const mainSubtitle = document.getElementById('main-subtitle');
  const tabBar = document.getElementById('tab-bar');
  const tabBtns = tabBar.querySelectorAll('.tab-btn');
  const generatedHistoryTabBtn = tabBar.querySelector('[data-tab="generated-history"]');
  const fillRulesTabBtn = tabBar.querySelector('[data-tab="fill-rules"]');
  const configIOTabBtn = tabBar.querySelector('[data-tab="config-io"]');

  // ===================== Temp Email 元素 =====================
  const tempPage = document.getElementById('temp-email-page');
  const createPane = document.getElementById('create-pane');
  const emailNameInput = document.getElementById('email-name');
  const domainSelect = document.getElementById('domain-select');
  const createBtn = document.getElementById('create-btn');
  const createMessage = document.getElementById('create-message');
  const resultArea = document.getElementById('result-area');
  const createdAddressSpan = document.getElementById('created-address');
  const fillEmailBtn = document.getElementById('fill-email-btn');
  const mainCopyBtn = document.getElementById('main-copy-btn');
  const tempExpirySelect = document.getElementById('temp-expiry-select');
  const historySection = document.getElementById('history-section');
  const historyList = document.getElementById('history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');
  const verifyAllBtn = document.getElementById('verify-all-btn');
  const tempMarkAllReadBtn = document.getElementById('temp-mark-all-read-btn');
  const cleanInvalidBtn = document.getElementById('clean-invalid-btn');
  const verifyStatusDiv = document.getElementById('verify-status');
  const inboxPane = document.getElementById('inbox-pane');
  const inboxAddressTitle = document.getElementById('inbox-address-title');
  const mailList = document.getElementById('mail-list');
  const mailContent = document.getElementById('mail-content');
  const backToListBtn = document.getElementById('back-to-list');
  const deleteMailBtn = document.getElementById('delete-mail-btn');
  const mailFrom = document.getElementById('mail-from');
  const mailSubject = document.getElementById('mail-subject');
  const mailTime = document.getElementById('mail-time');
  const toggleMailViewBtn = document.getElementById('toggle-mail-view-btn');
  const toggleMailImagesBtn = document.getElementById('toggle-mail-images-btn');
  const mailInsights = document.getElementById('mail-insights');
  const mailBody = document.getElementById('mail-body');
  const refreshInboxBtn = document.getElementById('refresh-inbox-btn');
  const retryDomainsBtn = document.getElementById('retry-domains-btn');
  const translateMailBtn = document.getElementById('translate-mail-btn');
  const mailTranslation = document.getElementById('mail-translation');
  const mailTranslationTitle = document.getElementById('mail-translation-title');
  const mailTranslationBody = document.getElementById('mail-translation-body');
  const copyMailTranslationBtn = document.getElementById('copy-mail-translation-btn');
  const retranslateMailBtn = document.getElementById('retranslate-mail-btn');

  // Temp Email Batch UI
  const tempHistoryBatchToggleBtn = document.getElementById('temp-history-batch-toggle-btn');
  const tempHistoryBatchAction = document.getElementById('temp-history-batch-action');
  const tempHistoryBatchDeleteBtn = document.getElementById('temp-history-batch-delete-btn');
  const tempHistoryBatchCancelBtn = document.getElementById('temp-history-batch-cancel-btn');

  const tempInboxBatchToggleBtn = document.getElementById('temp-inbox-batch-toggle-btn');
  const tempInboxBatchAction = document.getElementById('temp-inbox-batch-action');
  const tempInboxBatchDeleteBtn = document.getElementById('temp-inbox-batch-delete-btn');
  const tempInboxBatchCancelBtn = document.getElementById('temp-inbox-batch-cancel-btn');

  // ===================== MoeMail 元素 =====================
  const moePage = document.getElementById('moe-mail-page');
  const moeCreatePane = document.getElementById('moe-create-pane');
  const moeApiUrlInput = document.getElementById('moe-api-url');
  const moeApiKeyInput = document.getElementById('moe-api-key');
  const moeEmailNameInput = document.getElementById('moe-email-name');
  const moeDomainSelect = document.getElementById('moe-domain-select');
  const moeExpirySelect = document.getElementById('moe-expiry-select');
  const moeCreateBtn = document.getElementById('moe-create-btn');
  const moeCreateMessage = document.getElementById('moe-create-message');
  const moeEmailListSection = document.getElementById('moe-email-list-section');
  const moeEmailListDiv = document.getElementById('moe-email-list');
  const moeMarkAllReadBtn = document.getElementById('moe-mark-all-read-btn');
  const moeRefreshBtn = document.getElementById('moe-refresh-btn');
  const moeInboxPane = document.getElementById('moe-inbox-pane');
  const moeInboxTitle = document.getElementById('moe-inbox-title');
  const moeMailList = document.getElementById('moe-mail-list');
  const moeMailContent = document.getElementById('moe-mail-content');
  const moeBackToListBtn = document.getElementById('moe-back-to-list');
  const moeMailFrom = document.getElementById('moe-mail-from');
  const moeMailSubject = document.getElementById('moe-mail-subject');
  const moeMailTime = document.getElementById('moe-mail-time');
  const toggleMoeMailViewBtn = document.getElementById('toggle-moe-mail-view-btn');
  const toggleMoeMailImagesBtn = document.getElementById('toggle-moe-mail-images-btn');
  const moeMailInsights = document.getElementById('moe-mail-insights');
  const moeMailBody = document.getElementById('moe-mail-body');
  const moeRefreshInboxBtn = document.getElementById('moe-refresh-inbox-btn');
  const moeRetryDomainsBtn = document.getElementById('moe-retry-domains-btn');
  const translateMoeMailBtn = document.getElementById('translate-moe-mail-btn');
  const moeMailTranslation = document.getElementById('moe-mail-translation');
  const moeMailTranslationTitle = document.getElementById('moe-mail-translation-title');
  const moeMailTranslationBody = document.getElementById('moe-mail-translation-body');
  const copyMoeMailTranslationBtn = document.getElementById('copy-moe-mail-translation-btn');
  const retranslateMoeMailBtn = document.getElementById('retranslate-moe-mail-btn');

  // MoeMail Batch UI
  const moeHistoryBatchToggleBtn = document.getElementById('moe-history-batch-toggle-btn');
  const moeHistoryBatchAction = document.getElementById('moe-history-batch-action');
  const moeHistoryBatchDeleteBtn = document.getElementById('moe-history-batch-delete-btn');
  const moeHistoryBatchCancelBtn = document.getElementById('moe-history-batch-cancel-btn');

  // ===================== 书签元素 =====================
  const bookmarksPage = document.getElementById('bookmarks-page');
  const bmNameInput = document.getElementById('bm-name-input');
  const bmUrlInput = document.getElementById('bm-url-input');
  const bmAddBtn = document.getElementById('bm-add-btn');
  const bmMessage = document.getElementById('bm-message');
  const bmListDiv = document.getElementById('bm-list');
  const bmSortSelect = document.getElementById('bm-sort-select');

  // ===================== 工具元素 =====================
  const toolsPage = document.getElementById('tools-page');
  const fastFillPage = document.getElementById('fast-fill-page');
  const generatedHistoryPage = document.getElementById('generated-history-page');
  const toolsGeneratedHistorySlot = document.getElementById('tools-generated-history-slot');
  const generatedHistoryPageSlot = document.getElementById('generated-history-page-slot');
  const generatedHistorySection = document.getElementById('generated-history-section');
  const generatedHistoryList = document.getElementById('generated-history-list');
  const generatedHistorySearchInput = document.getElementById('generated-history-search');
  const clearGeneratedHistoryBtn = document.getElementById('clear-generated-history-btn');
  const generatedHistoryFilters = Array.from(document.querySelectorAll('#generated-history-filters [data-generated-filter]'));
  const fillRulesPage = document.getElementById('fill-rules-page');
  const toolsFillRulesSlot = document.getElementById('tools-fill-rules-slot');
  const fillRulesPageSlot = document.getElementById('fill-rules-page-slot');
  const fillRulesSection = document.getElementById('fill-rules-section');
  const fillProfileBtn = document.getElementById('fill-profile-btn');
  const fillProfileMessage = document.getElementById('fill-profile-message');
  const fillRulesSite = document.getElementById('fill-rules-site');
  const fillRulesList = document.getElementById('fill-rules-list');
  const fillRulesMessage = document.getElementById('fill-rules-message');

  // ===================== 一键填充页面元素 =====================
  const fastFillSite = document.getElementById('fast-fill-site');
  const fastFillRulesSummary = document.getElementById('fast-fill-rules-summary');
  const fastFillEmailSourceEl = document.getElementById('fast-fill-email-source');
  const fastFillDomainModeEl = document.getElementById('fast-fill-domain-mode');
  const fastFillDomainSelect = document.getElementById('fast-fill-domain-select');
  const fastFillDomainSpecificRow = document.getElementById('fast-fill-domain-specific-row');
  const fastFillDomainWhitelistRow = document.getElementById('fast-fill-domain-whitelist-row');
  const fastFillDomainBlacklistRow = document.getElementById('fast-fill-domain-blacklist-row');
  const fastFillDomainWhitelistEl = document.getElementById('fast-fill-domain-whitelist');
  const fastFillDomainBlacklistEl = document.getElementById('fast-fill-domain-blacklist');
  const fastFillDomainWhitelistList = document.getElementById('fast-fill-domain-whitelist-list');
  const fastFillDomainBlacklistList = document.getElementById('fast-fill-domain-blacklist-list');
  const fastFillMoeExpiryRow = document.getElementById('fast-fill-moe-expiry-row');
  const fastFillMoeExpiry = document.getElementById('fast-fill-moe-expiry');
  const fastFillTempExpiryRow = document.getElementById('fast-fill-temp-expiry-row');
  const fastFillTempExpiry = document.getElementById('fast-fill-temp-expiry');
  const fastFillDomainStatus = document.getElementById('fast-fill-domain-status');
  const fastFillGenerateBtn = document.getElementById('fast-fill-generate-btn');
  const fastFillMessage = document.getElementById('fast-fill-message');
  const fastFillResult = document.getElementById('fast-fill-result');
  const fastFillHistoryList = document.getElementById('fast-fill-history-list');

  // ===================== 风格页面元素 =====================
  const themesPage = document.getElementById('themes-page');

  // ===================== 统一设置页元素 =====================
  const settingsPage = document.getElementById('settings-page');
  const configIOPage = document.getElementById('config-io-page');
  const settingsConfigIOSlot = document.getElementById('settings-config-io-slot');
  const configIOPageSlot = document.getElementById('config-io-page-slot');
  const configIOSection = document.getElementById('config-io-section');
  const apiUrlInput = document.getElementById('api-url');
  const adminTokenInput = document.getElementById('admin-token');
  const testTempConnectionBtn = document.getElementById('test-temp-connection-btn');
  const tempConnectionMessage = document.getElementById('temp-connection-message');
  const testMoeConnectionBtn = document.getElementById('test-moe-connection-btn');
  const moeConnectionMessage = document.getElementById('moe-connection-message');
  const saveSettingsBtn = document.getElementById('save-settings');
  const settingsMessage = document.getElementById('settings-message');
  const floatToggle = document.getElementById('float-toggle');
  const floatWindowStyleToggle = document.getElementById('float-window-style-toggle');
  const floatWindowStyleBtns = floatWindowStyleToggle
    ? Array.from(floatWindowStyleToggle.querySelectorAll('[data-float-window-style]'))
    : [];
  const defaultTabSelect = document.getElementById('default-tab-select');
  const tabLayoutToggle = document.getElementById('tab-layout-toggle');
  const tabLayoutModeBtns = Array.from(document.querySelectorAll('#tab-layout-toggle [data-layout-mode]'));
  const themePicker = document.getElementById('theme-picker');
  const themeSwatches = themePicker ? Array.from(themePicker.querySelectorAll('.theme-swatch')) : [];
  const verifyIntervalSelect = document.getElementById('verify-interval-select');
  const verifyIntervalCustomInput = document.getElementById('verify-interval-custom');
  const verifyIntervalUnitSelect = document.getElementById('verify-interval-unit');
  const mailPollingIntervalSelect = document.getElementById('mail-polling-interval-select');
  const mailPollingIntervalCustomInput = document.getElementById('mail-polling-interval-custom');
  const mailPollingIntervalUnitSelect = document.getElementById('mail-polling-interval-unit');
  const notificationsToggle = document.getElementById('notifications-toggle');
  const defaultRemoteImagesToggle = document.getElementById('default-remote-images-toggle');
  const translationApiBaseInput = document.getElementById('translation-api-base');
  const translationApiKeyInput = document.getElementById('translation-api-key');
  const translationModelInput = document.getElementById('translation-model');
  const translationTargetLanguageInput = document.getElementById('translation-target-language');
  const mailInsightApiModeSelect = document.getElementById('mail-insight-api-mode');
  const mailInsightCustomApiFields = document.getElementById('mail-insight-custom-api-fields');
  const mailInsightApiBaseInput = document.getElementById('mail-insight-api-base');
  const mailInsightApiKeyInput = document.getElementById('mail-insight-api-key');
  const mailInsightModelInput = document.getElementById('mail-insight-model');
  const fetchTranslationModelsBtn = document.getElementById('fetch-translation-models-btn');
  const translationModelSelect = document.getElementById('translation-model-select');
  const fetchInsightModelsBtn = document.getElementById('fetch-insight-models-btn');
  const mailInsightModelSelect = document.getElementById('mail-insight-model-select');
  const generatedResultAutoCloseSecondsInput = document.getElementById('generated-result-auto-close-seconds');
  const siteAccessModeSelect = document.getElementById('site-access-mode');
  const currentSiteOriginDiv = document.getElementById('current-site-origin');
  const currentSiteStatusDiv = document.getElementById('current-site-status');
  const currentSiteToggleBtn = document.getElementById('current-site-toggle-btn');
  const siteBlocklistTextarea = document.getElementById('site-blocklist-patterns');

  // ===================== 状态 =====================
  const MAX_HISTORY = 20;
  const MIN_INTERVAL_SECONDS = 30;
  const MAX_INTERVAL_SECONDS = 24 * 60 * 60;
  const DISABLED_INTERVAL_SETTING = Object.freeze({ value: 0, unit: 'minutes' });
  const DEFAULT_MAIL_POLL_INTERVAL = Object.freeze({ value: 5, unit: 'minutes' });
  const INTERVAL_UNIT_DEFS = Object.freeze({
    seconds: Object.freeze({ label: '秒', multiplier: 1, min: MIN_INTERVAL_SECONDS, max: MAX_INTERVAL_SECONDS }),
    minutes: Object.freeze({ label: '分钟', multiplier: 60, min: 1, max: MAX_INTERVAL_SECONDS / 60 }),
    hours: Object.freeze({ label: '小时', multiplier: 3600, min: 1, max: MAX_INTERVAL_SECONDS / 3600 })
  });

  mailInsightApiModeSelect.addEventListener('change', () => {
    mailInsightApiMode = normalizeMailInsightApiMode(mailInsightApiModeSelect.value);
    syncMailInsightApiFieldsVisibility();
  });
  const VERIFY_INTERVAL_PRESETS = Object.freeze([
    Object.freeze({ key: '0', value: 0, unit: 'minutes' }),
    Object.freeze({ key: '30s', value: 30, unit: 'seconds' }),
    Object.freeze({ key: '1m', value: 1, unit: 'minutes' }),
    Object.freeze({ key: '5m', value: 5, unit: 'minutes' }),
    Object.freeze({ key: '15m', value: 15, unit: 'minutes' }),
    Object.freeze({ key: '30m', value: 30, unit: 'minutes' }),
    Object.freeze({ key: '1h', value: 1, unit: 'hours' })
  ]);
  const MAIL_POLL_INTERVAL_PRESETS = Object.freeze([
    Object.freeze({ key: '0', value: 0, unit: 'minutes' }),
    Object.freeze({ key: '30s', value: 30, unit: 'seconds' }),
    Object.freeze({ key: '1m', value: 1, unit: 'minutes' }),
    Object.freeze({ key: '5m', value: 5, unit: 'minutes' }),
    Object.freeze({ key: '10m', value: 10, unit: 'minutes' }),
    Object.freeze({ key: '30m', value: 30, unit: 'minutes' }),
    Object.freeze({ key: '1h', value: 1, unit: 'hours' })
  ]);
  const TAB_LAYOUT_MODE_KEY = 'tabLayoutMode';
  const TAB_LAYOUT_MODES = Object.freeze({
    TOP: 'top',
    SIDEBAR: 'sidebar'
  });
  const FLOAT_WINDOW_STYLE_KEY = 'floatWindowStyle';
  const FLOAT_WINDOW_STYLES = Object.freeze({
    LEGACY: 'legacy',
    MODERN: 'modern'
  });
  const GENERATED_RESULT_AUTO_CLOSE_KEY = 'generatedToolAutoCloseSeconds';
  const GENERATED_HISTORY_KEY = 'generatedToolHistory';
  const DEFAULT_GENERATED_RESULT_AUTO_CLOSE_SECONDS = 30;
  const MIN_GENERATED_RESULT_AUTO_CLOSE_SECONDS = 1;
  const MAX_GENERATED_RESULT_AUTO_CLOSE_SECONDS = 3600;
  const MAX_GENERATED_HISTORY_PER_KIND = 100;
  const MAX_GENERATED_HISTORY_TOTAL = 300;
  const PAGE_FILL_RULES_KEY = 'pageFillRules';
  const TEMP_MAIL_META_KEY = 'tempMailMeta';
  const DEFAULT_FF_TEMP_EXPIRY_KEY = 'defaultFfTempExpiry';
  const DEFAULT_FF_MOE_EXPIRY_KEY = 'defaultFfMoeExpiry';
  const DEFAULT_TEMP_EXPIRY_KEY = 'defaultTempExpiry';
  const DEFAULT_MOE_EXPIRY_KEY = 'defaultMoeExpiry';
  const THEME_KEY = 'theme';
  const TRANSLATION_API_BASE_KEY = 'translationApiBase';
  const TRANSLATION_API_KEY_KEY = 'translationApiKey';
  const TRANSLATION_MODEL_KEY = 'translationModel';
  const TRANSLATION_TARGET_LANGUAGE_KEY = 'translationTargetLanguage';
  const MAIL_INSIGHT_API_MODE_KEY = 'mailInsightApiMode';
  const MAIL_INSIGHT_API_BASE_KEY = 'mailInsightApiBase';
  const MAIL_INSIGHT_API_KEY_KEY = 'mailInsightApiKey';
  const MAIL_INSIGHT_MODEL_KEY = 'mailInsightModel';
  const DEFAULT_TRANSLATION_API_BASE = 'https://api.openai.com/v1';
  const DEFAULT_TRANSLATION_TARGET_LANGUAGE = '简体中文';
  const DEFAULT_MAIL_INSIGHT_API_MODE = 'translation';
  const MAX_TRANSLATION_SOURCE_CHARS = 12000;
  const GENERATED_PROFILE_KEY = 'generatedProfile';
  const GENERATED_HISTORY_KINDS = new Set(['password', 'name', 'birthday', 'age', 'address']);
  const PAGE_FILL_FIELD_DEFS = [
    { kind: 'email', label: '邮箱', pickLabel: '邮箱输入框' },
    { kind: 'password', label: '密码', pickLabel: '密码输入框' },
    { kind: 'confirmPassword', label: '重复密码', pickLabel: '重复密码输入框' },
    { kind: 'verificationCode', label: '验证码', pickLabel: '验证码输入框' },
    { kind: 'name', label: '姓名', pickLabel: '姓名输入框' },
    { kind: 'lastName', label: '姓', pickLabel: '姓输入框' },
    { kind: 'firstName', label: '名', pickLabel: '名输入框' },
    { kind: 'birthday', label: '生日', pickLabel: '生日输入框' },
    { kind: 'age', label: '年龄', pickLabel: '年龄输入框' },
    { kind: 'address', label: '住址', pickLabel: '住址输入框' }
  ];
  let currentTheme = 'ocean-blue';
  let currentFloatWindowStyle = FLOAT_WINDOW_STYLES.MODERN;
  let activeTab = 'temp-email'; // 当前激活的选项卡

  // Temp Email 状态
  let apiUrl = '';
  let adminToken = '';
  let history = [];
  let tempMailMeta = {};
  let defaultFfTempExpiry = '86400000';
  let defaultFfMoeExpiry = '86400000';
  let defaultTempExpiry = '86400000';
  let defaultMoeExpiry = '86400000';
  // 验证状态: { [address]: 'valid' | 'invalid' | 'checking' | 'error' }
  let verifyStatus = {};
  let tempUnreadCounts = {};
  let currentMailId = null;
  let currentInboxAddress = null;
  let currentTempMails = [];
  let currentTempMail = null;
  let tempMailDetailRequestToken = 0;
  let tempMailViewMode = 'safe-html';
  let tempMailAllowRemoteImages = false;
  let tempMailTranslationText = '';
  let tempMailTranslationRequestToken = 0;
  let tempMailAiInsights = null;
  let tempMailInsightStatus = 'idle';
  let tempMailInsightError = '';
  let tempMailInsightRequestToken = 0;

  // MoeMail 状态
  let moeApiUrl = '';
  let moeApiKey = '';
  let moeCurrentEmailId = null;
  let currentMoeEmails = [];
  let moeUnreadCounts = {};
  let currentMoeMail = null;
  let moeMailViewMode = 'safe-html';
  let moeMailAllowRemoteImages = false;
  let moeMailTranslationText = '';
  let moeMailTranslationRequestToken = 0;
  let moeMailAiInsights = null;
  let moeMailInsightStatus = 'idle';
  let moeMailInsightError = '';
  let moeMailInsightRequestToken = 0;

  // 书签状态
  let bookmarks = [];
  let bookmarkSort = 'custom'; // 'custom' | 'time-desc' | 'time-asc' | 'name-asc'
  let draggedBmIndex = null;

  // 页面协同与后台状态
  let generatedProfile = normalizeGeneratedProfile();
  let generatedToolHistory = [];
  let generatedHistoryFilter = 'all';
  let generatedHistorySearchTerm = '';
  let mailPollingInterval = { ...DEFAULT_MAIL_POLL_INTERVAL };
  let notificationsEnabled = true;
  let defaultRemoteImagesEnabled = false;
  let translationApiBase = DEFAULT_TRANSLATION_API_BASE;
  let translationApiKey = '';
  let translationModel = '';
  let translationTargetLanguage = DEFAULT_TRANSLATION_TARGET_LANGUAGE;
  let mailInsightApiMode = DEFAULT_MAIL_INSIGHT_API_MODE;
  let mailInsightApiBase = DEFAULT_TRANSLATION_API_BASE;
  let mailInsightApiKey = '';
  let mailInsightModel = '';
  let generatedResultAutoCloseSeconds = DEFAULT_GENERATED_RESULT_AUTO_CLOSE_SECONDS;
  let siteAccessMode = 'all';
  let siteAllowlist = [];
  let siteBlocklist = [];
  let tabLayoutMode = TAB_LAYOUT_MODES.SIDEBAR;
  let currentSiteOrigin = '';
  let pageFillRules = {};

  // 批量删除状态
  let isTempHistoryBatchMode = false;
  let selectedTempHistory = new Set();
  
  let isTempInboxBatchMode = false;
  let selectedTempMails = new Set();
  
  let isMoeHistoryBatchMode = false;
  let selectedMoeHistory = new Set();

  const storageGet = (keys) => new Promise((resolve) => {
    const localStorageApi = globalThis.chrome?.storage?.local;
    if (!localStorageApi) {
      resolve({});
      return;
    }
    localStorageApi.get(keys, resolve);
  });
  const storageSet = (items) => new Promise((resolve) => {
    const localStorageApi = globalThis.chrome?.storage?.local;
    if (!localStorageApi) {
      resolve();
      return;
    }
    localStorageApi.set(items, resolve);
  });
  const tabsQuery = (query) => new Promise((resolve) => chrome.tabs.query(query, resolve));
  let clearToolResultState = () => {};
  function splitGeneratedFullName(fullName) {
    const normalizedFullName = typeof fullName === 'string' ? fullName.trim() : '';
    if (!normalizedFullName) {
      return { firstName: '', lastName: '' };
    }

    const parts = normalizedFullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return {
        firstName: parts.slice(0, -1).join(' '),
        lastName: parts[parts.length - 1] || ''
      };
    }

    const compactName = normalizedFullName.replace(/\s+/g, '');
    if (/^[\u3400-\u9fff]{2,6}$/.test(compactName)) {
      return {
        firstName: compactName.slice(1),
        lastName: compactName.slice(0, 1)
      };
    }

    return { firstName: '', lastName: '' };
  }
  function normalizeGeneratedProfile(profile = {}) {
    const fullName = typeof profile?.fullName === 'string' ? profile.fullName : '';
    const derivedNameParts = splitGeneratedFullName(fullName);
    return {
      email: typeof profile?.email === 'string' ? profile.email : '',
      password: typeof profile?.password === 'string' ? profile.password : '',
      confirmPassword: typeof profile?.confirmPassword === 'string' ? profile.confirmPassword : '',
      fullName,
      firstName: typeof profile?.firstName === 'string' ? profile.firstName : derivedNameParts.firstName,
      lastName: typeof profile?.lastName === 'string' ? profile.lastName : derivedNameParts.lastName,
      birthday: typeof profile?.birthday === 'string' ? profile.birthday : '',
      age: typeof profile?.age === 'string' ? profile.age : '',
      address: typeof profile?.address === 'string' ? profile.address : ''
    };
  }
  function createGeneratedHistoryId() {
    return `generated_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function normalizeGeneratedHistoryKind(kind) {
    return GENERATED_HISTORY_KINDS.has(kind) ? kind : '';
  }
  function normalizeGeneratedHistoryFilter(filter) {
    return filter === 'all' || GENERATED_HISTORY_KINDS.has(filter) ? filter : 'all';
  }
  function normalizeGeneratedHistoryEntry(entry = {}) {
    const kind = normalizeGeneratedHistoryKind(entry?.kind);
    const value = typeof entry?.value === 'string' ? entry.value.trim() : '';
    if (!kind || !value) {
      return null;
    }
    const rawCreatedAt = Number(entry?.createdAt);
    return {
      id: typeof entry?.id === 'string' && entry.id ? entry.id : createGeneratedHistoryId(),
      kind,
      value,
      pageTitle: typeof entry?.pageTitle === 'string' ? entry.pageTitle.trim() : '',
      url: typeof entry?.url === 'string' ? entry.url.trim() : '',
      createdAt: Number.isFinite(rawCreatedAt) && rawCreatedAt > 0 ? rawCreatedAt : Date.now()
    };
  }
  function normalizeGeneratedToolHistory(entries = []) {
    if (!Array.isArray(entries)) {
      return [];
    }
    const countsByKind = {
      password: 0,
      name: 0,
      birthday: 0,
      age: 0,
      address: 0
    };
    const normalizedEntries = [];
    entries
      .map((entry) => normalizeGeneratedHistoryEntry(entry))
      .filter(Boolean)
      .some((entry) => {
        if (normalizedEntries.length >= MAX_GENERATED_HISTORY_TOTAL) {
          return true;
        }
        if (countsByKind[entry.kind] >= MAX_GENERATED_HISTORY_PER_KIND) {
          return false;
        }
        countsByKind[entry.kind] += 1;
        normalizedEntries.push(entry);
        return false;
      });
    return normalizedEntries;
  }
  function saveGeneratedToolHistory() {
    storageSet({ [GENERATED_HISTORY_KEY]: generatedToolHistory }).catch((error) => {
      console.error('保存生成历史失败', error);
    });
  }
  function getGeneratedHistoryKindLabel(kind) {
    const labels = {
      password: '密码',
      name: '姓名',
      birthday: '生日',
      age: '年龄',
      address: '住址'
    };
    return labels[kind] || '资料';
  }
  function formatGeneratedHistoryValue(entry) {
    if (!entry) {
      return '';
    }
    if (entry.kind === 'birthday') {
      return formatBirthdayResult(entry.value);
    }
    if (entry.kind === 'age') {
      return `${entry.value} 岁`;
    }
    if (entry.kind === 'address') {
      return entry.value;
    }
    return entry.value;
  }
  function formatGeneratedHistoryTime(timestamp) {
    if (!Number.isFinite(timestamp)) {
      return '时间未知';
    }
    return new Date(timestamp).toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
  function appendGeneratedToolHistory(entry) {
    const normalizedEntry = normalizeGeneratedHistoryEntry(entry);
    if (!normalizedEntry) {
      return;
    }
    generatedToolHistory = normalizeGeneratedToolHistory([normalizedEntry, ...generatedToolHistory]);
    renderGeneratedToolHistory();
    saveGeneratedToolHistory();
  }
  function removeGeneratedHistoryEntry(entryId) {
    if (!entryId) {
      return;
    }
    generatedToolHistory = generatedToolHistory.filter((entry) => entry.id !== entryId);
    renderGeneratedToolHistory();
    saveGeneratedToolHistory();
  }
  async function appendGeneratedHistory(entry) {
    const tab = await getActiveTab().catch(() => null);
    appendGeneratedToolHistory({
      ...entry,
      pageTitle: typeof tab?.title === 'string' && tab.title.trim() ? tab.title.trim() : '标签页',
      url: typeof tab?.url === 'string' ? tab.url : ''
    });
  }
  function renderGeneratedToolHistory() {
    if (!generatedHistoryList) {
      return;
    }

    const normalizedFilter = normalizeGeneratedHistoryFilter(generatedHistoryFilter);
    generatedHistoryFilter = normalizedFilter;
    const normalizedSearchTerm = (generatedHistorySearchTerm || '').trim();
    const searchKeyword = normalizedSearchTerm.toLowerCase();
    generatedHistorySearchTerm = normalizedSearchTerm;
    if (generatedHistorySearchInput && generatedHistorySearchInput.value !== generatedHistorySearchTerm) {
      generatedHistorySearchInput.value = generatedHistorySearchTerm;
    }
    generatedHistoryFilters.forEach((btn) => {
      const isActive = btn.dataset.generatedFilter === normalizedFilter;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    clearGeneratedHistoryBtn?.classList.toggle('hidden', generatedToolHistory.length === 0);
    generatedHistoryList.innerHTML = '';

    if (generatedToolHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'generated-history-empty';
      empty.textContent = '暂无生成记录';
      generatedHistoryList.appendChild(empty);
      return;
    }

    const filteredHistory = generatedToolHistory.filter((entry) => {
      if (normalizedFilter !== 'all' && entry.kind !== normalizedFilter) {
        return false;
      }
      if (!searchKeyword) {
        return true;
      }
      const searchableText = [
        entry.value,
        entry.pageTitle,
        entry.url,
        getGeneratedHistoryKindLabel(entry.kind)
      ].join('\n').toLowerCase();
      return searchableText.includes(searchKeyword);
    });

    if (filteredHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'generated-history-empty';
      empty.textContent = normalizedSearchTerm ? '没有匹配的生成历史' : '当前筛选下暂无记录';
      generatedHistoryList.appendChild(empty);
      return;
    }

    filteredHistory.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'generated-history-item';

      const main = document.createElement('div');
      main.className = 'generated-history-item-main';

      const topRow = document.createElement('div');
      topRow.className = 'generated-history-item-top';

      const kindBadge = document.createElement('span');
      kindBadge.className = 'generated-history-kind';
      kindBadge.dataset.kind = entry.kind;
      kindBadge.textContent = getGeneratedHistoryKindLabel(entry.kind);

      const value = document.createElement('div');
      value.className = 'generated-history-value';
      value.textContent = formatGeneratedHistoryValue(entry);

      const meta = document.createElement('div');
      meta.className = 'generated-history-meta';

      const pageTitle = document.createElement('span');
      pageTitle.className = 'generated-history-page-title';
      pageTitle.textContent = `页面：${entry.pageTitle || '未记录页面名称'}`;
      pageTitle.title = entry.pageTitle || '未记录页面名称';

      const url = document.createElement('span');
      url.className = 'generated-history-url';
      url.textContent = `网址：${entry.url || '未记录网址'}`;
      url.title = entry.url || '未记录网址';

      const time = document.createElement('span');
      time.className = 'generated-history-time';
      time.textContent = `时间：${formatGeneratedHistoryTime(entry.createdAt)}`;

      meta.appendChild(pageTitle);
      meta.appendChild(url);
      meta.appendChild(time);
      topRow.appendChild(kindBadge);
      main.appendChild(topRow);
      main.appendChild(value);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'generated-history-item-actions';

      const historyFillActions = getGeneratedHistoryFillActions(entry);
      historyFillActions.forEach((action) => {
        const fillBtn = document.createElement('button');
        fillBtn.type = 'button';
        fillBtn.className = 'tool-result-action generated-history-fill-action';
        fillBtn.title = action.title || action.label || getFillActionLabel(action.kind);
        fillBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/><path d="M5 3h14"/></svg><span>${action.label || getFillActionLabel(action.kind)}</span>`;
        fillBtn.addEventListener('click', () => {
          fillGeneratedHistoryAction(action, fillBtn).catch(() => {});
        });
        bindFillPreview(fillBtn, { kind: action.kind });
        actions.appendChild(fillBtn);
      });

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'icon-btn';
      copyBtn.title = '复制';
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      copyBtn.addEventListener('click', () => copyToClipboard(entry.value, copyBtn));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn generated-history-delete-btn';
      deleteBtn.title = '删除记录';
      deleteBtn.setAttribute('aria-label', '删除记录');
      deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
      deleteBtn.addEventListener('click', () => {
        removeGeneratedHistoryEntry(entry.id);
      });

      actions.appendChild(copyBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(main);
      item.appendChild(actions);
      generatedHistoryList.appendChild(item);
    });
  }
  function setGeneratedHistoryFilter(filter) {
    generatedHistoryFilter = normalizeGeneratedHistoryFilter(filter);
    renderGeneratedToolHistory();
  }
  function setGeneratedHistorySearchTerm(searchTerm) {
    generatedHistorySearchTerm = typeof searchTerm === 'string' ? searchTerm : '';
    renderGeneratedToolHistory();
  }
  function saveGeneratedProfile() {
    storageSet({ [GENERATED_PROFILE_KEY]: generatedProfile }).catch((error) => {
      console.error('保存最近生成的资料失败', error);
    });
  }
  function updateGeneratedProfile(patch) {
    const nextProfile = normalizeGeneratedProfile({ ...generatedProfile, ...patch });
    if (Object.prototype.hasOwnProperty.call(patch, 'password')
      && !Object.prototype.hasOwnProperty.call(patch, 'confirmPassword')) {
      nextProfile.confirmPassword = nextProfile.password;
    }
    generatedProfile = nextProfile;
    updateFillProfileButton();
    saveGeneratedProfile();
  }
  function getFillActionLabel(kind) {
    const labels = {
      email: '填入邮箱',
      password: '填入密码',
      confirmPassword: '填入重复密码',
      verificationCode: '填入验证码',
      name: '填入姓名',
      firstName: '填入名',
      lastName: '填入姓',
      birthday: '填入生日',
      age: '填入年龄',
      address: '填入住址'
    };
    return labels[kind] || '填入当前页面';
  }
  function getPasswordFillActions(passwordValue, confirmPasswordValue = passwordValue) {
    return [
      {
        kind: 'password',
        value: passwordValue,
        label: getFillActionLabel('password')
      },
      {
        kind: 'confirmPassword',
        value: confirmPasswordValue,
        label: getFillActionLabel('confirmPassword')
      }
    ];
  }
  function getNameFillActions(fullNameValue, firstNameValue = '', lastNameValue = '') {
    const actions = [];
    if (fullNameValue) {
      actions.push({
        kind: 'name',
        value: fullNameValue,
        label: getFillActionLabel('name')
      });
    }
    if (lastNameValue) {
      actions.push({
        kind: 'lastName',
        value: lastNameValue,
        label: getFillActionLabel('lastName')
      });
    }
    if (firstNameValue) {
      actions.push({
        kind: 'firstName',
        value: firstNameValue,
        label: getFillActionLabel('firstName')
      });
    }
    return actions;
  }
  function getBirthdayFillActions(birthdayValue, ageValue = '') {
    const actions = [];
    if (birthdayValue) {
      actions.push({
        kind: 'birthday',
        value: birthdayValue,
        label: getFillActionLabel('birthday')
      });
    }
    if (ageValue) {
      actions.push({
        kind: 'age',
        value: ageValue,
        label: getFillActionLabel('age')
      });
    }
    return actions;
  }
  function getAddressFillActions(addressValue) {
    if (!addressValue) {
      return [];
    }
    return [{
      kind: 'address',
      value: addressValue,
      label: getFillActionLabel('address')
    }];
  }
  function getGeneratedHistoryFillActions(entry) {
    if (!entry?.value) {
      return [];
    }
    if (entry.kind === 'password') {
      return getPasswordFillActions(entry.value, entry.value);
    }
    if (entry.kind === 'name') {
      const nameParts = splitGeneratedFullName(entry.value);
      return getNameFillActions(entry.value, nameParts.firstName, nameParts.lastName);
    }
    if (entry.kind === 'birthday') {
      const ageValue = getAgeFromBirthday(entry.value);
      return getBirthdayFillActions(entry.value, ageValue ? String(ageValue) : '');
    }
    if (entry.kind === 'age') {
      return [{
        kind: 'age',
        value: entry.value,
        label: getFillActionLabel('age')
      }];
    }
    if (entry.kind === 'address') {
      return getAddressFillActions(entry.value);
    }
    return [];
  }
  async function fillGeneratedHistoryAction(action, button) {
    const originalHTML = button.innerHTML;
    button.disabled = true;
    try {
      await sendToActivePage({
        type: 'fill-value',
        kind: action.kind,
        value: action.value
      });
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg><span>已填入</span>';
      window.setTimeout(() => {
        button.innerHTML = originalHTML;
        button.disabled = false;
      }, 1200);
    } catch (error) {
      button.innerHTML = originalHTML;
      button.disabled = false;
      showMessage(fillProfileMessage, `填充失败: ${error.message}`, 'error');
    }
  }
  function formatBirthdayResult(dateStr) {
    const match = /^(\d{4})-\d{2}-\d{2}$/.exec(dateStr || '');
    if (!match) {
      return dateStr || '';
    }
    const age = getAgeFromBirthday(dateStr);
    return `${dateStr}（${age} 岁）`;
  }
  function getAgeFromBirthday(dateStr) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
    if (!match) {
      return '';
    }
    const today = new Date();
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    let age = today.getFullYear() - year;
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();
    if (currentMonth < month || (currentMonth === month && currentDay < day)) {
      age -= 1;
    }
    return age >= 0 ? age : '';
  }
  function normalizeGeneratedResultAutoCloseSeconds(value, fallback = DEFAULT_GENERATED_RESULT_AUTO_CLOSE_SECONDS) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.min(MAX_GENERATED_RESULT_AUTO_CLOSE_SECONDS, Math.max(MIN_GENERATED_RESULT_AUTO_CLOSE_SECONDS, parsed));
  }
  function readGeneratedResultAutoCloseSeconds() {
    const rawValue = generatedResultAutoCloseSecondsInput?.value?.trim() || '';
    if (!rawValue) {
      return DEFAULT_GENERATED_RESULT_AUTO_CLOSE_SECONDS;
    }
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed) || parsed < MIN_GENERATED_RESULT_AUTO_CLOSE_SECONDS || parsed > MAX_GENERATED_RESULT_AUTO_CLOSE_SECONDS) {
      throw new Error(`生成结果自动关闭时间需在 ${MIN_GENERATED_RESULT_AUTO_CLOSE_SECONDS}-${MAX_GENERATED_RESULT_AUTO_CLOSE_SECONDS} 秒之间`);
    }
    return parsed;
  }
  function syncGeneratedResultAutoCloseInput(value = generatedResultAutoCloseSeconds) {
    if (generatedResultAutoCloseSecondsInput) {
      generatedResultAutoCloseSecondsInput.value = String(normalizeGeneratedResultAutoCloseSeconds(value));
    }
  }
  function getGeneratedResultContainer(kind) {
    if (kind === 'password') {
      return pwdResult;
    }
    if (kind === 'name') {
      return nameResult;
    }
    if (kind === 'birthday') {
      return bdayResult;
    }
    if (kind === 'address') {
      return addrResult;
    }
    return null;
  }
  function dismissGeneratedResult(kind) {
    const patch = {};
    if (kind === 'password') {
      patch.password = '';
      patch.confirmPassword = '';
    } else if (kind === 'name') {
      patch.fullName = '';
      patch.firstName = '';
      patch.lastName = '';
    } else if (kind === 'birthday') {
      patch.birthday = '';
      patch.age = '';
    } else if (kind === 'address') {
      patch.address = '';
    } else {
      return;
    }
    updateGeneratedProfile(patch);
    hideToolResult(getGeneratedResultContainer(kind));
  }
  function hideToolResult(container) {
    if (!container) {
      return;
    }
    clearToolResultState(container);
    container.classList.add('hidden');
    container.innerHTML = '';
  }
  function restoreGeneratedToolResults() {
    if (generatedProfile.password) {
      showToolResult(pwdResult, generatedProfile.password, {
        fillActions: getPasswordFillActions(
          generatedProfile.password,
          generatedProfile.confirmPassword || generatedProfile.password
        ),
        dismissKind: 'password'
      });
    } else {
      hideToolResult(pwdResult);
    }

    if (generatedProfile.fullName) {
      showToolResult(nameResult, generatedProfile.fullName, {
        fillActions: getNameFillActions(
          generatedProfile.fullName,
          generatedProfile.firstName,
          generatedProfile.lastName
        ),
        dismissKind: 'name'
      });
    } else {
      hideToolResult(nameResult);
    }

    if (generatedProfile.birthday || generatedProfile.age) {
      const birthdayAge = getAgeFromBirthday(generatedProfile.birthday);
      const ageValue = generatedProfile.age || (birthdayAge ? String(birthdayAge) : '');
      const displayText = generatedProfile.birthday
        ? formatBirthdayResult(generatedProfile.birthday)
        : `${ageValue} 岁`;
      showToolResult(bdayResult, displayText, {
        fillActions: getBirthdayFillActions(generatedProfile.birthday, ageValue),
        dismissKind: 'birthday'
      });
    } else {
      hideToolResult(bdayResult);
    }

    if (generatedProfile.address) {
      showToolResult(addrResult, generatedProfile.address, {
        fillActions: getAddressFillActions(generatedProfile.address),
        dismissKind: 'address'
      });
    } else {
      hideToolResult(addrResult);
    }
  }
  const runtimeSendMessage = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || '后台请求失败'));
        return;
      }
      resolve(response);
    });
  });
  async function proxiedFetch(url, init = {}) {
    const response = await runtimeSendMessage({
      type: 'proxy-fetch',
      url,
      init: {
        method: init.method || 'GET',
        headers: init.headers || {},
        body: init.body,
      },
    });
    const data = response?.data || {};
    return {
      ok: Boolean(data.ok),
      status: data.status || 0,
      statusText: data.statusText || '',
      json: async () => data.data ?? {},
      text: async () => data.text || '',
    };
  }
  const moeFetch = (url, init = {}) => proxiedFetch(url, init);
  const tabSendMessage = (tabId, message) => new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.error || '页面请求失败'));
        return;
      }
      resolve(response);
    });
  });
  const insertCssIntoTab = (tabId, files) => new Promise((resolve, reject) => {
    chrome.scripting.insertCSS({ target: { tabId }, files }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
  const executeScriptInTab = (tabId, files) => new Promise((resolve, reject) => {
    chrome.scripting.executeScript({ target: { tabId }, files }, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });

  const FLOAT_SELECT_MESSAGE_SOURCE = 'temp-email-floating-panel';
  let floatingSelectLockActive = false;
  let floatingFieldSelectionActive = false;
  let floatingFieldSelectionLabel = '';

  function setFloatingFieldSelectionState(active, label = '') {
    floatingFieldSelectionActive = window.top !== window && Boolean(active);
    floatingFieldSelectionLabel = floatingFieldSelectionActive ? (label || '输入框') : '';
  }

  function notifyFloatingHostSelectState(open) {
    if (window.top === window || floatingSelectLockActive === open) {
      return;
    }
    floatingSelectLockActive = open;
    try {
      window.parent.postMessage({
        source: FLOAT_SELECT_MESSAGE_SOURCE,
        type: 'floating-select-state',
        open
      }, '*');
    } catch {
      // 父页面不可达时忽略，不影响普通弹窗模式。
    }
  }

  function bindFloatingSelectScrollBridge() {
    const openSelectLock = () => notifyFloatingHostSelectState(true);
    const closeSelectLock = () => window.setTimeout(() => notifyFloatingHostSelectState(false), 0);

    document.querySelectorAll('select:not([data-no-scroll-lock])').forEach((selectElement) => {
      selectElement.addEventListener('pointerdown', openSelectLock);
      selectElement.addEventListener('mousedown', openSelectLock);
      selectElement.addEventListener('touchstart', openSelectLock, { passive: true });
      selectElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'F4') {
          openSelectLock();
        }
      });
      selectElement.addEventListener('change', closeSelectLock);
      selectElement.addEventListener('blur', closeSelectLock);
    });

    window.addEventListener('pagehide', () => notifyFloatingHostSelectState(false));
  }

  window.addEventListener('message', (event) => {
    if (window.top === window || event.source !== window.parent) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== FLOAT_SELECT_MESSAGE_SOURCE || data.type !== 'floating-field-selection-state') {
      return;
    }
    setFloatingFieldSelectionState(data.active, data.label);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !floatingFieldSelectionActive || window.top === window) {
      return;
    }

    const activeLabel = floatingFieldSelectionLabel || '输入框';
    setFloatingFieldSelectionState(false);
    event.preventDefault();
    event.stopPropagation();

    sendToActivePage({ type: 'cancel-field-selection' })
      .then(() => {
        showMessage(fillRulesMessage, `已取消${activeLabel}选取。`, 'info');
      })
      .catch((error) => {
        setFloatingFieldSelectionState(true, activeLabel);
        showMessage(fillRulesMessage, `取消失败: ${error.message}`, 'error');
      });
  }, true);

  // ===================== 选项卡切换 =====================
  const allPages = [fastFillPage, tempPage, moePage, bookmarksPage, toolsPage, generatedHistoryPage, fillRulesPage, themesPage, settingsPage, configIOPage];
  const MAIN_TABS = new Set(['fast-fill', 'temp-email', 'moe-mail', 'bookmarks', 'tools', 'generated-history', 'fill-rules', 'themes', 'settings', 'config-io']);

  function normalizeTabLayoutMode(mode) {
    return mode === TAB_LAYOUT_MODES.TOP ? TAB_LAYOUT_MODES.TOP : TAB_LAYOUT_MODES.SIDEBAR;
  }

  function isSidebarLayoutMode(mode = tabLayoutMode) {
    return normalizeTabLayoutMode(mode) === TAB_LAYOUT_MODES.SIDEBAR;
  }

  function normalizeTabForLayout(tab, mode = tabLayoutMode) {
    const fallbackTab = 'temp-email';
    const nextTab = MAIN_TABS.has(tab) ? tab : fallbackTab;
    if (nextTab === 'generated-history' && !isSidebarLayoutMode(mode)) {
      return 'tools';
    }
    if (nextTab === 'fill-rules' && !isSidebarLayoutMode(mode)) {
      return 'tools';
    }
    if (nextTab === 'config-io' && !isSidebarLayoutMode(mode)) {
      return 'settings';
    }
    return nextTab;
  }

  function mountGeneratedHistorySection(mode = tabLayoutMode) {
    if (!generatedHistorySection || !toolsGeneratedHistorySlot || !generatedHistoryPageSlot) {
      return;
    }
    const sidebarEnabled = isSidebarLayoutMode(mode);
    const targetSlot = sidebarEnabled ? generatedHistoryPageSlot : toolsGeneratedHistorySlot;
    if (generatedHistorySection.parentElement !== targetSlot) {
      targetSlot.appendChild(generatedHistorySection);
    }
    if (generatedHistoryTabBtn) {
      generatedHistoryTabBtn.classList.toggle('hidden', !sidebarEnabled);
    }
  }

  function mountFillRulesSection(mode = tabLayoutMode) {
    if (!fillRulesSection || !toolsFillRulesSlot || !fillRulesPageSlot) {
      return;
    }
    const sidebarEnabled = isSidebarLayoutMode(mode);
    const targetSlot = sidebarEnabled ? fillRulesPageSlot : toolsFillRulesSlot;
    if (fillRulesSection.parentElement !== targetSlot) {
      targetSlot.appendChild(fillRulesSection);
    }
    if (fillRulesTabBtn) {
      fillRulesTabBtn.classList.toggle('hidden', !sidebarEnabled);
    }
  }

  function mountConfigIOSection(mode = tabLayoutMode) {
    if (!configIOSection || !settingsConfigIOSlot || !configIOPageSlot) {
      return;
    }
    const sidebarEnabled = isSidebarLayoutMode(mode);
    const targetSlot = sidebarEnabled ? configIOPageSlot : settingsConfigIOSlot;
    if (configIOSection.parentElement !== targetSlot) {
      targetSlot.appendChild(configIOSection);
    }
    if (configIOTabBtn) {
      configIOTabBtn.classList.toggle('hidden', !sidebarEnabled);
    }
  }

  function syncTabLayoutToggle(mode) {
    const normalized = normalizeTabLayoutMode(mode);
    tabLayoutModeBtns.forEach((btn) => {
      const isActive = btn.dataset.layoutMode === normalized;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      btn.tabIndex = isActive ? 0 : -1;
    });
  }

  function applyTabLayoutMode(mode) {
    const normalized = normalizeTabLayoutMode(mode);
    tabLayoutMode = normalized;
    document.body.classList.remove('tab-layout-top', 'tab-layout-sidebar');
    document.body.classList.add(`tab-layout-${normalized}`);
    syncTabLayoutToggle(normalized);
    mountGeneratedHistorySection(normalized);
    mountFillRulesSection(normalized);
    mountConfigIOSection(normalized);
    const normalizedActiveTab = normalizeTabForLayout(activeTab, normalized);
    if (normalizedActiveTab !== activeTab) {
      switchTab(normalizedActiveTab, { persist: false });
      return;
    }
    if (!tabBar.classList.contains('hidden')) {
      updateHeaderForTab(normalizedActiveTab);
    }
  }

  function saveTabLayoutMode(mode) {
    const normalized = normalizeTabLayoutMode(mode);
    applyTabLayoutMode(normalized);
    storageSet({ [TAB_LAYOUT_MODE_KEY]: normalized });
  }

  function normalizeFloatWindowStyle(style) {
    return style === FLOAT_WINDOW_STYLES.LEGACY ? FLOAT_WINDOW_STYLES.LEGACY : FLOAT_WINDOW_STYLES.MODERN;
  }

  function syncFloatWindowStyleToggle(style) {
    const normalized = normalizeFloatWindowStyle(style);
    floatWindowStyleBtns.forEach((btn) => {
      const isActive = btn.dataset.floatWindowStyle === normalized;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      btn.tabIndex = isActive ? 0 : -1;
    });
  }

  function applyFloatingWindowStyle(style) {
    const normalized = normalizeFloatWindowStyle(style);
    currentFloatWindowStyle = normalized;
    const isFloatingHost = window.top !== window;
    document.documentElement.setAttribute('data-floating-window-style', normalized);
    document.body.classList.toggle('floating-hosted', isFloatingHost && normalized === FLOAT_WINDOW_STYLES.MODERN);
    document.body.classList.toggle('floating-style-modern', isFloatingHost && normalized === FLOAT_WINDOW_STYLES.MODERN);
    document.body.classList.toggle('floating-style-legacy', isFloatingHost && normalized === FLOAT_WINDOW_STYLES.LEGACY);
    syncFloatWindowStyleToggle(normalized);
  }

  function saveFloatingWindowStyle(style) {
    const normalized = normalizeFloatWindowStyle(style);
    applyFloatingWindowStyle(normalized);
    storageSet({ [FLOAT_WINDOW_STYLE_KEY]: normalized });
  }

  const VALID_THEMES = new Set(['ocean-blue', 'sakura-pink', 'emerald-green', 'lavender-purple', 'midnight-dark', 'sunset-orange', 'cyber-neon', 'mocha-brown', 'arctic-ice', 'rose-gold']);
  function normalizeTheme(theme) {
    return VALID_THEMES.has(theme) ? theme : 'ocean-blue';
  }

  function applyTheme(theme) {
    const normalized = normalizeTheme(theme);
    currentTheme = normalized;
    document.documentElement.setAttribute('data-theme', normalized);
    themeSwatches.forEach((swatch) => {
      const isActive = swatch.dataset.theme === normalized;
      swatch.classList.toggle('active', isActive);
      swatch.setAttribute('aria-checked', String(isActive));
    });
  }

  function saveTheme(theme) {
    const normalized = normalizeTheme(theme);
    applyTheme(normalized);
    storageSet({ [THEME_KEY]: normalized });
  }

  applyFloatingWindowStyle(currentFloatWindowStyle);

  function updateHeaderForTab(tab) {
    const activeBtn = Array.from(tabBtns).find((btn) => btn.dataset.tab === tab);
    mainTitle.textContent = activeBtn?.dataset.title || 'Email Tool';
    if (mainSubtitle) {
      mainSubtitle.textContent = activeBtn?.dataset.subtitle || '创建临时邮箱、查看邮件并快速填写网页表单。';
    }
  }

  function switchTab(tab, options = {}) {
    const nextTab = normalizeTabForLayout(tab);
    activeTab = nextTab;
    if (options.persist !== false) {
      chrome.storage.local.set({ activeTab: nextTab });
    }

    // 更新选项卡高亮
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === nextTab);
    });

    // 先关闭所有子视图状态
    closeInboxView();
    closeMoeInboxView();

    // 隐藏所有页面
    allPages.forEach(p => p.classList.add('hidden'));

    // 显示对应页面
    const pageMap = {
      'fast-fill': fastFillPage,
      'temp-email': tempPage,
      'moe-mail': moePage,
      'bookmarks': bookmarksPage,
      'tools': toolsPage,
      'generated-history': generatedHistoryPage,
      'fill-rules': fillRulesPage,
      'themes': themesPage,
      'settings': settingsPage,
      'config-io': configIOPage
    };
    if (pageMap[nextTab]) pageMap[nextTab].classList.remove('hidden');

    if (nextTab === 'fast-fill') {
      renderFastFillPage().catch(() => {});
    }

    backToHomeBtn.classList.add('hidden');
    updateHeaderForTab(nextTab);
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  function normalizeOrigin(rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!/^https?:$/.test(url.protocol)) return '';
      return url.origin;
    } catch {
      return '';
    }
  }

  function isHttpUrl(rawUrl) {
    return Boolean(normalizeOrigin(rawUrl));
  }

  /**
   * 从 URL 或 origin 中提取 hostname（不含端口）
   */
  function extractHostname(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
      const url = new URL(rawUrl);
      return url.hostname || '';
    } catch {
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
   * 支持：完整域名 (https://...)、通配符 (*.example.com)、关键词
   */
  function matchesSitePattern(rawUrl, pattern) {
    if (!rawUrl || !pattern) return false;
    const p = String(pattern).trim();
    if (!p) return false;

    // 完整 origin 精确匹配
    if (p.startsWith('http://') || p.startsWith('https://')) {
      try {
        const patternOrigin = new URL(p).origin;
        let origin;
        try { origin = new URL(rawUrl).origin; } catch { origin = rawUrl; }
        return patternOrigin === origin;
      } catch { return false; }
    }

    const hostname = extractHostname(rawUrl);
    if (!hostname) return false;

    // 通配符匹配
    if (p.startsWith('*.')) {
      const suffix = p.slice(2);
      if (!suffix) return false;
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }

    // 关键词匹配（忽略大小写）
    return hostname.toLowerCase().includes(p.toLowerCase());
  }

  function matchesAnySitePattern(rawUrl, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    return patterns.some(p => matchesSitePattern(rawUrl, p));
  }

  function isSiteAllowed(origin) {
    if (!origin) return false;
    const blocklist = Array.isArray(siteBlocklist) ? siteBlocklist : [];
    // 黑名单支持完整域名、通配符、关键词三种模式
    if (matchesAnySitePattern(origin, blocklist)) return false;
    if (siteAccessMode === 'whitelist') {
      const allowlist = Array.isArray(siteAllowlist) ? siteAllowlist : [];
      // 支持模式匹配 + 兼容旧的 origin 精确匹配
      if (matchesAnySitePattern(origin, allowlist)) return true;
      const allowlistOrigins = new Set(allowlist.map(normalizeOrigin).filter(Boolean));
      return allowlistOrigins.has(origin);
    }
    return true;
  }

  async function getActiveTab() {
    const tabs = await tabsQuery({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  async function ensurePageToolsInjected(tab) {
    if (!tab?.id || !isHttpUrl(tab.url)) {
      throw new Error('当前页面不支持页面助手');
    }

    try {
      await tabSendMessage(tab.id, { type: 'page-tools-ping' });
      return;
    } catch {
      // 页面尚未注入，继续按需注入。
    }

    try {
      await insertCssIntoTab(tab.id, ['content.css']);
    } catch {
      // CSS 重复注入时无需阻断。
    }
    await executeScriptInTab(tab.id, ['content.js']);
  }

  async function sendToActivePage(message) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      throw new Error('未找到当前标签页');
    }
    if (!isHttpUrl(tab.url)) {
      throw new Error('当前页面不是可注入的网页');
    }
    if (!isSiteAllowed(normalizeOrigin(tab.url))) {
      throw new Error('当前站点已被页面助手禁用');
    }

    await ensurePageToolsInjected(tab);
    return tabSendMessage(tab.id, message);
  }

  function normalizeIntervalValue(value, fallback = 0) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function parseWholeNumber(value) {
    const trimmed = String(value ?? '').trim();
    if (!trimmed) {
      return NaN;
    }
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) ? parsed : NaN;
  }

  function isIntervalUnit(unit) {
    return Object.prototype.hasOwnProperty.call(INTERVAL_UNIT_DEFS, unit);
  }

  function getIntervalUnitDef(unit) {
    return INTERVAL_UNIT_DEFS[isIntervalUnit(unit) ? unit : 'minutes'];
  }

  function cloneIntervalSetting(setting = DISABLED_INTERVAL_SETTING) {
    return {
      value: normalizeIntervalValue(setting?.value, 0),
      unit: isIntervalUnit(setting?.unit) ? setting.unit : 'minutes'
    };
  }

  function normalizeIntervalSetting(rawValue, fallbackSetting = DISABLED_INTERVAL_SETTING) {
    const fallback = cloneIntervalSetting(fallbackSetting);

    if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
      const unit = isIntervalUnit(rawValue.unit) ? rawValue.unit : fallback.unit;
      const unitDef = getIntervalUnitDef(unit);
      const parsedValue = parseWholeNumber(rawValue.value);
      if (Number.isFinite(parsedValue) && parsedValue > 0) {
        return {
          value: Math.max(unitDef.min, Math.min(unitDef.max, parsedValue)),
          unit
        };
      }
      if (normalizeIntervalValue(rawValue.value, 0) <= 0) {
        return { value: 0, unit: fallback.unit };
      }
    }

    const legacyMinutes = parseWholeNumber(rawValue);
    if (Number.isFinite(legacyMinutes)) {
      if (legacyMinutes <= 0) {
        return { value: 0, unit: fallback.unit };
      }
      return {
        value: Math.max(INTERVAL_UNIT_DEFS.minutes.min, Math.min(INTERVAL_UNIT_DEFS.minutes.max, legacyMinutes)),
        unit: 'minutes'
      };
    }

    if (fallback.value > 0) {
      return normalizeIntervalSetting(fallback, DISABLED_INTERVAL_SETTING);
    }

    return { value: 0, unit: fallback.unit };
  }

  function getIntervalPresetByKey(presets, key) {
    return presets.find((preset) => preset.key === key) || null;
  }

  function getIntervalPresetBySetting(presets, setting) {
    const normalized = normalizeIntervalSetting(setting, DISABLED_INTERVAL_SETTING);
    return presets.find((preset) => preset.value === normalized.value && preset.unit === normalized.unit) || null;
  }

  function updateIntervalCustomInputMeta(customInput, unitSelect) {
    const unitDef = getIntervalUnitDef(unitSelect.value);
    customInput.min = String(unitDef.min);
    customInput.max = String(unitDef.max);
    customInput.placeholder = unitDef.label;
  }

  function rememberCustomIntervalSetting(customInput, unitSelect) {
    const currentCustom = parseWholeNumber(customInput.value);
    if (Number.isFinite(currentCustom) && currentCustom > 0) {
      customInput.dataset.lastCustomValue = String(currentCustom);
    }
    if (isIntervalUnit(unitSelect.value)) {
      unitSelect.dataset.lastCustomUnit = unitSelect.value;
    }
  }

  function getIntervalCustomSeed(selectElement, customInput, unitSelect, presets, fallbackSetting = DISABLED_INTERVAL_SETTING) {
    const lastCustomValue = parseWholeNumber(customInput.dataset.lastCustomValue);
    const lastCustomUnit = isIntervalUnit(unitSelect.dataset.lastCustomUnit) ? unitSelect.dataset.lastCustomUnit : '';
    if (Number.isFinite(lastCustomValue) && lastCustomValue > 0 && lastCustomUnit) {
      return normalizeIntervalSetting({ value: lastCustomValue, unit: lastCustomUnit }, fallbackSetting);
    }

    const lastPreset = getIntervalPresetByKey(presets, selectElement.dataset.lastPresetKey);
    if (lastPreset) {
      return { value: lastPreset.value, unit: lastPreset.unit };
    }

    const fallback = normalizeIntervalSetting(fallbackSetting, { value: MIN_INTERVAL_SECONDS, unit: 'seconds' });
    if (fallback.value > 0) {
      return fallback;
    }
    return { value: MIN_INTERVAL_SECONDS, unit: 'seconds' };
  }

  function applyIntervalControl(selectElement, customInput, unitSelect, presets, rawValue, fallbackSetting = DISABLED_INTERVAL_SETTING) {
    const normalized = normalizeIntervalSetting(rawValue, fallbackSetting);
    const matchedPreset = getIntervalPresetBySetting(presets, normalized);

    if (matchedPreset) {
      selectElement.value = matchedPreset.key;
      selectElement.dataset.lastPresetKey = matchedPreset.key;
      unitSelect.value = matchedPreset.unit;
      updateIntervalCustomInputMeta(customInput, unitSelect);
      customInput.classList.add('hidden');
      unitSelect.classList.add('hidden');
      customInput.value = '';
      return { value: matchedPreset.value, unit: matchedPreset.unit };
    }

    if (normalized.value > 0) {
      selectElement.value = 'custom';
      unitSelect.value = normalized.unit;
      updateIntervalCustomInputMeta(customInput, unitSelect);
      customInput.classList.remove('hidden');
      unitSelect.classList.remove('hidden');
      customInput.value = String(normalized.value);
      customInput.dataset.lastCustomValue = String(normalized.value);
      unitSelect.dataset.lastCustomUnit = normalized.unit;
      return normalized;
    }

    selectElement.value = '0';
    selectElement.dataset.lastPresetKey = '0';
    unitSelect.value = unitSelect.dataset.lastCustomUnit || 'minutes';
    updateIntervalCustomInputMeta(customInput, unitSelect);
    customInput.classList.add('hidden');
    unitSelect.classList.add('hidden');
    customInput.value = '';
    return { value: 0, unit: 'minutes' };
  }

  function readIntervalControl(selectElement, customInput, unitSelect, presets, fieldLabel) {
    if (selectElement.value !== 'custom') {
      const preset = getIntervalPresetByKey(presets, selectElement.value);
      return preset ? { value: preset.value, unit: preset.unit } : { value: 0, unit: 'minutes' };
    }

    const unit = isIntervalUnit(unitSelect.value) ? unitSelect.value : 'minutes';
    const unitDef = getIntervalUnitDef(unit);
    const customValue = parseWholeNumber(customInput.value);
    if (!Number.isFinite(customValue) || customValue < unitDef.min || customValue > unitDef.max) {
      throw new Error(`${fieldLabel}需填写有效的${unitDef.label}整数，范围 ${unitDef.min} 到 ${unitDef.max}`);
    }

    const totalSeconds = customValue * unitDef.multiplier;
    if (totalSeconds < MIN_INTERVAL_SECONDS || totalSeconds > MAX_INTERVAL_SECONDS) {
      throw new Error(`${fieldLabel}需在 30 秒到 24 小时之间`);
    }

    return { value: customValue, unit };
  }

  function bindIntervalControl(selectElement, customInput, unitSelect, presets, fallbackSetting = DISABLED_INTERVAL_SETTING) {
    const handleModeChange = () => {
      if (selectElement.value === 'custom') {
        const seed = getIntervalCustomSeed(selectElement, customInput, unitSelect, presets, fallbackSetting);
        unitSelect.value = seed.unit;
        updateIntervalCustomInputMeta(customInput, unitSelect);
        customInput.classList.remove('hidden');
        unitSelect.classList.remove('hidden');
        if (!customInput.value) {
          customInput.value = String(seed.value);
        }
        customInput.focus();
        customInput.select();
        return;
      }

      rememberCustomIntervalSetting(customInput, unitSelect);
      const preset = getIntervalPresetByKey(presets, selectElement.value) || { value: 0, unit: 'minutes' };
      applyIntervalControl(selectElement, customInput, unitSelect, presets, preset, fallbackSetting);
    };

    selectElement.addEventListener('change', handleModeChange);
    unitSelect.addEventListener('change', () => {
      if (selectElement.value !== 'custom') {
        return;
      }
      updateIntervalCustomInputMeta(customInput, unitSelect);
      const unitDef = getIntervalUnitDef(unitSelect.value);
      const currentValue = parseWholeNumber(customInput.value);
      if (!Number.isFinite(currentValue) || currentValue < unitDef.min) {
        customInput.value = String(unitDef.min);
      } else if (currentValue > unitDef.max) {
        customInput.value = String(unitDef.max);
      }
      rememberCustomIntervalSetting(customInput, unitSelect);
      customInput.focus();
      customInput.select();
    });
    customInput.addEventListener('blur', () => {
      if (selectElement.value === 'custom') {
        rememberCustomIntervalSetting(customInput, unitSelect);
        if (!customInput.value.trim()) {
          return;
        }
        applyIntervalControl(
          selectElement,
          customInput,
          unitSelect,
          presets,
          { value: customInput.value, unit: unitSelect.value },
          fallbackSetting
        );
      }
    });
  }

  function getCurrentSiteFillRules() {
    return pageFillRules?.[currentSiteOrigin] || {};
  }

  function formatFillRuleSummary(rule) {
    if (!rule) {
      return '未设置，点击右侧按钮后回到网页选择输入框。';
    }
    const description = String(rule.description || rule.selector || '').trim();
    return description || '已设置规则';
  }

  function renderFillRuleManager() {
    if (!fillRulesSite || !fillRulesList) {
      return;
    }

    fillRulesList.innerHTML = '';
    showMessage(fillRulesMessage, '', '');

    if (!currentSiteOrigin) {
      fillRulesSite.textContent = '当前站点：未检测到网页';
      const empty = document.createElement('div');
      empty.className = 'fill-rule-meta';
      empty.textContent = '打开任意网页后，可为当前域名单独配置页面字段规则。';
      fillRulesList.appendChild(empty);
      return;
    }

    fillRulesSite.textContent = `当前站点：${currentSiteOrigin}`;
    const rules = getCurrentSiteFillRules();
    const siteEnabled = isSiteAllowed(currentSiteOrigin);

    PAGE_FILL_FIELD_DEFS.forEach((field) => {
      const card = document.createElement('div');
      card.className = 'fill-rule-card';

      const info = document.createElement('div');
      info.className = 'fill-rule-info';

      const title = document.createElement('div');
      title.className = 'fill-rule-title';
      title.textContent = field.label;

      const meta = document.createElement('div');
      meta.className = 'fill-rule-meta';
      meta.textContent = formatFillRuleSummary(rules[field.kind]);

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'fill-rule-actions';

      const pickBtn = document.createElement('button');
      pickBtn.type = 'button';
      pickBtn.className = 'btn primary-btn fill-rule-pick-btn';
      pickBtn.textContent = rules[field.kind] ? '重新选取' : '选取输入框';
      pickBtn.disabled = !siteEnabled;
      pickBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        armFieldSelection(field).catch((error) => {
          showMessage(fillRulesMessage, `规则创建失败: ${error.message}`, 'error');
        });
      });

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'btn text-btn fill-rule-clear-btn';
      clearBtn.textContent = '清除';
      clearBtn.disabled = !rules[field.kind];
      clearBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearFieldRule(field.kind).catch((error) => {
          showMessage(fillRulesMessage, `规则清除失败: ${error.message}`, 'error');
        });
      });

      actions.appendChild(pickBtn);
      actions.appendChild(clearBtn);
      card.appendChild(info);
      card.appendChild(actions);
      fillRulesList.appendChild(card);
    });

    if (!siteEnabled) {
      showMessage(fillRulesMessage, '当前站点已被页面助手禁用，启用后才能创建或预览字段规则。', 'error');
    }
  }

  async function armFieldSelection(field) {
    if (!currentSiteOrigin) {
      throw new Error('未检测到当前网页');
    }
    await sendToActivePage({
      type: 'start-field-selection',
      kind: field.kind,
      label: field.pickLabel
    });
    showMessage(fillRulesMessage, `已进入${field.pickLabel}选取模式，请回到网页点击目标输入框，按 Esc 可取消。`, 'success');
  }

  async function clearFieldRule(kind) {
    if (!currentSiteOrigin) {
      throw new Error('未检测到当前网页');
    }

    const nextRules = { ...pageFillRules };
    const originRules = { ...(nextRules[currentSiteOrigin] || {}) };
    delete originRules[kind];

    if (Object.keys(originRules).length > 0) {
      nextRules[currentSiteOrigin] = originRules;
    } else {
      delete nextRules[currentSiteOrigin];
    }

    pageFillRules = nextRules;
    await storageSet({ [PAGE_FILL_RULES_KEY]: nextRules });
    renderFillRuleManager();
    showMessage(fillRulesMessage, '当前字段规则已清除。', 'success');
  }

  // ===================== 一键填充页面 =====================
  const FAST_FILL_EMAIL_SOURCE_KEY = 'fastFillEmailSource';
  const FAST_FILL_DOMAIN_MODE_KEY = 'fastFillDomainMode';
  const FAST_FILL_DOMAIN_SPECIFIC_KEY = 'fastFillDomainSpecific';
  const FAST_FILL_DOMAIN_WHITELIST_KEY = 'fastFillDomainWhitelist';
  const FAST_FILL_DOMAIN_BLACKLIST_KEY = 'fastFillDomainBlacklist';
  const FAST_FILL_HISTORY_KEY = 'fastFillHistory';
  const FAST_FILL_NAME_REGION_KEY = 'fastFillNameRegion';
  const FAST_FILL_NAME_GENDER_KEY = 'fastFillNameGender';
  let fastFillEmailSource = 'temp';
  let fastFillDomainMode = 'random';
  let fastFillDomainSpecific = '';
  let fastFillDomainWhitelist = [];
  let fastFillDomainBlacklist = [];
  let fastFillTempDomains = [];
  let fastFillMoeDomains = [];
  let fastFillDomainsLoaded = false;
  let fastFillGenerating = false;
  let fastFillHistory = [];
  let fastFillNameRegion = 'en';
  let fastFillNameGender = 'random';

  function saveFastFillConfig() {
    storageSet({
      [FAST_FILL_EMAIL_SOURCE_KEY]: fastFillEmailSource,
      [FAST_FILL_DOMAIN_MODE_KEY]: fastFillDomainMode,
      [FAST_FILL_DOMAIN_SPECIFIC_KEY]: fastFillDomainSpecific,
      [FAST_FILL_DOMAIN_WHITELIST_KEY]: fastFillDomainWhitelist,
      [FAST_FILL_DOMAIN_BLACKLIST_KEY]: fastFillDomainBlacklist,
      [FAST_FILL_NAME_REGION_KEY]: fastFillNameRegion,
      [FAST_FILL_NAME_GENDER_KEY]: fastFillNameGender
    }).catch(() => {});
  }

  function getFastFillAvailableDomains() {
    const sourceDomains = fastFillEmailSource === 'moe' ? fastFillMoeDomains : fastFillTempDomains;
    if (!sourceDomains.length) return [];
    if (fastFillDomainMode === 'specific') {
      return fastFillDomainSpecific ? [fastFillDomainSpecific] : [];
    }
    if (fastFillDomainMode === 'whitelist' && fastFillDomainWhitelist.length) {
      return fastFillDomainWhitelist.filter(d => sourceDomains.includes(d));
    }
    if (fastFillDomainMode === 'blacklist') {
      const blackSet = new Set(fastFillDomainBlacklist.map(d => d.toLowerCase()));
      return sourceDomains.filter(d => !blackSet.has(d.toLowerCase()));
    }
    // random mode — all domains available
    return sourceDomains;
  }

  function pickRandomDomain() {
    const available = getFastFillAvailableDomains();
    if (!available.length) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  async function fastFillLoadDomains() {
    fastFillDomainsLoaded = false;
    fastFillDomainStatus.textContent = '域名加载中...';

    // Load temp domains
    if (apiUrl) {
      try {
        const res = await fetch(`${apiUrl}/open_api/settings`);
        if (res.ok) {
          const data = await res.json();
          fastFillTempDomains = data.domains || [];
        }
      } catch { /* ignore */ }
    }

    // Load moe domains
    if (moeApiUrl && moeApiKey) {
      try {
        const res = await moeFetch(`${moeApiUrl}/api/config`, {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': moeApiKey }
        });
        if (res.ok) {
          const data = await res.json();
          const domainStr = data.emailDomains || '';
          fastFillMoeDomains = domainStr.split(',').map(d => d.trim()).filter(Boolean);
        }
      } catch { /* ignore */ }
    }

    fastFillDomainsLoaded = true;
    fastFillRefreshDomainUI();
  }

  function fastFillRefreshDomainUI() {
    const sourceDomains = fastFillEmailSource === 'moe' ? fastFillMoeDomains : fastFillTempDomains;
    const available = getFastFillAvailableDomains();

    // Update domain select
    fastFillDomainSelect.innerHTML = '';
    if (sourceDomains.length === 0) {
      fastFillDomainSelect.innerHTML = '<option value="">无可用域名</option>';
    } else {
      sourceDomains.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        if (d === fastFillDomainSpecific) opt.selected = true;
        fastFillDomainSelect.appendChild(opt);
      });
    }

    // Update whitelist checklist
    renderDomainChecklist(fastFillDomainWhitelistList, sourceDomains, fastFillDomainWhitelist, (selected) => {
      fastFillDomainWhitelist = selected;
      saveFastFillConfig();
      fastFillRefreshDomainUI();
    });

    // Update blacklist checklist
    renderDomainChecklist(fastFillDomainBlacklistList, sourceDomains, fastFillDomainBlacklist, (selected) => {
      fastFillDomainBlacklist = selected;
      saveFastFillConfig();
      fastFillRefreshDomainUI();
    });

    // Update status text
    if (!fastFillDomainsLoaded) {
      fastFillDomainStatus.textContent = '域名加载中...';
    } else if (available.length === 0) {
      fastFillDomainStatus.textContent = '无可用域名，请检查邮箱来源配置或黑白名单';
    } else {
      fastFillDomainStatus.textContent = `当前可用域名：${available.length} 个 (${fastFillEmailSource === 'moe' ? 'Moe Mail' : 'Temp Mail'})`;
    }

    fastFillGenerateBtn.disabled = available.length === 0 || !currentSiteOrigin;
  }

  function renderDomainChecklist(container, allDomains, selectedList, onChange) {
    if (!container) return;
    const selectedSet = new Set((selectedList || []).map(d => d.toLowerCase()));
    if (allDomains.length === 0) {
      container.innerHTML = '<div class="domain-checklist-empty">暂无域名</div>';
      return;
    }
    container.innerHTML = '';
    allDomains.forEach(d => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedSet.has(d.toLowerCase());
      cb.addEventListener('change', () => {
        const next = allDomains.filter(dom => {
          if (dom === d) return cb.checked;
          return selectedSet.has(dom.toLowerCase());
        });
        onChange(next);
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(d));
      container.appendChild(label);
    });
  }

  function fastFillRefreshDomainModeUI() {
    fastFillDomainSpecificRow.classList.toggle('hidden', fastFillDomainMode !== 'specific');
    fastFillDomainWhitelistRow.classList.toggle('hidden', fastFillDomainMode !== 'whitelist');
    fastFillDomainBlacklistRow.classList.toggle('hidden', fastFillDomainMode !== 'blacklist');
    fastFillRefreshDomainUI();
  }

  function renderFastFillRulesSummary() {
    if (!fastFillRulesSummary) return;

    if (!currentSiteOrigin) {
      fastFillRulesSummary.textContent = '打开网页后切换到「规则」标签页配置字段映射';
      fastFillGenerateBtn.disabled = true;
      return;
    }

    const rules = getCurrentSiteFillRules();
    const configuredKinds = PAGE_FILL_FIELD_DEFS
      .filter(f => rules[f.kind])
      .map(f => f.label);

    if (configuredKinds.length === 0) {
      fastFillRulesSummary.textContent = '暂无规则 — 请先到「规则」页面选取页面输入框';
      fastFillGenerateBtn.disabled = true;
    } else {
      fastFillRulesSummary.textContent = `已配置 ${configuredKinds.length} 个字段：${configuredKinds.join('、')}`;
      fastFillGenerateBtn.disabled = getFastFillAvailableDomains().length === 0;
    }
  }

  function saveFastFillHistory(entry) {
    fastFillHistory.unshift(entry);
    if (fastFillHistory.length > 3) fastFillHistory = fastFillHistory.slice(0, 3);
    storageSet({ [FAST_FILL_HISTORY_KEY]: fastFillHistory }).catch(() => {});
    renderFastFillHistory();
  }

  function renderFastFillHistory() {
    if (!fastFillHistoryList) return;
    if (fastFillHistory.length === 0) {
      fastFillHistoryList.innerHTML = '<div class="tool-note" style="text-align:center;">暂无记录</div>';
      return;
    }
    fastFillHistoryList.innerHTML = '';
    fastFillHistory.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'fast-fill-history-item';

      const header = document.createElement('div');
      header.className = 'fast-fill-history-header';
      const time = document.createElement('span');
      time.className = 'fast-fill-history-time';
      time.textContent = new Date(entry.time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const source = document.createElement('span');
      source.className = 'fast-fill-history-source';
      source.textContent = entry.emailSource === 'moe' ? 'Moe Mail' : 'Temp Mail';
      header.appendChild(time);
      header.appendChild(source);

      const fields = document.createElement('div');
      fields.className = 'fast-fill-history-fields';
      const fieldLabels = { email: '邮箱', password: '密码', fullName: '姓名', birthday: '生日', address: '住址' };
      Object.entries(entry.fields).forEach(([key, val]) => {
        if (!val) return;
        const tag = document.createElement('span');
        tag.className = 'fast-fill-history-field';
        tag.textContent = fieldLabels[key] || key;
        tag.title = val;
        fields.appendChild(tag);
      });

      const actions = document.createElement('div');
      actions.className = 'fast-fill-history-actions';
      const fillBtn = document.createElement('button');
      fillBtn.className = 'btn text-btn';
      fillBtn.textContent = '填入';
      fillBtn.addEventListener('click', async () => {
        try {
          // Only fill fields that have rules configured on the current page
          const rules = getCurrentSiteFillRules();
          const fieldMap = {
            email: 'email',
            password: 'password',
            fullName: 'name',
            birthday: 'birthday',
            address: 'address'
          };
          // Map rule kinds back to history field keys
          const kindToKey = {};
          Object.entries(fieldMap).forEach(([key, kind]) => { kindToKey[kind] = key; });

          // Determine which history fields to fill, and their target kinds
          const fillList = [];
          Object.entries(entry.fields).forEach(([key, val]) => {
            const ruleKind = fieldMap[key];
            if (ruleKind && rules[ruleKind] && val) {
              fillList.push({ kind: ruleKind, value: val });
              if (key === 'password') {
                fillList.push({ kind: 'confirmPassword', value: val });
              }
            }
          });
          if (fillList.length === 0) {
            showMessage(fastFillMessage, '当前页面无匹配的字段规则', 'error');
            return;
          }
          // Send each field individually to avoid target interference
          let filled = 0;
          for (const item of fillList) {
            try {
              const res = await sendToActivePage({
                type: 'fill-value',
                kind: item.kind,
                value: item.value
              });
              if (res?.ok) filled++;
            } catch { /* skip failed fields */ }
          }
          showMessage(fastFillMessage, `已填入 ${filled} 个字段`, filled > 0 ? 'success' : 'error');
        } catch (e) {
          showMessage(fastFillMessage, `填入失败: ${e.message}`, 'error');
        }
      });
      actions.appendChild(fillBtn);

      // Add inbox jump button if entry has email
      if (entry.fields.email) {
        const inboxBtn = document.createElement('button');
        inboxBtn.className = 'btn text-btn';
        inboxBtn.textContent = '收件箱';
        inboxBtn.addEventListener('click', async () => {
          inboxBtn.disabled = true;
          inboxBtn.textContent = '...';
          try {
            await fastFillJumpToInbox(entry);
          } finally {
            inboxBtn.disabled = false;
            inboxBtn.textContent = '收件箱';
          }
        });
        actions.appendChild(inboxBtn);
      }

      item.appendChild(header);
      item.appendChild(fields);
      item.appendChild(actions);
      fastFillHistoryList.appendChild(item);
    });
  }

  async function fastFillJumpToInbox(entry) {
    const email = entry.fields.email;
    if (!email) return;
    const [name, domain] = email.split('@');
    if (!name || !domain) return;
    const expiryMs = entry.expiryMs || 0;
    const source = entry.emailSource || 'temp';

    if (source === 'moe') {
      // Check if email still exists in MoeMail
      try {
        const res = await moeFetch(`${moeApiUrl}/api/emails`, {
          headers: { 'Content-Type': 'application/json', 'X-API-Key': moeApiKey }
        });
        if (res.ok) {
          const list = await res.json();
          const found = (list.emails || []).find(e => e.address === email);
          if (found) {
            switchTab('moe-mail');
            setTimeout(() => { moeOpenInbox(found); }, 400);
            return;
          }
        }
      } catch { /* fall through to recreate */ }

      // Recreate MoeMail email
      try {
        const createRes = await moeFetch(`${moeApiUrl}/api/emails/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-API-Key': moeApiKey },
          body: JSON.stringify({ name, domain, expiryTime: expiryMs || 86400000 })
        });
        if (!createRes.ok) {
          const errData = await createRes.json().catch(() => ({}));
          throw new Error(errData.error || `创建失败 (${createRes.status})`);
        }
        const data = await createRes.json();
        const newAddr = data.email || email;
        // Refresh email list then open inbox
        await moeLoadEmails();
        const found = currentMoeEmails.find(e => e.address === newAddr);
        if (found) {
          switchTab('moe-mail');
          setTimeout(() => { moeOpenInbox(found); }, 400);
          return;
        }
      } catch (e) {
        showMessage(fastFillMessage, `重新创建失败: ${e.message}`, 'error');
        return;
      }
    } else {
      // Temp Mail
      // Check if email still exists in history
      if (history.includes(email)) {
        switchTab('temp-email');
        setTimeout(() => { openInboxView(email); }, 300);
        return;
      }

      // Recreate Temp Mail email
      try {
        const res = await fetch(`${apiUrl}/admin/new_address`, {
          method: 'POST',
          headers: { 'x-admin-auth': adminToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, domain })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `创建失败 (${res.status})`);
        }
        const data = await res.json();
        const newAddr = data.address || `${name}@${domain}`;
        // Add to history (permanent — expiryMs=0)
        if (typeof addHistory === 'function') {
          addHistory(newAddr, 0);
        }
        switchTab('temp-email');
        setTimeout(() => { openInboxView(newAddr); }, 500);
      } catch (e) {
        showMessage(fastFillMessage, `重新创建失败: ${e.message}`, 'error');
      }
    }
  }

  function renderFastFillSite() {
    if (fastFillSite) {
      fastFillSite.textContent = currentSiteOrigin
        ? `当前站点：${currentSiteOrigin}`
        : '当前站点：未检测到网页';
    }
  }

  async function renderFastFillPage() {
    const tab = await getActiveTab().catch(() => null);
    currentSiteOrigin = normalizeOrigin(tab?.url || '');
    renderFastFillSite();
    renderFastFillRulesSummary();
    renderFastFillHistory();
    fastFillRefreshDomainModeUI();
    showMessage(fastFillMessage, '', '');
  }

  async function fastFillGenerateAndFill() {
    if (fastFillGenerating) return;
    if (!currentSiteOrigin) {
      showMessage(fastFillMessage, '请先打开一个网页', 'error');
      return;
    }

    const rules = getCurrentSiteFillRules();
    const neededKinds = PAGE_FILL_FIELD_DEFS
      .map(f => f.kind)
      .filter(k => rules[k]);

    if (neededKinds.length === 0) {
      showMessage(fastFillMessage, '请先为当前页面创建至少一条字段规则', 'error');
      return;
    }

    const domain = pickRandomDomain();
    if (!domain) {
      showMessage(fastFillMessage, '无可用域名，请检查邮箱配置', 'error');
      return;
    }

    fastFillGenerating = true;
    fastFillGenerateBtn.disabled = true;
    fastFillGenerateBtn.textContent = '生成中...';
    fastFillResult.classList.add('hidden');
    showMessage(fastFillMessage, '', '');

    const generatedFields = {};
    const resultItems = [];

    try {
      // Generate email first if needed
      if (neededKinds.includes('email')) {
        const name = (() => {
          const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
          let n = '';
          for (let i = 0; i < 10; i++) n += chars.charAt(Math.floor(Math.random() * chars.length));
          return n;
        })();

        let emailAddr = '';
        if (fastFillEmailSource === 'moe') {
          const expiryTime = parseInt(fastFillMoeExpiry.value) || 86400000;
          const res = await moeFetch(`${moeApiUrl}/api/emails/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': moeApiKey },
            body: JSON.stringify({ name, domain, expiryTime })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Moe Mail 创建失败 (${res.status})`);
          }
          const data = await res.json();
          emailAddr = data.email || '';
        } else {
          const res = await fetch(`${apiUrl}/admin/new_address`, {
            method: 'POST',
            headers: { 'x-admin-auth': adminToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, domain })
          });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Temp Mail 创建失败 (${res.status})`);
          }
          const data = await res.json();
          emailAddr = data.address || `${name}@${domain}`;
        }

        if (!emailAddr) throw new Error('未能获取邮箱地址');
        generatedFields.email = emailAddr;
        updateGeneratedProfile({ email: emailAddr });
        if (fastFillEmailSource !== 'moe' && typeof addHistory === 'function') {
          const tempExpiryMs = parseInt(fastFillTempExpiry.value) || 0;
          addHistory(emailAddr, tempExpiryMs);
        }
        resultItems.push({ kind: 'email', label: '邮箱', value: emailAddr, isEmail: true });
      }

      // Generate password if needed
      if (neededKinds.includes('password') || neededKinds.includes('confirmPassword')) {
        const len = Math.max(4, Math.min(128, parseInt(document.getElementById('ff-pwd-length')?.value, 10) || 16));
        const useUpper = document.getElementById('ff-pwd-upper')?.checked;
        const useLower = document.getElementById('ff-pwd-lower')?.checked;
        const useDigit = document.getElementById('ff-pwd-digit')?.checked;
        const useSpecial = document.getElementById('ff-pwd-special')?.checked;
        const noAmbig = document.getElementById('ff-pwd-no-ambig')?.checked;

        const genPwd = window.PopupToolGenerators?.generatePassword;
        const password = genPwd
          ? genPwd(len, useUpper, useLower, useDigit, useSpecial, noAmbig)
          : (function () {
              // Fallback inline generator (kept for robustness)
              const ambiguous = 'O0lI1|';
              let chars = '';
              if (useUpper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
              if (useLower) chars += 'abcdefghijklmnopqrstuvwxyz';
              if (useDigit) chars += '0123456789';
              if (useSpecial) chars += '!@#$%^&*()-_=+[]{}:;<>,.?/~';
              if (!chars) chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
              if (noAmbig) chars = chars.split('').filter(function (c) { return ambiguous.indexOf(c) === -1; }).join('');
              var rv = new Uint32Array(len);
              crypto.getRandomValues(rv);
              var pwd = '';
              for (var i = 0; i < len; i++) pwd += chars[rv[i] % chars.length];
              return pwd;
            })();
        generatedFields.password = password;
        generatedFields.confirmPassword = password;
        updateGeneratedProfile({ password, confirmPassword: password });
        resultItems.push({ kind: 'password', label: '密码', value: password });
      }

      // Generate name if needed
      if (neededKinds.includes('name') || neededKinds.includes('firstName') || neededKinds.includes('lastName')) {
        const pick = (list) => list[Math.floor(Math.random() * list.length)];
        const nameData = window.PopupToolGenerators?.NAME_DATA || {};
        const region = fastFillNameRegion || 'en';
        const genderSelection = fastFillNameGender || 'random';
        const gender = genderSelection === 'random'
          ? (Math.random() < 0.5 ? 'male' : 'female')
          : genderSelection;

        let firstName, lastName, fullName;
        if (region === 'en' && nameData.en) {
          firstName = pick(nameData.en[gender] || nameData.en.male);
          lastName = pick(nameData.en.last);
          fullName = `${firstName} ${lastName}`;
        } else {
          const zhData = nameData.zh || { surname: ['王','李','张','刘','陈'], male: ['伟','强','磊','洋','勇'], female: ['芳','娜','敏','静','丽'] };
          lastName = pick(zhData.surname);
          const givenPool = zhData[gender] || zhData.male;
          const givenLen = Math.random() < 0.5 ? 2 : 1;
          firstName = '';
          for (let i = 0; i < givenLen; i++) firstName += pick(givenPool);
          fullName = lastName + firstName;
        }

        generatedFields.fullName = fullName;
        generatedFields.firstName = firstName;
        generatedFields.lastName = lastName;
        updateGeneratedProfile({ fullName, firstName, lastName });
        resultItems.push({ kind: 'name', label: '姓名', value: fullName });
      }

      // Generate birthday if needed
      if (neededKinds.includes('birthday') || neededKinds.includes('age')) {
        const year = 1985 + Math.floor(Math.random() * 20);
        const month = 1 + Math.floor(Math.random() * 12);
        const daysInMonth = new Date(year, month, 0).getDate();
        const day = 1 + Math.floor(Math.random() * daysInMonth);
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const today = new Date();
        let age = today.getFullYear() - year;
        if (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day)) age -= 1;
        generatedFields.birthday = dateStr;
        generatedFields.age = String(age);
        updateGeneratedProfile({ birthday: dateStr, age: String(age) });
        resultItems.push({ kind: 'birthday', label: '生日', value: `${dateStr}（${age}岁）` });
      }

      // Generate address if needed
      if (neededKinds.includes('address')) {
        const pickAddr = (list) => list[Math.floor(Math.random() * list.length)];
        const roads = ['中山路', '解放路', '人民路', '建设路', '文化路', '和平路'];
        const road = pickAddr(roads);
        const roadNum = Math.floor(Math.random() * 300) + 1;
        const city = pickAddr(['北京市朝阳区', '上海市浦东新区', '广州市天河区', '深圳市南山区', '杭州市西湖区']);
        const address = `${city}${road}${roadNum}号`;
        generatedFields.address = address;
        updateGeneratedProfile({ address });
        resultItems.push({ kind: 'address', label: '住址', value: address });
      }

      // Fill into the page
      const fillResponse = await sendToActivePage({
        type: 'fill-profile',
        fields: generatedFields
      });
      const filled = fillResponse?.filled || 0;

      // Save to history
      saveFastFillHistory({
        time: Date.now(),
        fields: generatedFields,
        emailSource: fastFillEmailSource,
        expiryMs: fastFillEmailSource === 'moe'
          ? (parseInt(fastFillMoeExpiry.value) || 86400000)
          : (parseInt(fastFillTempExpiry.value) || 0)
      });

      // Render result
      fastFillResult.classList.remove('hidden');
      fastFillResult.innerHTML = '';
      resultItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'fast-fill-result-item';

        const info = document.createElement('div');
        info.className = 'fast-fill-result-info';

        const kind = document.createElement('span');
        kind.className = 'fast-fill-result-kind';
        kind.textContent = item.label;

        const value = document.createElement('span');
        value.className = 'fast-fill-result-value';
        value.textContent = item.value;

        info.appendChild(kind);
        info.appendChild(value);
        row.appendChild(info);

        if (item.isEmail) {
          const inboxBtn = document.createElement('button');
          inboxBtn.className = 'btn primary-btn fast-fill-inbox-btn';
          inboxBtn.textContent = '收件箱 →';
          inboxBtn.addEventListener('click', async () => {
            if (fastFillEmailSource === 'moe') {
              switchTab('moe-mail');
              // Load emails then open the inbox for the newly created address
              try {
                const res = await moeFetch(`${moeApiUrl}/api/emails`, {
                  headers: { 'Content-Type': 'application/json', 'X-API-Key': moeApiKey }
                });
                if (res.ok) {
                  const list = await res.json();
                  const found = (list.emails || []).find(e => e.address === item.value);
                  if (found) {
                    setTimeout(() => { moeOpenInbox(found); }, 400);
                    return;
                  }
                }
              } catch { /* fall through to just showing the tab */ }
            } else {
              switchTab('temp-email');
              setTimeout(() => {
                openInboxView(item.value);
              }, 300);
            }
          });
          row.appendChild(inboxBtn);
        }
        fastFillResult.appendChild(row);
      });

      showMessage(fastFillMessage, `已生成 ${resultItems.length} 项信息，成功填入 ${filled} 个字段`, 'success');

      // If some fields weren't filled (e.g., multi-step form), show refill button
      if (filled < resultItems.length) {
        const refillRow = document.createElement('div');
        refillRow.className = 'fast-fill-refill-row';
        refillRow.innerHTML = `<span class="tool-note">${resultItems.length - filled} 个字段未找到输入框（可能尚未显示）</span>`;
        const refillBtn = document.createElement('button');
        refillBtn.className = 'btn text-btn';
        refillBtn.textContent = '重新填入未填充字段';
        refillBtn.addEventListener('click', async () => {
          try {
            const reResponse = await sendToActivePage({
              type: 'fill-profile',
              fields: generatedProfile
            });
            const reFilled = reResponse?.filled || 0;
            showMessage(fastFillMessage, `补充填入 ${reFilled} 个字段`, reFilled > 0 ? 'success' : 'error');
          } catch (e) {
            showMessage(fastFillMessage, `填入失败: ${e.message}`, 'error');
          }
        });
        refillRow.appendChild(refillBtn);
        fastFillResult.appendChild(refillRow);
      }
    } catch (error) {
      showMessage(fastFillMessage, `生成失败: ${error.message}`, 'error');
      fastFillResult.classList.add('hidden');
    } finally {
      fastFillGenerating = false;
      fastFillGenerateBtn.disabled = false;
      fastFillGenerateBtn.textContent = '一键生成并填入所有信息';
    }
  }

  async function previewFieldTarget(kind) {
    await sendToActivePage({ type: 'preview-fill-target', kind });
  }

  async function previewGeneratedProfileTargets() {
    await sendToActivePage({
      type: 'preview-fill-profile',
      fields: generatedProfile
    });
  }

  async function clearFieldPreview() {
    await sendToActivePage({ type: 'clear-fill-preview' });
  }

  function bindFillPreview(button, options = {}) {
    if (!button) {
      return;
    }

    const onEnter = () => {
      const previewTask = options.profile === true
        ? previewGeneratedProfileTargets()
        : previewFieldTarget(options.kind);
      previewTask.catch(() => {});
    };
    const onLeave = () => {
      clearFieldPreview().catch(() => {});
    };

    button.addEventListener('mouseenter', onEnter);
    button.addEventListener('mouseleave', onLeave);
    button.addEventListener('blur', onLeave);
  }

  function updateFillProfileButton() {
    const hasFillData = Object.values(generatedProfile).some(Boolean);
    fillProfileBtn.classList.toggle('hidden', !hasFillData);
  }

  const {
    htmlToText,
    isStubPlainText,
    sanitizeEmailHtml,
    renderPlainText,
    renderSafeHtml,
    renderMailInsights,
    renderEmailBody,
    renderMoeEmailBody,
    parseEmailBody,
    decodeQuotedPrintable,
    decodeBase64UTF8,
    escapeHtml
  } = createMailRenderer({
    copyToClipboard,
    sendToActivePage,
    bindFillPreview,
    showMessage,
    fillProfileMessage
  });

  function normalizeTranslationSetting(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
  }

  function normalizeMailInsightApiMode(value) {
    return value === 'custom' ? 'custom' : DEFAULT_MAIL_INSIGHT_API_MODE;
  }

  function hasTranslationConfig() {
    return Boolean(translationApiBase && translationApiKey && translationModel);
  }

  function syncMailInsightApiFieldsVisibility() {
    if (!mailInsightCustomApiFields) {
      return;
    }
    mailInsightCustomApiFields.classList.toggle('hidden', mailInsightApiMode !== 'custom');
  }

  function getMailInsightApiConfig() {
    if (mailInsightApiMode === 'custom') {
      return {
        apiBase: normalizeTranslationSetting(mailInsightApiBase, DEFAULT_TRANSLATION_API_BASE).replace(/\/$/, ''),
        apiKey: normalizeTranslationSetting(mailInsightApiKey),
        model: normalizeTranslationSetting(mailInsightModel)
      };
    }
    return {
      apiBase: normalizeTranslationSetting(translationApiBase, DEFAULT_TRANSLATION_API_BASE).replace(/\/$/, ''),
      apiKey: normalizeTranslationSetting(translationApiKey),
      model: normalizeTranslationSetting(translationModel)
    };
  }

  function hasMailInsightConfig() {
    const config = getMailInsightApiConfig();
    return Boolean(config.apiBase && config.apiKey && config.model);
  }

  function getMailInsightConfigErrorMessage() {
    return mailInsightApiMode === 'custom'
      ? '请先在设置页填写提取 API Base、API Key 和模型名称'
      : '请先在设置页填写翻译 API Base、API Key 和模型名称，或切换为独立提取 API';
  }

  function extractCodesLocally(text) {
    const source = String(text || '');
    if (!source) {
      return [];
    }
    const codeSet = new Set();
    const patterns = [
      // "verification code: XXXXX" / "验证码：XXXXX" patterns
      /(?:verification\s*code|code|验证码|验证代码|確認コード|認証コード)\s*[：:]\s*([A-Za-z0-9]{4,16})/gi,
      // "code is XXXXX" / "code: XXXXX"
      /code\s+(?:is|：|:)\s*([A-Za-z0-9]{4,16})/gi,
      // standalone hex-like codes (6-16 hex chars, often on their own line)
      /(?:^|\s)([A-Fa-f0-9]{6,16})(?:\s|$|[.,;!?)\]}>])/gm,
      // shorter numeric codes (4-8 digits, often standalone)
      /(?:^|\s)(\d{4,8})(?:\s|$|[.,;!?)\]}>])/gm
    ];

    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const raw = (match[1] || '').trim();
        const cleaned = raw.replace(/[\s-]+/g, '');
        if (/^[A-Z0-9]{4,16}$/i.test(cleaned)) {
          codeSet.add(cleaned);
        }
      }
      // Reset lastIndex since we use the same source with multiple patterns
      if (pattern.sticky || pattern.global) {
        pattern.lastIndex = 0;
      }
    });

    return Array.from(codeSet).slice(0, 3);
  }

  function verifyCodesAgainstSource(codes, text) {
    if (!Array.isArray(codes) || !codes.length) {
      return [];
    }
    const source = String(text || '');
    if (!source) {
      return [];
    }
    const normalizedSource = source.replace(/\s+/g, ' ').toLowerCase();
    return codes.filter((code) => {
      const normalized = String(code || '').trim().toLowerCase();
      return normalized && normalizedSource.includes(normalized);
    });
  }

  function normalizeAiInsightCode(code) {
    const normalized = String(code || '').trim().replace(/[\s-]+/g, '');
    return /^[A-Z0-9]{4,16}$/i.test(normalized) ? normalized : '';
  }

  function formatInsightLinkLabel(url, label = '') {
    const normalizedLabel = String(label || '').replace(/\s+/g, ' ').trim();
    if (normalizedLabel) {
      return normalizedLabel.length <= 88 ? normalizedLabel : `${normalizedLabel.slice(0, 85)}...`;
    }
    try {
      const parsed = new URL(url);
      const compactPath = `${parsed.hostname}${parsed.pathname === '/' ? '' : parsed.pathname}`;
      return compactPath.length <= 88 ? compactPath : `${compactPath.slice(0, 85)}...`;
    } catch {
      return url;
    }
  }

  function normalizeAiInsightResult(payload) {
    const codeSet = new Set();
    const codes = [];
    (Array.isArray(payload?.codes) ? payload.codes : []).forEach((item) => {
      const normalized = normalizeAiInsightCode(item);
      if (normalized && !codeSet.has(normalized)) {
        codeSet.add(normalized);
        codes.push(normalized);
      }
    });

    const linkMap = new Map();
    (Array.isArray(payload?.links) ? payload.links : []).forEach((item) => {
      const rawUrl = typeof item === 'string' ? item : (item?.url || item?.href || '');
      const rawLabel = typeof item === 'object' && item ? (item.label || item.title || '') : '';
      const url = String(rawUrl || '').trim();
      if (!url) {
        return;
      }
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          return;
        }
        const normalizedUrl = parsed.toString();
        if (!linkMap.has(normalizedUrl)) {
          linkMap.set(normalizedUrl, {
            url: normalizedUrl,
            label: formatInsightLinkLabel(normalizedUrl, rawLabel)
          });
        }
      } catch {
        // ignore invalid urls
      }
    });

    return {
      codes: codes.slice(0, 3),
      links: Array.from(linkMap.values()).slice(0, 3)
    };
  }

  function parseMailInsightJson(text) {
    const raw = String(text || '').trim();
    if (!raw) {
      throw new Error('模型返回了空内容');
    }

    const directCandidates = [raw];
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      directCandidates.unshift(fenced[1].trim());
    }
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      directCandidates.push(raw.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of directCandidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // try next candidate
      }
    }

    throw new Error('模型返回的数据不是有效 JSON');
  }

  function getTempMailInsightsOverride() {
    return tempMailInsightStatus === 'success'
      ? normalizeAiInsightResult(tempMailAiInsights)
      : null;
  }

  function getMoeMailInsightsOverride() {
    return moeMailInsightStatus === 'success'
      ? normalizeAiInsightResult(moeMailAiInsights)
      : null;
  }

  function buildTempMailInsightRenderOptions() {
    if (tempMailInsightStatus === 'loading') {
      return {
        statusText: 'AI 提取中... ',
        statusType: 'info',
        noteText: '正在提取验证码与验证链接，完成后会自动显示在此处。',
        onRetry: () => triggerTempMailAiInsights(true),
        retryLabel: 'AI 提取中',
        retryDisabled: true
      };
    }
    if (tempMailInsightStatus === 'success') {
      return {
        statusText: 'AI 提取已完成',
        statusType: 'success',
        noteText: '当前显示 AI 提取到的高置信验证码与验证链接。',
        onRetry: () => triggerTempMailAiInsights(true),
        retryLabel: '重新提取'
      };
    }
    if (tempMailInsightStatus === 'error') {
      return {
        statusText: `AI 提取失败：${tempMailInsightError}`,
        statusType: 'error',
        noteText: '当前未显示验证码或验证链接，可点击右侧按钮重试。',
        onRetry: () => triggerTempMailAiInsights(true),
        retryLabel: '重试提取'
      };
    }
    if (!hasMailInsightConfig()) {
      return {
        statusText: '未配置 AI 提取 API',
        statusType: 'info',
        noteText: '请在设置页选择复用翻译 API，或填写独立提取 API。',
        onRetry: () => triggerTempMailAiInsights(true),
        retryLabel: '重试提取'
      };
    }
    return {
      statusText: '邮件打开后将自动进行 AI 提取',
      statusType: 'info',
      noteText: '如果自动提取未显示结果，可点击右侧按钮重试。',
      onRetry: () => triggerTempMailAiInsights(true),
      retryLabel: '重试提取'
    };
  }

  function buildMoeMailInsightRenderOptions() {
    if (moeMailInsightStatus === 'loading') {
      return {
        statusText: 'AI 提取中... ',
        statusType: 'info',
        noteText: '正在提取验证码与验证链接，完成后会自动显示在此处。',
        onRetry: () => triggerMoeMailAiInsights(true),
        retryLabel: 'AI 提取中',
        retryDisabled: true
      };
    }
    if (moeMailInsightStatus === 'success') {
      return {
        statusText: 'AI 提取已完成',
        statusType: 'success',
        noteText: '当前显示 AI 提取到的高置信验证码与验证链接。',
        onRetry: () => triggerMoeMailAiInsights(true),
        retryLabel: '重新提取'
      };
    }
    if (moeMailInsightStatus === 'error') {
      return {
        statusText: `AI 提取失败：${moeMailInsightError}`,
        statusType: 'error',
        noteText: '当前未显示验证码或验证链接，可点击右侧按钮重试。',
        onRetry: () => triggerMoeMailAiInsights(true),
        retryLabel: '重试提取'
      };
    }
    if (!hasMailInsightConfig()) {
      return {
        statusText: '未配置 AI 提取 API',
        statusType: 'info',
        noteText: '请在设置页选择复用翻译 API，或填写独立提取 API。',
        onRetry: () => triggerMoeMailAiInsights(true),
        retryLabel: '重试提取'
      };
    }
    return {
      statusText: '邮件打开后将自动进行 AI 提取',
      statusType: 'info',
      noteText: '如果自动提取未显示结果，可点击右侧按钮重试。',
      onRetry: () => triggerMoeMailAiInsights(true),
      retryLabel: '重试提取'
    };
  }

  function resetTranslationPanel(panel, titleEl, bodyEl, copyBtn, retranslateBtn) {
    if (!panel || !titleEl || !bodyEl || !copyBtn) {
      return;
    }
    panel.classList.add('hidden');
    titleEl.textContent = 'AI 翻译';
    bodyEl.innerHTML = '';
    copyBtn.classList.add('hidden');
    if (retranslateBtn) retranslateBtn.classList.add('hidden');
  }

  function renderTranslationPanel(panel, titleEl, bodyEl, copyBtn, text, title, retranslateBtn) {
    if (!panel || !titleEl || !bodyEl || !copyBtn) {
      return;
    }
    titleEl.textContent = title || `AI 翻译 · ${translationTargetLanguage}`;
    renderPlainText(bodyEl, text || '(无内容)');
    panel.classList.remove('hidden');
    copyBtn.classList.toggle('hidden', !text);
    if (retranslateBtn) retranslateBtn.classList.toggle('hidden', !text);
  }

  function getTempMailTranslationSource(mail) {
    if (!mail) {
      return '';
    }
    const parsed = parseEmailBody(mail.raw || '');

    // Quick check: if "text" looks like raw MIME headers, discard it
    function looksLikeRawMime(str) {
      if (!str) return false;
      const upper = str.slice(0, 500).toUpperCase();
      return upper.includes('CONTENT-TYPE:') || upper.includes('CONTENT-TRANSFER-ENCODING:')
          || upper.includes('MIME-VERSION:') || upper.includes('BOUNDARY=');
    }

    // Collect all usable text sources
    const parts = [];

    // 1. Plain text part (if not a stub and not raw MIME garbage)
    const plainText = (parsed?.text || '').trim();
    if (plainText && !looksLikeRawMime(plainText) && !isStubPlainText(plainText, parsed?.html || '')) {
      parts.push(plainText);
    }

    // 2. HTML part converted to text (richest source for HTML-only emails)
    const htmlContent = parsed?.html || '';
    const htmlAsText = htmlToText(htmlContent);
    if (htmlAsText) {
      // Avoid duplicating if plain text already contains the same info
      if (parts.length === 0 || !htmlAsText.includes(plainText)) {
        parts.push(htmlAsText);
      }
    }

    // 3. Last resort: manually strip MIME headers and QP-decode the raw body
    if (parts.length === 0) {
      const raw = mail.raw || '';
      // Find the body after the MIME headers (first empty line)
      const headerEnd = raw.indexOf('\r\n\r\n');
      let bodyOnly = headerEnd !== -1 ? raw.slice(headerEnd + 4) : raw;
      // If it's a multipart, try to extract just the HTML or text parts
      const boundaryMatch = bodyOnly.match(/^--([a-zA-Z0-9_=\-\.]+)/m);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1];
        const segments = bodyOnly.split('--' + boundary);
        const texts = [];
        for (const seg of segments) {
          const partHeaderEnd = seg.indexOf('\r\n\r\n');
          const partBody = partHeaderEnd !== -1
            ? seg.slice(partHeaderEnd + 4).trim()
            : seg.trim();
          if (partBody && !partBody.startsWith('--') && partBody.length > 10) {
            const decoded = partBody
              .replace(/=\r?\n/g, '')
              .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
              .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
              .trim();
            if (decoded && !looksLikeRawMime(decoded)) {
              texts.push(decoded);
            }
          }
        }
        if (texts.length > 0) {
          parts.push(texts.join('\n\n'));
        }
      } else {
        // Single part: just QP-decode and clean
        const cleaned = bodyOnly
          .replace(/=\r?\n/g, '')
          .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
          .trim();
        if (cleaned && cleaned.length > 20 && !looksLikeRawMime(cleaned)) {
          parts.push(cleaned);
        }
      }
    }

    const text = parts.join('\n\n---\n\n');
    if (!text) {
      console.warn('[Temp Email] 无法从邮件中提取文本内容，AI 提取将无法正常工作。mail.raw 长度:', (mail.raw || '').length);
      return '';
    }

    return normalizeTranslationSource(text);
  }

  function getMoeMailTranslationSource(mail) {
    if (!mail) {
      return '';
    }
    const text = mail.content || htmlToText(mail.html || '') || '';
    return normalizeTranslationSource(text);
  }

  function normalizeTranslationSource(text) {
    if (typeof text !== 'string') {
      return '';
    }
    return text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, MAX_TRANSLATION_SOURCE_CHARS);
  }

  async function extractMailInsightsWithApi(text, options = {}) {
    if (!hasMailInsightConfig()) {
      throw new Error(getMailInsightConfigErrorMessage());
    }

    const sourceText = normalizeTranslationSource(text);
    if (!sourceText) {
      throw new Error('当前邮件没有可用于提取的信息');
    }

    const config = getMailInsightApiConfig();
    const subject = options.subject ? String(options.subject).trim() : '';
    const from = options.from ? String(options.from).trim() : '';

    const response = await fetch(`${config.apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `你是一个邮件验证码与验证链接提取助手。请从邮件正文中严格提取验证码和验证链接，遵守以下规则：

1. 验证码通常在 "code:", "verification code:", "验证码：", "验证代码：", "code is", "your code" 等提示词附近，也可能是单独成行的数字或字母串。
2. 验证码格式多样：纯数字（如 123456）、十六进制大小写混合（如 4fe4f0a77e）、字母数字混合（如 Ab12CD34）、短哈希 等。务必提取原文中真实存在的字符串，保留原始大小写，不要统一转为大写或小写。
3. 验证链接是用于登录、注册、验证、激活、确认、重置密码等的 URL。不要提取退订链接、追踪链接、广告链接、图片链接。
4. 严格禁止编造：如果文中没有找到验证码，codes 必须返回空数组 []。绝对不要猜测、编造、或虚构任何验证码。你返回的每个 code 都必须能在邮件正文中找到一模一样的原始字符串（包括大小写）。
5. 只返回 JSON，格式为 {"codes":["4fe4f0a77e"],"links":[{"url":"https://example.com/verify","label":"验证邮箱"}]}。
6. 最多返回 3 个验证码和 3 个链接，不要解释。`
          },
          {
            role: 'user',
            content: `请提取以下邮件中的验证码和验证链接。\n\n主题：${subject || '(无主题)'}\n发件人：${from || '(未知)'}\n\n邮件正文：\n${sourceText}`
          }
        ]
      })
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const errorMessage = data?.error?.message || data?.message || `${response.status}`;
      throw new Error(`AI 提取请求失败: ${errorMessage}`);
    }

    const content = data?.choices?.[0]?.message?.content?.trim();
    const parsed = parseMailInsightJson(content);
    const aiResult = normalizeAiInsightResult(parsed);

    // Verify AI-extracted codes actually exist in the email text
    const verifiedCodes = verifyCodesAgainstSource(aiResult.codes, sourceText);
    if (verifiedCodes.length > 0) {
      aiResult.codes = verifiedCodes;
      return aiResult;
    }

    // If AI codes fail verification, try local regex extraction as fallback
    if (aiResult.codes.length === 0 || verifiedCodes.length === 0) {
      const localCodes = extractCodesLocally(sourceText);
      if (localCodes.length > 0) {
        aiResult.codes = localCodes;
      }
    }

    return aiResult;
  }

  async function translateTextWithApi(text, options = {}) {
    if (!hasTranslationConfig()) {
      throw new Error('请先在设置页填写翻译 API Base、API Key 和模型名称');
    }
    const sourceText = normalizeTranslationSource(text);
    if (!sourceText) {
      throw new Error('当前邮件没有可翻译的文本内容');
    }
    const apiBase = normalizeTranslationSetting(translationApiBase, DEFAULT_TRANSLATION_API_BASE).replace(/\/$/, '');
    const targetLanguage = normalizeTranslationSetting(translationTargetLanguage, DEFAULT_TRANSLATION_TARGET_LANGUAGE);
    const subject = options.subject ? String(options.subject).trim() : '';
    const from = options.from ? String(options.from).trim() : '';
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${translationApiKey}`
      },
      body: JSON.stringify({
        model: translationModel,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `你是一个专业的邮件翻译助手。请将邮件翻译为${targetLanguage}。保持原文结构清晰，保留换行。邮箱地址、网址、验证码、订单号、代码、数字、专有名词尽量原样保留，不要凭空补充内容。`
          },
          {
            role: 'user',
            content: `请翻译以下邮件内容。\n\n主题：${subject || '(无主题)'}\n发件人：${from || '(未知)'}\n\n邮件正文：\n${sourceText}`
          }
        ]
      })
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const errorMessage = data?.error?.message || data?.message || `${response.status}`;
      throw new Error(`翻译请求失败: ${errorMessage}`);
    }

    const translated = data?.choices?.[0]?.message?.content?.trim();
    if (!translated) {
      throw new Error('模型返回了空内容');
    }
    return translated;
  }

  function getMailActionIconMarkup(kind) {
    const icons = {
      translate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14"/><path d="M10 4v4"/><path d="M8 20l4-9 4 9"/><path d="M18 13c0 3-2.5 5.5-6 7"/></svg>',
      collapseTranslation: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
      plainText: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M4 12h10"/><path d="M4 17h16"/></svg>',
      safeHtml: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10"/><path d="M7 12h4"/><path d="M15 16h2"/></svg>',
      showImages: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
      blockImages: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m21 15-5-5-2.5 2.5"/><path d="M8.5 10.5h.01"/></svg>',
      noImages: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 2 20 20"/><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8.5 10.5h.01"/></svg>',
      delete: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>',
      loading: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
    };
    return icons[kind] || icons.safeHtml;
  }

  function setMailActionButtonState(button, options = {}) {
    if (!button) {
      return;
    }
    button.innerHTML = getMailActionIconMarkup(options.icon);
    button.title = options.title || '';
    button.setAttribute('aria-label', options.title || '');
    button.disabled = options.disabled === true;
    button.classList.toggle('is-danger', options.danger === true);
  }

  function updateTempMailActionButtons(parsed) {
    setMailActionButtonState(translateMailBtn, {
      icon: 'translate',
      title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API',
      disabled: !currentTempMail
    });

    setMailActionButtonState(toggleMailViewBtn, parsed?.safeHtmlAvailable
      ? {
          icon: tempMailViewMode === 'safe-html' ? 'plainText' : 'safeHtml',
          title: tempMailViewMode === 'safe-html' ? '切换到纯文本' : '切换到安全 HTML'
        }
      : {
          icon: 'plainText',
          title: '仅纯文本可用',
          disabled: true
        });

    setMailActionButtonState(toggleMailImagesBtn, parsed?.hasRemoteImages
      ? {
          icon: tempMailAllowRemoteImages ? 'blockImages' : 'showImages',
          title: tempMailAllowRemoteImages ? '阻止远程图片' : '显示远程图片'
        }
      : {
          icon: 'noImages',
          title: '无远程图片',
          disabled: true
        });

    setMailActionButtonState(deleteMailBtn, {
      icon: 'delete',
      title: '删除此邮件',
      danger: true
    });
  }

  function updateMoeMailActionButtons(result) {
    setMailActionButtonState(translateMoeMailBtn, {
      icon: 'translate',
      title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API',
      disabled: !currentMoeMail
    });

    setMailActionButtonState(toggleMoeMailViewBtn, result?.safeHtmlAvailable
      ? {
          icon: moeMailViewMode === 'safe-html' ? 'plainText' : 'safeHtml',
          title: moeMailViewMode === 'safe-html' ? '切换到纯文本' : '切换到安全 HTML'
        }
      : {
          icon: 'plainText',
          title: '仅纯文本可用',
          disabled: true
        });

    setMailActionButtonState(toggleMoeMailImagesBtn, result?.hasRemoteImages
      ? {
          icon: moeMailAllowRemoteImages ? 'blockImages' : 'showImages',
          title: moeMailAllowRemoteImages ? '阻止远程图片' : '显示远程图片'
        }
      : {
          icon: 'noImages',
          title: '无远程图片',
          disabled: true
        });
  }

  setMailActionButtonState(translateMailBtn, { icon: 'translate', title: '翻译邮件', disabled: true });
  setMailActionButtonState(toggleMailViewBtn, { icon: 'plainText', title: '切换邮件视图', disabled: true });
  setMailActionButtonState(toggleMailImagesBtn, { icon: 'noImages', title: '无远程图片', disabled: true });
  setMailActionButtonState(deleteMailBtn, { icon: 'delete', title: '删除此邮件', danger: true });
  setMailActionButtonState(translateMoeMailBtn, { icon: 'translate', title: '翻译邮件', disabled: true });
  setMailActionButtonState(toggleMoeMailViewBtn, { icon: 'plainText', title: '切换邮件视图', disabled: true });
  setMailActionButtonState(toggleMoeMailImagesBtn, { icon: 'noImages', title: '无远程图片', disabled: true });

  bindFloatingSelectScrollBridge();

  bindIntervalControl(
    verifyIntervalSelect,
    verifyIntervalCustomInput,
    verifyIntervalUnitSelect,
    VERIFY_INTERVAL_PRESETS,
    DISABLED_INTERVAL_SETTING
  );
  bindIntervalControl(
    mailPollingIntervalSelect,
    mailPollingIntervalCustomInput,
    mailPollingIntervalUnitSelect,
    MAIL_POLL_INTERVAL_PRESETS,
    DEFAULT_MAIL_POLL_INTERVAL
  );

  /**
   * 将 siteBlocklist 数组同步到 textarea（每行一条）
   */
  function syncBlocklistTextarea() {
    if (siteBlocklistTextarea) {
      siteBlocklistTextarea.value = Array.isArray(siteBlocklist) ? siteBlocklist.join('\n') : '';
    }
  }

  /**
   * 从 textarea 解析黑名单规则数组（自动去重、过滤空行/空白）
   */
  function parseBlocklistTextarea() {
    if (!siteBlocklistTextarea) return siteBlocklist;
    const lines = siteBlocklistTextarea.value.split(/\r?\n/);
    const seen = new Set();
    const result = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
    }
    return result;
  }

  async function refreshCurrentSiteInfo() {
    const tab = await getActiveTab().catch(() => null);
    currentSiteOrigin = normalizeOrigin(tab?.url || '');

    if (!currentSiteOrigin) {
      currentSiteOriginDiv.textContent = '未检测到当前网页';
      currentSiteStatusDiv.textContent = '打开任意网页后可单独启用或禁用悬浮助手。';
      currentSiteToggleBtn.textContent = '当前站点不可用';
      currentSiteToggleBtn.disabled = true;
      renderFillRuleManager();
      syncBlocklistTextarea();
      return;
    }

    currentSiteToggleBtn.disabled = false;
    currentSiteOriginDiv.textContent = currentSiteOrigin;
    const allowed = isSiteAllowed(currentSiteOrigin);
    if (siteAccessMode === 'whitelist') {
      currentSiteStatusDiv.textContent = allowed
        ? '当前站点位于白名单中，页面助手会自动启用。'
        : '当前站点未加入白名单，页面助手不会自动注入。';
      currentSiteToggleBtn.textContent = allowed ? '从白名单移除当前站点' : '加入白名单';
      renderFillRuleManager();
      if (activeTab === 'fast-fill') renderFastFillPage().catch(() => {});
      syncBlocklistTextarea();
      return;
    }

    currentSiteStatusDiv.textContent = allowed
      ? '当前站点允许注入页面助手。'
      : '当前站点已被排除，页面助手不会自动注入。';
    currentSiteToggleBtn.textContent = allowed ? '禁用当前站点' : '重新启用当前站点';
    renderFillRuleManager();
    if (activeTab === 'fast-fill') renderFastFillPage().catch(() => {});
    syncBlocklistTextarea();
  }

  async function handleCurrentSiteToggle() {
    if (!currentSiteOrigin) {
      return;
    }

    // 先同步 textarea 内容，确保基于最新编辑状态判断
    siteBlocklist = parseBlocklistTextarea();

    if (siteAccessMode === 'whitelist') {
      if (matchesAnySitePattern(currentSiteOrigin, siteAllowlist)) {
        siteAllowlist = siteAllowlist.filter(origin => origin !== currentSiteOrigin);
      } else {
        siteAllowlist = Array.from(new Set([...siteAllowlist, currentSiteOrigin]));
      }
    } else if (matchesAnySitePattern(currentSiteOrigin, siteBlocklist)) {
      siteBlocklist = siteBlocklist.filter(origin => origin !== currentSiteOrigin);
    } else {
      siteBlocklist = Array.from(new Set([...siteBlocklist, currentSiteOrigin]));
    }

    await storageSet({
      siteAccessMode,
      siteAllowlist,
      siteBlocklist
    });
    refreshCurrentSiteInfo();
    syncBlocklistTextarea();
  }

  applyTabLayoutMode(TAB_LAYOUT_MODES.SIDEBAR);

  // ===================== 初始化加载 =====================
  storageGet([
    'apiUrl', 'adminToken', 'emailHistory', 'floatWindowEnabled', 'activeTab',
    'moeApiUrl', 'moeApiKey', 'moeEmailCache', 'defaultTab', 'bookmarks', 'verifyInterval', 'bookmarkSort',
    'verifyStatusCache', 'tempUnreadCounts', 'moeUnreadCounts', 'mailPollingInterval',
    'notificationsEnabled', 'defaultRemoteImagesEnabled', TRANSLATION_API_BASE_KEY, TRANSLATION_API_KEY_KEY, TRANSLATION_MODEL_KEY, TRANSLATION_TARGET_LANGUAGE_KEY, MAIL_INSIGHT_API_MODE_KEY, MAIL_INSIGHT_API_BASE_KEY, MAIL_INSIGHT_API_KEY_KEY, MAIL_INSIGHT_MODEL_KEY, 'siteAccessMode', 'siteAllowlist', 'siteBlocklist',
    TAB_LAYOUT_MODE_KEY, GENERATED_RESULT_AUTO_CLOSE_KEY, PAGE_FILL_RULES_KEY, GENERATED_PROFILE_KEY, GENERATED_HISTORY_KEY,
    THEME_KEY, FLOAT_WINDOW_STYLE_KEY,
    FAST_FILL_EMAIL_SOURCE_KEY, FAST_FILL_DOMAIN_MODE_KEY, FAST_FILL_DOMAIN_SPECIFIC_KEY, FAST_FILL_DOMAIN_WHITELIST_KEY, FAST_FILL_DOMAIN_BLACKLIST_KEY,
    FAST_FILL_HISTORY_KEY,
    TEMP_MAIL_META_KEY,
    DEFAULT_FF_TEMP_EXPIRY_KEY, DEFAULT_FF_MOE_EXPIRY_KEY, DEFAULT_TEMP_EXPIRY_KEY, DEFAULT_MOE_EXPIRY_KEY,
    'activeInbox'
  ]).then((result) => {
    // Temp Email 配置
    apiUrlInput.value = result.apiUrl || '';
    adminTokenInput.value = result.adminToken || '';
    apiUrl = result.apiUrl || '';
    adminToken = result.adminToken || '';
    floatToggle.checked = result.floatWindowEnabled !== false;

    // 默认页面设置
    const savedDefault = result.defaultTab || 'temp-email';
    defaultTabSelect.value = savedDefault;
    applyTabLayoutMode(result[TAB_LAYOUT_MODE_KEY]);
    applyFloatingWindowStyle(result[FLOAT_WINDOW_STYLE_KEY]);
    applyTheme(result[THEME_KEY]);

    if (result.emailHistory) {
      history = result.emailHistory;
    }
    verifyStatus = result.verifyStatusCache || {};
    tempUnreadCounts = result.tempUnreadCounts || {};
    tempMailMeta = result[TEMP_MAIL_META_KEY] || {};

    // Default expiry settings
    defaultFfTempExpiry = result[DEFAULT_FF_TEMP_EXPIRY_KEY] || '86400000';
    defaultFfMoeExpiry = result[DEFAULT_FF_MOE_EXPIRY_KEY] || '86400000';
    defaultTempExpiry = result[DEFAULT_TEMP_EXPIRY_KEY] || '86400000';
    defaultMoeExpiry = result[DEFAULT_MOE_EXPIRY_KEY] || '86400000';
    document.getElementById('setting-ff-temp-expiry').value = defaultFfTempExpiry;
    document.getElementById('setting-ff-moe-expiry').value = defaultFfMoeExpiry;
    document.getElementById('setting-temp-expiry').value = defaultTempExpiry;
    document.getElementById('setting-moe-expiry').value = defaultMoeExpiry;
    // Apply defaults to the active pages
    tempExpirySelect.value = defaultTempExpiry;
    moeExpirySelect.value = defaultMoeExpiry;
    fastFillTempExpiry.value = defaultFfTempExpiry;
    fastFillMoeExpiry.value = defaultFfMoeExpiry;

    renderHistory();

    // Check and auto-delete expired addresses
    if (apiUrl && adminToken) {
      checkAndDeleteExpiredTempMails().catch(() => {});
    }

    // Temp Email: 如果有配置则加载域名
    if (apiUrl && adminToken) {
      loadDomains();
    }

    // MoeMail 配置
    moeApiUrlInput.value = result.moeApiUrl || '';
    moeApiKeyInput.value = result.moeApiKey || '';
    moeApiUrl = result.moeApiUrl || '';
    moeApiKey = result.moeApiKey || '';
    currentMoeEmails = Array.isArray(result.moeEmailCache) ? result.moeEmailCache : [];
    moeUnreadCounts = result.moeUnreadCounts || {};
    renderMoeEmails();

    // MoeMail: 如果有配置则加载
    if (moeApiUrl && moeApiKey) {
      moeLoadDomains();
      moeLoadEmails();
    }

    // 书签
    if (result.bookmarks) {
      bookmarks = result.bookmarks;
    }
    if (result.bookmarkSort) {
      bookmarkSort = result.bookmarkSort;
      bmSortSelect.value = bookmarkSort;
    }
    renderBookmarks();

    // 自动验证间隔
    const savedInterval = normalizeIntervalSetting(result.verifyInterval, DISABLED_INTERVAL_SETTING);
    setupAutoVerify(savedInterval);

    const savedMailPollingInterval = normalizeIntervalSetting(result.mailPollingInterval, DEFAULT_MAIL_POLL_INTERVAL);
    mailPollingInterval = savedMailPollingInterval;
    applyIntervalControl(
      mailPollingIntervalSelect,
      mailPollingIntervalCustomInput,
      mailPollingIntervalUnitSelect,
      MAIL_POLL_INTERVAL_PRESETS,
      savedMailPollingInterval,
      DEFAULT_MAIL_POLL_INTERVAL
    );
    notificationsEnabled = result.notificationsEnabled !== false;
    notificationsToggle.checked = notificationsEnabled;
    defaultRemoteImagesEnabled = result.defaultRemoteImagesEnabled === true;
    defaultRemoteImagesToggle.checked = defaultRemoteImagesEnabled;
    translationApiBase = normalizeTranslationSetting(result[TRANSLATION_API_BASE_KEY], DEFAULT_TRANSLATION_API_BASE);
    translationApiKey = normalizeTranslationSetting(result[TRANSLATION_API_KEY_KEY]);
    translationModel = normalizeTranslationSetting(result[TRANSLATION_MODEL_KEY]);
    translationTargetLanguage = normalizeTranslationSetting(result[TRANSLATION_TARGET_LANGUAGE_KEY], DEFAULT_TRANSLATION_TARGET_LANGUAGE);
    mailInsightApiMode = normalizeMailInsightApiMode(result[MAIL_INSIGHT_API_MODE_KEY]);
    mailInsightApiBase = normalizeTranslationSetting(result[MAIL_INSIGHT_API_BASE_KEY], DEFAULT_TRANSLATION_API_BASE);
    mailInsightApiKey = normalizeTranslationSetting(result[MAIL_INSIGHT_API_KEY_KEY]);
    mailInsightModel = normalizeTranslationSetting(result[MAIL_INSIGHT_MODEL_KEY]);
    translationApiBaseInput.value = translationApiBase;
    translationApiKeyInput.value = translationApiKey;
    translationModelInput.value = translationModel;
    translationTargetLanguageInput.value = translationTargetLanguage;
    mailInsightApiModeSelect.value = mailInsightApiMode;
    mailInsightApiBaseInput.value = mailInsightApiBase;
    mailInsightApiKeyInput.value = mailInsightApiKey;
    mailInsightModelInput.value = mailInsightModel;
    syncMailInsightApiFieldsVisibility();
    generatedResultAutoCloseSeconds = normalizeGeneratedResultAutoCloseSeconds(result[GENERATED_RESULT_AUTO_CLOSE_KEY]);
    syncGeneratedResultAutoCloseInput(generatedResultAutoCloseSeconds);
    siteAccessMode = result.siteAccessMode || 'all';
    siteAllowlist = Array.isArray(result.siteAllowlist) ? result.siteAllowlist : [];
    siteBlocklist = Array.isArray(result.siteBlocklist) ? result.siteBlocklist : [];
    syncBlocklistTextarea();
    pageFillRules = result[PAGE_FILL_RULES_KEY] || {};
    generatedProfile = normalizeGeneratedProfile(result[GENERATED_PROFILE_KEY]);
    generatedToolHistory = normalizeGeneratedToolHistory(result[GENERATED_HISTORY_KEY]);

    // 一键填充配置
    fastFillEmailSource = result[FAST_FILL_EMAIL_SOURCE_KEY] || 'temp';
    fastFillDomainMode = result[FAST_FILL_DOMAIN_MODE_KEY] || 'random';
    fastFillDomainSpecific = result[FAST_FILL_DOMAIN_SPECIFIC_KEY] || '';
    fastFillDomainWhitelist = Array.isArray(result[FAST_FILL_DOMAIN_WHITELIST_KEY]) ? result[FAST_FILL_DOMAIN_WHITELIST_KEY] : [];
    fastFillDomainBlacklist = Array.isArray(result[FAST_FILL_DOMAIN_BLACKLIST_KEY]) ? result[FAST_FILL_DOMAIN_BLACKLIST_KEY] : [];
    fastFillHistory = Array.isArray(result[FAST_FILL_HISTORY_KEY]) ? result[FAST_FILL_HISTORY_KEY].slice(0, 3) : [];
    fastFillNameRegion = result[FAST_FILL_NAME_REGION_KEY] || 'en';
    fastFillNameGender = result[FAST_FILL_NAME_GENDER_KEY] || 'random';
    const ffNameRegionEl = document.getElementById('ff-name-region');
    const ffNameGenderEl = document.getElementById('ff-name-gender');
    if (ffNameRegionEl) ffNameRegionEl.value = fastFillNameRegion;
    if (ffNameGenderEl) ffNameGenderEl.value = fastFillNameGender;
    fastFillEmailSourceEl.value = fastFillEmailSource;
    fastFillDomainModeEl.value = fastFillDomainMode;
    if (fastFillDomainSpecific) fastFillDomainSelect.value = fastFillDomainSpecific;
    fastFillMoeExpiryRow.classList.toggle('hidden', fastFillEmailSource !== 'moe');
    fastFillTempExpiryRow.classList.toggle('hidden', fastFillEmailSource !== 'temp');
    fastFillRefreshDomainModeUI();
    fastFillLoadDomains();

    siteAccessModeSelect.value = siteAccessMode;
    refreshCurrentSiteInfo();
    updateFillProfileButton();
    restoreGeneratedToolResults();
    renderGeneratedToolHistory();

    // 恢复上次的选项卡（activeTab 优先，否则用 defaultTab）
    let savedTab = normalizeTabForLayout(result.activeTab || savedDefault, tabLayoutMode);
    // 如果首次使用（无任何配置），自动跳转到设置页
    if (!apiUrl && !adminToken && !moeApiUrl && !moeApiKey && !result.activeTab) {
      savedTab = 'settings';
    }
    switchTab(savedTab);

    // 恢复收件箱视图（悬浮窗页面跳转后保持收件箱状态）
    const savedInbox = result.activeInbox;
    if (savedInbox && savedInbox.type === 'temp' && savedInbox.address) {
      setTimeout(() => { openInboxView(savedInbox.address); }, 200);
    } else if (savedInbox && savedInbox.type === 'moe' && savedInbox.emailId) {
      setTimeout(() => {
        const emailObj = { id: savedInbox.emailId, address: savedInbox.address || '' };
        moeOpenInbox(emailObj);
      }, 200);
    }

    // 初始化完成，显示页面
    clearTimeout(initSafetyTimer);
    document.body.classList.remove('js-loading');
  }).catch((error) => {
    clearTimeout(initSafetyTimer);
    document.body.classList.remove('js-loading');
    showMessage(settingsMessage, `配置加载失败: ${error.message}`, 'error');
  });

  // ===================== 统一保存设置 =====================
  saveSettingsBtn.addEventListener('click', async () => {
    const newUrl = apiUrlInput.value.trim().replace(/\/$/, "");
    const newToken = adminTokenInput.value.trim();
    const newMoeUrl = moeApiUrlInput.value.trim().replace(/\/$/, "");
    const newMoeKey = moeApiKeyInput.value.trim();
    const floatEnabled = floatToggle.checked;
    const newFloatWindowStyle = currentFloatWindowStyle;
    const newDefaultTab = defaultTabSelect.value;
    const newTabLayoutMode = tabLayoutMode;
    let verifyInterval = { ...DISABLED_INTERVAL_SETTING };
    let newMailPollingInterval = { ...DEFAULT_MAIL_POLL_INTERVAL };
    try {
      verifyInterval = readIntervalControl(
        verifyIntervalSelect,
        verifyIntervalCustomInput,
        verifyIntervalUnitSelect,
        VERIFY_INTERVAL_PRESETS,
        '自动验证邮箱间隔'
      );
      newMailPollingInterval = readIntervalControl(
        mailPollingIntervalSelect,
        mailPollingIntervalCustomInput,
        mailPollingIntervalUnitSelect,
        MAIL_POLL_INTERVAL_PRESETS,
        '后台检查新邮件间隔'
      );
    } catch (error) {
      showMessage(settingsMessage, error.message, 'error');
      return;
    }
    const newNotificationsEnabled = notificationsToggle.checked;
    const newDefaultRemoteImagesEnabled = defaultRemoteImagesToggle.checked;
    const newTranslationApiBase = normalizeTranslationSetting(translationApiBaseInput.value, DEFAULT_TRANSLATION_API_BASE).replace(/\/$/, '');
    const newTranslationApiKey = normalizeTranslationSetting(translationApiKeyInput.value);
    const newTranslationModel = normalizeTranslationSetting(translationModelInput.value);
    const newTranslationTargetLanguage = normalizeTranslationSetting(translationTargetLanguageInput.value, DEFAULT_TRANSLATION_TARGET_LANGUAGE);
    const newMailInsightApiMode = normalizeMailInsightApiMode(mailInsightApiModeSelect.value);
    const newMailInsightApiBase = normalizeTranslationSetting(mailInsightApiBaseInput.value, DEFAULT_TRANSLATION_API_BASE).replace(/\/$/, '');
    const newMailInsightApiKey = normalizeTranslationSetting(mailInsightApiKeyInput.value);
    const newMailInsightModel = normalizeTranslationSetting(mailInsightModelInput.value);
    let newGeneratedResultAutoCloseSeconds = DEFAULT_GENERATED_RESULT_AUTO_CLOSE_SECONDS;
    try {
      newGeneratedResultAutoCloseSeconds = readGeneratedResultAutoCloseSeconds();
    } catch (error) {
      showMessage(settingsMessage, error.message, 'error');
      return;
    }
    const newSiteAccessMode = siteAccessModeSelect.value || 'all';

    // Default expiry
    const newDefaultFfTempExpiry = document.getElementById('setting-ff-temp-expiry').value;
    const newDefaultFfMoeExpiry = document.getElementById('setting-ff-moe-expiry').value;
    const newDefaultTempExpiry = document.getElementById('setting-temp-expiry').value;
    const newDefaultMoeExpiry = document.getElementById('setting-moe-expiry').value;

    // Temp Email 配置更新
    apiUrl = newUrl;
    adminToken = newToken;
    // MoeMail 配置更新
    moeApiUrl = newMoeUrl;
    moeApiKey = newMoeKey;
    mailPollingInterval = newMailPollingInterval;
    notificationsEnabled = newNotificationsEnabled;
    defaultRemoteImagesEnabled = newDefaultRemoteImagesEnabled;
    translationApiBase = newTranslationApiBase;
    translationApiKey = newTranslationApiKey;
    translationModel = newTranslationModel;
    translationTargetLanguage = newTranslationTargetLanguage;
    mailInsightApiMode = newMailInsightApiMode;
    mailInsightApiBase = newMailInsightApiBase;
    mailInsightApiKey = newMailInsightApiKey;
    mailInsightModel = newMailInsightModel;
    generatedResultAutoCloseSeconds = newGeneratedResultAutoCloseSeconds;
    siteAccessMode = newSiteAccessMode;
    // 从 textarea 解析黑名单规则（覆盖变量中的旧值）
    siteBlocklist = parseBlocklistTextarea();
    defaultFfTempExpiry = newDefaultFfTempExpiry;
    defaultFfMoeExpiry = newDefaultFfMoeExpiry;
    defaultTempExpiry = newDefaultTempExpiry;
    defaultMoeExpiry = newDefaultMoeExpiry;
    syncMailInsightApiFieldsVisibility();

    chrome.storage.local.set({
      apiUrl, adminToken,
      moeApiUrl, moeApiKey,
      floatWindowEnabled: floatEnabled,
      [FLOAT_WINDOW_STYLE_KEY]: newFloatWindowStyle,
      defaultTab: newDefaultTab,
      [TAB_LAYOUT_MODE_KEY]: newTabLayoutMode,
      verifyInterval,
      mailPollingInterval,
      notificationsEnabled,
      defaultRemoteImagesEnabled,
      [TRANSLATION_API_BASE_KEY]: translationApiBase,
      [TRANSLATION_API_KEY_KEY]: translationApiKey,
      [TRANSLATION_MODEL_KEY]: translationModel,
      [TRANSLATION_TARGET_LANGUAGE_KEY]: translationTargetLanguage,
      [MAIL_INSIGHT_API_MODE_KEY]: mailInsightApiMode,
      [MAIL_INSIGHT_API_BASE_KEY]: mailInsightApiBase,
      [MAIL_INSIGHT_API_KEY_KEY]: mailInsightApiKey,
      [MAIL_INSIGHT_MODEL_KEY]: mailInsightModel,
      [GENERATED_RESULT_AUTO_CLOSE_KEY]: generatedResultAutoCloseSeconds,
      siteAccessMode,
      siteAllowlist,
      siteBlocklist,
      [DEFAULT_FF_TEMP_EXPIRY_KEY]: defaultFfTempExpiry,
      [DEFAULT_FF_MOE_EXPIRY_KEY]: defaultFfMoeExpiry,
      [DEFAULT_TEMP_EXPIRY_KEY]: defaultTempExpiry,
      [DEFAULT_MOE_EXPIRY_KEY]: defaultMoeExpiry
    }, async () => {
      setupAutoVerify(verifyInterval);
      await runtimeSendMessage({ type: 'run-mail-poll-now' }).catch(() => {});
      showMessage(settingsMessage, '配置已保存成功！', 'success');
      // 重新加载域名
      if (apiUrl && adminToken) loadDomains();
      if (moeApiUrl && moeApiKey) { moeLoadDomains(); moeLoadEmails(); }
      restoreGeneratedToolResults();
      refreshCurrentSiteInfo();
      setTimeout(() => { settingsMessage.textContent = ''; }, 2000);
    });
  });

  currentSiteToggleBtn.addEventListener('click', () => {
    handleCurrentSiteToggle().catch((error) => {
      showMessage(settingsMessage, `站点设置失败: ${error.message}`, 'error');
    });
  });

  siteAccessModeSelect.addEventListener('change', () => {
    siteAccessMode = siteAccessModeSelect.value || 'all';
    refreshCurrentSiteInfo();
  });

  if (tabLayoutToggle) {
    tabLayoutToggle.addEventListener('click', (event) => {
      const targetBtn = event.target.closest('[data-layout-mode]');
      if (!targetBtn) {
        return;
      }
      const nextMode = normalizeTabLayoutMode(targetBtn.dataset.layoutMode);
      if (nextMode === tabLayoutMode) {
        return;
      }
      saveTabLayoutMode(nextMode);
    });

    tabLayoutToggle.addEventListener('keydown', (event) => {
      const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key)
        ? -1
        : ['ArrowDown', 'ArrowRight'].includes(event.key)
          ? 1
          : 0;
      if (!direction || tabLayoutModeBtns.length < 2) {
        return;
      }
      event.preventDefault();
      const currentIndex = tabLayoutModeBtns.findIndex((btn) => btn.dataset.layoutMode === tabLayoutMode);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (safeIndex + direction + tabLayoutModeBtns.length) % tabLayoutModeBtns.length;
      const nextBtn = tabLayoutModeBtns[nextIndex];
      if (!nextBtn) {
        return;
      }
      saveTabLayoutMode(nextBtn.dataset.layoutMode);
      nextBtn.focus();
    });
  }

  if (floatWindowStyleToggle) {
    floatWindowStyleToggle.addEventListener('click', (event) => {
      const targetBtn = event.target.closest('[data-float-window-style]');
      if (!targetBtn) {
        return;
      }
      const nextStyle = normalizeFloatWindowStyle(targetBtn.dataset.floatWindowStyle);
      if (nextStyle === currentFloatWindowStyle) {
        return;
      }
      saveFloatingWindowStyle(nextStyle);
    });

    floatWindowStyleToggle.addEventListener('keydown', (event) => {
      const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key)
        ? -1
        : ['ArrowDown', 'ArrowRight'].includes(event.key)
          ? 1
          : 0;
      if (!direction || floatWindowStyleBtns.length < 2) {
        return;
      }
      event.preventDefault();
      const currentIndex = floatWindowStyleBtns.findIndex((btn) => btn.dataset.floatWindowStyle === currentFloatWindowStyle);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (safeIndex + direction + floatWindowStyleBtns.length) % floatWindowStyleBtns.length;
      const nextBtn = floatWindowStyleBtns[nextIndex];
      if (!nextBtn) {
        return;
      }
      saveFloatingWindowStyle(nextBtn.dataset.floatWindowStyle);
      nextBtn.focus();
    });
  }

  if (themePicker) {
    themePicker.addEventListener('click', (event) => {
      const targetSwatch = event.target.closest('[data-theme]');
      if (!targetSwatch) {
        return;
      }
      const nextTheme = normalizeTheme(targetSwatch.dataset.theme);
      if (nextTheme === currentTheme) {
        return;
      }
      saveTheme(nextTheme);
    });

    themePicker.addEventListener('keydown', (event) => {
      const direction = ['ArrowUp', 'ArrowLeft'].includes(event.key)
        ? -1
        : ['ArrowDown', 'ArrowRight'].includes(event.key)
          ? 1
          : 0;
      if (!direction || themeSwatches.length < 2) {
        return;
      }
      event.preventDefault();
      const currentIndex = themeSwatches.findIndex((s) => s.dataset.theme === currentTheme);
      const safeIndex = currentIndex >= 0 ? currentIndex : 0;
      const nextIndex = (safeIndex + direction + themeSwatches.length) % themeSwatches.length;
      const nextSwatch = themeSwatches[nextIndex];
      if (!nextSwatch) {
        return;
      }
      saveTheme(nextSwatch.dataset.theme);
      nextSwatch.focus();
    });
  }

  // ===================== 风格页面事件监听 =====================
  if (themesPage) {
    // 主题卡片点击事件 - 应用风格和颜色
    themesPage.addEventListener('click', (event) => {
      // 检查是否点击了颜色选择器
      const colorSwatch = event.target.closest('.theme-color-swatch');
      if (colorSwatch) {
        const themeCard = colorSwatch.closest('.theme-card');
        const selectedTheme = colorSwatch.dataset.theme;
        const selectedStyle = themeCard.dataset.style;
        
        // 更新当前卡片的颜色选择状态
        const allSwatches = themeCard.querySelectorAll('.theme-color-swatch');
        allSwatches.forEach(swatch => {
          swatch.classList.toggle('active', swatch.dataset.theme === selectedTheme);
        });
        
        // 更新卡片的data-theme属性
        themeCard.dataset.theme = selectedTheme;
        
        // 应用主题到body
        document.body.setAttribute('data-style', selectedStyle);
        document.body.setAttribute('data-theme', selectedTheme);
        
        // 保存到storage
        chrome.storage.local.set({ 
          selectedStyle: selectedStyle,
          selectedTheme: selectedTheme
        });
        
        // 同步到悬浮窗
        saveTheme(selectedTheme);
        
        // 显示应用成功提示
        showMessage(createMessage, `已应用 ${themeCard.querySelector('.theme-name').textContent} - ${colorSwatch.title}`, 'success');
        setTimeout(() => {
          createMessage.textContent = '';
          createMessage.className = 'message';
        }, 2000);
        
        return;
      }
      
      // 检查是否点击了主题卡片（但不是颜色选择器）
      const themeCard = event.target.closest('.theme-card');
      if (!themeCard) {
        return;
      }
      
      const selectedStyle = themeCard.dataset.style;
      const selectedTheme = themeCard.dataset.theme;
      
      if (!selectedStyle) {
        return;
      }
      
      // 应用风格和颜色到body
      document.body.setAttribute('data-style', selectedStyle);
      document.body.setAttribute('data-theme', selectedTheme);
      
      // 更新所有主题卡片的激活状态
      const allThemeCards = themesPage.querySelectorAll('.theme-card');
      allThemeCards.forEach(card => {
        card.classList.toggle('active', card.dataset.style === selectedStyle);
      });
      
      // 保存到storage
      chrome.storage.local.set({ 
        selectedStyle: selectedStyle,
        selectedTheme: selectedTheme
      });
      
      // 同步到悬浮窗
      saveTheme(selectedTheme);
      
      // 显示应用成功提示
      showMessage(createMessage, `已应用 ${themeCard.querySelector('.theme-name').textContent}`, 'success');
      setTimeout(() => {
        createMessage.textContent = '';
        createMessage.className = 'message';
      }, 2000);
    });
    
    // 页面加载时应用已保存的风格和颜色
    chrome.storage.local.get(['selectedStyle', 'selectedTheme'], (result) => {
      const savedStyle = result.selectedStyle || 'neumorphism';
      const savedTheme = result.selectedTheme || 'ocean-blue';
      
      document.body.setAttribute('data-style', savedStyle);
      document.body.setAttribute('data-theme', savedTheme);
      
      // 更新主题卡片的激活状态
      const allThemeCards = themesPage.querySelectorAll('.theme-card');
      allThemeCards.forEach(card => {
        card.classList.toggle('active', card.dataset.style === savedStyle);
        
        // 如果是当前激活的风格，更新其颜色选择器状态
        if (card.dataset.style === savedStyle) {
          const allSwatches = card.querySelectorAll('.theme-color-swatch');
          allSwatches.forEach(swatch => {
            swatch.classList.toggle('active', swatch.dataset.theme === savedTheme);
          });
          card.dataset.theme = savedTheme;
        }
      });
    });
  }

  testTempConnectionBtn.addEventListener('click', async () => {
    const targetUrl = apiUrlInput.value.trim().replace(/\/$/, '');
    if (!targetUrl) {
      showMessage(tempConnectionMessage, '请先填写 Temp Email API 地址', 'error');
      return;
    }

    testTempConnectionBtn.disabled = true;
    showMessage(tempConnectionMessage, '连接测试中...', '');
    try {
      const res = await fetch(`${targetUrl}/open_api/settings`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const domains = Array.isArray(data.domains) ? data.domains.length : 0;
      showMessage(tempConnectionMessage, `连接正常，可用域名 ${domains} 个`, 'success');
    } catch (error) {
      showMessage(tempConnectionMessage, `连接失败: ${error.message}`, 'error');
    } finally {
      testTempConnectionBtn.disabled = false;
    }
  });

  testMoeConnectionBtn.addEventListener('click', async () => {
    const targetUrl = moeApiUrlInput.value.trim().replace(/\/$/, '');
    const targetKey = moeApiKeyInput.value.trim();
    if (!targetUrl || !targetKey) {
      showMessage(moeConnectionMessage, '请先填写 MoeMail API 地址和 Key', 'error');
      return;
    }

    testMoeConnectionBtn.disabled = true;
    showMessage(moeConnectionMessage, '连接测试中...', '');
    try {
      const res = await moeFetch(`${targetUrl}/api/config`, {
        headers: { 'X-API-Key': targetKey }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      const domains = String(data.emailDomains || '')
        .split(',')
        .map(domain => domain.trim())
        .filter(Boolean);
      showMessage(moeConnectionMessage, `连接正常，可用域名 ${domains.length} 个`, 'success');
    } catch (error) {
      showMessage(moeConnectionMessage, `连接失败: ${error.message}`, 'error');
    } finally {
      testMoeConnectionBtn.disabled = false;
    }
  });

  // ===================== 获取模型列表（OpenAI 兼容） =====================
  async function fetchModelsFromApi(apiBase, apiKey) {
    const base = String(apiBase || '').replace(/\/$/, '');
    if (!base || !apiKey) {
      throw new Error('请先填写 API Base 和 API Key');
    }
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!response.ok) {
      let msg = `${response.status}`;
      try {
        const err = await response.json();
        msg = err?.error?.message || err?.message || msg;
      } catch {}
      throw new Error(`获取模型列表失败: ${msg}`);
    }
    const data = await response.json();
    const models = (data?.data || []).map(m => m.id).filter(Boolean);
    if (!models.length) {
      throw new Error('该 API 未返回任何可用模型');
    }
    return models;
  }

  function populateModelSelect(selectEl, models) {
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '-- 请选择模型 --';
    selectEl.appendChild(placeholder);
    models.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      selectEl.appendChild(opt);
    });
    selectEl.selectedIndex = 0;
    selectEl.classList.remove('hidden');
  }

  fetchTranslationModelsBtn.addEventListener('click', async () => {
    const base = translationApiBaseInput.value.trim();
    const key = translationApiKeyInput.value.trim();
    const originalText = fetchTranslationModelsBtn.textContent;
    fetchTranslationModelsBtn.textContent = '获取中...';
    fetchTranslationModelsBtn.disabled = true;
    try {
      const models = await fetchModelsFromApi(base, key);
      populateModelSelect(translationModelSelect, models);
      if (translationModelInput.value.trim()) {
        translationModelSelect.value = translationModelInput.value.trim();
      }
    } catch (error) {
      showMessage(settingsMessage, error.message, 'error');
      setTimeout(() => { settingsMessage.textContent = ''; }, 3000);
    } finally {
      fetchTranslationModelsBtn.textContent = originalText;
      fetchTranslationModelsBtn.disabled = false;
    }
  });

  translationModelSelect.addEventListener('change', () => {
    translationModelInput.value = translationModelSelect.value;
  });

  fetchInsightModelsBtn.addEventListener('click', async () => {
    const mode = mailInsightApiModeSelect.value;
    let base, key;
    if (mode === 'custom') {
      base = mailInsightApiBaseInput.value.trim();
      key = mailInsightApiKeyInput.value.trim();
    } else {
      base = translationApiBaseInput.value.trim();
      key = translationApiKeyInput.value.trim();
    }
    const originalInsightText = fetchInsightModelsBtn.textContent;
    fetchInsightModelsBtn.textContent = '获取中...';
    fetchInsightModelsBtn.disabled = true;
    try {
      const models = await fetchModelsFromApi(base, key);
      populateModelSelect(mailInsightModelSelect, models);
      if (mailInsightModelInput.value.trim()) {
        mailInsightModelSelect.value = mailInsightModelInput.value.trim();
      }
    } catch (error) {
      showMessage(settingsMessage, error.message, 'error');
      setTimeout(() => { settingsMessage.textContent = ''; }, 3000);
    } finally {
      fetchInsightModelsBtn.textContent = originalInsightText;
      fetchInsightModelsBtn.disabled = false;
    }
  });

  mailInsightModelSelect.addEventListener('change', () => {
    mailInsightModelInput.value = mailInsightModelSelect.value;
  });

  // ===================== Temp Email: 加载域名 =====================
  async function loadDomains() {
    try {
      domainSelect.disabled = true;
      domainSelect.innerHTML = '<option value="">加载中...</option>';
      createBtn.disabled = true;

      const res = await fetch(`${apiUrl}/open_api/settings`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      
      const data = await res.json();
      const domains = data.domains || [];

      domainSelect.innerHTML = '';
      if (domains.length === 0) {
        domainSelect.innerHTML = '<option value="">无可用域名</option>';
        return;
      }
      
      domains.forEach(d => {
        const option = document.createElement('option');
        option.value = d;
        option.textContent = d;
        domainSelect.appendChild(option);
      });
      
      domainSelect.disabled = false;
      createBtn.disabled = false;
    } catch (e) {
      domainSelect.innerHTML = '<option value="">加载失败</option>';
      showMessage(createMessage, `获取域名失败: ${e.message}`, 'error');
    }
  }

  // 重试获取域名列表
  retryDomainsBtn.addEventListener('click', async () => {
    retryDomainsBtn.style.animation = 'spin 1s linear infinite';
    await loadDomains();
    retryDomainsBtn.style.animation = '';
  });

  // ===================== Temp Email: 创建邮箱 =====================
  createBtn.addEventListener('click', async () => {
    let name = emailNameInput.value.trim();
    const domain = domainSelect.value;
    
    if (!domain) {
      showMessage(createMessage, '错误：无法获取域名', 'error');
      return;
    }

    if (!name) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
      const len = 8 + Math.floor(Math.random() * 5);
      name = '';
      for (let i = 0; i < len; i++) {
        name += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }

    createBtn.disabled = true;
    createBtn.textContent = '创建中...';
    showMessage(createMessage, '', '');
    resultArea.classList.add('hidden');

    try {
      const res = await fetch(`${apiUrl}/admin/new_address`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-auth': adminToken
        },
        body: JSON.stringify({ name, domain })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `${res.status} ${res.statusText}`);
      }

      const data = await res.json();
      const addr = data.address || `${data.name}@${domain}`;

      createdAddressSpan.textContent = addr;
      resultArea.classList.remove('hidden');
      showMessage(createMessage, '创建成功!', 'success');
      updateGeneratedProfile({ email: addr });
      const expiryMs = parseInt(tempExpirySelect.value) || 0;
      addHistory(addr, expiryMs);
    } catch (e) {
      showMessage(createMessage, `创建失败: ${e.message}`, 'error');
    } finally {
      createBtn.disabled = false;
      createBtn.textContent = '创建邮箱';
    }
  });

  mainCopyBtn.addEventListener('click', () => {
    copyToClipboard(createdAddressSpan.textContent, mainCopyBtn);
  });

  fillEmailBtn.addEventListener('click', async () => {
    const address = createdAddressSpan.textContent.trim();
    if (!address) return;
    try {
      await sendToActivePage({ type: 'fill-value', kind: 'email', value: address });
      copyToClipboard(address, fillEmailBtn);
    } catch (error) {
      showMessage(createMessage, `填充失败: ${error.message}`, 'error');
    }
  });
  bindFillPreview(fillEmailBtn, { kind: 'email' });

  function buildAddressString(record) {
    if (!record || typeof record !== 'object') return '';
    if (record.address) return String(record.address).trim();
    if (record.name && record.domain) return `${record.name}@${record.domain}`.trim();
    return String(record.name || '').trim();
  }

  function matchesAddressRecord(record, address) {
    if (!record || !address) return false;
    const normalizedAddress = String(address).trim().toLowerCase();
    const variants = [
      buildAddressString(record),
      record.name,
      record.email
    ].filter(Boolean).map(value => String(value).trim().toLowerCase());
    return variants.includes(normalizedAddress);
  }

  // ===================== Temp Email: 历史记录 =====================
  function addHistory(addr, expiryMs = 0) {
    if (history.length > 0 && history[0] === addr) return;
    history.unshift(addr);
    if (history.length > MAX_HISTORY) {
      const removed = history.pop();
      delete tempMailMeta[removed];
    }
    // Store creation metadata
    if (expiryMs > 0) {
      tempMailMeta[addr] = { createdAt: Date.now(), expiryMs };
    } else {
      tempMailMeta[addr] = { createdAt: Date.now(), expiryMs: 0 };
    }
    chrome.storage.local.set({ emailHistory: history, [TEMP_MAIL_META_KEY]: tempMailMeta });
    renderHistory();
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.innerHTML = '<li style="justify-content:center; color: var(--text-muted); border:none; background:transparent">暂无记录</li>';
      clearHistoryBtn.classList.add('hidden');
      cleanInvalidBtn.classList.add('hidden');
      tempMarkAllReadBtn.classList.add('hidden');
      return;
    }

    clearHistoryBtn.classList.remove('hidden');
    // 如果有已验证失效的邮箱，显示清除失效按钮
    const hasInvalid = history.some(a => verifyStatus[a] === 'invalid');
    if (hasInvalid) cleanInvalidBtn.classList.remove('hidden');
    else cleanInvalidBtn.classList.add('hidden');
    const hasUnread = history.some((addr) => (tempUnreadCounts[addr] || 0) > 0);
    tempMarkAllReadBtn.classList.toggle('hidden', !hasUnread || isTempHistoryBatchMode);

    history.forEach((addr) => {
      const li = document.createElement('li');
      li.style.display = 'flex';
      li.style.alignItems = 'center';

      // 批量删除复选框
      if (isTempHistoryBatchMode) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'batch-checkbox';
        checkbox.checked = selectedTempHistory.has(addr);
        checkbox.onclick = (e) => {
          e.stopPropagation(); // 阻止触发查看邮件
          if (checkbox.checked) {
            selectedTempHistory.add(addr);
          } else {
            selectedTempHistory.delete(addr);
          }
          updateTempHistoryBatchBtn();
        };
        li.appendChild(checkbox);
        li.style.cursor = 'default';
        li.onclick = (e) => {
          // 点击整行时切换 checkbox，如果不点到按钮
          if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && !e.target.closest('button')) {
             checkbox.checked = !checkbox.checked;
             checkbox.onclick({ stopPropagation: () => {} });
          }
        };
      }

      // 验证状态指示点
      const dot = document.createElement('span');
      const status = verifyStatus[addr] || 'unknown';
      dot.className = `verify-dot ${status}`;
      dot.title = status === 'valid' ? '有效' : status === 'invalid' ? '已失效' : status === 'checking' ? '验证中' : status === 'error' ? '检测失败' : '未验证';

      const span = document.createElement('span');
      span.textContent = addr;
      span.title = addr;
      span.style.flex = '1';
      span.style.minWidth = '0';
      span.style.overflow = 'hidden';
      span.style.textOverflow = 'ellipsis';
      if (!isTempHistoryBatchMode) {
        span.style.cursor = 'pointer';
        span.onclick = () => openInboxView(addr);
      }
      
      const btnGroup = document.createElement('div');
      btnGroup.style.display = 'flex';
      btnGroup.style.gap = '4px';
      btnGroup.style.flexShrink = '0';

      const unreadCount = tempUnreadCounts[addr] || 0;
      if (!isTempHistoryBatchMode && unreadCount > 0) {
        const unreadBadge = document.createElement('span');
        unreadBadge.className = 'unread-badge';
        unreadBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
        unreadBadge.title = `${unreadCount} 封未读邮件`;
        btnGroup.appendChild(unreadBadge);
      }

      // Show remaining time if expiry is set
      const meta = tempMailMeta[addr];
      if (meta && meta.expiryMs > 0) {
        const remaining = meta.createdAt + meta.expiryMs - Date.now();
        if (remaining > 0) {
          const expiryHint = document.createElement('span');
          expiryHint.className = 'expiry-hint';
          const hours = Math.floor(remaining / 3600000);
          const mins = Math.floor((remaining % 3600000) / 60000);
          expiryHint.textContent = hours > 0 ? `${hours}h` : `${mins}m`;
          expiryHint.title = `将于 ${new Date(meta.createdAt + meta.expiryMs).toLocaleString()} 自动删除`;
          btnGroup.appendChild(expiryHint);
        } else {
          // Already expired — show expired status
          const expiryHint = document.createElement('span');
          expiryHint.className = 'expiry-hint expired';
          expiryHint.textContent = '已过期';
          expiryHint.title = '将在下次打开面板时自动删除';
          btnGroup.appendChild(expiryHint);
        }
      }

      const copyBtn = document.createElement('button');
      copyBtn.className = 'icon-btn';
      copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      copyBtn.title = '复制地址';
      copyBtn.onclick = (e) => { e.stopPropagation(); copyToClipboard(addr, copyBtn); };

      const fillBtn = document.createElement('button');
      fillBtn.className = 'icon-btn';
      fillBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/><path d="M5 3h14"/></svg>';
      fillBtn.title = '填入当前页面';
      fillBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await sendToActivePage({ type: 'fill-value', kind: 'email', value: addr });
          copyToClipboard(addr, fillBtn);
        } catch (error) {
          showMessage(createMessage, `填充失败: ${error.message}`, 'error');
        }
      };
      bindFillPreview(fillBtn, { kind: 'email' });

      const viewBtn = document.createElement('button');
      viewBtn.className = 'icon-btn';
      viewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';
      viewBtn.title = '查看邮件';
      viewBtn.onclick = (e) => { e.stopPropagation(); openInboxView(addr); };

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
      delBtn.title = '删除此邮箱';
      delBtn.style.color = 'var(--error)';
      delBtn.onclick = (e) => { e.stopPropagation(); deleteAddress(addr, li); };

      if (!isTempHistoryBatchMode) {
        btnGroup.appendChild(copyBtn);
        btnGroup.appendChild(fillBtn);
        btnGroup.appendChild(viewBtn);
        btnGroup.appendChild(delBtn);
      }
      li.appendChild(dot);
      li.appendChild(span);
      li.appendChild(btnGroup);
      historyList.appendChild(li);
    });
  }

  async function markAllTempRead() {
    const unreadAddresses = history.filter((addr) => (tempUnreadCounts[addr] || 0) > 0);
    if (unreadAddresses.length === 0) {
      return;
    }

    tempMarkAllReadBtn.disabled = true;
    const nextTempUnreadCounts = { ...tempUnreadCounts };
    unreadAddresses.forEach((addr) => {
      nextTempUnreadCounts[addr] = 0;
    });
    tempUnreadCounts = nextTempUnreadCounts;
    chrome.storage.local.set({ tempUnreadCounts });
    renderHistory();
    showMessage(verifyStatusDiv, `已将 ${unreadAddresses.length} 个邮箱标为已读`, 'success');
    verifyStatusDiv.classList.remove('hidden');

    try {
      await Promise.all(unreadAddresses.map((address) => runtimeSendMessage({ type: 'clear-temp-unread', address }).catch(() => null)));
    } finally {
      tempMarkAllReadBtn.disabled = false;
    }
  }

  // ===================== Temp Email 批量删除逻辑 =====================
  function updateTempHistoryBatchBtn() {
    if (selectedTempHistory.size > 0) {
      tempHistoryBatchDeleteBtn.textContent = `删除所选 (${selectedTempHistory.size})`;
      tempHistoryBatchDeleteBtn.disabled = false;
    } else {
      tempHistoryBatchDeleteBtn.textContent = '删除所选';
      tempHistoryBatchDeleteBtn.disabled = true;
    }
  }

  tempHistoryBatchToggleBtn.addEventListener('click', () => {
    isTempHistoryBatchMode = !isTempHistoryBatchMode;
    if (isTempHistoryBatchMode) {
      tempHistoryBatchToggleBtn.classList.add('batch-mode-active');
      tempHistoryBatchAction.classList.remove('hidden');
      selectedTempHistory.clear();
      updateTempHistoryBatchBtn();
    } else {
      tempHistoryBatchToggleBtn.classList.remove('batch-mode-active');
      tempHistoryBatchAction.classList.add('hidden');
    }
    renderHistory();
  });

  tempHistoryBatchCancelBtn.addEventListener('click', () => {
    isTempHistoryBatchMode = false;
    tempHistoryBatchToggleBtn.classList.remove('batch-mode-active');
    tempHistoryBatchAction.classList.add('hidden');
    renderHistory();
  });

  tempMarkAllReadBtn.addEventListener('click', () => {
    markAllTempRead().catch((error) => {
      tempMarkAllReadBtn.disabled = false;
      showMessage(verifyStatusDiv, `一键已读失败: ${error.message}`, 'error');
      verifyStatusDiv.classList.remove('hidden');
    });
  });

  tempHistoryBatchDeleteBtn.addEventListener('click', async () => {
    if (selectedTempHistory.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedTempHistory.size} 个邮箱吗？\n如果 API 配置正确，将尝试从服务器同步删除。`)) return;

    tempHistoryBatchDeleteBtn.disabled = true;
    tempHistoryBatchDeleteBtn.textContent = '删除中...';

    // 尽量从服务器删除
    if (apiUrl && adminToken) {
      for (const addr of selectedTempHistory) {
        try {
          const queryRes = await fetch(`${apiUrl}/admin/address?query=${encodeURIComponent(addr)}&limit=10&offset=0`, {
            headers: { 'x-admin-auth': adminToken }
          });
          if (queryRes.ok) {
            const queryData = await queryRes.json();
            const match = (queryData.results || []).find(a => matchesAddressRecord(a, addr));
            if (match) {
              await fetch(`${apiUrl}/admin/delete_address/${match.id}`, {
                method: 'DELETE',
                headers: { 'x-admin-auth': adminToken }
              });
            }
          }
        } catch (e) {
          console.warn('服务端批量删除失败:', e.message);
        }
      }
    }

    // 从本地删除
    history = history.filter(a => !selectedTempHistory.has(a));
    selectedTempHistory.forEach(addr => {
      delete verifyStatus[addr];
      delete tempUnreadCounts[addr];
    });
    chrome.storage.local.set({
      emailHistory: history,
      verifyStatusCache: verifyStatus,
      tempUnreadCounts
    });
    
    // 退出批量模式并重新渲染
    isTempHistoryBatchMode = false;
    tempHistoryBatchToggleBtn.classList.remove('batch-mode-active');
    tempHistoryBatchAction.classList.add('hidden');
    selectedTempHistory.clear();
    renderHistory();
  });

  clearHistoryBtn.addEventListener('click', () => {
    history = [];
    verifyStatus = {};
    tempUnreadCounts = {};
    chrome.storage.local.set({
      emailHistory: history,
      verifyStatusCache: verifyStatus,
      tempUnreadCounts
    });
    renderHistory();
  });

  // ===================== 邮箱有效性验证 =====================
  const VERIFY_RETRY = 3;       // 最大重试次数
  const VERIFY_TIMEOUT = 8000;  // 单次请求超时 (ms)

  // 带重试的单地址验证
  async function verifyAddress(addr) {
    for (let attempt = 1; attempt <= VERIFY_RETRY; attempt++) {
      let timer = null;
      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT);

        const res = await fetch(
          `${apiUrl}/admin/address?query=${encodeURIComponent(addr)}&limit=10&offset=0`,
          { headers: { 'x-admin-auth': adminToken }, signal: controller.signal }
        );

        if (!res.ok) {
          // 非网络错误的 HTTP 错误，不重试
          if (res.status === 401 || res.status === 403) return 'error';
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const match = (data.results || []).find(a => matchesAddressRecord(a, addr));
        return match ? 'valid' : 'invalid';
      } catch (err) {
        console.warn(`验证第 ${attempt} 次失败:`, err.message);
        if (attempt < VERIFY_RETRY) {
          // 指数退避等待
          await new Promise(r => setTimeout(r, 1000 * attempt));
        }
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    }
    // 所有重试都失败，标记为 error（不作失效处理）
    return 'error';
  }

  // 验证全部邮箱
  verifyAllBtn.addEventListener('click', async () => {
    if (!apiUrl || !adminToken) {
      showMessage(verifyStatusDiv, '请先配置 API 地址和密码', 'error');
      verifyStatusDiv.classList.remove('hidden');
      return;
    }
    if (history.length === 0) return;

    verifyAllBtn.disabled = true;
    verifyStatusDiv.classList.remove('hidden');

    let done = 0;
    const total = history.length;

    // 先全部标记为 checking
    history.forEach(a => { verifyStatus[a] = 'checking'; });
    renderHistory();

    // 逐个验证（避免并发过多）
    for (const addr of history) {
      verifyStatusDiv.textContent = `验证中 ${done + 1}/${total}：${addr}`;
      verifyStatusDiv.className = 'message';

      const result = await verifyAddress(addr);
      verifyStatus[addr] = result;
      done++;
      renderHistory();
    }

    const validCount = history.filter(a => verifyStatus[a] === 'valid').length;
    const invalidCount = history.filter(a => verifyStatus[a] === 'invalid').length;
    const errorCount = history.filter(a => verifyStatus[a] === 'error').length;

    let summary = `验证完成：✅ ${validCount} 有效`;
    if (invalidCount > 0) summary += `，❌ ${invalidCount} 已失效`;
    if (errorCount > 0) summary += `，⚠️ ${errorCount} 检测失败（未删除）`;

    chrome.storage.local.set({ verifyStatusCache: verifyStatus });
    showMessage(verifyStatusDiv, summary, invalidCount > 0 ? 'error' : 'success');
    verifyStatusDiv.classList.remove('hidden');
    verifyAllBtn.disabled = false;
  });

  function setupAutoVerify(intervalSetting) {
    applyIntervalControl(
      verifyIntervalSelect,
      verifyIntervalCustomInput,
      verifyIntervalUnitSelect,
      VERIFY_INTERVAL_PRESETS,
      intervalSetting,
      DISABLED_INTERVAL_SETTING
    );
  }

  // 清除已确认失效的邮箱
  cleanInvalidBtn.addEventListener('click', () => {
    const invalidAddrs = history.filter(a => verifyStatus[a] === 'invalid');
    if (invalidAddrs.length === 0) return;
    if (!confirm(`确定清除 ${invalidAddrs.length} 个已失效的邮箱？`)) return;

    history = history.filter(a => verifyStatus[a] !== 'invalid');
    invalidAddrs.forEach(a => delete verifyStatus[a]);
    chrome.storage.local.set({ emailHistory: history, verifyStatusCache: verifyStatus });
    renderHistory();
    showMessage(verifyStatusDiv, `已清除 ${invalidAddrs.length} 个失效邮箱`, 'success');
    verifyStatusDiv.classList.remove('hidden');
  });

  // ===================== Temp Email: 收件箱 =====================
  function openInboxView(address) {
    resetTempMailDetail();
    createPane.classList.add('hidden');
    historySection.classList.add('hidden');
    inboxPane.classList.remove('hidden');
    backToHomeBtn.classList.remove('hidden');
    tabBar.classList.add('hidden');
    mainTitle.textContent = 'Temp Inbox';
    if (mainSubtitle) {
      mainSubtitle.textContent = '查看邮件内容、提取验证码，并处理当前临时邮箱的收件列表。';
    }
    inboxAddressTitle.textContent = address;
    currentInboxAddress = address;
    currentTempMail = null;
    tempMailViewMode = 'safe-html';
    tempMailAllowRemoteImages = defaultRemoteImagesEnabled;
    tempUnreadCounts[address] = 0;
    renderHistory();
    backToHomeBtn.onclick = closeInboxView;
    runtimeSendMessage({ type: 'clear-temp-unread', address }).catch(() => {});
    // Save inbox state so it can be restored on iframe reload
    storageSet({ activeInbox: { type: 'temp', address } }).catch(() => {});
    fetchMails(address);
  }

  function resetTempMailDetail() {
    tempMailDetailRequestToken += 1;
    tempMailTranslationRequestToken += 1;
    tempMailInsightRequestToken += 1;
    currentMailId = null;
    currentTempMail = null;
    tempMailViewMode = 'safe-html';
    tempMailAllowRemoteImages = defaultRemoteImagesEnabled;
    tempMailTranslationText = '';
    tempMailAiInsights = null;
    tempMailInsightStatus = 'idle';
    tempMailInsightError = '';
    mailInsights.classList.add('hidden');
    mailInsights.innerHTML = '';
    mailBody.innerHTML = '';
    resetTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, retranslateMailBtn);
    updateTempMailActionButtons(null);
  }

  function resetMoeMailDetail() {
    moeMailTranslationRequestToken += 1;
    moeMailInsightRequestToken += 1;
    currentMoeMail = null;
    moeMailViewMode = 'safe-html';
    moeMailAllowRemoteImages = defaultRemoteImagesEnabled;
    moeMailTranslationText = '';
    moeMailAiInsights = null;
    moeMailInsightStatus = 'idle';
    moeMailInsightError = '';
    moeMailInsights.classList.add('hidden');
    moeMailInsights.innerHTML = '';
    moeMailBody.innerHTML = '';
    resetTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, retranslateMoeMailBtn);
    updateMoeMailActionButtons(null);
  }

  function closeInboxView() {
    inboxPane.classList.add('hidden');
    backToHomeBtn.classList.add('hidden');
    createPane.classList.remove('hidden');
    historySection.classList.remove('hidden');
    tabBar.classList.remove('hidden');
    updateHeaderForTab(activeTab);
    mailContent.classList.add('hidden');
    mailList.classList.remove('hidden');
    backToListBtn.classList.add('hidden');
    resetTempMailDetail();
    currentTempMails = [];
    currentInboxAddress = null;
    storageSet({ activeInbox: null }).catch(() => {});
  }

  backToListBtn.addEventListener('click', () => {
    mailContent.classList.add('hidden');
    mailList.classList.remove('hidden');
    backToListBtn.classList.add('hidden');
    resetTempMailDetail();
  });

  // 刷新 Temp Email 收件箱
  refreshInboxBtn.addEventListener('click', () => {
    if (currentInboxAddress) fetchMails(currentInboxAddress);
  });

  deleteMailBtn.addEventListener('click', async () => {
    if (!currentMailId) return;
    if (!confirm('确定要删除这封邮件吗？')) return;
    setMailActionButtonState(deleteMailBtn, {
      icon: 'loading',
      title: '删除中...',
      disabled: true,
      danger: true
    });
    try {
      const res = await fetch(`${apiUrl}/admin/mails/${currentMailId}`, {
        method: 'DELETE',
        headers: { 'x-admin-auth': adminToken }
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      currentMailId = null;
      currentTempMail = null;
      mailContent.classList.add('hidden');
      mailList.classList.remove('hidden');
      if (currentInboxAddress) {
        fetchMails(currentInboxAddress);
      }
    } catch(e) {
      alert('删除失败: ' + e.message);
    } finally {
      setMailActionButtonState(deleteMailBtn, {
        icon: 'delete',
        title: '删除此邮件',
        danger: true
      });
    }
  });

  async function deleteAddress(addr, liElement) {
    if (!confirm(`确定要删除邮箱 ${addr} 及其所有邮件吗？`)) return;
    let serverDeleted = false;
    try {
      const queryRes = await fetch(`${apiUrl}/admin/address?query=${encodeURIComponent(addr)}&limit=10&offset=0`, {
        headers: { 'x-admin-auth': adminToken }
      });
      if (queryRes.ok) {
        const queryData = await queryRes.json();
        const match = (queryData.results || []).find(a => matchesAddressRecord(a, addr));
        if (match) {
          const delRes = await fetch(`${apiUrl}/admin/delete_address/${match.id}`, {
            method: 'DELETE',
            headers: { 'x-admin-auth': adminToken }
          });
          serverDeleted = delRes.ok;
        }
      }
    } catch(e) {
      console.warn('服务端删除失败:', e.message);
    }

    if (!serverDeleted) {
      if (!confirm('服务端删除失败。\n是否仅从本地历史记录中移除？')) return;
    }

    history = history.filter(a => a !== addr);
    delete verifyStatus[addr];
    delete tempUnreadCounts[addr];
    delete tempMailMeta[addr];
    chrome.storage.local.set({
      emailHistory: history,
      verifyStatusCache: verifyStatus,
      tempUnreadCounts,
      [TEMP_MAIL_META_KEY]: tempMailMeta
    });
    liElement.style.transition = 'opacity 0.3s, transform 0.3s';
    liElement.style.opacity = '0';
    liElement.style.transform = 'translateX(20px)';
    setTimeout(() => renderHistory(), 300);
  }

  async function checkAndDeleteExpiredTempMails() {
    if (!apiUrl || !adminToken) return;
    const now = Date.now();
    const toDelete = [];

    for (const addr of history) {
      const meta = tempMailMeta[addr];
      if (!meta || !meta.expiryMs || meta.expiryMs <= 0) continue; // no expiry set
      if (now < meta.createdAt + meta.expiryMs) continue; // not yet expired
      toDelete.push(addr);
    }

    if (toDelete.length === 0) return;

    console.log('[TempMail] Auto-deleting expired addresses:', toDelete.length);

    for (const addr of toDelete) {
      try {
        // Try server-side deletion first
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
      } catch (e) {
        console.warn('[TempMail] Server delete failed:', e.message);
      }
      // Remove from local state regardless of server result
      history = history.filter(a => a !== addr);
      delete verifyStatus[addr];
      delete tempUnreadCounts[addr];
      delete tempMailMeta[addr];
    }

    chrome.storage.local.set({
      emailHistory: history,
      verifyStatusCache: verifyStatus,
      tempUnreadCounts,
      [TEMP_MAIL_META_KEY]: tempMailMeta
    });
    renderHistory();
  }

  async function fetchMails(address) {
    mailList.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">加载中...</div>';
    try {
      const res = await fetch(`${apiUrl}/admin/mails?address=${encodeURIComponent(address)}&limit=50&offset=0&summary_only=true`, {
        headers: { 'x-admin-auth': adminToken }
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      currentTempMails = (data.results || []).map((mail) => ({
        id: mail.id,
        message_id: mail.message_id,
        source: mail.source,
        address: mail.address,
        created_at: mail.created_at,
        metadata: mail.metadata,
        subject: mail.subject
      }));
      tempUnreadCounts[address] = 0;
      chrome.storage.local.set({ tempUnreadCounts });
      renderTempMails();
    } catch (e) {
      mailList.innerHTML = `<div style="padding:12px; text-align:center; color:var(--error);">加载失败: ${e.message}</div>`;
    }
  }

  async function fetchTempMailById(mailId, address = '') {
    const res = await fetch(`${apiUrl}/admin/mails/${mailId}`, {
      headers: { 'x-admin-auth': adminToken }
    });
    if (res.ok) {
      return res.json();
    }

    if (res.status !== 404) {
      throw new Error(`${res.status}`);
    }

    const fallbackAddress = String(address || currentInboxAddress || '').trim();
    if (!fallbackAddress) {
      throw new Error('404');
    }

    // 兼容尚未部署单封详情接口的旧后端：
    // 回退到旧的列表接口重新拉取当前收件箱，并从中定位目标邮件正文。
    const fallbackRes = await fetch(
      `${apiUrl}/admin/mails?address=${encodeURIComponent(fallbackAddress)}&limit=50&offset=0`,
      {
        headers: { 'x-admin-auth': adminToken }
      }
    );
    if (!fallbackRes.ok) {
      throw new Error(`${res.status}`);
    }

    const fallbackData = await fallbackRes.json();
    const matchedMail = (fallbackData.results || []).find((item) => String(item?.id) === String(mailId));
    if (!matchedMail) {
      throw new Error('404');
    }

    return matchedMail;
  }

  function renderTempMails() {
    mailList.innerHTML = '';
    if (currentTempMails.length === 0) {
      mailList.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">收件箱为空</div>';
      return;
    }
    currentTempMails.forEach(mail => {
        const item = document.createElement('div');
        item.className = 'mail-item';
        item.style.display = 'flex';
        item.style.alignItems = 'center';

        // 批量删除复选框
        if (isTempInboxBatchMode) {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'batch-checkbox';
          checkbox.checked = selectedTempMails.has(mail.id);
          checkbox.onclick = (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
              selectedTempMails.add(mail.id);
            } else {
              selectedTempMails.delete(mail.id);
            }
            updateTempInboxBatchBtn();
          };
          item.appendChild(checkbox);
          item.style.cursor = 'default';
          item.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
               checkbox.checked = !checkbox.checked;
               checkbox.onclick({ stopPropagation: () => {} });
            }
          };
        } else {
          item.addEventListener('click', () => showMailDetail(mail));
        }

        const contentDiv = document.createElement('div');
        contentDiv.style.flex = '1';
        contentDiv.style.minWidth = '0';
        contentDiv.innerHTML = `
          <div class="mail-item-header">
            <div class="mail-subject">${escapeHtml(mail.subject || '(无主题)')}</div>
            <div class="mail-time">${new Date(mail.created_at).toLocaleString()}</div>
          </div>
          <div class="mail-sender">${escapeHtml(mail.source || '未知')}</div>`;
        item.appendChild(contentDiv);
        
        mailList.appendChild(item);
      });
  }

  // ===================== Temp Email Inbox 批量删除逻辑 =====================
  function updateTempInboxBatchBtn() {
    if (selectedTempMails.size > 0) {
      tempInboxBatchDeleteBtn.textContent = `删除所选 (${selectedTempMails.size})`;
      tempInboxBatchDeleteBtn.disabled = false;
    } else {
      tempInboxBatchDeleteBtn.textContent = '删除所选';
      tempInboxBatchDeleteBtn.disabled = true;
    }
  }

  tempInboxBatchToggleBtn.addEventListener('click', () => {
    isTempInboxBatchMode = !isTempInboxBatchMode;
    if (isTempInboxBatchMode) {
      tempInboxBatchToggleBtn.classList.add('batch-mode-active');
      tempInboxBatchAction.classList.remove('hidden');
      selectedTempMails.clear();
      updateTempInboxBatchBtn();
    } else {
      tempInboxBatchToggleBtn.classList.remove('batch-mode-active');
      tempInboxBatchAction.classList.add('hidden');
    }
    renderTempMails();
  });

  tempInboxBatchCancelBtn.addEventListener('click', () => {
    isTempInboxBatchMode = false;
    tempInboxBatchToggleBtn.classList.remove('batch-mode-active');
    tempInboxBatchAction.classList.add('hidden');
    renderTempMails();
  });

  tempInboxBatchDeleteBtn.addEventListener('click', async () => {
    if (selectedTempMails.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedTempMails.size} 封邮件吗？`)) return;

    tempInboxBatchDeleteBtn.disabled = true;
    tempInboxBatchDeleteBtn.textContent = '删除中...';

    for (const mailId of selectedTempMails) {
      try {
        await fetch(`${apiUrl}/admin/mails/${mailId}`, {
          method: 'DELETE',
          headers: { 'x-admin-auth': adminToken }
        });
      } catch (e) {
        console.warn('删除邮件失败:', e.message);
      }
    }
    
    // 退出批量模式并重新渲染
    isTempInboxBatchMode = false;
    tempInboxBatchToggleBtn.classList.remove('batch-mode-active');
    tempInboxBatchAction.classList.add('hidden');
    selectedTempMails.clear();
    if (currentInboxAddress) fetchMails(currentInboxAddress);
  });

  async function showMailDetail(mail) {
    const requestToken = ++tempMailDetailRequestToken;
    tempMailTranslationRequestToken += 1;
    tempMailInsightRequestToken += 1;
    mailList.classList.add('hidden');
    mailContent.classList.remove('hidden');
    backToListBtn.classList.remove('hidden');
    currentTempMail = mail;
    tempMailViewMode = 'safe-html';
    tempMailAllowRemoteImages = defaultRemoteImagesEnabled;
    tempMailTranslationText = '';
    tempMailAiInsights = null;
    tempMailInsightStatus = 'idle';
    tempMailInsightError = '';
    currentMailId = mail.id;
    mailFrom.textContent = `发件人: ${mail.source}`;
    mailSubject.textContent = mail.subject || '(无主题)';
    mailTime.textContent = `时间: ${new Date(mail.created_at).toLocaleString()}`;
    renderPlainText(mailBody, '加载邮件内容中...');
    resetTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, retranslateMailBtn);
    mailInsights.classList.add('hidden');
    mailInsights.innerHTML = '';
    setMailActionButtonState(translateMailBtn, { icon: 'translate', title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API', disabled: false });
    setMailActionButtonState(toggleMailViewBtn, { icon: 'plainText', title: '加载邮件中...', disabled: true });
    setMailActionButtonState(toggleMailImagesBtn, { icon: 'noImages', title: '加载邮件中...', disabled: true });
    setMailActionButtonState(deleteMailBtn, {
      icon: 'delete',
      title: '删除此邮件',
      danger: true
    });

    try {
      const fullMail = mail.raw ? mail : await fetchTempMailById(mail.id, mail.address);
      if (requestToken !== tempMailDetailRequestToken || currentMailId !== mail.id) {
        return;
      }
      currentTempMail = {
        ...mail,
        ...fullMail
      };
      renderCurrentTempMail();
      if (hasMailInsightConfig()) {
        triggerTempMailAiInsights();
      }
    } catch (error) {
      if (requestToken !== tempMailDetailRequestToken || currentMailId !== mail.id) {
        return;
      }
      renderPlainText(mailBody, `加载邮件失败：${error.message}`);
      mailInsights.classList.add('hidden');
      mailInsights.innerHTML = '';
      updateTempMailActionButtons(null);
    }
  }

  function renderCurrentTempMail() {
    if (!currentTempMail) return;
    const parsed = renderEmailBody(mailBody, currentTempMail.raw || '', {
      viewMode: tempMailViewMode,
      insightsContainer: mailInsights,
      allowRemoteImages: tempMailAllowRemoteImages,
      insightsOverride: getTempMailInsightsOverride(),
      insightsRenderOptions: buildTempMailInsightRenderOptions()
    });
    updateTempMailActionButtons(parsed);
  }

  async function triggerTempMailAiInsights(force = false) {
    if (!currentTempMail) {
      return;
    }
    if (!force && (tempMailInsightStatus === 'loading' || tempMailInsightStatus === 'success')) {
      return;
    }
    if (!hasMailInsightConfig()) {
      tempMailInsightStatus = 'error';
      tempMailInsightError = getMailInsightConfigErrorMessage();
      renderCurrentTempMail();
      return;
    }

    const requestToken = ++tempMailInsightRequestToken;
    const stableMailId = currentMailId;
    tempMailInsightStatus = 'loading';
    tempMailInsightError = '';
    if (force) {
      tempMailAiInsights = null;
    }
    renderCurrentTempMail();

    try {
      const extracted = await extractMailInsightsWithApi(getTempMailTranslationSource(currentTempMail), {
        subject: currentTempMail.subject,
        from: currentTempMail.source
      });
      if (requestToken !== tempMailInsightRequestToken || !currentTempMail || currentMailId !== stableMailId) {
        return;
      }
      tempMailAiInsights = extracted;
      tempMailInsightStatus = 'success';
      tempMailInsightError = '';
      renderCurrentTempMail();
    } catch (error) {
      if (requestToken !== tempMailInsightRequestToken || !currentTempMail || currentMailId !== stableMailId) {
        return;
      }
      tempMailAiInsights = null;
      tempMailInsightStatus = 'error';
      tempMailInsightError = error.message || '未知错误';
      renderCurrentTempMail();
    }
  }

  toggleMailViewBtn.addEventListener('click', () => {
    if (!currentTempMail) return;
    tempMailViewMode = tempMailViewMode === 'safe-html' ? 'plain-text' : 'safe-html';
    renderCurrentTempMail();
  });

  toggleMailImagesBtn.addEventListener('click', () => {
    if (!currentTempMail) return;
    tempMailAllowRemoteImages = !tempMailAllowRemoteImages;
    renderCurrentTempMail();
  });

  translateMailBtn.addEventListener('click', async () => {
    if (!currentTempMail) {
      return;
    }
    // If translation panel is visible → collapse it
    if (!mailTranslation.classList.contains('hidden')) {
      mailTranslation.classList.add('hidden');
      setMailActionButtonState(translateMailBtn, {
        icon: 'translate',
        title: tempMailTranslationText ? '查看翻译' : (hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API'),
        disabled: !currentTempMail
      });
      return;
    }
    // If we have cached translation text → just show it (no API call)
    if (tempMailTranslationText) {
      renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, tempMailTranslationText, `AI 翻译 · ${translationTargetLanguage}`, retranslateMailBtn);
      setMailActionButtonState(translateMailBtn, { icon: 'collapseTranslation', title: '收起翻译', disabled: false });
      return;
    }
    // No cached translation → call API
    const requestToken = ++tempMailTranslationRequestToken;
    renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, '翻译中...', 'AI 翻译 · 正在处理', retranslateMailBtn);
    retranslateMailBtn.classList.add('hidden');
    copyMailTranslationBtn.classList.add('hidden');
    setMailActionButtonState(translateMailBtn, { icon: 'loading', title: '翻译中...', disabled: true });
    try {
      const translated = await translateTextWithApi(getTempMailTranslationSource(currentTempMail), {
        subject: currentTempMail.subject,
        from: currentTempMail.source
      });
      if (requestToken !== tempMailTranslationRequestToken || !currentTempMail) {
        return;
      }
      tempMailTranslationText = translated;
      renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, translated, `AI 翻译 · ${translationTargetLanguage}`, retranslateMailBtn);
      setMailActionButtonState(translateMailBtn, { icon: 'collapseTranslation', title: '收起翻译', disabled: false });
    } catch (error) {
      if (requestToken !== tempMailTranslationRequestToken) {
        return;
      }
      renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, `翻译失败：${error.message}`, 'AI 翻译 · 调用失败', retranslateMailBtn);
      copyMailTranslationBtn.classList.add('hidden');
      setMailActionButtonState(translateMailBtn, {
        icon: 'translate',
        title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API',
        disabled: !currentTempMail
      });
    }
  });

  retranslateMailBtn.addEventListener('click', async () => {
    if (!currentTempMail) return;
    tempMailTranslationText = '';
    const requestToken = ++tempMailTranslationRequestToken;
    renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, '翻译中...', 'AI 翻译 · 正在处理', retranslateMailBtn);
    retranslateMailBtn.classList.add('hidden');
    copyMailTranslationBtn.classList.add('hidden');
    setMailActionButtonState(translateMailBtn, { icon: 'loading', title: '翻译中...', disabled: true });
    try {
      const translated = await translateTextWithApi(getTempMailTranslationSource(currentTempMail), {
        subject: currentTempMail.subject,
        from: currentTempMail.source
      });
      if (requestToken !== tempMailTranslationRequestToken || !currentTempMail) return;
      tempMailTranslationText = translated;
      renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, translated, `AI 翻译 · ${translationTargetLanguage}`, retranslateMailBtn);
      setMailActionButtonState(translateMailBtn, { icon: 'collapseTranslation', title: '收起翻译', disabled: false });
    } catch (error) {
      if (requestToken !== tempMailTranslationRequestToken) return;
      renderTranslationPanel(mailTranslation, mailTranslationTitle, mailTranslationBody, copyMailTranslationBtn, `翻译失败：${error.message}`, 'AI 翻译 · 调用失败', retranslateMailBtn);
      copyMailTranslationBtn.classList.add('hidden');
      setMailActionButtonState(translateMailBtn, {
        icon: 'translate',
        title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API',
        disabled: !currentTempMail
      });
    }
  });

  copyMailTranslationBtn.addEventListener('click', () => {
    if (!tempMailTranslationText) {
      return;
    }
    copyToClipboard(tempMailTranslationText, copyMailTranslationBtn);
  });

  // MoeMail 保存设置已合并到统一设置页

  // ===================== MoeMail: API 辅助函数 =====================
  function moeHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': moeApiKey
    };
  }

  // ===================== MoeMail: 加载域名 =====================
  async function moeLoadDomains() {
    try {
      moeDomainSelect.disabled = true;
      moeDomainSelect.innerHTML = '<option value="">加载中...</option>';
      moeCreateBtn.disabled = true;

      const res = await moeFetch(`${moeApiUrl}/api/config`, {
        headers: moeHeaders()
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();

      // emailDomains 是逗号分隔的字符串
      const domainStr = data.emailDomains || '';
      const domains = domainStr.split(',').map(d => d.trim()).filter(Boolean);

      moeDomainSelect.innerHTML = '';
      if (domains.length === 0) {
        moeDomainSelect.innerHTML = '<option value="">无可用域名</option>';
        return;
      }

      domains.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        moeDomainSelect.appendChild(opt);
      });

      moeDomainSelect.disabled = false;
      moeCreateBtn.disabled = false;
    } catch (e) {
      moeDomainSelect.innerHTML = '<option value="">加载失败</option>';
      showMessage(moeCreateMessage, `获取域名失败: ${e.message}`, 'error');
    }
  }

  // MoeMail 重试获取域名列表
  moeRetryDomainsBtn.addEventListener('click', async () => {
    moeRetryDomainsBtn.style.animation = 'spin 1s linear infinite';
    await moeLoadDomains();
    moeRetryDomainsBtn.style.animation = '';
  });

  // ===================== MoeMail: 创建邮箱 =====================
  moeCreateBtn.addEventListener('click', async () => {
    const name = moeEmailNameInput.value.trim();
    const domain = moeDomainSelect.value;
    const expiryTime = parseInt(moeExpirySelect.value);

    if (!domain) {
      showMessage(moeCreateMessage, '错误：无可用域名', 'error');
      return;
    }

    moeCreateBtn.disabled = true;
    moeCreateBtn.textContent = '创建中...';
    showMessage(moeCreateMessage, '', '');

    try {
      const res = await moeFetch(`${moeApiUrl}/api/emails/generate`, {
        method: 'POST',
        headers: moeHeaders(),
        body: JSON.stringify({ name, domain, expiryTime })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `${res.status}`);
      }

      const data = await res.json();
      showMessage(moeCreateMessage, `创建成功: ${data.email}`, 'success');
      updateGeneratedProfile({ email: data.email || generatedProfile.email });
      moeEmailNameInput.value = '';
      // 刷新邮箱列表
      moeLoadEmails();
    } catch (e) {
      showMessage(moeCreateMessage, `创建失败: ${e.message}`, 'error');
    } finally {
      moeCreateBtn.disabled = false;
      moeCreateBtn.textContent = '创建邮箱';
    }
  });

  // ===================== MoeMail: 加载邮箱列表 =====================
  async function moeLoadEmails() {
    moeEmailListDiv.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">加载中...</div>';
    try {
      const res = await moeFetch(`${moeApiUrl}/api/emails`, {
        headers: moeHeaders()
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      currentMoeEmails = data.emails || [];
      chrome.storage.local.set({
        moeEmailCache: currentMoeEmails.map(email => ({
          id: email.id,
          address: email.address,
          expiresAt: email.expiresAt
        }))
      });
      renderMoeEmails();
    } catch (e) {
      moeEmailListDiv.innerHTML = `<div style="padding:12px; text-align:center; color:var(--error);">加载失败: ${e.message}</div>`;
    }
  }

  function renderMoeEmails() {
    moeEmailListDiv.innerHTML = '';
    if (currentMoeEmails.length === 0) {
      moeMarkAllReadBtn.classList.add('hidden');
      moeEmailListDiv.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">暂无邮箱</div>';
      return;
    }

    const hasUnread = currentMoeEmails.some((email) => (moeUnreadCounts[String(email.id)] || 0) > 0);
    moeMarkAllReadBtn.classList.toggle('hidden', !hasUnread || isMoeHistoryBatchMode);

    currentMoeEmails.forEach(email => {
        const card = document.createElement('div');
        card.className = 'moe-email-card';
        card.style.display = 'flex';
        card.style.alignItems = 'center';

        // 批量删除复选框
        if (isMoeHistoryBatchMode) {
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'batch-checkbox';
          checkbox.checked = selectedMoeHistory.has(email.id);
          checkbox.onclick = (e) => {
            e.stopPropagation();
            if (checkbox.checked) {
              selectedMoeHistory.add(email.id);
            } else {
              selectedMoeHistory.delete(email.id);
            }
            updateMoeHistoryBatchBtn();
          };
          card.appendChild(checkbox);
          card.style.cursor = 'default';
          card.onclick = (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT' && !e.target.closest('button')) {
               checkbox.checked = !checkbox.checked;
               checkbox.onclick({ stopPropagation: () => {} });
            }
          };
        }

        const contentWrapper = document.createElement('div');
        contentWrapper.style.flex = '1';
        contentWrapper.style.display = 'flex';
        contentWrapper.style.justifyContent = 'space-between';
        contentWrapper.style.alignItems = 'center';

        const info = document.createElement('div');
        info.className = 'moe-email-info';

        const addr = document.createElement('div');
        addr.className = 'moe-email-addr';
        addr.textContent = email.address;
        addr.title = email.address;
        if (!isMoeHistoryBatchMode) {
            addr.style.cursor = 'pointer';
            addr.onclick = (e) => { e.stopPropagation(); moeOpenInbox(email); };
        }

        const meta = document.createElement('div');
        meta.className = 'moe-email-meta';
        const expiresAt = new Date(email.expiresAt);
        const isForever = expiresAt.getFullYear() >= 9000;
        meta.textContent = isForever ? '永久有效' : `过期: ${expiresAt.toLocaleString()}`;

        info.appendChild(addr);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'moe-email-actions';

        const unreadCount = moeUnreadCounts[String(email.id)] || 0;
        if (!isMoeHistoryBatchMode && unreadCount > 0) {
          const unreadBadge = document.createElement('span');
          unreadBadge.className = 'unread-badge';
          unreadBadge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          unreadBadge.title = `${unreadCount} 封未读邮件`;
          actions.appendChild(unreadBadge);
        }

        // 复制按钮
        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-btn';
        copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
        copyBtn.title = '复制地址';
        copyBtn.onclick = (e) => { e.stopPropagation(); copyToClipboard(email.address, copyBtn); };

        const fillBtn = document.createElement('button');
        fillBtn.className = 'icon-btn';
        fillBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/><path d="M5 3h14"/></svg>';
        fillBtn.title = '填入当前页面';
        fillBtn.onclick = async (e) => {
          e.stopPropagation();
          try {
            await sendToActivePage({ type: 'fill-value', kind: 'email', value: email.address });
            copyToClipboard(email.address, fillBtn);
          } catch (error) {
            showMessage(moeCreateMessage, `填充失败: ${error.message}`, 'error');
          }
        };
        bindFillPreview(fillBtn, { kind: 'email' });

        // 查看邮件按钮
        const viewBtn = document.createElement('button');
        viewBtn.className = 'icon-btn';
        viewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';
        viewBtn.title = '查看邮件';
        viewBtn.onclick = (e) => { e.stopPropagation(); moeOpenInbox(email); };

        // 删除按钮
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn';
        delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
        delBtn.title = '删除此邮箱';
        delBtn.style.color = 'var(--error)';
        delBtn.onclick = (e) => { e.stopPropagation(); moeDeleteEmail(email.id, card); };

        if (!isMoeHistoryBatchMode) {
          actions.appendChild(copyBtn);
          actions.appendChild(fillBtn);
          actions.appendChild(viewBtn);
          actions.appendChild(delBtn);
        }

        contentWrapper.appendChild(info);
        contentWrapper.appendChild(actions);
        card.appendChild(contentWrapper);
        moeEmailListDiv.appendChild(card);
      });
  }

  async function markAllMoeRead() {
    const unreadEmails = currentMoeEmails.filter((email) => (moeUnreadCounts[String(email.id)] || 0) > 0);
    if (unreadEmails.length === 0) {
      return;
    }

    moeMarkAllReadBtn.disabled = true;
    const nextMoeUnreadCounts = { ...moeUnreadCounts };
    unreadEmails.forEach((email) => {
      nextMoeUnreadCounts[String(email.id)] = 0;
    });
    moeUnreadCounts = nextMoeUnreadCounts;
    chrome.storage.local.set({ moeUnreadCounts });
    renderMoeEmails();
    showMessage(moeCreateMessage, `已将 ${unreadEmails.length} 个邮箱标为已读`, 'success');

    try {
      await Promise.all(unreadEmails.map((email) => runtimeSendMessage({ type: 'clear-moe-unread', emailId: email.id }).catch(() => null)));
    } finally {
      moeMarkAllReadBtn.disabled = false;
    }
  }

  // ===================== MoeMail History 批量删除逻辑 =====================
  function updateMoeHistoryBatchBtn() {
    if (selectedMoeHistory.size > 0) {
      moeHistoryBatchDeleteBtn.textContent = `删除所选 (${selectedMoeHistory.size})`;
      moeHistoryBatchDeleteBtn.disabled = false;
    } else {
      moeHistoryBatchDeleteBtn.textContent = '删除所选';
      moeHistoryBatchDeleteBtn.disabled = true;
    }
  }

  moeHistoryBatchToggleBtn.addEventListener('click', () => {
    isMoeHistoryBatchMode = !isMoeHistoryBatchMode;
    if (isMoeHistoryBatchMode) {
      moeHistoryBatchToggleBtn.classList.add('batch-mode-active');
      moeHistoryBatchAction.classList.remove('hidden');
      selectedMoeHistory.clear();
      updateMoeHistoryBatchBtn();
    } else {
      moeHistoryBatchToggleBtn.classList.remove('batch-mode-active');
      moeHistoryBatchAction.classList.add('hidden');
    }
    renderMoeEmails();
  });

  moeHistoryBatchCancelBtn.addEventListener('click', () => {
    isMoeHistoryBatchMode = false;
    moeHistoryBatchToggleBtn.classList.remove('batch-mode-active');
    moeHistoryBatchAction.classList.add('hidden');
    renderMoeEmails();
  });

  moeMarkAllReadBtn.addEventListener('click', () => {
    markAllMoeRead().catch((error) => {
      moeMarkAllReadBtn.disabled = false;
      showMessage(moeCreateMessage, `一键已读失败: ${error.message}`, 'error');
    });
  });

  moeHistoryBatchDeleteBtn.addEventListener('click', async () => {
    if (selectedMoeHistory.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedMoeHistory.size} 个邮箱吗？此操作不可恢复。`)) return;

    moeHistoryBatchDeleteBtn.disabled = true;
    moeHistoryBatchDeleteBtn.textContent = '删除中...';

    for (const emailId of selectedMoeHistory) {
      try {
        await moeFetch(`${moeApiUrl}/api/emails/${emailId}`, {
          method: 'DELETE',
          headers: moeHeaders()
        });
      } catch (e) {
        console.warn('删除 MoeMail 失败:', e.message);
      }
    }
    
    // 退出批量模式并重新渲染
    isMoeHistoryBatchMode = false;
    moeHistoryBatchToggleBtn.classList.remove('batch-mode-active');
    moeHistoryBatchAction.classList.add('hidden');
    selectedMoeHistory.forEach(emailId => {
      delete moeUnreadCounts[String(emailId)];
    });
    chrome.storage.local.set({ moeUnreadCounts });
    selectedMoeHistory.clear();
    moeLoadEmails();
  });

  moeRefreshBtn.addEventListener('click', () => moeLoadEmails());

  // ===================== MoeMail: 删除邮箱 =====================
  async function moeDeleteEmail(emailId, cardElement) {
    if (!confirm('确定要删除此邮箱及其所有邮件吗？')) return;
    try {
      const res = await moeFetch(`${moeApiUrl}/api/emails/${emailId}`, {
        method: 'DELETE',
        headers: moeHeaders()
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `${res.status}`);
      }
      delete moeUnreadCounts[String(emailId)];
      chrome.storage.local.set({ moeUnreadCounts });
      cardElement.style.transition = 'opacity 0.3s, transform 0.3s';
      cardElement.style.opacity = '0';
      cardElement.style.transform = 'translateX(20px)';
      setTimeout(() => moeLoadEmails(), 300);
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  // ===================== MoeMail: 收件箱 =====================
  function moeOpenInbox(email) {
    moeCreatePane.classList.add('hidden');
    moeEmailListSection.classList.add('hidden');
    moeInboxPane.classList.remove('hidden');
    backToHomeBtn.classList.remove('hidden');
    tabBar.classList.add('hidden');
    mainTitle.textContent = 'Moe Inbox';
    if (mainSubtitle) {
      mainSubtitle.textContent = '查看 MoeMail 收件箱、切换邮件视图，并处理远程图片加载。';
    }
    moeInboxTitle.textContent = email.address;
    moeCurrentEmailId = email.id;
    currentMoeMail = null;
    moeMailViewMode = 'safe-html';
    moeMailAllowRemoteImages = defaultRemoteImagesEnabled;
    moeUnreadCounts[String(email.id)] = 0;
    renderMoeEmails();
    backToHomeBtn.onclick = closeMoeInboxView;
    runtimeSendMessage({ type: 'clear-moe-unread', emailId: email.id }).catch(() => {});
    // Save inbox state for restore on iframe reload
    storageSet({ activeInbox: { type: 'moe', emailId: email.id, address: email.address } }).catch(() => {});
    moeFetchMails(email.id);
  }

  function closeMoeInboxView() {
    moeInboxPane.classList.add('hidden');
    backToHomeBtn.classList.add('hidden');
    moeCreatePane.classList.remove('hidden');
    moeEmailListSection.classList.remove('hidden');
    tabBar.classList.remove('hidden');
    updateHeaderForTab(activeTab);
    moeMailContent.classList.add('hidden');
    moeMailList.classList.remove('hidden');
    moeBackToListBtn.classList.add('hidden');
    resetMoeMailDetail();
    moeCurrentEmailId = null;
    storageSet({ activeInbox: null }).catch(() => {});
  }

  moeBackToListBtn.addEventListener('click', () => {
    moeMailContent.classList.add('hidden');
    moeMailList.classList.remove('hidden');
    moeBackToListBtn.classList.add('hidden');
    resetMoeMailDetail();
  });

  // 刷新 MoeMail 收件箱
  moeRefreshInboxBtn.addEventListener('click', () => {
    if (moeCurrentEmailId) moeFetchMails(moeCurrentEmailId);
  });

  async function moeFetchMails(emailId) {
    moeMailList.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">加载中...</div>';
    try {
      const res = await moeFetch(`${moeApiUrl}/api/emails/${emailId}`, {
        headers: moeHeaders()
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const messages = data.messages || [];
      moeUnreadCounts[String(emailId)] = 0;
      chrome.storage.local.set({ moeUnreadCounts });

      moeMailList.innerHTML = '';
      if (messages.length === 0) {
        moeMailList.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">收件箱为空</div>';
        return;
      }

      messages.forEach(msg => {
        const item = document.createElement('div');
        item.className = 'mail-item';
        item.innerHTML = `
          <div class="mail-item-header">
            <div class="mail-subject">${escapeHtml(msg.subject || '(无主题)')}</div>
            <div class="mail-time">${new Date(msg.received_at).toLocaleString()}</div>
          </div>
          <div class="mail-sender">${escapeHtml(msg.from_address || '未知')}</div>`;
        item.addEventListener('click', () => moeShowMailDetail(msg));
        moeMailList.appendChild(item);
      });
    } catch (e) {
      moeMailList.innerHTML = `<div style="padding:12px; text-align:center; color:var(--error);">加载失败: ${e.message}</div>`;
    }
  }

  function moeShowMailDetail(msg) {
    moeMailList.classList.add('hidden');
    moeMailContent.classList.remove('hidden');
    moeBackToListBtn.classList.remove('hidden');
    currentMoeMail = msg;
    moeMailViewMode = 'safe-html';
    moeMailAllowRemoteImages = defaultRemoteImagesEnabled;
    moeMailTranslationRequestToken += 1;
    moeMailInsightRequestToken += 1;
    moeMailTranslationText = '';
    moeMailAiInsights = null;
    moeMailInsightStatus = 'idle';
    moeMailInsightError = '';
    moeMailFrom.textContent = `发件人: ${msg.from_address || '未知'}`;
    moeMailSubject.textContent = msg.subject || '(无主题)';
    moeMailTime.textContent = `时间: ${new Date(msg.received_at).toLocaleString()}`;
    resetTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, retranslateMoeMailBtn);
    renderCurrentMoeMail();
    if (hasMailInsightConfig()) {
      triggerMoeMailAiInsights();
    }
  }

  function renderCurrentMoeMail() {
    if (!currentMoeMail) return;
    const result = renderMoeEmailBody(
      moeMailBody,
      currentMoeMail,
      moeMailInsights,
      moeMailViewMode,
      moeMailAllowRemoteImages,
      getMoeMailInsightsOverride(),
      buildMoeMailInsightRenderOptions()
    );
    updateMoeMailActionButtons(result);
  }

  async function triggerMoeMailAiInsights(force = false) {
    if (!currentMoeMail) {
      return;
    }
    if (!force && (moeMailInsightStatus === 'loading' || moeMailInsightStatus === 'success')) {
      return;
    }
    if (!hasMailInsightConfig()) {
      moeMailInsightStatus = 'error';
      moeMailInsightError = getMailInsightConfigErrorMessage();
      renderCurrentMoeMail();
      return;
    }

    const requestToken = ++moeMailInsightRequestToken;
    const mailRef = currentMoeMail;
    moeMailInsightStatus = 'loading';
    moeMailInsightError = '';
    if (force) {
      moeMailAiInsights = null;
    }
    renderCurrentMoeMail();

    try {
      const extracted = await extractMailInsightsWithApi(getMoeMailTranslationSource(currentMoeMail), {
        subject: currentMoeMail.subject,
        from: currentMoeMail.from_address
      });
      if (requestToken !== moeMailInsightRequestToken || !currentMoeMail || currentMoeMail !== mailRef) {
        return;
      }
      moeMailAiInsights = extracted;
      moeMailInsightStatus = 'success';
      moeMailInsightError = '';
      renderCurrentMoeMail();
    } catch (error) {
      if (requestToken !== moeMailInsightRequestToken || !currentMoeMail || currentMoeMail !== mailRef) {
        return;
      }
      moeMailAiInsights = null;
      moeMailInsightStatus = 'error';
      moeMailInsightError = error.message || '未知错误';
      renderCurrentMoeMail();
    }
  }

  toggleMoeMailViewBtn.addEventListener('click', () => {
    if (!currentMoeMail) return;
    moeMailViewMode = moeMailViewMode === 'safe-html' ? 'plain-text' : 'safe-html';
    renderCurrentMoeMail();
  });

  toggleMoeMailImagesBtn.addEventListener('click', () => {
    if (!currentMoeMail) return;
    moeMailAllowRemoteImages = !moeMailAllowRemoteImages;
    renderCurrentMoeMail();
  });

  translateMoeMailBtn.addEventListener('click', async () => {
    if (!currentMoeMail) {
      return;
    }
    // If translation panel is visible → collapse it
    if (!moeMailTranslation.classList.contains('hidden')) {
      moeMailTranslation.classList.add('hidden');
      setMailActionButtonState(translateMoeMailBtn, {
        icon: 'translate',
        title: moeMailTranslationText ? '查看翻译' : (hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API'),
        disabled: !currentMoeMail
      });
      return;
    }
    // If we have cached translation text → just show it (no API call)
    if (moeMailTranslationText) {
      renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, moeMailTranslationText, `AI 翻译 · ${translationTargetLanguage}`, retranslateMoeMailBtn);
      setMailActionButtonState(translateMoeMailBtn, { icon: 'collapseTranslation', title: '收起翻译', disabled: false });
      return;
    }
    // No cached translation → call API
    const requestToken = ++moeMailTranslationRequestToken;
    renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, '翻译中...', 'AI 翻译 · 正在处理', retranslateMoeMailBtn);
    retranslateMoeMailBtn.classList.add('hidden');
    copyMoeMailTranslationBtn.classList.add('hidden');
    setMailActionButtonState(translateMoeMailBtn, { icon: 'loading', title: '翻译中...', disabled: true });
    try {
      const translated = await translateTextWithApi(getMoeMailTranslationSource(currentMoeMail), {
        subject: currentMoeMail.subject,
        from: currentMoeMail.from_address
      });
      if (requestToken !== moeMailTranslationRequestToken || !currentMoeMail) {
        return;
      }
      moeMailTranslationText = translated;
      renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, translated, `AI 翻译 · ${translationTargetLanguage}`, retranslateMoeMailBtn);
      setMailActionButtonState(translateMoeMailBtn, { icon: 'collapseTranslation', title: '收起翻译', disabled: false });
    } catch (error) {
      if (requestToken !== moeMailTranslationRequestToken) {
        return;
      }
      renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, `翻译失败：${error.message}`, 'AI 翻译 · 调用失败', retranslateMoeMailBtn);
      copyMoeMailTranslationBtn.classList.add('hidden');
      setMailActionButtonState(translateMoeMailBtn, {
        icon: 'translate',
        title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API',
        disabled: !currentMoeMail
      });
    }
  });

  retranslateMoeMailBtn.addEventListener('click', async () => {
    if (!currentMoeMail) return;
    moeMailTranslationText = '';
    const requestToken = ++moeMailTranslationRequestToken;
    renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, '翻译中...', 'AI 翻译 · 正在处理', retranslateMoeMailBtn);
    retranslateMoeMailBtn.classList.add('hidden');
    copyMoeMailTranslationBtn.classList.add('hidden');
    setMailActionButtonState(translateMoeMailBtn, { icon: 'loading', title: '翻译中...', disabled: true });
    try {
      const translated = await translateTextWithApi(getMoeMailTranslationSource(currentMoeMail), {
        subject: currentMoeMail.subject,
        from: currentMoeMail.from_address
      });
      if (requestToken !== moeMailTranslationRequestToken || !currentMoeMail) return;
      moeMailTranslationText = translated;
      renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, translated, `AI 翻译 · ${translationTargetLanguage}`, retranslateMoeMailBtn);
      setMailActionButtonState(translateMoeMailBtn, { icon: 'collapseTranslation', title: '收起翻译', disabled: false });
    } catch (error) {
      if (requestToken !== moeMailTranslationRequestToken) return;
      renderTranslationPanel(moeMailTranslation, moeMailTranslationTitle, moeMailTranslationBody, copyMoeMailTranslationBtn, `翻译失败：${error.message}`, 'AI 翻译 · 调用失败', retranslateMoeMailBtn);
      copyMoeMailTranslationBtn.classList.add('hidden');
      setMailActionButtonState(translateMoeMailBtn, {
        icon: 'translate',
        title: hasTranslationConfig() ? '翻译邮件' : '请先配置翻译 API',
        disabled: !currentMoeMail
      });
    }
  });

  copyMoeMailTranslationBtn.addEventListener('click', () => {
    if (!moeMailTranslationText) {
      return;
    }
    copyToClipboard(moeMailTranslationText, copyMoeMailTranslationBtn);
  });

  // ===================== 公共工具函数 =====================
  function showMessage(element, text, type) {
    element.textContent = text;
    element.className = `message ${type}`;
  }

  function copyToClipboard(text, btnElement) {
    const onSuccess = () => {
      const originalHTML = btnElement.innerHTML;
      btnElement.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
      setTimeout(() => { btnElement.innerHTML = originalHTML; }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => fallbackCopy(text, onSuccess));
    } else {
      fallbackCopy(text, onSuccess);
    }
  }

  function fallbackCopy(text, onSuccess) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); onSuccess(); }
    catch (e) { console.error('复制失败', e); }
    document.body.removeChild(textarea);
  }

  function normalizeBookmarkHttpUrl(rawUrl) {
    try {
      const raw = String(rawUrl || '').trim();
      const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
      if (hasScheme && !/^https?:\/\//i.test(raw)) {
        return '';
      }
      const candidate = hasScheme ? raw : `https://${raw}`;
      const url = new URL(candidate);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function openBookmarkUrl(rawUrl, opener) {
    const safeUrl = normalizeBookmarkHttpUrl(rawUrl);
    if (!safeUrl) {
      showMessage(bmMessage, '书签网址无效或协议不受支持', 'error');
      return;
    }
    opener(safeUrl);
  }

  // ===================== 书签功能 =====================
  bmAddBtn.addEventListener('click', () => {
    const url = bmUrlInput.value.trim();
    if (!url) {
      showMessage(bmMessage, '请输入网址', 'error');
      return;
    }
    const finalUrl = normalizeBookmarkHttpUrl(url);
    if (!finalUrl) {
      showMessage(bmMessage, '网址格式不正确', 'error');
      return;
    }
    const name = bmNameInput.value.trim() || finalUrl;

    // 检查重复
    if (bookmarks.some(b => b.url === finalUrl)) {
      showMessage(bmMessage, '该网址已存在', 'error');
      return;
    }

    bookmarks.unshift({ name, url: finalUrl });
    chrome.storage.local.set({ bookmarks });
    bmNameInput.value = '';
    bmUrlInput.value = '';
    showMessage(bmMessage, '添加成功！', 'success');
    renderBookmarks();
  });

  bmSortSelect.addEventListener('change', () => {
    bookmarkSort = bmSortSelect.value;
    chrome.storage.local.set({ bookmarkSort });
    renderBookmarks();
  });

  function renderBookmarks() {
    bmListDiv.innerHTML = '';
    if (bookmarks.length === 0) {
      bmListDiv.innerHTML = '<div style="padding:12px; text-align:center; color:var(--text-muted);">暂无书签</div>';
      return;
    }

    // 处理排序
    // 注意：bookmarks 数组本身总是按照添加顺序（或自定义拖拽顺序）存储的（新添加的在前面）。
    // 只有在渲染时，如果我们选择了不同的排序方式，才会生成一份 sortedBookmarks 进行展示，并不改变原数组顺序。
    let sortedBookmarks = [];
    if (bookmarkSort === 'custom') {
      sortedBookmarks = bookmarks.map((bm, i) => ({ ...bm, originalIndex: i }));
    } else if (bookmarkSort === 'time-desc') {
      sortedBookmarks = bookmarks.map((bm, i) => ({ ...bm, originalIndex: i })).sort((a, b) => a.originalIndex - b.originalIndex); // 原数组就是新的在前（即时间倒序）
    } else if (bookmarkSort === 'time-asc') {
      sortedBookmarks = bookmarks.map((bm, i) => ({ ...bm, originalIndex: i })).sort((a, b) => b.originalIndex - a.originalIndex);
    } else if (bookmarkSort === 'name-asc') {
      sortedBookmarks = bookmarks.map((bm, i) => ({ ...bm, originalIndex: i })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }

    sortedBookmarks.forEach((bm) => {
      const idx = bm.originalIndex; // 使用原数组中的真实索引
      const card = document.createElement('div');
      card.className = 'bm-card';

      // 如果是自定义顺序，允许拖拽
      if (bookmarkSort === 'custom') {
        card.draggable = true;
        
        const dragHandle = document.createElement('div');
        dragHandle.className = 'bm-drag-handle';
        dragHandle.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>';
        dragHandle.title = '拖动以排序';
        card.appendChild(dragHandle);

        card.addEventListener('dragstart', (e) => {
          draggedBmIndex = idx;
          e.dataTransfer.effectAllowed = 'move';
          setTimeout(() => card.classList.add('dragging'), 0);
        });

        card.addEventListener('dragend', () => {
          draggedBmIndex = null;
          card.classList.remove('dragging');
          // 移除所有可能遗留的下划线/上划线拖放提示样式
          document.querySelectorAll('.bm-card').forEach(c => {
            c.style.borderTop = '';
            c.style.borderBottom = '';
          });
        });

        card.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          const bounding = card.getBoundingClientRect();
          const offset = bounding.y + (bounding.height / 2);
          if (e.clientY - offset > 0) {
            card.style.borderBottom = '2px solid var(--primary)';
            card.style.borderTop = '';
          } else {
            card.style.borderTop = '2px solid var(--primary)';
            card.style.borderBottom = '';
          }
        });

        card.addEventListener('dragleave', () => {
          card.style.borderTop = '';
          card.style.borderBottom = '';
        });

        card.addEventListener('drop', (e) => {
          e.preventDefault();
          card.style.borderTop = '';
          card.style.borderBottom = '';
          
          if (draggedBmIndex === null || draggedBmIndex === idx) return;

          const bounding = card.getBoundingClientRect();
          const offset = bounding.y + (bounding.height / 2);
          
          // 确定放下位置是在目标元素的上方还是下方
          // 注意：bookmarks中，索引0是最上面（最新创建的）
          let targetIndex = idx;
          if (e.clientY - offset > 0) {
            // 放在目标下方
            targetIndex = idx + 1;
          }

          // 如果原始在目标前面被拖到了目标后面，由于移除原始节点后索引会变，需要调整targetIndex
          if (draggedBmIndex < targetIndex) {
            targetIndex--;
          }

          // 重新排序书签数组
          const item = bookmarks.splice(draggedBmIndex, 1)[0];
          bookmarks.splice(targetIndex, 0, item);
          
          chrome.storage.local.set({ bookmarks });
          renderBookmarks();
        });
      }

      // 信息区域（点击打开）
      const info = document.createElement('div');
      info.className = 'bm-card-info';
      info.title = bm.url;

      const nameDiv = document.createElement('div');
      nameDiv.className = 'bm-card-name';
      nameDiv.textContent = bm.name;

      const urlDiv = document.createElement('div');
      urlDiv.className = 'bm-card-url';
      urlDiv.textContent = bm.url;

      info.appendChild(nameDiv);
      info.appendChild(urlDiv);

      // 操作按钮组
      const actions = document.createElement('div');
      actions.className = 'bm-card-actions';

      // 在当前页面打开按钮
      const openCurrentBtn = document.createElement('button');
      openCurrentBtn.className = 'icon-btn';
      openCurrentBtn.title = '在当前页面打开';
      openCurrentBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      openCurrentBtn.onclick = (e) => {
        e.stopPropagation();
        openBookmarkUrl(bm.url, (safeUrl) => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) chrome.tabs.update(tabs[0].id, { url: safeUrl });
          });
        });
      };

      // 在新标签页打开按钮
      const openNewBtn = document.createElement('button');
      openNewBtn.className = 'icon-btn';
      openNewBtn.title = '在新标签页打开';
      openNewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
      openNewBtn.onclick = (e) => {
        e.stopPropagation();
        openBookmarkUrl(bm.url, (safeUrl) => chrome.tabs.create({ url: safeUrl }));
      };

      // 无痕模式打开按钮
      const openIncognitoBtn = document.createElement('button');
      openIncognitoBtn.className = 'icon-btn';
      openIncognitoBtn.title = '在无痕模式中打开';
      openIncognitoBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><path d="M2 2l20 20"/></svg>';
      openIncognitoBtn.onclick = (e) => {
        e.stopPropagation();
        openBookmarkUrl(bm.url, (safeUrl) => chrome.windows.create({ url: safeUrl, incognito: true }));
      };

      // 删除按钮
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.title = '删除书签';
      delBtn.style.color = 'var(--error)';
      delBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
      delBtn.onclick = (e) => {
        e.stopPropagation();
        bookmarks.splice(idx, 1);
        chrome.storage.local.set({ bookmarks });
        card.style.opacity = '0';
        card.style.transform = 'translateX(20px)';
        setTimeout(() => renderBookmarks(), 300);
      };

      // 编辑按钮
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = '编辑书签';
      editBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        card.classList.add('editing');
      };

      // 复制链接按钮
      const copyLinkBtn = document.createElement('button');
      copyLinkBtn.className = 'icon-btn';
      copyLinkBtn.title = '复制链接';
      copyLinkBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      copyLinkBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(bm.url, copyLinkBtn);
      };

      actions.appendChild(editBtn);
      actions.appendChild(copyLinkBtn);
      actions.appendChild(openCurrentBtn);
      actions.appendChild(openNewBtn);
      actions.appendChild(openIncognitoBtn);
      actions.appendChild(delBtn);

      // 编辑表单区域
      const editForm = document.createElement('div');
      editForm.className = 'bm-edit-form';

      const editNameInput = document.createElement('input');
      editNameInput.type = 'text';
      editNameInput.className = 'bm-edit-input';
      editNameInput.value = bm.name;
      editNameInput.placeholder = '名称';

      const editUrlInput = document.createElement('input');
      editUrlInput.type = 'url';
      editUrlInput.className = 'bm-edit-input';
      editUrlInput.value = bm.url;
      editUrlInput.placeholder = 'https://example.com';

      const editActions = document.createElement('div');
      editActions.className = 'bm-edit-actions';

      const saveBtn = document.createElement('button');
      saveBtn.className = 'btn primary-btn';
      saveBtn.style.padding = '2px 8px';
      saveBtn.style.fontSize = '12px';
      saveBtn.textContent = '保存';
      
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'btn text-btn';
      cancelBtn.style.padding = '2px 8px';
      cancelBtn.style.fontSize = '12px';
      cancelBtn.textContent = '取消';

      cancelBtn.onclick = () => {
        card.classList.remove('editing');
        // 恢复原有值
        editNameInput.value = bm.name;
        editUrlInput.value = bm.url;
      };

      saveBtn.onclick = () => {
        const url = editUrlInput.value.trim();
        if (!url) {
          alert('网址不能为空');
          return;
        }
        const finalUrl = normalizeBookmarkHttpUrl(url);
        if (!finalUrl) {
          alert('网址格式不正确');
          return;
        }
        const name = editNameInput.value.trim() || finalUrl;

        // 更新数据并保存
        bookmarks[idx].name = name;
        bookmarks[idx].url = finalUrl;
        chrome.storage.local.set({ bookmarks });
        card.classList.remove('editing');
        renderBookmarks();
      };

      editActions.appendChild(cancelBtn);
      editActions.appendChild(saveBtn);

      editForm.appendChild(editNameInput);
      editForm.appendChild(editUrlInput);
      editForm.appendChild(editActions);

      card.appendChild(info);
      card.appendChild(actions);
      card.appendChild(editForm);
      bmListDiv.appendChild(card);
    });
  }
  // ===================== 导出/导入配置 =====================
  const exportBtn = document.getElementById('export-config-btn');
  const importBtn = document.getElementById('import-config-btn');
  const importFileInput = document.getElementById('import-file-input');
  const ioMessage = document.getElementById('io-message');
  const configChecks = configIOSection.querySelectorAll('.config-check input[type="checkbox"]');
  const configSelectAllBtn = document.getElementById('config-select-all-btn');
  const configDeselectAllBtn = document.getElementById('config-deselect-all-btn');

  if (configSelectAllBtn) {
    configSelectAllBtn.addEventListener('click', () => {
      configChecks.forEach(cb => { cb.checked = true; });
    });
  }
  if (configDeselectAllBtn) {
    configDeselectAllBtn.addEventListener('click', () => {
      configChecks.forEach(cb => { cb.checked = false; });
    });
  }

  initConfigIO({
    exportBtn,
    importBtn,
    importFileInput,
    ioMessage,
    configChecks,
    showMessage,
    onImportApplied: (toStore) => {
      setTimeout(() => {
        if (toStore.apiUrl !== undefined) { apiUrl = toStore.apiUrl; apiUrlInput.value = apiUrl; }
        if (toStore.adminToken !== undefined) { adminToken = toStore.adminToken; adminTokenInput.value = adminToken; }
        if (toStore.moeApiUrl !== undefined) { moeApiUrl = toStore.moeApiUrl; moeApiUrlInput.value = moeApiUrl; }
        if (toStore.moeApiKey !== undefined) { moeApiKey = toStore.moeApiKey; moeApiKeyInput.value = moeApiKey; }
        if (toStore.floatWindowEnabled !== undefined) {
          floatToggle.checked = toStore.floatWindowEnabled;
        }
        if (toStore[FLOAT_WINDOW_STYLE_KEY] !== undefined) {
          applyFloatingWindowStyle(toStore[FLOAT_WINDOW_STYLE_KEY]);
        }
        if (toStore.verifyInterval !== undefined) {
          setupAutoVerify(normalizeIntervalSetting(toStore.verifyInterval, DISABLED_INTERVAL_SETTING));
        }
        if (toStore.mailPollingInterval !== undefined) {
          mailPollingInterval = normalizeIntervalSetting(toStore.mailPollingInterval, DEFAULT_MAIL_POLL_INTERVAL);
          applyIntervalControl(
            mailPollingIntervalSelect,
            mailPollingIntervalCustomInput,
            mailPollingIntervalUnitSelect,
            MAIL_POLL_INTERVAL_PRESETS,
            mailPollingInterval,
            DEFAULT_MAIL_POLL_INTERVAL
          );
        }
        if (toStore.notificationsEnabled !== undefined) {
          notificationsEnabled = toStore.notificationsEnabled !== false;
          notificationsToggle.checked = notificationsEnabled;
        }
        if (toStore.defaultRemoteImagesEnabled !== undefined) {
          defaultRemoteImagesEnabled = toStore.defaultRemoteImagesEnabled === true;
          defaultRemoteImagesToggle.checked = defaultRemoteImagesEnabled;
        }
        if (toStore[TRANSLATION_API_BASE_KEY] !== undefined) {
          translationApiBase = normalizeTranslationSetting(toStore[TRANSLATION_API_BASE_KEY], DEFAULT_TRANSLATION_API_BASE);
          translationApiBaseInput.value = translationApiBase;
        }
        if (toStore[TRANSLATION_API_KEY_KEY] !== undefined) {
          translationApiKey = normalizeTranslationSetting(toStore[TRANSLATION_API_KEY_KEY]);
          translationApiKeyInput.value = translationApiKey;
        }
        if (toStore[TRANSLATION_MODEL_KEY] !== undefined) {
          translationModel = normalizeTranslationSetting(toStore[TRANSLATION_MODEL_KEY]);
          translationModelInput.value = translationModel;
        }
        if (toStore[TRANSLATION_TARGET_LANGUAGE_KEY] !== undefined) {
          translationTargetLanguage = normalizeTranslationSetting(toStore[TRANSLATION_TARGET_LANGUAGE_KEY], DEFAULT_TRANSLATION_TARGET_LANGUAGE);
          translationTargetLanguageInput.value = translationTargetLanguage;
        }
        if (toStore[MAIL_INSIGHT_API_MODE_KEY] !== undefined) {
          mailInsightApiMode = normalizeMailInsightApiMode(toStore[MAIL_INSIGHT_API_MODE_KEY]);
          mailInsightApiModeSelect.value = mailInsightApiMode;
          syncMailInsightApiFieldsVisibility();
        }
        if (toStore[MAIL_INSIGHT_API_BASE_KEY] !== undefined) {
          mailInsightApiBase = normalizeTranslationSetting(toStore[MAIL_INSIGHT_API_BASE_KEY], DEFAULT_TRANSLATION_API_BASE);
          mailInsightApiBaseInput.value = mailInsightApiBase;
        }
        if (toStore[MAIL_INSIGHT_API_KEY_KEY] !== undefined) {
          mailInsightApiKey = normalizeTranslationSetting(toStore[MAIL_INSIGHT_API_KEY_KEY]);
          mailInsightApiKeyInput.value = mailInsightApiKey;
        }
        if (toStore[MAIL_INSIGHT_MODEL_KEY] !== undefined) {
          mailInsightModel = normalizeTranslationSetting(toStore[MAIL_INSIGHT_MODEL_KEY]);
          mailInsightModelInput.value = mailInsightModel;
        }
        if (toStore[GENERATED_RESULT_AUTO_CLOSE_KEY] !== undefined) {
          generatedResultAutoCloseSeconds = normalizeGeneratedResultAutoCloseSeconds(toStore[GENERATED_RESULT_AUTO_CLOSE_KEY]);
          syncGeneratedResultAutoCloseInput(generatedResultAutoCloseSeconds);
          restoreGeneratedToolResults();
        }
        if (toStore[TAB_LAYOUT_MODE_KEY] !== undefined) {
          applyTabLayoutMode(toStore[TAB_LAYOUT_MODE_KEY]);
        }
        if (toStore[THEME_KEY] !== undefined) {
          applyTheme(toStore[THEME_KEY]);
        }
        if (toStore.siteAccessMode !== undefined) {
          siteAccessMode = toStore.siteAccessMode || 'all';
          siteAccessModeSelect.value = siteAccessMode;
        }
        if (toStore.siteAllowlist !== undefined) {
          siteAllowlist = Array.isArray(toStore.siteAllowlist) ? toStore.siteAllowlist : [];
        }
        if (toStore.siteBlocklist !== undefined) {
          siteBlocklist = Array.isArray(toStore.siteBlocklist) ? toStore.siteBlocklist : [];
          syncBlocklistTextarea();
        }
        if (toStore[PAGE_FILL_RULES_KEY] !== undefined) {
          pageFillRules = toStore[PAGE_FILL_RULES_KEY] || {};
          renderFillRuleManager();
        }
        // Fast-fill config
        if (toStore[FAST_FILL_EMAIL_SOURCE_KEY] !== undefined) {
          fastFillEmailSource = toStore[FAST_FILL_EMAIL_SOURCE_KEY] || 'temp';
          fastFillEmailSourceEl.value = fastFillEmailSource;
          fastFillTempExpiryRow.classList.toggle('hidden', fastFillEmailSource !== 'temp');
          fastFillMoeExpiryRow.classList.toggle('hidden', fastFillEmailSource !== 'moe');
        }
        if (toStore[FAST_FILL_DOMAIN_MODE_KEY] !== undefined) {
          fastFillDomainMode = toStore[FAST_FILL_DOMAIN_MODE_KEY] || 'random';
          fastFillDomainModeEl.value = fastFillDomainMode;
          fastFillRefreshDomainModeUI();
        }
        if (toStore[FAST_FILL_DOMAIN_SPECIFIC_KEY] !== undefined) {
          fastFillDomainSpecific = toStore[FAST_FILL_DOMAIN_SPECIFIC_KEY] || '';
          if (fastFillDomainSpecific) fastFillDomainSelect.value = fastFillDomainSpecific;
        }
        if (toStore[FAST_FILL_DOMAIN_WHITELIST_KEY] !== undefined) {
          fastFillDomainWhitelist = Array.isArray(toStore[FAST_FILL_DOMAIN_WHITELIST_KEY]) ? toStore[FAST_FILL_DOMAIN_WHITELIST_KEY] : [];
        }
        if (toStore[FAST_FILL_DOMAIN_BLACKLIST_KEY] !== undefined) {
          fastFillDomainBlacklist = Array.isArray(toStore[FAST_FILL_DOMAIN_BLACKLIST_KEY]) ? toStore[FAST_FILL_DOMAIN_BLACKLIST_KEY] : [];
        }
        if (toStore[FAST_FILL_NAME_REGION_KEY] !== undefined) {
          fastFillNameRegion = toStore[FAST_FILL_NAME_REGION_KEY] || 'en';
          const ffNrEl = document.getElementById('ff-name-region');
          if (ffNrEl) ffNrEl.value = fastFillNameRegion;
        }
        if (toStore[FAST_FILL_NAME_GENDER_KEY] !== undefined) {
          fastFillNameGender = toStore[FAST_FILL_NAME_GENDER_KEY] || 'random';
          const ffNgEl = document.getElementById('ff-name-gender');
          if (ffNgEl) ffNgEl.value = fastFillNameGender;
        }
        if (toStore[GENERATED_PROFILE_KEY] !== undefined) {
          generatedProfile = normalizeGeneratedProfile(toStore[GENERATED_PROFILE_KEY]);
          updateFillProfileButton();
          restoreGeneratedToolResults();
        }
        if (toStore[GENERATED_HISTORY_KEY] !== undefined) {
          generatedToolHistory = normalizeGeneratedToolHistory(toStore[GENERATED_HISTORY_KEY]);
          renderGeneratedToolHistory();
        }
        if (toStore.defaultTab !== undefined) {
          defaultTabSelect.value = toStore.defaultTab;
        }
        if (toStore.activeTab !== undefined) {
          switchTab(toStore.activeTab, { persist: false });
        }
        if (toStore.emailHistory !== undefined) {
          history = toStore.emailHistory;
          renderHistory();
        }
        if (toStore[TEMP_MAIL_META_KEY] !== undefined) {
          tempMailMeta = toStore[TEMP_MAIL_META_KEY] || {};
          renderHistory();
        }
        // Default expiry
        if (toStore[DEFAULT_FF_TEMP_EXPIRY_KEY] !== undefined) {
          defaultFfTempExpiry = toStore[DEFAULT_FF_TEMP_EXPIRY_KEY];
          fastFillTempExpiry.value = defaultFfTempExpiry;
          document.getElementById('setting-ff-temp-expiry').value = defaultFfTempExpiry;
        }
        if (toStore[DEFAULT_FF_MOE_EXPIRY_KEY] !== undefined) {
          defaultFfMoeExpiry = toStore[DEFAULT_FF_MOE_EXPIRY_KEY];
          fastFillMoeExpiry.value = defaultFfMoeExpiry;
          document.getElementById('setting-ff-moe-expiry').value = defaultFfMoeExpiry;
        }
        if (toStore[DEFAULT_TEMP_EXPIRY_KEY] !== undefined) {
          defaultTempExpiry = toStore[DEFAULT_TEMP_EXPIRY_KEY];
          tempExpirySelect.value = defaultTempExpiry;
          document.getElementById('setting-temp-expiry').value = defaultTempExpiry;
        }
        if (toStore[DEFAULT_MOE_EXPIRY_KEY] !== undefined) {
          defaultMoeExpiry = toStore[DEFAULT_MOE_EXPIRY_KEY];
          moeExpirySelect.value = defaultMoeExpiry;
          document.getElementById('setting-moe-expiry').value = defaultMoeExpiry;
        }
        if (toStore.verifyStatusCache !== undefined) {
          verifyStatus = toStore.verifyStatusCache || {};
          renderHistory();
        }
        if (toStore.tempUnreadCounts !== undefined) {
          tempUnreadCounts = toStore.tempUnreadCounts || {};
          renderHistory();
        }
        if (toStore.moeEmailCache !== undefined) {
          currentMoeEmails = Array.isArray(toStore.moeEmailCache) ? toStore.moeEmailCache : [];
          renderMoeEmails();
        }
        if (toStore.moeUnreadCounts !== undefined) {
          moeUnreadCounts = toStore.moeUnreadCounts || {};
          renderMoeEmails();
        }
        if (toStore.bookmarks !== undefined) {
          bookmarks = toStore.bookmarks;
          renderBookmarks();
        }
        if (toStore.bookmarkSort !== undefined) {
          bookmarkSort = toStore.bookmarkSort || 'custom';
          bmSortSelect.value = bookmarkSort;
          renderBookmarks();
        }

        if (apiUrl && adminToken) loadDomains();
        if (moeApiUrl && moeApiKey) {
          moeLoadDomains();
          moeLoadEmails();
        }
        refreshCurrentSiteInfo();
      }, 500);
    }
  });

  // ===================== 工具: 生成器子 Tab 切换 =====================
  const genTabBtns = document.querySelectorAll('.tool-gen-tabs .tool-gen-tab');
  const genPanels = document.querySelectorAll('.tool-gen-panel');
  genTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      genTabBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      genPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const target = document.querySelector(`.tool-gen-panel[data-gen-tab="${btn.dataset.genTab}"]`);
      if (target) target.classList.add('active');
    });
  });

  // ===================== 工具: 资料生成器 =====================
  const genPwdBtn = document.getElementById('gen-pwd-btn');
  const pwdResult = document.getElementById('pwd-result');
  const genNameBtn = document.getElementById('gen-name-btn');
  const nameResult = document.getElementById('name-result');
  const genBdayBtn = document.getElementById('gen-bday-btn');
  const bdayResult = document.getElementById('bday-result');
  const genAddrBtn = document.getElementById('gen-addr-btn');
  const addrResult = document.getElementById('addr-result');
  const {
    showToolResult,
    clearToolResultState: disposeGeneratedToolResultState
  } = initGeneratedTools({
    genPwdBtn,
    pwdResult,
    genNameBtn,
    nameResult,
    genBdayBtn,
    bdayResult,
    genAddrBtn,
    addrResult,
    getFillActionLabel,
    getPasswordFillActions,
    getNameFillActions,
    getBirthdayFillActions,
    getAddressFillActions,
    updateGeneratedProfile,
    sendToActivePage,
    bindFillPreview,
    copyToClipboard,
    showMessage,
    fillProfileMessage,
    dismissGeneratedResult,
    appendGeneratedHistory,
    getGeneratedResultAutoCloseSeconds: () => generatedResultAutoCloseSeconds
  });
  clearToolResultState = disposeGeneratedToolResultState;

  generatedHistoryFilters.forEach((btn) => {
    btn.addEventListener('click', () => {
      setGeneratedHistoryFilter(btn.dataset.generatedFilter);
    });
  });

  generatedHistorySearchInput?.addEventListener('input', () => {
    setGeneratedHistorySearchTerm(generatedHistorySearchInput.value);
  });

  clearGeneratedHistoryBtn?.addEventListener('click', () => {
    if (!generatedToolHistory.length) {
      return;
    }
    if (!confirm('确定要清空所有生成历史吗？')) {
      return;
    }
    generatedToolHistory = [];
    renderGeneratedToolHistory();
    saveGeneratedToolHistory();
  });

  fillProfileBtn.addEventListener('click', async () => {
    try {
      const response = await sendToActivePage({
        type: 'fill-profile',
        fields: generatedProfile
      });
      const filled = response?.filled || 0;
      showMessage(fillProfileMessage, filled > 0 ? `已填充 ${filled} 个字段` : '未识别到可填充的字段', filled > 0 ? 'success' : 'error');
    } catch (error) {
      showMessage(fillProfileMessage, `填充失败: ${error.message}`, 'error');
    }
  });
  bindFillPreview(fillProfileBtn, { profile: true });

  // ===================== 一键填充页面事件 =====================
  fastFillEmailSourceEl.addEventListener('change', () => {
    fastFillEmailSource = fastFillEmailSourceEl.value;
    fastFillMoeExpiryRow.classList.toggle('hidden', fastFillEmailSource !== 'moe');
    fastFillTempExpiryRow.classList.toggle('hidden', fastFillEmailSource !== 'temp');
    saveFastFillConfig();
    fastFillRefreshDomainUI();
  });

  fastFillDomainModeEl.addEventListener('change', () => {
    fastFillDomainMode = fastFillDomainModeEl.value;
    saveFastFillConfig();
    fastFillRefreshDomainModeUI();
  });

  const ffNameRegionEl = document.getElementById('ff-name-region');
  const ffNameGenderEl = document.getElementById('ff-name-gender');
  if (ffNameRegionEl) {
    ffNameRegionEl.addEventListener('change', () => {
      fastFillNameRegion = ffNameRegionEl.value;
      saveFastFillConfig();
    });
  }
  if (ffNameGenderEl) {
    ffNameGenderEl.addEventListener('change', () => {
      fastFillNameGender = ffNameGenderEl.value;
      saveFastFillConfig();
    });
  }

  fastFillDomainSelect.addEventListener('change', () => {
    fastFillDomainSpecific = fastFillDomainSelect.value;
    saveFastFillConfig();
    fastFillRefreshDomainUI();
  });

  fastFillGenerateBtn.addEventListener('click', () => {
    fastFillGenerateAndFill().catch(() => {});
  });

  // ===================== 跨实例数据同步 =====================
  // 当另一个 popup 实例（如悬浮窗 iframe 或弹窗）修改了 storage，
  // 本实例自动刷新对应的数据和 UI
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    // 邮箱历史记录变动
    if (changes.emailHistory) {
      history = changes.emailHistory.newValue || [];
      renderHistory();
    }
    if (changes.verifyStatusCache) {
      verifyStatus = changes.verifyStatusCache.newValue || {};
      renderHistory();
    }
    if (changes.tempUnreadCounts) {
      tempUnreadCounts = changes.tempUnreadCounts.newValue || {};
      renderHistory();
    }
    if (changes.moeUnreadCounts) {
      moeUnreadCounts = changes.moeUnreadCounts.newValue || {};
      renderMoeEmails();
    }

    // 书签变动
    if (changes.bookmarks) {
      bookmarks = changes.bookmarks.newValue || [];
      renderBookmarks();
    }
    if (changes.bookmarkSort) {
      bookmarkSort = changes.bookmarkSort.newValue || 'custom';
      bmSortSelect.value = bookmarkSort;
      renderBookmarks();
    }
    if (changes.moeEmailCache) {
      currentMoeEmails = Array.isArray(changes.moeEmailCache.newValue) ? changes.moeEmailCache.newValue : [];
      renderMoeEmails();
    }

    // Temp Email 配置变动
    if (changes.apiUrl) {
      apiUrl = changes.apiUrl.newValue || '';
      apiUrlInput.value = apiUrl;
      if (apiUrl && adminToken) loadDomains();
    }
    if (changes.adminToken) {
      adminToken = changes.adminToken.newValue || '';
      adminTokenInput.value = adminToken;
      if (apiUrl && adminToken) loadDomains();
    }

    // MoeMail 配置变动
    if (changes.moeApiUrl) {
      moeApiUrl = changes.moeApiUrl.newValue || '';
      moeApiUrlInput.value = moeApiUrl;
      if (moeApiUrl && moeApiKey) { moeLoadDomains(); moeLoadEmails(); }
    }
    if (changes.moeApiKey) {
      moeApiKey = changes.moeApiKey.newValue || '';
      moeApiKeyInput.value = moeApiKey;
      if (moeApiUrl && moeApiKey) { moeLoadDomains(); moeLoadEmails(); }
    }

    // 通用设置变动
    if (changes.floatWindowEnabled !== undefined) {
      floatToggle.checked = changes.floatWindowEnabled.newValue !== false;
    }
    if (changes[FLOAT_WINDOW_STYLE_KEY]) {
      applyFloatingWindowStyle(changes[FLOAT_WINDOW_STYLE_KEY].newValue);
    }
    if (changes.defaultTab) {
      defaultTabSelect.value = changes.defaultTab.newValue || 'temp-email';
    }
    if (changes.activeTab) {
      switchTab(changes.activeTab.newValue || 'temp-email', { persist: false });
    }
    if (changes[TAB_LAYOUT_MODE_KEY]) {
      applyTabLayoutMode(changes[TAB_LAYOUT_MODE_KEY].newValue);
    }
    if (changes[THEME_KEY]) {
      applyTheme(changes[THEME_KEY].newValue);
    }
    if (changes.verifyInterval) {
      setupAutoVerify(normalizeIntervalSetting(changes.verifyInterval.newValue, DISABLED_INTERVAL_SETTING));
    }
    if (changes.mailPollingInterval) {
      mailPollingInterval = normalizeIntervalSetting(changes.mailPollingInterval.newValue, DEFAULT_MAIL_POLL_INTERVAL);
      applyIntervalControl(
        mailPollingIntervalSelect,
        mailPollingIntervalCustomInput,
        mailPollingIntervalUnitSelect,
        MAIL_POLL_INTERVAL_PRESETS,
        mailPollingInterval,
        DEFAULT_MAIL_POLL_INTERVAL
      );
    }
    if (changes.notificationsEnabled) {
      notificationsEnabled = changes.notificationsEnabled.newValue !== false;
      notificationsToggle.checked = notificationsEnabled;
    }
    if (changes.defaultRemoteImagesEnabled) {
      defaultRemoteImagesEnabled = changes.defaultRemoteImagesEnabled.newValue === true;
      defaultRemoteImagesToggle.checked = defaultRemoteImagesEnabled;
    }
    if (changes[TRANSLATION_API_BASE_KEY]) {
      translationApiBase = normalizeTranslationSetting(changes[TRANSLATION_API_BASE_KEY].newValue, DEFAULT_TRANSLATION_API_BASE);
      translationApiBaseInput.value = translationApiBase;
    }
    if (changes[TRANSLATION_API_KEY_KEY]) {
      translationApiKey = normalizeTranslationSetting(changes[TRANSLATION_API_KEY_KEY].newValue);
      translationApiKeyInput.value = translationApiKey;
    }
    if (changes[TRANSLATION_MODEL_KEY]) {
      translationModel = normalizeTranslationSetting(changes[TRANSLATION_MODEL_KEY].newValue);
      translationModelInput.value = translationModel;
    }
    if (changes[TRANSLATION_TARGET_LANGUAGE_KEY]) {
      translationTargetLanguage = normalizeTranslationSetting(changes[TRANSLATION_TARGET_LANGUAGE_KEY].newValue, DEFAULT_TRANSLATION_TARGET_LANGUAGE);
      translationTargetLanguageInput.value = translationTargetLanguage;
    }
    if (changes[MAIL_INSIGHT_API_MODE_KEY]) {
      mailInsightApiMode = normalizeMailInsightApiMode(changes[MAIL_INSIGHT_API_MODE_KEY].newValue);
      mailInsightApiModeSelect.value = mailInsightApiMode;
      syncMailInsightApiFieldsVisibility();
    }
    if (changes[MAIL_INSIGHT_API_BASE_KEY]) {
      mailInsightApiBase = normalizeTranslationSetting(changes[MAIL_INSIGHT_API_BASE_KEY].newValue, DEFAULT_TRANSLATION_API_BASE);
      mailInsightApiBaseInput.value = mailInsightApiBase;
    }
    if (changes[MAIL_INSIGHT_API_KEY_KEY]) {
      mailInsightApiKey = normalizeTranslationSetting(changes[MAIL_INSIGHT_API_KEY_KEY].newValue);
      mailInsightApiKeyInput.value = mailInsightApiKey;
    }
    if (changes[MAIL_INSIGHT_MODEL_KEY]) {
      mailInsightModel = normalizeTranslationSetting(changes[MAIL_INSIGHT_MODEL_KEY].newValue);
      mailInsightModelInput.value = mailInsightModel;
    }
    if (changes[GENERATED_RESULT_AUTO_CLOSE_KEY]) {
      generatedResultAutoCloseSeconds = normalizeGeneratedResultAutoCloseSeconds(changes[GENERATED_RESULT_AUTO_CLOSE_KEY].newValue);
      syncGeneratedResultAutoCloseInput(generatedResultAutoCloseSeconds);
      restoreGeneratedToolResults();
    }
    if (changes[GENERATED_PROFILE_KEY]) {
      generatedProfile = normalizeGeneratedProfile(changes[GENERATED_PROFILE_KEY].newValue);
      updateFillProfileButton();
      restoreGeneratedToolResults();
    }
    if (changes[GENERATED_HISTORY_KEY]) {
      generatedToolHistory = normalizeGeneratedToolHistory(changes[GENERATED_HISTORY_KEY].newValue);
      renderGeneratedToolHistory();
    }
    if (changes[PAGE_FILL_RULES_KEY]) {
      pageFillRules = changes[PAGE_FILL_RULES_KEY].newValue || {};
      renderFillRuleManager();
      if (activeTab === 'fast-fill') renderFastFillPage().catch(() => {});
    }
    if (changes.siteAccessMode) {
      siteAccessMode = changes.siteAccessMode.newValue || 'all';
      siteAccessModeSelect.value = siteAccessMode;
      refreshCurrentSiteInfo();
    }
    if (changes.siteAllowlist) {
      siteAllowlist = Array.isArray(changes.siteAllowlist.newValue) ? changes.siteAllowlist.newValue : [];
      refreshCurrentSiteInfo();
    }
    if (changes.siteBlocklist) {
      siteBlocklist = Array.isArray(changes.siteBlocklist.newValue) ? changes.siteBlocklist.newValue : [];
      refreshCurrentSiteInfo();
    }
    if (changes.bookmarkSort) {
      bookmarkSort = changes.bookmarkSort.newValue || 'custom';
      bmSortSelect.value = bookmarkSort;
      renderBookmarks();
    }
  });
});
