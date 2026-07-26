// 页面助手 Content Script
// 负责悬浮窗、页面填充与页面级消息响应。
(function () {
  'use strict';

  const PAGE_TOOLS_VERSION = '2026.07.13-lifecycle-v2';
  const existingPageToolsController = window.__floatMailPageToolsController;
  if (existingPageToolsController?.version === PAGE_TOOLS_VERSION
    && existingPageToolsController.disposed !== true) {
    return;
  }
  if (typeof existingPageToolsController?.dispose === 'function') {
    try {
      existingPageToolsController.dispose();
    } catch {
      // 旧实例清理失败时继续启动，新实例会移除遗留 UI。
    }
  }

  const pageToolsController = {
    version: PAGE_TOOLS_VERSION,
    disposed: false,
    dispose: null,
  };
  window.__floatMailPageToolsController = pageToolsController;
  window.__tempEmailPageToolsLoaded = true;

  const BUTTON_ID = 'temp-email-float-btn';
  const PANEL_ID = 'temp-email-float-panel';
  const FLOAT_TOP_Z_INDEX = '2147483647';
  const FLOAT_LAYOUT_KEY = 'floatLayout';
  const FLOAT_WINDOW_STYLE_KEY = 'floatWindowStyle';
  const PAGE_FILL_RULES_KEY = 'pageFillRules';
  const DEFAULT_PANEL_WIDTH = 560;
  const DEFAULT_PANEL_HEIGHT = 680;
  const MIN_PANEL_WIDTH = 320;
  const MIN_PANEL_HEIGHT = 300;
  const PREVIEW_TARGET_CLASS = 'temp-email-fill-preview-target';
  const SELECT_TARGET_CLASS = 'temp-email-fill-select-target';
  const SELECTION_HINT_ID = 'temp-email-fill-selection-hint';
  const FLOAT_SELECT_MESSAGE_SOURCE = 'temp-email-floating-panel';
  const FIXED_FLOAT_WINDOW_STYLE = 'modern';
  const FLOAT_HOST_EVENT_TYPES = [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'auxclick',
    'contextmenu',
    'touchstart',
    'touchend',
    'touchcancel',
  ];
  const FIELD_LABELS = {
    email: '邮箱输入框',
    password: '密码输入框',
    confirmPassword: '重复密码输入框',
    verificationCode: '验证码输入框',
    name: '姓名输入框',
    lastName: '姓输入框',
    firstName: '名输入框',
    birthday: '生日输入框',
    address: '住址输入框',
  };

  let lastFocusedElement = null;
  let floatUi = null;
  let allFillRules = {};
  let previewTargets = [];
  let fieldSelection = null;
  let hostScrollLock = null;
  let shouldReopenFloatPanelAfterSelection = false;
  let lastPanelStateChangeTime = 0;
  let selectionHintTimer = null;
  let floatLifecycleRevision = 0;
  let pageToolsDisposed = false;
  // SEC-10：站点被黑名单/白名单挡掉时，内容脚本必须真正停用能力，
  // 而不只是拆掉悬浮窗。默认放行，首次 reconcile 完成后才有权威值。
  let siteToolsAllowed = true;
  let siteToolsPermissionReady = null;
  let focusTrackingBound = false;
  const targetHighlightState = new WeakMap();
  const fillRulesReady = storageGet([PAGE_FILL_RULES_KEY])
    .then((result) => {
      allFillRules = result[PAGE_FILL_RULES_KEY] || {};
    })
    .catch(() => {
      allFillRules = {};
    });

  function hasChromeStorageLocal() {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
  }

  let cachedExtensionOrigin;

  // 悬浮窗 iframe 的扩展页 origin。收发 postMessage 都要按它校验对端：
  // iframe 元素挂在页面共享 DOM 里，页面可以改 src 导航后冒充 contentWindow。
  function getExtensionOrigin() {
    if (cachedExtensionOrigin !== undefined) {
      return cachedExtensionOrigin;
    }
    try {
      cachedExtensionOrigin = new URL(chrome.runtime.getURL('popup.html')).origin;
    } catch {
      cachedExtensionOrigin = '';
    }
    return cachedExtensionOrigin;
  }

  function sendRuntimeMessage(message, fallback) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve(fallback);
        return;
      }
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.ok === false) {
          reject(new Error(response.error || '后台请求失败'));
          return;
        }
        resolve(response?.data ?? fallback);
      });
    });
  }

  function storageGet(keys) {
    if (hasChromeStorageLocal()) {
      return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
    }
    return sendRuntimeMessage({ type: 'storage-get', keys }, {});
  }

  function storageSet(items) {
    if (hasChromeStorageLocal()) {
      return new Promise((resolve) => chrome.storage.local.set(items, resolve));
    }
    return sendRuntimeMessage({ type: 'storage-set', items }, null);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function parsePixelValue(value) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseLayoutNumber(value) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string' && value.trim()) {
      return parsePixelValue(value);
    }
    return null;
  }

  const floatStyleCache = new WeakMap();

  function setImportantStyle(element, property, value) {
    if (!element) {
      return;
    }
    let cache = floatStyleCache.get(element);
    if (!cache) {
      cache = new Map();
      floatStyleCache.set(element, cache);
    }
    if (cache.get(property) === value) {
      return;
    }
    cache.set(property, value);
    element.style.setProperty(property, value, 'important');
  }

  // BUG-6：页面可能整体清空我方节点的 style，此时缓存仍认为已设置会跳过 setProperty。
  // 只在重挂 / 兜底检测这类低频路径上主动失效，避免每次调用都退回无缓存的写入。
  function invalidateFloatStyleCache(elements) {
    const targets = elements
      || (floatUi ? [floatUi.button, floatUi.panel, floatUi.overlay] : []);
    targets.forEach((element) => {
      if (element) {
        floatStyleCache.delete(element);
      }
    });
  }

  function applyFloatTopLayerStyles() {
    if (!floatUi) {
      return;
    }

    setImportantStyle(floatUi.button, 'position', 'fixed');
    setImportantStyle(floatUi.button, 'z-index', floatUi.panelVisible ? '2147483646' : FLOAT_TOP_Z_INDEX);
    setImportantStyle(floatUi.button, 'pointer-events', 'auto');
    setImportantStyle(floatUi.button, 'isolation', 'isolate');

    setImportantStyle(floatUi.panel, 'position', 'fixed');
    setImportantStyle(floatUi.panel, 'z-index', FLOAT_TOP_Z_INDEX);
    setImportantStyle(floatUi.panel, 'pointer-events', 'auto');
    setImportantStyle(floatUi.panel, 'isolation', 'isolate');

    setImportantStyle(floatUi.button, 'display', 'flex');
    setImportantStyle(floatUi.panel, 'display', floatUi.panelVisible ? 'flex' : 'none');
    if (floatUi.panelVisible) {
      setImportantStyle(floatUi.panel, 'flex-direction', 'column');
    }
  }

  function bringFloatUiToFront(options = {}) {
    if (!floatUi || !document.body) {
      return false;
    }

    const { button, panel, observer } = floatUi;
    // force 仅由被遮挡兜底检测使用：重挂 iframe 会触发重载与重绘，普通路径绝不能走。
    const nodesToAttach = options.force === true
      ? [button, panel]
      : [button, panel].filter((node) => node.parentNode !== document.body);

    // 只补挂确实脱离 body 的节点。按钮与 iframe 面板的前后顺序不参与置顶，
    // 避免开关面板或页面更新时重挂 iframe，导致重绘和入场动画重播。
    if (nodesToAttach.length > 0) {
      // 暂停 observer 避免 appendChild 自触发
      if (observer) {
        observer.disconnect();
      }
      // BUG-6：重挂说明页面动过我方节点，此时 style 也可能被一并清掉，
      // 缓存必须失效并把布局重新写一遍，否则 setImportantStyle 会误判为已设置。
      invalidateFloatStyleCache();
      nodesToAttach.forEach((node) => document.body.appendChild(node));
      if (observer) {
        observer.observe(document.body, { childList: true });
        floatUi.observedBody = document.body;
      }
      floatUi.buttonLayout = applyButtonLayout(button, floatUi.buttonLayout);
      floatUi.panelLayout = applyPanelLayout(panel, floatUi.panelLayout);
    }

    applyFloatTopLayerStyles();
    return nodesToAttach.length > 0;
  }

  // BUG-6：页面清空我方 style 后并不会触发节点移除，这里用内联 position 做廉价探针。
  // 只在确认被改写时才失效缓存并重新落样式——不重挂 DOM，因此不会引起 iframe 闪烁。
  function ensureFloatInlineStyles() {
    if (!floatUi) {
      return false;
    }
    const panelPosition = floatUi.panel.style.getPropertyValue('position');
    const buttonPosition = floatUi.button.style.getPropertyValue('position');
    if (panelPosition === 'fixed' && buttonPosition === 'fixed') {
      return false;
    }

    invalidateFloatStyleCache();
    applyFloatTopLayerStyles();
    floatUi.buttonLayout = applyButtonLayout(floatUi.button, floatUi.buttonLayout);
    floatUi.panelLayout = applyPanelLayout(floatUi.panel, floatUi.panelLayout);
    return true;
  }

  // BUG-5：页面若在我方节点之后插入同为 2147483647 的覆盖层，我方会被遮挡且不自纠。
  // 兜底检测刻意做得很保守：仅面板可见时运行、数秒一次、且需连续两次命中才重挂，
  // 避免退回历史上的高频重挂 —— 那会让 iframe 反复重载并重播入场动画（闪烁）。
  const FLOAT_OCCLUSION_CHECK_INTERVAL = 4000;
  const FLOAT_OCCLUSION_STRIKES_BEFORE_REATTACH = 2;
  let floatOcclusionTimer = null;
  let floatOcclusionStrikes = 0;

  function isFloatPanelOccluded() {
    if (!floatUi?.panelVisible || !document.body) {
      return false;
    }

    const panel = floatUi.panel;
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    // 取标题栏中部一点：既在面板内部，又避开圆角与四周的缩放手柄。
    const x = Math.round(rect.left + (rect.width / 2));
    const y = Math.round(rect.top + Math.min(18, rect.height / 2));
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
      return false;
    }

    let hit = null;
    try {
      hit = document.elementFromPoint(x, y);
    } catch {
      return false;
    }
    // 命中不到元素时按“未被遮挡”处理，宁可漏判也不要误重挂。
    if (!hit) {
      return false;
    }
    return !panel.contains(hit) && !floatUi.button.contains(hit);
  }

  function runFloatOcclusionCheck() {
    if (!floatUi?.panelVisible) {
      floatOcclusionStrikes = 0;
      return;
    }

    ensureFloatInlineStyles();

    if (!isFloatPanelOccluded()) {
      floatOcclusionStrikes = 0;
      return;
    }

    floatOcclusionStrikes += 1;
    if (floatOcclusionStrikes < FLOAT_OCCLUSION_STRIKES_BEFORE_REATTACH) {
      return;
    }
    floatOcclusionStrikes = 0;
    // 重挂会重新插入 iframe（内容重载），先清掉入场动画避免顺带重播一次。
    clearPanelEnterAnimation();
    bringFloatUiToFront({ force: true });
  }

  function startFloatOcclusionWatch() {
    if (floatOcclusionTimer !== null || !floatUi) {
      return;
    }
    floatOcclusionStrikes = 0;
    floatOcclusionTimer = window.setInterval(runFloatOcclusionCheck, FLOAT_OCCLUSION_CHECK_INTERVAL);
  }

  function stopFloatOcclusionWatch() {
    if (floatOcclusionTimer !== null) {
      window.clearInterval(floatOcclusionTimer);
      floatOcclusionTimer = null;
    }
    floatOcclusionStrikes = 0;
  }

  function clearPanelEnterAnimation() {
    if (!floatUi?.panel) {
      return;
    }
    floatUi.panel.classList.remove('panel-enter');
    if (floatUi.panelEnterCleanup) {
      floatUi.panelEnterCleanup();
      floatUi.panelEnterCleanup = null;
    }
  }

  function playPanelEnterAnimation() {
    if (!floatUi?.panel) {
      return;
    }

    const panel = floatUi.panel;
    clearPanelEnterAnimation();

    // 强制重排，确保同帧内重新添加 class 时动画能可靠触发一次
    void panel.offsetWidth;
    panel.classList.add('panel-enter');

    const onAnimationEnd = (event) => {
      if (event.target !== panel || event.animationName !== 'floatmailFloatPanelIn') {
        return;
      }
      clearPanelEnterAnimation();
    };
    panel.addEventListener('animationend', onAnimationEnd);
    floatUi.panelEnterCleanup = () => panel.removeEventListener('animationend', onAnimationEnd);
  }

  function setFloatPanelVisible(visible, options = {}) {
    if (!floatUi) {
      return;
    }

    const alreadyVisible = floatUi.panelVisible === visible;

    // 防止短时间内反复切换导致闪烁
    if (!alreadyVisible) {
      const now = Date.now();
      if (!options.force && now - lastPanelStateChangeTime < 350) {
        return;
      }
      lastPanelStateChangeTime = now;
    }

    if (visible) {
      // 已打开时默认不重复套布局，避免拖拽/填充后无意义的重算
      if (!alreadyVisible && options.reapplyLayout !== false) {
        floatUi.panelLayout = applyPanelLayout(floatUi.panel, floatUi.panelLayout);
      } else if (alreadyVisible && options.reapplyLayout === true) {
        floatUi.panelLayout = applyPanelLayout(floatUi.panel, floatUi.panelLayout);
      }
      floatUi.panelVisible = true;
      floatUi.panel.classList.add('visible');
      if (!alreadyVisible && options.animate !== false) {
        playPanelEnterAnimation();
      }
      startFloatOcclusionWatch();
    } else {
      floatUi.panelVisible = false;
      clearPanelEnterAnimation();
      floatUi.panel.classList.remove('visible');
      unlockHostPageScroll();
      stopFloatOcclusionWatch();
    }

    // 状态未变时不必重挂 DOM，避免填充/页面更新时触发“关再开”观感
    if (!alreadyVisible || options.forceBringToFront) {
      bringFloatUiToFront();
    } else {
      applyFloatTopLayerStyles();
    }
  }

  function hideFloatPanelForFieldSelection() {
    shouldReopenFloatPanelAfterSelection = Boolean(floatUi?.panelVisible);
    if (shouldReopenFloatPanelAfterSelection) {
      // 字段选取必须立刻收起，绕过 350ms 冷却
      setFloatPanelVisible(false, { force: true, animate: false });
    }
  }

  function restoreFloatPanelAfterFieldSelection() {
    const shouldReopen = shouldReopenFloatPanelAfterSelection;
    shouldReopenFloatPanelAfterSelection = false;
    if (!shouldReopen || !floatUi) {
      return;
    }
    window.setTimeout(() => {
      setFloatPanelVisible(true, { force: true });
    }, 0);
  }

  function installFloatHostEventIsolation(elements) {
    if (!floatUi) {
      return;
    }

    const stopHostPageEvent = (event) => {
      event.stopPropagation();
    };

    elements.forEach((element) => {
      FLOAT_HOST_EVENT_TYPES.forEach((type) => {
        element.addEventListener(type, stopHostPageEvent);
        floatUi.cleanup.push(() => element.removeEventListener(type, stopHostPageEvent));
      });
    });
  }

  function ensureFillRulesLoaded() {
    return fillRulesReady;
  }

  function getDefaultPanelSize() {
    return { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
  }

  function lockHostPageScroll() {
    if (hostScrollLock?.locked) {
      return;
    }

    hostScrollLock = {
      locked: true,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };

    // 下拉框展开时只固定当前位置，不修改宿主页面的 overflow。
    // GitHub 等使用占位滚动条的页面在 overflow:hidden 时会直接移除滚动滑块，
    // 同时改变视口宽度并造成阅读进度与页面布局跳动。
    window.addEventListener('scroll', syncLockedScrollPosition, true);
    window.scrollTo(hostScrollLock.scrollX, hostScrollLock.scrollY);
  }

  function unlockHostPageScroll() {
    if (!hostScrollLock?.locked) {
      return;
    }

    window.removeEventListener('scroll', syncLockedScrollPosition, true);
    hostScrollLock = null;
  }

  function syncLockedScrollPosition() {
    if (!hostScrollLock?.locked) {
      return;
    }

    if (window.scrollX !== hostScrollLock.scrollX || window.scrollY !== hostScrollLock.scrollY) {
      window.scrollTo(hostScrollLock.scrollX, hostScrollLock.scrollY);
    }
  }

  function getOriginFillRules() {
    return allFillRules?.[window.location.origin] || {};
  }

  function containsAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
  }

  function escapeSelectorToken(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/([^\w-])/g, '\\$1');
  }

  // 属性值会拼进 CSS 属性选择器并写入 storage。反斜杠转义在 CSS 里等价于字符本身，
  // 因此补上 `< > &` 既不改变选择器语义，又能保证页面可控文本不以原样入库（纵深防御）。
  function escapeAttributeValue(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/([<>&])/g, '\\$1');
  }

  const MAX_RULE_DESCRIPTION_LENGTH = 120;
  const MAX_RULE_DESCRIPTION_LABEL_LENGTH = 40;

  // 规则描述取自页面完全可控的 aria-label/placeholder/name/id，会长期存进 storage
  // 并在其他上下文里展示：去掉控制字符与尖括号、折叠空白并限制长度（纵深防御）。
  function sanitizeRuleText(value, maxLength) {
    const normalized = String(value ?? '')
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!Number.isFinite(maxLength) || normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function isEditableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    if (element.isContentEditable) {
      return true;
    }
    const tagName = String(element.tagName || '').toLowerCase();
    if (tagName === 'textarea') {
      return !element.disabled && !element.readOnly;
    }
    if (tagName === 'input') {
      const blockedTypes = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);
      return !element.disabled && !element.readOnly && !blockedTypes.has(element.type);
    }
    return false;
  }

  function isElementVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const ownerWindow = element.ownerDocument?.defaultView || window;
    const style = ownerWindow.getComputedStyle(element);
    return rect.width > 0
      && rect.height > 0
      && style.visibility !== 'hidden'
      && style.display !== 'none';
  }

  function collectSearchRoots(root, roots, visitedDocuments) {
    if (!root) {
      return;
    }
    roots.push(root);

    let elements = [];
    try {
      elements = Array.from(root.querySelectorAll('*'));
    } catch {
      return;
    }

    elements.forEach((element) => {
      if (element.shadowRoot) {
        collectSearchRoots(element.shadowRoot, roots, visitedDocuments);
      }
      if (String(element.tagName || '').toLowerCase() === 'iframe') {
        try {
          const childDocument = element.contentDocument;
          if (childDocument && !visitedDocuments.has(childDocument)) {
            visitedDocuments.add(childDocument);
            collectSearchRoots(childDocument, roots, visitedDocuments);
          }
        } catch {
          // 跨域 iframe 无法访问，按浏览器安全边界跳过。
        }
      }
    });
  }

  function getSearchRoots() {
    const roots = [];
    collectSearchRoots(document, roots, new Set([document]));
    return roots;
  }

  // PERF-1：getSearchRoots 会对 document 和每个 shadowRoot 跑 querySelectorAll('*')
  // 并递归同源 iframe，代价很高。这里给出一个短生命周期 memo：
  // 只在单次目标解析内复用，解析结束即丢弃，因此不会缓存过期的 DOM 快照。
  function createSearchRootsMemo(initialRoots) {
    let cachedRoots = Array.isArray(initialRoots) ? initialRoots : null;
    return () => {
      if (!cachedRoots) {
        cachedRoots = getSearchRoots();
      }
      return cachedRoots;
    };
  }

  function getAccessibleDocuments() {
    return getSearchRoots().filter((root) => root.nodeType === Node.DOCUMENT_NODE);
  }

  function getEditableCandidates(searchRoots = getSearchRoots()) {
    const candidates = [];
    searchRoots.forEach((root) => {
      try {
        candidates.push(...root.querySelectorAll('input, textarea, [contenteditable=""], [contenteditable="true"]'));
      } catch {
        // 已失效或不可访问的 root 直接跳过。
      }
    });
    return Array.from(new Set(candidates))
      .filter(isEditableElement)
      .filter(isElementVisible);
  }

  function collectElementText(element) {
    const parts = [
      element.id,
      element.name,
      element.type,
      element.placeholder,
      element.getAttribute('aria-label'),
      element.getAttribute('autocomplete'),
      element.getAttribute('data-testid'),
      element.getAttribute('data-field'),
    ];
    if (element?.labels) {
      parts.push(...Array.from(element.labels).map((label) => label.textContent));
    }
    return parts.filter(Boolean).join(' ').toLowerCase();
  }

  function getElementLabelText(element) {
    const labels = element?.labels
      ? Array.from(element.labels).map((label) => label.textContent?.trim()).filter(Boolean)
      : [];
    return labels[0]
      || element.getAttribute('aria-label')
      || element.placeholder
      || element.name
      || element.id
      || '';
  }

  function scoreField(element, kind) {
    const haystack = collectElementText(element);
    const labelText = getElementLabelText(element).toLowerCase().trim();
    const compactLabelText = labelText.replace(/\s+/g, '');
    const type = (element.type || '').toLowerCase();
    const autocomplete = (element.getAttribute('autocomplete') || '').toLowerCase();
    const inputMode = (element.getAttribute('inputmode') || '').toLowerCase();
    const confirmKeywords = ['confirm', 'confirmation', 'repeat', 'again', 're-enter', '确认', '重复', '再次'];
    const codeKeywords = ['code', 'otp', 'verify', 'verification', 'token', 'captcha', '验证码', '校验码', '动态码', '一次性'];
    const fullNameKeywords = ['full name', 'fullname', 'real name', '姓名', '真实姓名'];
    const firstNameKeywords = ['first name', 'firstname', 'given name', 'givenname', 'given-name', 'forename'];
    const lastNameKeywords = ['last name', 'lastname', 'family name', 'familyname', 'family-name', 'surname'];
    const hasFullNameSignals = autocomplete === 'name'
      || containsAny(haystack, fullNameKeywords)
      || compactLabelText === '姓名'
      || compactLabelText === '真实姓名';
    const hasFirstNameSignals = autocomplete === 'given-name'
      || containsAny(haystack, firstNameKeywords)
      || compactLabelText === '名'
      || compactLabelText === '名字';
    const hasLastNameSignals = autocomplete === 'family-name'
      || containsAny(haystack, lastNameKeywords)
      || compactLabelText === '姓'
      || compactLabelText === '姓氏';
    let score = 0;

    if (kind === 'email') {
      if (type === 'email') score += 8;
      if (autocomplete === 'email') score += 4;
      if (haystack.includes('email') || haystack.includes('mail') || haystack.includes('邮箱')) score += 5;
      if (haystack.includes('user')) score += 1;
    } else if (kind === 'password') {
      if (type === 'password') score += 10;
      if (autocomplete === 'new-password' || autocomplete === 'current-password') score += 4;
      if (haystack.includes('password') || haystack.includes('pass') || haystack.includes('密码')) score += 5;
      if (containsAny(haystack, confirmKeywords)) score -= 6;
    } else if (kind === 'confirmPassword') {
      if (type === 'password') score += 8;
      if (autocomplete === 'new-password') score += 2;
      if (containsAny(haystack, confirmKeywords)) score += 10;
      if (haystack.includes('password') || haystack.includes('pass') || haystack.includes('密码')) score += 2;
    } else if (kind === 'verificationCode') {
      if (autocomplete === 'one-time-code') score += 8;
      if (inputMode === 'numeric' || inputMode === 'decimal') score += 3;
      if (type === 'number' || type === 'tel') score += 3;
      if (containsAny(haystack, codeKeywords)) score += 8;
    } else if (kind === 'name') {
      if (hasFullNameSignals) score += 8;
      if (autocomplete === 'name') score += 5;
      if (haystack.includes('name') || haystack.includes('nickname')) score += 2;
      if (hasFirstNameSignals || hasLastNameSignals) score -= 6;
    } else if (kind === 'firstName') {
      if (autocomplete === 'given-name') score += 10;
      if (containsAny(haystack, firstNameKeywords) || compactLabelText === '名' || compactLabelText === '名字') score += 8;
      if (containsAny(haystack, ['nickname', 'display name'])) score -= 3;
      if (hasFullNameSignals) score -= 8;
      if (hasLastNameSignals) score -= 6;
    } else if (kind === 'lastName') {
      if (autocomplete === 'family-name') score += 10;
      if (containsAny(haystack, lastNameKeywords) || compactLabelText === '姓' || compactLabelText === '姓氏') score += 8;
      if (hasFullNameSignals) score -= 8;
      if (hasFirstNameSignals) score -= 6;
    } else if (kind === 'birthday') {
      if (type === 'date') score += 8;
      if (autocomplete === 'bday') score += 4;
      if (haystack.includes('birthday') || haystack.includes('birth') || haystack.includes('dob') || haystack.includes('生日') || haystack.includes('出生')) score += 5;
    } else if (kind === 'age') {
      if (type === 'number' || type === 'tel') score += 4;
      if (inputMode === 'numeric' || inputMode === 'decimal') score += 3;
      if (haystack.includes('age') || haystack.includes('年龄') || haystack.includes('岁数')) score += 8;
      if (haystack.includes('birthday') || haystack.includes('birth') || haystack.includes('dob') || haystack.includes('生日') || haystack.includes('出生')) score -= 4;
    } else if (kind === 'address') {
      if (haystack.includes('address') || haystack.includes('addr') || haystack.includes('住址') || haystack.includes('地址')) score += 8;
      if (autocomplete === 'street-address' || autocomplete === 'address-level1' || autocomplete === 'address-level2') score += 6;
      if (type === 'text') score += 2;
      if (haystack.includes('street') || haystack.includes('街道') || haystack.includes('road')) score += 3;
    }

    if (element === lastFocusedElement) {
      score += 3;
    }

    return score;
  }

  function resolveRuleContext(contextPath) {
    let root = document;
    for (const step of Array.isArray(contextPath) ? contextPath : []) {
      let host = null;
      try {
        host = root.querySelector(step.selector);
      } catch {
        return null;
      }
      if (!host) {
        return null;
      }
      if (step.type === 'shadow') {
        root = host.shadowRoot;
      } else if (step.type === 'frame') {
        try {
          root = host.contentDocument;
        } catch {
          root = null;
        }
      } else {
        return null;
      }
      if (!root) {
        return null;
      }
    }
    return root;
  }

  // getSearchRootsMemo 是 createSearchRootsMemo 产出的取值函数（可为空）。
  // 命中 contextPath 时不需要全树遍历，因此这里保持惰性调用。
  function queryEditableElement(selector, contextPath = null, getSearchRootsMemo = null) {
    if (!selector) {
      return null;
    }

    const roots = Array.isArray(contextPath) && contextPath.length > 0
      ? [resolveRuleContext(contextPath)].filter(Boolean)
      : (typeof getSearchRootsMemo === 'function' ? getSearchRootsMemo() : getSearchRoots());
    for (const root of roots) {
      try {
        const element = root.querySelector(selector);
        if (element && isEditableElement(element) && isElementVisible(element)) {
          return element;
        }
      } catch {
        // 当前 root 不支持或 selector 已失效时继续尝试其他 root。
      }
    }
    return null;
  }

  function resolveRuleTarget(kind, getSearchRootsMemo = null) {
    const rule = getOriginFillRules()[kind];
    if (!rule?.selector) {
      return null;
    }
    return queryEditableElement(rule.selector, rule.contextPath, getSearchRootsMemo);
  }

  function resolveFillTarget(kind, options = {}) {
    const exclude = options.exclude || new Set();
    const preferFocused = options.preferFocused !== false;
    // 同一次解析里规则查询与候选枚举共用一次 DOM 遍历（PERF-1），
    // 但仍是“每次调用都重新遍历”，不会跨字段复用陈旧快照。
    const getSearchRootsMemo = createSearchRootsMemo(options.searchRoots);
    const ruleTarget = options.ignoreRule ? null : resolveRuleTarget(kind, getSearchRootsMemo);

    if (ruleTarget && !exclude.has(ruleTarget)) {
      return ruleTarget;
    }

    if (preferFocused
      && isEditableElement(lastFocusedElement)
      && isElementVisible(lastFocusedElement)
      && !exclude.has(lastFocusedElement)
      && scoreField(lastFocusedElement, kind) > 0) {
      return lastFocusedElement;
    }

    const candidates = (options.candidates || getEditableCandidates(getSearchRootsMemo()))
      .filter((candidate) => !exclude.has(candidate));
    let bestElement = null;
    let bestScore = -1;
    for (const candidate of candidates) {
      const score = scoreField(candidate, kind);
      if (score > bestScore) {
        bestScore = score;
        bestElement = candidate;
      }
    }

    return bestScore > 0 ? bestElement : null;
  }

  function getElementQueryRoot(element) {
    const root = element?.getRootNode?.();
    return root?.querySelectorAll ? root : element?.ownerDocument || document;
  }

  function isUniqueSelector(selector, expectedElement, root = getElementQueryRoot(expectedElement)) {
    try {
      const matches = root.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === expectedElement;
    } catch {
      return false;
    }
  }

  function buildPathSelector(element) {
    const segments = [];
    let current = element;
    const root = getElementQueryRoot(element);
    const stopElement = root?.nodeType === Node.DOCUMENT_NODE ? root.body : null;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== stopElement) {
      if (current.id) {
        const idSelector = `#${escapeSelectorToken(current.id)}`;
        if (isUniqueSelector(idSelector, element)) {
          segments.unshift(idSelector);
          return segments.join(' > ');
        }
      }

      let segment = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) {
          segment += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }

      segments.unshift(segment);
      current = current.parentElement;
    }

    if (segments.length === 0) {
      return '';
    }
    return stopElement ? `body > ${segments.join(' > ')}` : segments.join(' > ');
  }

  function buildElementContextPath(element) {
    const reversed = [];
    let currentElement = element;

    while (currentElement) {
      const root = currentElement.getRootNode?.();
      if (root?.host) {
        reversed.push({ type: 'shadow', selector: createRuleSelector(root.host) });
        currentElement = root.host;
        continue;
      }

      const ownerWindow = currentElement.ownerDocument?.defaultView;
      let frameElement = null;
      try {
        frameElement = ownerWindow?.frameElement || null;
      } catch {
        frameElement = null;
      }
      if (frameElement) {
        reversed.push({ type: 'frame', selector: createRuleSelector(frameElement) });
        currentElement = frameElement;
        continue;
      }
      break;
    }

    return reversed.reverse().filter((step) => step.selector);
  }

  function createRuleSelector(element) {
    const root = getElementQueryRoot(element);
    if (element.id) {
      const idSelector = `#${escapeSelectorToken(element.id)}`;
      if (isUniqueSelector(idSelector, element, root)) {
        return idSelector;
      }
    }

    const tag = element.tagName.toLowerCase();
    const attributes = [
      ['name', element.getAttribute('name')],
      ['data-testid', element.getAttribute('data-testid')],
      ['autocomplete', element.getAttribute('autocomplete')],
      ['aria-label', element.getAttribute('aria-label')],
      ['placeholder', element.getAttribute('placeholder')],
    ];

    for (const [attribute, value] of attributes) {
      if (!value) {
        continue;
      }
      const selector = `${tag}[${attribute}="${escapeAttributeValue(value)}"]`;
      if (isUniqueSelector(selector, element, root)) {
        return selector;
      }
    }

    if (element.name && element.type) {
      const selector = `${tag}[name="${escapeAttributeValue(element.name)}"][type="${escapeAttributeValue(element.type)}"]`;
      if (isUniqueSelector(selector, element, root)) {
        return selector;
      }
    }

    return buildPathSelector(element);
  }

  function describeRuleElement(element) {
    const tag = sanitizeRuleText(element.tagName.toLowerCase(), 32);
    const parts = [tag];
    if (element.id) {
      parts.push(`#${sanitizeRuleText(element.id, MAX_RULE_DESCRIPTION_LABEL_LENGTH)}`);
    } else if (element.name) {
      parts.push(`[name="${sanitizeRuleText(element.name, MAX_RULE_DESCRIPTION_LABEL_LENGTH)}"]`);
    } else if (element.type) {
      parts.push(`[type="${sanitizeRuleText(element.type, 24)}"]`);
    }

    const label = sanitizeRuleText(getElementLabelText(element), MAX_RULE_DESCRIPTION_LABEL_LENGTH);
    if (label) {
      parts.push(`· ${label}`);
    }

    return sanitizeRuleText(parts.join(' '), MAX_RULE_DESCRIPTION_LENGTH);
  }

  async function saveFillRule(kind, element) {
    const selector = createRuleSelector(element);
    if (!selector) {
      throw new Error('无法为当前输入框生成规则');
    }

    const originRules = {
      ...(allFillRules[window.location.origin] || {}),
      [kind]: {
        selector,
        contextPath: buildElementContextPath(element),
        description: describeRuleElement(element),
        updatedAt: Date.now(),
      },
    };

    allFillRules = {
      ...allFillRules,
      [window.location.origin]: originRules,
    };

    await storageSet({
      [PAGE_FILL_RULES_KEY]: allFillRules,
    });

    return originRules[kind];
  }

  function getEditableTargetFromNode(node) {
    // 同源 iframe 中的元素属于 iframe 自己的 realm，不能用顶层 Element 做 instanceof。
    let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement || null;

    while (current) {
      if (isEditableElement(current) && isElementVisible(current)) {
        return current;
      }
      const parent = current.parentElement;
      if (parent) {
        current = parent;
        continue;
      }
      const root = current.getRootNode?.();
      current = root?.host || null;
    }

    return null;
  }

  function getEditableTargetFromPoint(x, y, ownerDocument = document) {
    const element = ownerDocument.elementFromPoint(x, y);
    return getEditableTargetFromNode(element);
  }

  function clearPreviewTargets() {
    previewTargets.forEach((element) => clearTargetHighlight(element, PREVIEW_TARGET_CLASS));
    previewTargets = [];
  }

  function applyTargetHighlight(element, className, styles) {
    if (!element) {
      return;
    }
    if (!targetHighlightState.has(element)) {
      targetHighlightState.set(element, ['outline', 'outline-offset', 'box-shadow'].map((property) => ({
        property,
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
      })));
    }
    element.classList.add(className);
    Object.entries(styles).forEach(([property, value]) => {
      element.style.setProperty(property, value, 'important');
    });
  }

  function clearTargetHighlight(element, className) {
    if (!element) {
      return;
    }
    element.classList.remove(className);
    const savedStyles = targetHighlightState.get(element);
    if (!savedStyles) {
      return;
    }
    savedStyles.forEach(({ property, value, priority }) => {
      if (value) {
        element.style.setProperty(property, value, priority);
      } else {
        element.style.removeProperty(property);
      }
    });
    targetHighlightState.delete(element);
  }

  function setPreviewTargets(targets) {
    clearPreviewTargets();
    previewTargets = Array.from(new Set(targets.filter(Boolean)));
    previewTargets.forEach((element) => applyTargetHighlight(element, PREVIEW_TARGET_CLASS, {
      outline: '3px solid #1a73e8',
      'outline-offset': '2px',
      'box-shadow': '0 0 0 4px rgba(26, 115, 232, 0.22)',
    }));
  }

  function removeSelectionHint() {
    if (selectionHintTimer !== null) {
      window.clearTimeout(selectionHintTimer);
      selectionHintTimer = null;
    }
    document.getElementById(SELECTION_HINT_ID)?.remove();
  }

  function showSelectionHint(text, tone = 'info', autoRemoveDelay = 0) {
    if (!document.body) {
      return;
    }
    let hint = document.getElementById(SELECTION_HINT_ID);
    if (!hint) {
      hint = document.createElement('div');
      hint.id = SELECTION_HINT_ID;
      document.body.appendChild(hint);
    }
    hint.textContent = text;
    hint.dataset.tone = tone;
    if (selectionHintTimer !== null) {
      window.clearTimeout(selectionHintTimer);
      selectionHintTimer = null;
    }
    if (autoRemoveDelay > 0) {
      selectionHintTimer = window.setTimeout(() => {
        selectionHintTimer = null;
        if (!fieldSelection) {
          document.getElementById(SELECTION_HINT_ID)?.remove();
        }
      }, autoRemoveDelay);
    }
  }

  function clearSelectionHover() {
    if (!fieldSelection?.hoverTarget) {
      return;
    }
    clearTargetHighlight(fieldSelection.hoverTarget, SELECT_TARGET_CLASS);
    fieldSelection.hoverTarget = null;
  }

  function setSelectionHover(target) {
    if (!fieldSelection || fieldSelection.hoverTarget === target) {
      return;
    }
    clearSelectionHover();
    if (target) {
      applyTargetHighlight(target, SELECT_TARGET_CLASS, {
        outline: '3px solid #f9ab00',
        'outline-offset': '2px',
        'box-shadow': '0 0 0 4px rgba(249, 171, 0, 0.24)',
      });
      fieldSelection.hoverTarget = target;
    }
  }

  function notifyFloatingFieldSelectionState(active, label = '') {
    const iframeWindow = floatUi?.iframe?.contentWindow;
    const extensionOrigin = getExtensionOrigin();
    // 没拿到扩展 origin 时宁可不发，也不要用 '*' 广播给可能被页面导航过的 iframe。
    if (!iframeWindow || !extensionOrigin) {
      return;
    }
    try {
      iframeWindow.postMessage({
        source: FLOAT_SELECT_MESSAGE_SOURCE,
        type: 'floating-field-selection-state',
        active: Boolean(active),
        label: label || '',
      }, extensionOrigin);
    } catch {
      // iframe 不可用时忽略，不影响页面内直接取消。
    }
  }

  function stopFieldSelection(removeHint = true) {
    if (!fieldSelection) {
      if (removeHint) {
        removeSelectionHint();
      }
      return;
    }

    fieldSelection.cleanup.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // 忽略清理异常。
      }
    });
    fieldSelection.cleanup = [];
    clearSelectionHover();
    notifyFloatingFieldSelectionState(false);
    fieldSelection = null;

    if (removeHint) {
      removeSelectionHint();
    }
  }

  function finishFieldSelection(message, tone = 'success') {
    stopFieldSelection(false);
    restoreFloatPanelAfterFieldSelection();
    showSelectionHint(message, tone, 1800);
  }

  function startFieldSelection(kind, label) {
    stopFieldSelection();
    shouldReopenFloatPanelAfterSelection = false;
    clearPreviewTargets();

    fieldSelection = {
      kind,
      hoverTarget: null,
      cleanup: [],
    };

    const labelText = label || FIELD_LABELS[kind] || '输入框';
    showSelectionHint(`正在选择${labelText}，点击目标输入框后自动保存，按 Esc 可取消。`);
    notifyFloatingFieldSelectionState(true, labelText);
    hideFloatPanelForFieldSelection();

    const onMouseMove = (event) => {
      const eventTarget = event.composedPath?.()[0] || event.target;
      const target = getEditableTargetFromNode(eventTarget)
        || getEditableTargetFromPoint(event.clientX, event.clientY, event.currentTarget || document);
      setSelectionHover(target);
    };

    const onMouseDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      const eventTarget = event.composedPath?.()[0] || event.target;
      const target = getEditableTargetFromNode(eventTarget)
        || getEditableTargetFromPoint(event.clientX, event.clientY, event.currentTarget || document)
        || fieldSelection?.hoverTarget
        || null;

      if (!target) {
        showSelectionHint(`请点击可输入的${labelText}。`, 'error');
        return;
      }

      stopFieldSelection(false);
      showSelectionHint(`正在保存${labelText}规则...`, 'info');
      saveFillRule(kind, target)
        .then(() => {
          showSelectionHint(`已保存${labelText}规则。`, 'success', 1800);
        })
        .catch((error) => {
          showSelectionHint(`保存失败：${error.message}`, 'error', 3000);
        })
        .finally(() => {
          restoreFloatPanelAfterFieldSelection();
        });
    };

    const onKeyDown = (event) => {
      if (event.key !== 'Escape') {
        return;
      }
      event.preventDefault();
      finishFieldSelection('已取消字段选择。', 'info');
    };

    getAccessibleDocuments().forEach((targetDocument) => {
      const supportsPointerEvents = Boolean(targetDocument.defaultView?.PointerEvent);
      targetDocument.addEventListener('mousemove', onMouseMove, true);
      targetDocument.addEventListener(supportsPointerEvents ? 'pointerdown' : 'mousedown', onMouseDown, true);
      if (!supportsPointerEvents) {
        targetDocument.addEventListener('touchstart', onMouseDown, { capture: true, passive: false });
      }
      targetDocument.addEventListener('click', onClick, true);
      targetDocument.addEventListener('keydown', onKeyDown, true);
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('mousemove', onMouseMove, true));
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener(supportsPointerEvents ? 'pointerdown' : 'mousedown', onMouseDown, true));
      if (!supportsPointerEvents) {
        fieldSelection.cleanup.push(() => targetDocument.removeEventListener('touchstart', onMouseDown, true));
      }
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('click', onClick, true));
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('keydown', onKeyDown, true));
    });
  }

  function buildFillOperations(fields) {
    const operations = [];

    if (fields.email) {
      operations.push({ kind: 'email', value: fields.email });
    }
    if (fields.password) {
      operations.push({ kind: 'password', value: fields.password });
      operations.push({ kind: 'confirmPassword', value: fields.confirmPassword || fields.password, optional: true });
    }
    if (fields.verificationCode) {
      operations.push({ kind: 'verificationCode', value: fields.verificationCode });
    }
    if (fields.lastName) {
      operations.push({ kind: 'lastName', value: fields.lastName, group: 'split-last-name' });
    }
    if (fields.firstName) {
      operations.push({ kind: 'firstName', value: fields.firstName, group: 'split-first-name' });
    }
    if (fields.fullName) {
      operations.push({
        kind: 'name',
        value: fields.fullName,
        optional: Boolean(fields.firstName || fields.lastName),
        skipIfMatchedGroupsAll: ['split-last-name', 'split-first-name']
      });
    }
    if (fields.birthday) {
      operations.push({ kind: 'birthday', value: fields.birthday });
    }
    if (fields.age) {
      operations.push({ kind: 'age', value: fields.age });
    }
    if (fields.address) {
      operations.push({ kind: 'address', value: fields.address });
    }

    return operations;
  }

  function shouldSkipFillOperation(operation, matchedGroups) {
    return (Array.isArray(operation.skipIfMatchedGroups)
      && operation.skipIfMatchedGroups.some((group) => matchedGroups.has(group)))
      || (Array.isArray(operation.skipIfMatchedGroupsAll)
        && operation.skipIfMatchedGroupsAll.every((group) => matchedGroups.has(group)));
  }

  function buildFillPlan(fields) {
    const searchRoots = getSearchRoots();
    const candidates = getEditableCandidates(searchRoots);
    const usedTargets = new Set();
    const matchedGroups = new Set();
    const plan = [];

    for (const operation of buildFillOperations(fields || {})) {
      if (shouldSkipFillOperation(operation, matchedGroups)) {
        continue;
      }
      const target = resolveFillTarget(operation.kind, {
        exclude: usedTargets,
        preferFocused: false,
        searchRoots,
        candidates,
      });
      if (!target) {
        continue;
      }
      usedTargets.add(target);
      if (operation.group) {
        matchedGroups.add(operation.group);
      }
      plan.push({ operation, target });
    }

    return plan;
  }

  async function previewFillTarget(kind) {
    await ensureFillRulesLoaded();
    const target = resolveFillTarget(kind, { preferFocused: false });
    setPreviewTargets(target ? [target] : []);
    return { ok: true, matched: Boolean(target) };
  }

  async function previewFillProfile(fields) {
    await ensureFillRulesLoaded();

    const targets = buildFillPlan(fields).map(({ target }) => target);

    setPreviewTargets(targets);
    return { ok: true, matched: targets.length };
  }

  // BUG-7：只发 input+change 时，依赖键盘事件的表单不会跑校验。
  // 顺序按真实输入还原为 keydown → input → keyup → change；
  // 值已经在调用前用原型 setter 写好，键盘事件只是补信号，不影响 React 受控组件。
  function dispatchInputEvents(element) {
    const view = element.ownerDocument?.defaultView || window;
    const EventConstructor = view.Event || Event;
    const KeyboardEventConstructor = view.KeyboardEvent
      || (typeof KeyboardEvent !== 'undefined' ? KeyboardEvent : null);

    const dispatchKeyEvent = (type) => {
      if (!KeyboardEventConstructor) {
        return;
      }
      try {
        // key 用 Unidentified，避免被页面当成 Enter 之类的功能键触发提交。
        element.dispatchEvent(new KeyboardEventConstructor(type, {
          bubbles: true,
          cancelable: true,
          key: 'Unidentified',
        }));
      } catch {
        // 个别环境不支持构造 KeyboardEvent，跳过即可。
      }
    };

    dispatchKeyEvent('keydown');
    element.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    dispatchKeyEvent('keyup');
    element.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  }

  // 只派发 blur/focusout 事件而不真正 element.blur()：
  // 既能触发依赖失焦的校验（含 React 的 onBlur，它监听 focusout），
  // 又不会打断多字段连续填充时的焦点顺序。
  function dispatchBlurEvents(element) {
    const view = element.ownerDocument?.defaultView || window;
    const FocusEventConstructor = view.FocusEvent || view.Event || Event;
    try {
      element.dispatchEvent(new FocusEventConstructor('blur', { bubbles: false }));
      element.dispatchEvent(new FocusEventConstructor('focusout', { bubbles: true }));
    } catch {
      // 构造失败时忽略，填充本身已经完成。
    }
  }

  function fillElement(element, value) {
    if (!element) {
      return false;
    }

    element.focus();

    if (element.isContentEditable) {
      element.textContent = value;
      dispatchInputEvents(element);
      dispatchBlurEvents(element);
      return true;
    }

    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    dispatchInputEvents(element);
    dispatchBlurEvents(element);
    return true;
  }

  async function fillSingleValue(value, kind) {
    await ensureFillRulesLoaded();
    const target = resolveFillTarget(kind);
    if (!target) {
      return { ok: false, error: '未找到可填充的输入框' };
    }

    fillElement(target, value);
    lastFocusedElement = target;
    return { ok: true, kind };
  }

  async function fillProfile(fields) {
    await ensureFillRulesLoaded();

    const operations = buildFillOperations(fields || {});
    const usedTargets = new Set();
    const matchedGroups = new Set();
    let filled = 0;
    for (const operation of operations) {
      if (shouldSkipFillOperation(operation, matchedGroups)) {
        continue;
      }

      // 实际填充时逐字段重新扫描。前一个 input/change 事件可能让 React/Vue
      // 重绘表单或显示新字段，不能复用预览阶段的一次性 DOM 快照。
      // 单个字段内部的重复全树遍历由 resolveFillTarget 里的 memo 消除（PERF-1）。
      const target = resolveFillTarget(operation.kind, {
        exclude: usedTargets,
        preferFocused: false,
      });
      if (!target) {
        continue;
      }

      fillElement(target, operation.value);
      lastFocusedElement = target;
      usedTargets.add(target);
      if (operation.group) {
        matchedGroups.add(operation.group);
      }
      filled += 1;
    }

    if (filled === 0) {
      return { ok: false, error: '当前页面未识别到可填充的注册字段' };
    }
    return { ok: true, filled };
  }

  function teardownFloatWindow() {
    stopFieldSelection();
    clearPreviewTargets();
    unlockHostPageScroll();
    stopFloatOcclusionWatch();

    if (!floatUi) {
      return;
    }

    clearPanelEnterAnimation();

    floatUi.cleanup.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        // 忽略清理阶段的非关键错误。
      }
    });
    floatUi.cleanup = [];

    if (floatUi.observer) {
      floatUi.observer.disconnect();
    }
    if (floatUi.documentObserver) {
      floatUi.documentObserver.disconnect();
    }

    floatUi.panel.remove();
    floatUi.button.remove();
    floatUi = null;
  }

  async function persistFloatLayout() {
    if (!floatUi) {
      return;
    }

    await storageSet({
      [FLOAT_LAYOUT_KEY]: {
        button: { ...floatUi.buttonLayout },
        panel: { ...floatUi.panelLayout },
        pinned: floatUi.isPinned,
      },
    });
  }

  function applyButtonLayout(button, layout) {
    const savedLeft = parseLayoutNumber(layout?.left);
    const savedTop = parseLayoutNumber(layout?.top);
    const width = button.offsetWidth || 52;
    const height = button.offsetHeight || 52;
    const preferredLeft = savedLeft ?? window.innerWidth - width - 24;
    const preferredTop = savedTop ?? window.innerHeight - height - 24;
    const left = clamp(preferredLeft, 0, Math.max(0, window.innerWidth - width));
    const top = clamp(preferredTop, 0, Math.max(0, window.innerHeight - height));

    setImportantStyle(button, 'left', `${left}px`);
    setImportantStyle(button, 'top', `${top}px`);
    setImportantStyle(button, 'right', 'auto');
    setImportantStyle(button, 'bottom', 'auto');
    setImportantStyle(button, 'position', 'fixed');
    setImportantStyle(button, 'z-index', FLOAT_TOP_Z_INDEX);

    return {
      left: Math.round(preferredLeft),
      top: Math.round(preferredTop),
    };
  }

  function applyPanelLayout(panel, layout) {
    const savedWidth = parseLayoutNumber(layout?.width);
    const savedHeight = parseLayoutNumber(layout?.height);
    const hasValidSavedSize = savedWidth !== null
      && savedHeight !== null
      && savedWidth >= MIN_PANEL_WIDTH
      && savedHeight >= MIN_PANEL_HEIGHT;
    const savedLeft = hasValidSavedSize ? parseLayoutNumber(layout?.left) : null;
    const savedTop = hasValidSavedSize ? parseLayoutNumber(layout?.top) : null;
    const defaultSize = getDefaultPanelSize();
    const preferredWidth = hasValidSavedSize ? savedWidth : defaultSize.width;
    const preferredHeight = hasValidSavedSize ? savedHeight : defaultSize.height;
    const width = clamp(
      preferredWidth,
      MIN_PANEL_WIDTH,
      Math.max(MIN_PANEL_WIDTH, window.innerWidth - 20)
    );
    const height = clamp(
      preferredHeight,
      MIN_PANEL_HEIGHT,
      Math.max(MIN_PANEL_HEIGHT, window.innerHeight - 20)
    );
    const preferredLeft = savedLeft ?? window.innerWidth - width - 30;
    const preferredTop = savedTop ?? Math.max(12, window.innerHeight - height - 90);
    const left = clamp(
      preferredLeft,
      0,
      Math.max(0, window.innerWidth - width)
    );
    const top = clamp(
      preferredTop,
      0,
      Math.max(0, window.innerHeight - height)
    );

    setImportantStyle(panel, 'width', `${width}px`);
    setImportantStyle(panel, 'height', `${height}px`);
    setImportantStyle(panel, 'left', `${left}px`);
    setImportantStyle(panel, 'top', `${top}px`);
    setImportantStyle(panel, 'right', 'auto');
    setImportantStyle(panel, 'bottom', 'auto');
    setImportantStyle(panel, 'position', 'fixed');
    setImportantStyle(panel, 'z-index', FLOAT_TOP_Z_INDEX);

    return {
      left: Math.round(preferredLeft),
      top: Math.round(preferredTop),
      width: Math.round(preferredWidth),
      height: Math.round(preferredHeight),
    };
  }

  function applyFloatWindowStyle(options = {}) {
    if (!floatUi) {
      return FIXED_FLOAT_WINDOW_STYLE;
    }

    floatUi.style = FIXED_FLOAT_WINDOW_STYLE;
    floatUi.button.dataset.style = FIXED_FLOAT_WINDOW_STYLE;
    floatUi.panel.dataset.style = FIXED_FLOAT_WINDOW_STYLE;
    if (floatUi.overlay) {
      floatUi.overlay.dataset.style = FIXED_FLOAT_WINDOW_STYLE;
    }

    if (options.reapplyLayout !== false) {
      floatUi.buttonLayout = applyButtonLayout(floatUi.button, floatUi.buttonLayout);
      floatUi.panelLayout = applyPanelLayout(floatUi.panel, floatUi.panelLayout);
    }
    applyFloatTopLayerStyles();

    return FIXED_FLOAT_WINDOW_STYLE;
  }

  async function initFloatWindow(savedLayout) {
    if (floatUi || !document.body) {
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    // 方案二图标；HTML 宽高 + CSS 双重约束，避免大图撑破按钮
    const floatIconUrl = chrome.runtime.getURL('icons/float-btn.png');
    button.innerHTML = `<img class="temp-email-float-btn-icon" src="${floatIconUrl}" width="54" height="54" alt="FloatMail" draggable="false" />`;
    button.title = 'FloatMail';
    document.body.appendChild(button);

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    const header = document.createElement('div');
    header.id = 'temp-email-panel-header';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'temp-email-panel-title';
    titleSpan.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg><span>Float Mail</span>';

    const headerButtons = document.createElement('div');
    headerButtons.className = 'temp-email-header-actions';

    const resetButton = document.createElement('button');
    resetButton.id = 'temp-email-panel-reset';
    resetButton.type = 'button';
    resetButton.className = 'temp-email-header-btn';
    resetButton.title = '复位大小和位置';
    resetButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>';

    const pinButton = document.createElement('button');
    pinButton.id = 'temp-email-panel-pin';
    pinButton.type = 'button';
    pinButton.className = 'temp-email-header-btn';
    pinButton.title = '固定窗口（点击外部不关闭）';
    pinButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76z"/></svg>';

    const closeButton = document.createElement('button');
    closeButton.id = 'temp-email-panel-close';
    closeButton.type = 'button';
    closeButton.className = 'temp-email-header-btn';
    closeButton.title = '关闭';
    closeButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

    headerButtons.appendChild(resetButton);
    headerButtons.appendChild(pinButton);
    headerButtons.appendChild(closeButton);
    header.appendChild(titleSpan);
    header.appendChild(headerButtons);
    panel.appendChild(header);

    const iframe = document.createElement('iframe');
    panel.appendChild(iframe);

    const overlay = document.createElement('div');
    overlay.id = 'temp-email-iframe-overlay';
    panel.appendChild(overlay);

    ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `temp-email-resize temp-email-resize-${dir}`;
      handle.dataset.dir = dir;
      panel.appendChild(handle);
    });

    document.body.appendChild(panel);

    floatUi = {
      button,
      panel,
      iframe,
      overlay,
      style: FIXED_FLOAT_WINDOW_STYLE,
      isPinned: Boolean(savedLayout?.pinned),
      panelVisible: false,
      iframeLoaded: false,
      buttonLayout: null,
      panelLayout: null,
      observer: null,
      documentObserver: null,
      observedBody: null,
      panelEnterCleanup: null,
      cleanup: [],
    };
    installFloatHostEventIsolation([button, panel]);
    pinButton.classList.toggle('pinned', floatUi.isPinned);
    applyFloatWindowStyle({ reapplyLayout: false });
    floatUi.buttonLayout = applyButtonLayout(button, savedLayout?.button);
    floatUi.panelLayout = applyPanelLayout(panel, savedLayout?.panel);
    bringFloatUiToFront();

    const syncFloatingFieldSelectionState = () => {
      if (!floatUi) {
        return;
      }
      if (!fieldSelection) {
        notifyFloatingFieldSelectionState(false);
        return;
      }
      const activeLabel = FIELD_LABELS[fieldSelection.kind] || '输入框';
      notifyFloatingFieldSelectionState(true, activeLabel);
    };
    iframe.addEventListener('load', syncFloatingFieldSelectionState);
    floatUi.cleanup.push(() => iframe.removeEventListener('load', syncFloatingFieldSelectionState));

    function showPanel() {
      if (!floatUi) {
        return;
      }
      // 延迟加载：仅在用户首次打开面板时才加载 iframe 内容，
      // 避免标签页初始化时批量创建 iframe 导致请求风暴。
      if (!floatUi.iframeLoaded) {
        floatUi.iframeLoaded = true;
        floatUi.iframe.src = chrome.runtime.getURL('popup.html');
      }
      setFloatPanelVisible(true);
    }

    function hidePanel() {
      if (!floatUi) {
        return;
      }
      setFloatPanelVisible(false);
    }

    function enableOverlay() {
      setImportantStyle(overlay, 'display', 'block');
    }

    function disableOverlay() {
      setImportantStyle(overlay, 'display', 'none');
    }

    let wasDragged = false;
    let isButtonDragging = false;
    let buttonStartX = 0;
    let buttonStartY = 0;
    let buttonStartLeft = 0;
    let buttonStartTop = 0;

    const onButtonClick = (event) => {
      event.stopPropagation();
      if (!wasDragged) {
        floatUi.panelVisible ? hidePanel() : showPanel();
      }
      wasDragged = false;
    };
    button.addEventListener('click', onButtonClick);
    floatUi.cleanup.push(() => button.removeEventListener('click', onButtonClick));

    let dragListenersAttached = false;
    function attachDragListeners() {
      if (dragListenersAttached) {
        return;
      }
      dragListenersAttached = true;
      document.addEventListener('mousemove', onDocumentMouseMove, true);
      document.addEventListener('mouseup', onDocumentMouseUp, true);
      window.addEventListener('blur', onWindowBlur);
    }

    function detachDragListeners() {
      if (!dragListenersAttached) {
        return;
      }
      dragListenersAttached = false;
      document.removeEventListener('mousemove', onDocumentMouseMove, true);
      document.removeEventListener('mouseup', onDocumentMouseUp, true);
      window.removeEventListener('blur', onWindowBlur);
    }

    const onButtonMouseDown = (event) => {
      attachDragListeners();
      isButtonDragging = true;
      wasDragged = false;
      const rect = button.getBoundingClientRect();
      buttonStartX = event.clientX;
      buttonStartY = event.clientY;
      buttonStartLeft = rect.left;
      buttonStartTop = rect.top;
      button.classList.add('dragging');
      event.preventDefault();
      event.stopPropagation();
    };
    button.addEventListener('mousedown', onButtonMouseDown);
    floatUi.cleanup.push(() => button.removeEventListener('mousedown', onButtonMouseDown));

    let isPanelDragging = false;
    let panelStartX = 0;
    let panelStartY = 0;
    let panelStartLeft = 0;
    let panelStartTop = 0;

    const onHeaderMouseDown = (event) => {
      event.stopPropagation();
      if (event.target.closest('.temp-email-header-btn')) {
        event.preventDefault();
        return;
      }
      attachDragListeners();
      isPanelDragging = true;
      enableOverlay();
      const rect = panel.getBoundingClientRect();
      panelStartX = event.clientX;
      panelStartY = event.clientY;
      panelStartLeft = rect.left;
      panelStartTop = rect.top;
      event.preventDefault();
    };
    header.addEventListener('mousedown', onHeaderMouseDown);
    floatUi.cleanup.push(() => header.removeEventListener('mousedown', onHeaderMouseDown));

    let isResizing = false;
    let resizeDirection = '';
    let resizeStartX = 0;
    let resizeStartY = 0;
    let resizeStartWidth = 0;
    let resizeStartHeight = 0;
    let resizeStartLeft = 0;
    let resizeStartTop = 0;

    const onPanelMouseDown = (event) => {
      const handle = event.target.closest('.temp-email-resize');
      if (!handle) {
        return;
      }
      attachDragListeners();
      isResizing = true;
      enableOverlay();
      resizeDirection = handle.dataset.dir || '';
      const rect = panel.getBoundingClientRect();
      resizeStartX = event.clientX;
      resizeStartY = event.clientY;
      resizeStartWidth = rect.width;
      resizeStartHeight = rect.height;
      resizeStartLeft = rect.left;
      resizeStartTop = rect.top;
      event.preventDefault();
      event.stopPropagation();
    };
    panel.addEventListener('mousedown', onPanelMouseDown);
    floatUi.cleanup.push(() => panel.removeEventListener('mousedown', onPanelMouseDown));

    const onDocumentMouseMove = (event) => {
      if (isButtonDragging || isPanelDragging || isResizing) {
        event.stopPropagation();
      }

      if (isButtonDragging) {
        const dx = event.clientX - buttonStartX;
        const dy = event.clientY - buttonStartY;
        if (!wasDragged && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
          wasDragged = true;
        }
        if (wasDragged) {
          const newLeft = clamp(buttonStartLeft + dx, 0, Math.max(0, window.innerWidth - button.offsetWidth));
          const newTop = clamp(buttonStartTop + dy, 0, Math.max(0, window.innerHeight - button.offsetHeight));
          setImportantStyle(button, 'left', `${newLeft}px`);
          setImportantStyle(button, 'top', `${newTop}px`);
          setImportantStyle(button, 'right', 'auto');
          setImportantStyle(button, 'bottom', 'auto');
          floatUi.buttonLayout = {
            left: Math.round(newLeft),
            top: Math.round(newTop),
          };
        }
      }

      if (isPanelDragging) {
        const dx = event.clientX - panelStartX;
        const dy = event.clientY - panelStartY;
        const newLeft = clamp(panelStartLeft + dx, 0, Math.max(0, window.innerWidth - panel.offsetWidth));
        const newTop = clamp(panelStartTop + dy, 0, Math.max(0, window.innerHeight - panel.offsetHeight));
        setImportantStyle(panel, 'left', `${newLeft}px`);
        setImportantStyle(panel, 'top', `${newTop}px`);
        setImportantStyle(panel, 'right', 'auto');
        setImportantStyle(panel, 'bottom', 'auto');
        floatUi.panelLayout = {
          ...(floatUi.panelLayout || {}),
          left: Math.round(newLeft),
          top: Math.round(newTop),
          width: Math.round(panel.offsetWidth || parsePixelValue(panel.style.width) || DEFAULT_PANEL_WIDTH),
          height: Math.round(panel.offsetHeight || parsePixelValue(panel.style.height) || DEFAULT_PANEL_HEIGHT),
        };
      }

      if (isResizing) {
        const dx = event.clientX - resizeStartX;
        const dy = event.clientY - resizeStartY;
        let width = resizeStartWidth;
        let height = resizeStartHeight;
        let left = resizeStartLeft;
        let top = resizeStartTop;

        if (resizeDirection.includes('e')) {
          width = Math.max(MIN_PANEL_WIDTH, resizeStartWidth + dx);
        }
        if (resizeDirection.includes('w')) {
          width = Math.max(MIN_PANEL_WIDTH, resizeStartWidth - dx);
          left = resizeStartLeft + (resizeStartWidth - width);
        }
        if (resizeDirection.includes('s')) {
          height = Math.max(MIN_PANEL_HEIGHT, resizeStartHeight + dy);
        }
        if (resizeDirection.includes('n')) {
          height = Math.max(MIN_PANEL_HEIGHT, resizeStartHeight - dy);
          top = resizeStartTop + (resizeStartHeight - height);
        }

        width = Math.min(width, window.innerWidth - left);
        height = Math.min(height, window.innerHeight - top);
        left = clamp(left, 0, Math.max(0, window.innerWidth - width));
        top = clamp(top, 0, Math.max(0, window.innerHeight - height));

        setImportantStyle(panel, 'width', `${width}px`);
        setImportantStyle(panel, 'height', `${height}px`);
        setImportantStyle(panel, 'left', `${left}px`);
        setImportantStyle(panel, 'top', `${top}px`);
        setImportantStyle(panel, 'right', 'auto');
        setImportantStyle(panel, 'bottom', 'auto');
        floatUi.panelLayout = {
          left: Math.round(left),
          top: Math.round(top),
          width: Math.round(width),
          height: Math.round(height),
        };
      }
    };
    const onDocumentMouseUp = (event) => {
      const shouldPersist = isButtonDragging || isPanelDragging || isResizing;
      if (shouldPersist && event) {
        event.stopPropagation();
      }
      if (isButtonDragging) {
        isButtonDragging = false;
        button.classList.remove('dragging');
      }
      if (isPanelDragging) {
        isPanelDragging = false;
        disableOverlay();
      }
      if (isResizing) {
        isResizing = false;
        disableOverlay();
      }
      if (shouldPersist) {
        persistFloatLayout().catch(() => {});
      }
      detachDragListeners();
    };
    const onWindowBlur = () => onDocumentMouseUp(null);
    floatUi.cleanup.push(detachDragListeners);

    const onDocumentMouseDown = (event) => {
      if (floatUi.panelVisible && !floatUi.isPinned && !panel.contains(event.target) && event.target !== button) {
        hidePanel();
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    floatUi.cleanup.push(() => document.removeEventListener('mousedown', onDocumentMouseDown));

    const onCloseClick = (event) => {
      event.stopPropagation();
      hidePanel();
    };
    closeButton.addEventListener('click', onCloseClick);
    floatUi.cleanup.push(() => closeButton.removeEventListener('click', onCloseClick));

    const onPinClick = (event) => {
      event.stopPropagation();
      floatUi.isPinned = !floatUi.isPinned;
      pinButton.classList.toggle('pinned', floatUi.isPinned);
      pinButton.title = floatUi.isPinned ? '取消固定窗口' : '固定窗口（点击外部不关闭）';
      persistFloatLayout().catch(() => {});
    };
    pinButton.addEventListener('click', onPinClick);
    floatUi.cleanup.push(() => pinButton.removeEventListener('click', onPinClick));

    const onResetClick = (event) => {
      event.stopPropagation();
      floatUi.panelLayout = applyPanelLayout(panel, null);
      persistFloatLayout().catch(() => {});
    };
    resetButton.addEventListener('click', onResetClick);
    floatUi.cleanup.push(() => resetButton.removeEventListener('click', onResetClick));

    // PERF-2：resize 事件在拖动窗口时高频触发，用 rAF 把同一帧内的重算合并成一次。
    let resizeFrameId = 0;
    const applyResizeLayout = () => {
      resizeFrameId = 0;
      if (!floatUi) {
        return;
      }
      floatUi.buttonLayout = applyButtonLayout(button, floatUi.buttonLayout);
      floatUi.panelLayout = applyPanelLayout(panel, floatUi.panelLayout);
    };
    const onWindowResize = () => {
      if (!floatUi || resizeFrameId) {
        return;
      }
      resizeFrameId = window.requestAnimationFrame(applyResizeLayout);
    };
    window.addEventListener('resize', onWindowResize);
    floatUi.cleanup.push(() => {
      window.removeEventListener('resize', onWindowResize);
      if (resizeFrameId) {
        window.cancelAnimationFrame(resizeFrameId);
        resizeFrameId = 0;
      }
    });

    const onWindowMessage = (event) => {
      if (!floatUi || event.source !== iframe.contentWindow) {
        return;
      }
      // 仅校验 source 不够：iframe 元素在页面共享 DOM 里，页面可以改 src 导航后
      // 用同一个 contentWindow 发消息，必须叠加扩展 origin 校验。
      const extensionOrigin = getExtensionOrigin();
      if (!extensionOrigin || event.origin !== extensionOrigin) {
        return;
      }
      const data = event.data;
      if (!data || data.source !== FLOAT_SELECT_MESSAGE_SOURCE || data.type !== 'floating-select-state') {
        return;
      }

      if (data.open && floatUi.panelVisible) {
        lockHostPageScroll();
        return;
      }
      unlockHostPageScroll();
    };
    window.addEventListener('message', onWindowMessage);
    floatUi.cleanup.push(() => window.removeEventListener('message', onWindowMessage));

    const reattachIfMissing = () => {
      if (!floatUi || !document.body) {
        return false;
      }
      let rebound = false;
      if (floatUi.observer && floatUi.observedBody !== document.body) {
        floatUi.observer.disconnect();
        floatUi.observer.observe(document.body, { childList: true });
        floatUi.observedBody = document.body;
        rebound = true;
      }
      // 页面可能只清空了 style 而没有移除节点，这里顺带纠正（BUG-6）。
      ensureFloatInlineStyles();
      const reattached = bringFloatUiToFront();
      return rebound || reattached;
    };

    // PERF-3：固定 100ms 去抖遇到持续清理 body 的页面会形成 ~10Hz 乒乓。
    // 只有“真的又重挂了一次”才累计退避；安静一段时间后自动复位回最快响应。
    const REATTACH_BACKOFF_AFTER = 3;
    const REATTACH_MAX_DELAY = 3000;
    const REATTACH_BURST_RESET_MS = 2000;
    let reattachScheduled = false;
    let reattachBurstCount = 0;
    let lastReattachTime = 0;

    const scheduleReattach = (delay = 150) => {
      if (reattachScheduled || !floatUi) {
        return;
      }
      reattachScheduled = true;

      const now = Date.now();
      if (now - lastReattachTime > REATTACH_BURST_RESET_MS) {
        reattachBurstCount = 0;
      }
      const backoffDelay = reattachBurstCount >= REATTACH_BACKOFF_AFTER
        ? Math.min(REATTACH_MAX_DELAY, 100 * (2 ** (reattachBurstCount - REATTACH_BACKOFF_AFTER + 1)))
        : 0;

      window.setTimeout(() => {
        reattachScheduled = false;
        const didReattach = reattachIfMissing();
        if (didReattach) {
          reattachBurstCount += 1;
          lastReattachTime = Date.now();
        } else {
          reattachBurstCount = 0;
        }
      }, Math.max(delay, backoffDelay));
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // 忽略页面普通 DOM 更新；只在悬浮节点被移除/挪出 body 时再挂回。
        // 填充、表单校验、SPA 渲染常会新增节点，旧逻辑会误触发重挂导致闪烁。
        for (const removed of mutation.removedNodes) {
          if (
            removed === button
            || removed === panel
            || (removed.nodeType === 1 && (removed.contains?.(button) || removed.contains?.(panel)))
          ) {
            scheduleReattach(100);
            return;
          }
        }

        if (button.parentNode !== document.body || panel.parentNode !== document.body) {
          scheduleReattach(100);
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true });
    floatUi.observer = observer;
    floatUi.observedBody = document.body;

    const documentObserver = new MutationObserver(() => {
      if (floatUi && document.body && floatUi.observedBody !== document.body) {
        scheduleReattach(0);
      }
    });
    documentObserver.observe(document.documentElement, { childList: true });
    floatUi.documentObserver = documentObserver;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        reattachIfMissing();
        syncLockedScrollPosition();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    floatUi.cleanup.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
  }

  /**
   * 从 URL 或 origin 中提取 hostname（不含端口）
   */
  function extractFloatHostname(rawUrl) {
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
  function matchesFloatSitePattern(rawUrl, pattern) {
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

    const hostname = extractFloatHostname(rawUrl);
    if (!hostname) return false;

    // 通配符匹配
    if (p.startsWith('*.')) {
      const suffix = p.slice(2);
      if (!suffix) return false;
      return hostname === suffix || hostname.endsWith('.' + suffix);
    }

    // 关键词匹配
    return hostname.toLowerCase().includes(p.toLowerCase());
  }

  function matchesAnyFloatSitePattern(rawUrl, patterns) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    return patterns.some(p => matchesFloatSitePattern(rawUrl, p));
  }

  /**
   * 站点是否允许页面助手能力（黑名单 / 白名单）。
   * 注意与 floatWindowEnabled 区分：后者只是用户关掉了悬浮窗 UI，
   * 从 popup 触发的填充仍然应当可用。
   */
  function evaluateSiteToolsAllowed(result) {
    const origin = (window.location && window.location.origin) || '';
    if (!origin) {
      return true;
    }

    const blocklist = Array.isArray(result.siteBlocklist) ? result.siteBlocklist : [];
    if (matchesAnyFloatSitePattern(window.location.href, blocklist)) {
      return false;
    }
    if (result.siteAccessMode === 'whitelist') {
      const allowlist = Array.isArray(result.siteAllowlist) ? result.siteAllowlist : [];
      if (!matchesAnyFloatSitePattern(window.location.href, allowlist) && !allowlist.includes(origin)) {
        return false;
      }
    }
    return true;
  }

  function bindFocusTracking() {
    if (focusTrackingBound || pageToolsDisposed) {
      return;
    }
    document.addEventListener('focusin', handleDocumentFocusIn, true);
    focusTrackingBound = true;
  }

  function unbindFocusTracking() {
    if (!focusTrackingBound) {
      return;
    }
    document.removeEventListener('focusin', handleDocumentFocusIn, true);
    focusTrackingBound = false;
  }

  /**
   * 应用站点级能力开关。站点被禁用时解绑 focusin 追踪、清空已记录的输入框引用，
   * 并结束进行中的选取/预览；重新启用时恢复追踪。
   * storage.onChanged 监听不在这里处理——它必须一直在，否则感知不到重新启用。
   */
  function applySiteToolsPermission(allowed) {
    const next = Boolean(allowed);
    siteToolsAllowed = next;

    if (next) {
      bindFocusTracking();
      return;
    }

    unbindFocusTracking();
    lastFocusedElement = null;
    stopFieldSelection();
    clearPreviewTargets();
  }

  /**
   * 填充/选取类消息的准入判断。首次 reconcile 还没跑完时先等它，
   * 避免页面刚加载就被一条消息绕过站点黑名单。
   */
  async function ensureSiteToolsAllowed() {
    if (siteToolsPermissionReady) {
      try {
        await siteToolsPermissionReady;
      } catch {
        // 读取设置失败时沿用当前判定，不阻塞。
      }
    }
    return siteToolsAllowed;
  }

  async function reconcileFloatWindow(revision) {
    const result = await storageGet([
      'floatWindowEnabled', FLOAT_LAYOUT_KEY, FLOAT_WINDOW_STYLE_KEY,
      'siteAccessMode', 'siteAllowlist', 'siteBlocklist'
    ]);
    if (pageToolsDisposed || revision !== floatLifecycleRevision) {
      return;
    }
    if (result[FLOAT_WINDOW_STYLE_KEY] !== FIXED_FLOAT_WINDOW_STYLE) {
      storageSet({ [FLOAT_WINDOW_STYLE_KEY]: FIXED_FLOAT_WINDOW_STYLE }).catch(() => {});
    }

    // 站点准入要先于 floatWindowEnabled 判断，否则关掉悬浮窗后就再也刷新不到名单变化。
    const siteAllowed = evaluateSiteToolsAllowed(result);
    applySiteToolsPermission(siteAllowed);

    if (result.floatWindowEnabled === false || !siteAllowed) {
      teardownFloatWindow();
      return;
    }
    await initFloatWindow(result[FLOAT_LAYOUT_KEY]);
  }

  function runFloatWindowReconcile(revision) {
    siteToolsPermissionReady = reconcileFloatWindow(revision).catch(() => {});
    return siteToolsPermissionReady;
  }

  function scheduleFloatWindowReconcile() {
    if (pageToolsDisposed) {
      return;
    }
    const revision = ++floatLifecycleRevision;
    runFloatWindowReconcile(revision);
  }

  function handleDocumentFocusIn(event) {
    if (isEditableElement(event.target)) {
      lastFocusedElement = event.target;
    }
  }

  function handleStorageChanged(changes, area) {
    if (pageToolsDisposed || area !== 'local') {
      return;
    }

    if (changes[PAGE_FILL_RULES_KEY]) {
      allFillRules = changes[PAGE_FILL_RULES_KEY].newValue || {};
    }

    if (changes.floatWindowEnabled
      || changes.siteAccessMode
      || changes.siteAllowlist
      || changes.siteBlocklist) {
      const revision = ++floatLifecycleRevision;
      if (changes.floatWindowEnabled?.newValue === false) {
        // 先立即拆窗口保证观感即时，随后仍要 reconcile 一次刷新站点能力开关。
        teardownFloatWindow();
      }
      // 站点名单变化后必须重新评估能力开关（可能是重新启用），走完整 reconcile。
      runFloatWindowReconcile(revision);
    }

    if (changes[FLOAT_LAYOUT_KEY] && floatUi) {
      const nextLayout = changes[FLOAT_LAYOUT_KEY].newValue || {};
      floatUi.buttonLayout = applyButtonLayout(floatUi.button, nextLayout.button);
      floatUi.panelLayout = applyPanelLayout(floatUi.panel, nextLayout.panel);
      floatUi.isPinned = Boolean(nextLayout.pinned);
      const pinButton = document.getElementById('temp-email-panel-pin');
      if (pinButton) {
        pinButton.classList.toggle('pinned', floatUi.isPinned);
        pinButton.title = floatUi.isPinned ? '取消固定窗口' : '固定窗口（点击外部不关闭）';
      }
    }

    if (changes[FLOAT_WINDOW_STYLE_KEY]) {
      applyFloatWindowStyle();
      if (changes[FLOAT_WINDOW_STYLE_KEY].newValue !== FIXED_FLOAT_WINDOW_STYLE) {
        storageSet({ [FLOAT_WINDOW_STYLE_KEY]: FIXED_FLOAT_WINDOW_STYLE }).catch(() => {});
      }
    }
  }

  // 需要站点准入的消息类型（SEC-10）。生命周期与取消/清理类消息不在其中。
  const SITE_GATED_MESSAGE_TYPES = new Set([
    'fill-value',
    'fill-profile',
    'start-field-selection',
    'preview-fill-target',
    'preview-fill-profile',
  ]);

  function handleRuntimeMessage(message, sender, sendResponse) {
    (async () => {
      if (message?.type === 'page-tools-ping') {
        sendResponse({ ok: true, version: PAGE_TOOLS_VERSION });
        return;
      }

      if (message?.type === 'teardown-page-tools') {
        floatLifecycleRevision += 1;
        teardownFloatWindow();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'dispose-page-tools') {
        sendResponse({ ok: true, version: PAGE_TOOLS_VERSION });
        disposePageTools();
        return;
      }

      // SEC-10：填充 / 字段选取 / 预览属于“对页面动手”的能力，
      // 站点被禁用时必须直接拒绝，而不是照常扫描并填充整页。
      // cancel-field-selection、clear-fill-preview 是收尾动作，始终放行。
      if (SITE_GATED_MESSAGE_TYPES.has(message?.type) && !(await ensureSiteToolsAllowed())) {
        sendResponse({ ok: false, error: '当前站点已在扩展设置中被禁用，页面填充功能不可用' });
        return;
      }

      if (message?.type === 'fill-value') {
        sendResponse(await fillSingleValue(message.value || '', message.kind || 'text'));
        return;
      }

      if (message?.type === 'fill-profile') {
        sendResponse(await fillProfile(message.fields || {}));
        return;
      }

      if (message?.type === 'start-field-selection') {
        await ensureFillRulesLoaded();
        startFieldSelection(message.kind, message.label);
        sendResponse({ ok: true, armed: true });
        return;
      }

      if (message?.type === 'cancel-field-selection') {
        if (fieldSelection) {
          finishFieldSelection('已取消字段选择。', 'info');
        }
        sendResponse({ ok: true, cancelled: true });
        return;
      }

      if (message?.type === 'preview-fill-target') {
        sendResponse(await previewFillTarget(message.kind));
        return;
      }

      if (message?.type === 'preview-fill-profile') {
        sendResponse(await previewFillProfile(message.fields || {}));
        return;
      }

      if (message?.type === 'clear-fill-preview') {
        clearPreviewTargets();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: 'Unsupported message' });
    })().catch((error) => {
      sendResponse({ ok: false, error: error.message });
    });

    return true;
  }

  function disposePageTools() {
    if (pageToolsDisposed) {
      return;
    }
    pageToolsDisposed = true;
    pageToolsController.disposed = true;
    floatLifecycleRevision += 1;
    teardownFloatWindow();
    unbindFocusTracking();
    lastFocusedElement = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.removeListener) {
      chrome.storage.onChanged.removeListener(handleStorageChanged);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.removeListener) {
      chrome.runtime.onMessage.removeListener(handleRuntimeMessage);
    }
    if (window.__floatMailPageToolsController === pageToolsController) {
      delete window.__floatMailPageToolsController;
      window.__tempEmailPageToolsLoaded = false;
    }
  }

  pageToolsController.dispose = disposePageTools;
  // 先绑上 focusin，随后的首次 reconcile 若判定站点被禁用会立刻解绑并清空引用；
  // 反过来（等 reconcile 再绑）会在 storage 读取失败时永久丢失焦点追踪。
  bindFocusTracking();
  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener(handleStorageChanged);
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
  }

  // 升级或扩展重载后，移除失效上下文遗留的悬浮 DOM。
  document.getElementById(BUTTON_ID)?.remove();
  document.getElementById(PANEL_ID)?.remove();
  scheduleFloatWindowReconcile();
})();
