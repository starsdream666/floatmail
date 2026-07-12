// 页面助手 Content Script
// 负责悬浮窗、页面填充与页面级消息响应。
(function () {
  'use strict';

  if (window.__tempEmailPageToolsLoaded) {
    return;
  }
  window.__tempEmailPageToolsLoaded = true;

  const BUTTON_ID = 'temp-email-float-btn';
  const PANEL_ID = 'temp-email-float-panel';
  const FLOAT_TOP_Z_INDEX = '2147483647';
  const FLOAT_LAYOUT_KEY = 'floatLayout';
  const FLOAT_WINDOW_STYLE_KEY = 'floatWindowStyle';
  const PAGE_FILL_RULES_KEY = 'pageFillRules';
  const DEFAULT_PANEL_WIDTH = 560;
  const DEFAULT_PANEL_HEIGHT = 680;
  const LEGACY_DEFAULT_PANEL_WIDTH = 500;
  const LEGACY_DEFAULT_PANEL_HEIGHT = 560;
  const MIN_PANEL_WIDTH = 320;
  const MIN_PANEL_HEIGHT = 300;
  const PREVIEW_TARGET_CLASS = 'temp-email-fill-preview-target';
  const SELECT_TARGET_CLASS = 'temp-email-fill-select-target';
  const SELECTION_HINT_ID = 'temp-email-fill-selection-hint';
  const FLOAT_SELECT_MESSAGE_SOURCE = 'temp-email-floating-panel';
  const FLOAT_WINDOW_STYLES = Object.freeze({
    LEGACY: 'legacy',
    MODERN: 'modern',
  });
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
  let currentFloatWindowStyle = FLOAT_WINDOW_STYLES.MODERN;
  let shouldReopenFloatPanelAfterSelection = false;
  let lastPanelStateChangeTime = 0;
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

  function bringFloatUiToFront() {
    if (!floatUi || !document.body) {
      return;
    }

    const { button, panel, observer } = floatUi;
    const firstNode = floatUi.panelVisible ? button : panel;
    const lastNode = floatUi.panelVisible ? panel : button;
    // 仅在节点脱离 body 或按钮/面板相对顺序错误时重挂。
    // 不再因 body 末尾新增兄弟节点反复 appendChild：
    // 填充/SPA 更新会不断改 DOM，重挂 iframe 面板会像“关闭又打开”。
    // 置顶依赖最大 z-index，不依赖始终处于 body 最后。
    const needsReorder = firstNode.parentNode !== document.body
      || lastNode.parentNode !== document.body
      || firstNode.nextElementSibling !== lastNode;

    if (needsReorder) {
      // 暂停 observer 避免 appendChild 自触发
      if (observer) {
        observer.disconnect();
      }
      document.body.appendChild(firstNode);
      document.body.appendChild(lastNode);
      if (observer) {
        observer.observe(document.body, { childList: true });
        floatUi.observedBody = document.body;
      }
    }

    applyFloatTopLayerStyles();
  }

  function clearPanelEnterAnimation() {
    if (!floatUi?.panel) {
      return;
    }
    floatUi.panel.classList.remove('panel-enter');
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
      panel.classList.remove('panel-enter');
      panel.removeEventListener('animationend', onAnimationEnd);
    };
    panel.addEventListener('animationend', onAnimationEnd);
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
    } else {
      floatUi.panelVisible = false;
      clearPanelEnterAnimation();
      floatUi.panel.classList.remove('visible');
      unlockHostPageScroll();
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

  function normalizeFloatWindowStyle(style) {
    return style === FLOAT_WINDOW_STYLES.LEGACY ? FLOAT_WINDOW_STYLES.LEGACY : FLOAT_WINDOW_STYLES.MODERN;
  }

  function getDefaultPanelSize(style) {
    return normalizeFloatWindowStyle(style) === FLOAT_WINDOW_STYLES.LEGACY
      ? { width: LEGACY_DEFAULT_PANEL_WIDTH, height: LEGACY_DEFAULT_PANEL_HEIGHT }
      : { width: DEFAULT_PANEL_WIDTH, height: DEFAULT_PANEL_HEIGHT };
  }

  function isDefaultPanelSizeForStyle(width, height, style) {
    const defaultSize = getDefaultPanelSize(style);
    return Math.round(width) === defaultSize.width
      && Math.round(height) === defaultSize.height;
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

  function escapeAttributeValue(value) {
    return String(value)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
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

  function getAccessibleDocuments() {
    return getSearchRoots().filter((root) => root.nodeType === Node.DOCUMENT_NODE);
  }

  function getEditableCandidates() {
    const candidates = [];
    getSearchRoots().forEach((root) => {
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

  function queryEditableElement(selector, contextPath = null) {
    if (!selector) {
      return null;
    }

    const roots = Array.isArray(contextPath) && contextPath.length > 0
      ? [resolveRuleContext(contextPath)].filter(Boolean)
      : getSearchRoots();
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

  function resolveRuleTarget(kind) {
    const rule = getOriginFillRules()[kind];
    if (!rule?.selector) {
      return null;
    }
    return queryEditableElement(rule.selector, rule.contextPath);
  }

  function resolveFillTarget(kind, options = {}) {
    const exclude = options.exclude || new Set();
    const preferFocused = options.preferFocused !== false;
    const ruleTarget = options.ignoreRule ? null : resolveRuleTarget(kind);

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

    const candidates = getEditableCandidates().filter((candidate) => !exclude.has(candidate));
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
    const tag = element.tagName.toLowerCase();
    const parts = [tag];
    if (element.id) {
      parts.push(`#${element.id}`);
    } else if (element.name) {
      parts.push(`[name="${element.name}"]`);
    } else if (element.type) {
      parts.push(`[type="${element.type}"]`);
    }

    const label = getElementLabelText(element);
    if (label) {
      parts.push(`· ${label.slice(0, 40)}`);
    }

    return parts.join(' ');
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
    let current = node instanceof Element ? node : node?.parentElement || null;

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
    document.getElementById(SELECTION_HINT_ID)?.remove();
  }

  function showSelectionHint(text, tone = 'info') {
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
    if (!iframeWindow) {
      return;
    }
    try {
      iframeWindow.postMessage({
        source: FLOAT_SELECT_MESSAGE_SOURCE,
        type: 'floating-field-selection-state',
        active: Boolean(active),
        label: label || '',
      }, '*');
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
    showSelectionHint(message, tone);
    window.setTimeout(() => {
      if (!fieldSelection) {
        removeSelectionHint();
      }
    }, 1800);
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
          showSelectionHint(`已保存${labelText}规则。`, 'success');
          window.setTimeout(() => {
            if (!fieldSelection) {
              removeSelectionHint();
            }
          }, 1800);
        })
        .catch((error) => {
          showSelectionHint(`保存失败：${error.message}`, 'error');
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
      targetDocument.addEventListener('mousemove', onMouseMove, true);
      targetDocument.addEventListener('pointerdown', onMouseDown, true);
      targetDocument.addEventListener('mousedown', onMouseDown, true);
      targetDocument.addEventListener('touchstart', onMouseDown, { capture: true, passive: false });
      targetDocument.addEventListener('click', onClick, true);
      targetDocument.addEventListener('keydown', onKeyDown, true);
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('mousemove', onMouseMove, true));
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('pointerdown', onMouseDown, true));
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('mousedown', onMouseDown, true));
      fieldSelection.cleanup.push(() => targetDocument.removeEventListener('touchstart', onMouseDown, true));
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

  async function previewFillTarget(kind) {
    await ensureFillRulesLoaded();
    const target = resolveFillTarget(kind, { preferFocused: false });
    setPreviewTargets(target ? [target] : []);
    return { ok: true, matched: Boolean(target) };
  }

  async function previewFillProfile(fields) {
    await ensureFillRulesLoaded();

    const operations = buildFillOperations(fields || {});
    const usedTargets = new Set();
    const matchedGroups = new Set();
    const targets = [];

    for (const operation of operations) {
      if (Array.isArray(operation.skipIfMatchedGroups)
        && operation.skipIfMatchedGroups.some((group) => matchedGroups.has(group))) {
        continue;
      }
      if (Array.isArray(operation.skipIfMatchedGroupsAll)
        && operation.skipIfMatchedGroupsAll.every((group) => matchedGroups.has(group))) {
        continue;
      }
      const target = resolveFillTarget(operation.kind, {
        exclude: usedTargets,
        preferFocused: false,
      });
      if (!target) {
        continue;
      }
      usedTargets.add(target);
      if (operation.group) {
        matchedGroups.add(operation.group);
      }
      targets.push(target);
    }

    setPreviewTargets(targets);
    return { ok: true, matched: targets.length };
  }

  function dispatchInputEvents(element) {
    const EventConstructor = element.ownerDocument?.defaultView?.Event || Event;
    element.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    element.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  }

  function fillElement(element, value) {
    if (!element) {
      return false;
    }

    element.focus();

    if (element.isContentEditable) {
      element.textContent = value;
      dispatchInputEvents(element);
      return true;
    }

    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
    if (descriptor?.set) {
      descriptor.set.call(element, value);
    } else {
      element.value = value;
    }
    dispatchInputEvents(element);
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
      if (Array.isArray(operation.skipIfMatchedGroups)
        && operation.skipIfMatchedGroups.some((group) => matchedGroups.has(group))) {
        continue;
      }
      if (Array.isArray(operation.skipIfMatchedGroupsAll)
        && operation.skipIfMatchedGroupsAll.every((group) => matchedGroups.has(group))) {
        continue;
      }
      const target = resolveFillTarget(operation.kind, {
        exclude: usedTargets,
        preferFocused: false,
      });
      if (!target) {
        if (operation.optional) {
          continue;
        }
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

    if (!floatUi) {
      return;
    }

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

  function applyPanelLayout(panel, layout, style = currentFloatWindowStyle, previousStyle = null) {
    const normalizedStyle = normalizeFloatWindowStyle(style);
    const savedWidth = parseLayoutNumber(layout?.width);
    const savedHeight = parseLayoutNumber(layout?.height);
    const hasValidSavedSize = savedWidth !== null
      && savedHeight !== null
      && savedWidth >= MIN_PANEL_WIDTH
      && savedHeight >= MIN_PANEL_HEIGHT;
    const shouldSwitchDefaultSize = hasValidSavedSize
      && previousStyle
      && normalizeFloatWindowStyle(previousStyle) !== normalizedStyle
      && isDefaultPanelSizeForStyle(savedWidth, savedHeight, previousStyle);
    const savedLeft = hasValidSavedSize ? parseLayoutNumber(layout?.left) : null;
    const savedTop = hasValidSavedSize ? parseLayoutNumber(layout?.top) : null;
    const defaultSize = getDefaultPanelSize(normalizedStyle);
    const preferredWidth = hasValidSavedSize && !shouldSwitchDefaultSize ? savedWidth : defaultSize.width;
    const preferredHeight = hasValidSavedSize && !shouldSwitchDefaultSize ? savedHeight : defaultSize.height;
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

  function applyFloatWindowStyle(style, options = {}) {
    const normalizedStyle = normalizeFloatWindowStyle(style);
    const previousStyle = normalizeFloatWindowStyle(floatUi?.style || currentFloatWindowStyle);
    currentFloatWindowStyle = normalizedStyle;

    if (!floatUi) {
      return normalizedStyle;
    }

    floatUi.style = normalizedStyle;
    floatUi.button.dataset.style = normalizedStyle;
    floatUi.panel.dataset.style = normalizedStyle;
    if (floatUi.overlay) {
      floatUi.overlay.dataset.style = normalizedStyle;
    }

    if (options.reapplyLayout !== false) {
      floatUi.buttonLayout = applyButtonLayout(floatUi.button, floatUi.buttonLayout);
      floatUi.panelLayout = applyPanelLayout(floatUi.panel, floatUi.panelLayout, normalizedStyle, previousStyle);
    }
    applyFloatTopLayerStyles();

    return normalizedStyle;
  }

  async function initFloatWindow(savedLayout, savedStyle) {
    if (floatUi || !document.body) {
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>';
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
      style: normalizeFloatWindowStyle(savedStyle),
      isPinned: Boolean(savedLayout?.pinned),
      panelVisible: false,
      iframeLoaded: false,
      buttonLayout: null,
      panelLayout: null,
      observer: null,
      documentObserver: null,
      observedBody: null,
      cleanup: [],
    };
    installFloatHostEventIsolation([button, panel]);
    pinButton.classList.toggle('pinned', floatUi.isPinned);
    applyFloatWindowStyle(floatUi.style, { reapplyLayout: false });
    floatUi.buttonLayout = applyButtonLayout(button, savedLayout?.button);
    floatUi.panelLayout = applyPanelLayout(panel, savedLayout?.panel, floatUi.style);
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

    const onWindowResize = () => {
      if (!floatUi) {
        return;
      }
      floatUi.buttonLayout = applyButtonLayout(button, floatUi.buttonLayout);
      floatUi.panelLayout = applyPanelLayout(panel, floatUi.panelLayout);
    };
    window.addEventListener('resize', onWindowResize);
    floatUi.cleanup.push(() => window.removeEventListener('resize', onWindowResize));

    const onWindowMessage = (event) => {
      if (!floatUi || event.source !== iframe.contentWindow) {
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
        return;
      }
      if (floatUi.observer && floatUi.observedBody !== document.body) {
        floatUi.observer.disconnect();
        floatUi.observer.observe(document.body, { childList: true });
        floatUi.observedBody = document.body;
      }
      bringFloatUiToFront();
    };

    let reattachScheduled = false;
    const scheduleReattach = (delay = 150) => {
      if (reattachScheduled || !floatUi) {
        return;
      }
      reattachScheduled = true;
      window.setTimeout(() => {
        reattachScheduled = false;
        reattachIfMissing();
      }, delay);
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

  async function maybeInitFloatWindow() {
    const result = await storageGet([
      'floatWindowEnabled', FLOAT_LAYOUT_KEY, FLOAT_WINDOW_STYLE_KEY,
      'siteAccessMode', 'siteAllowlist', 'siteBlocklist'
    ]);
    currentFloatWindowStyle = normalizeFloatWindowStyle(result[FLOAT_WINDOW_STYLE_KEY]);
    if (result.floatWindowEnabled === false) {
      teardownFloatWindow();
      return;
    }
    // Check site-level access control
    const origin = (window.location && window.location.origin) || '';
    if (origin) {
      const blocklist = Array.isArray(result.siteBlocklist) ? result.siteBlocklist : [];
      if (matchesAnyFloatSitePattern(window.location.href, blocklist)) {
        teardownFloatWindow();
        return;
      }
      if (result.siteAccessMode === 'whitelist') {
        const allowlist = Array.isArray(result.siteAllowlist) ? result.siteAllowlist : [];
        if (!matchesAnyFloatSitePattern(window.location.href, allowlist) && !allowlist.includes(origin)) {
          teardownFloatWindow();
          return;
        }
      }
    }
    await initFloatWindow(result[FLOAT_LAYOUT_KEY], currentFloatWindowStyle);
  }

  document.addEventListener('focusin', (event) => {
    if (isEditableElement(event.target)) {
      lastFocusedElement = event.target;
    }
  }, true);

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') {
        return;
      }

      if (changes[PAGE_FILL_RULES_KEY]) {
        allFillRules = changes[PAGE_FILL_RULES_KEY].newValue || {};
      }

      if (changes.floatWindowEnabled) {
        if (changes.floatWindowEnabled.newValue === false) {
          teardownFloatWindow();
        } else {
          maybeInitFloatWindow().catch(() => {});
        }
      }

      if (changes.siteAccessMode || changes.siteAllowlist || changes.siteBlocklist) {
        maybeInitFloatWindow().catch(() => {});
      }

      if (changes[FLOAT_LAYOUT_KEY] && floatUi) {
        const nextLayout = changes[FLOAT_LAYOUT_KEY].newValue || {};
        floatUi.buttonLayout = applyButtonLayout(floatUi.button, nextLayout.button);
        floatUi.panelLayout = applyPanelLayout(floatUi.panel, nextLayout.panel, floatUi.style);
        floatUi.isPinned = Boolean(nextLayout.pinned);
        const pinButton = document.getElementById('temp-email-panel-pin');
        if (pinButton) {
          pinButton.classList.toggle('pinned', floatUi.isPinned);
          pinButton.title = floatUi.isPinned ? '取消固定窗口' : '固定窗口（点击外部不关闭）';
        }
      }

      if (changes[FLOAT_WINDOW_STYLE_KEY]) {
        currentFloatWindowStyle = normalizeFloatWindowStyle(changes[FLOAT_WINDOW_STYLE_KEY].newValue);
        applyFloatWindowStyle(currentFloatWindowStyle);
      }
    });
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message?.type === 'page-tools-ping') {
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === 'teardown-page-tools') {
        teardownFloatWindow();
        sendResponse({ ok: true });
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
    });
  }

  maybeInitFloatWindow().catch(() => {});
})();
