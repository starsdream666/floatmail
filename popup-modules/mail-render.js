(function () {
  'use strict';

  function createMailRenderer(deps) {
    const {
      copyToClipboard,
      sendToActivePage,
      bindFillPreview,
      showMessage,
      fillProfileMessage
    } = deps;
    const MAX_MAIL_RAW_PARSE_CHARS = 600000;
    const MAX_MAIL_RAW_FALLBACK_CHARS = 200000;
    const MAX_MAIL_HTML_TO_TEXT_CHARS = 300000;
    const MAX_MAIL_HTML_RENDER_CHARS = 500000;
    const MIN_MAIL_IFRAME_HEIGHT = 480;
    const FALLBACK_MAIL_IFRAME_HEIGHT = 720;
    const MAX_MAIL_IFRAME_HEIGHT = 2400;
    const MAX_DOM_ELEMENTS = 1500;
    const MAX_STYLE_BLOCK_CHARS = 50000;
    const MAX_IFRAME_SRCDOC_CHARS = 400000;

    function clipMailSource(value, limit) {
      return String(value || '').slice(0, limit);
    }

    function isMailHtmlTooLarge(html) {
      return String(html || '').length > MAX_MAIL_HTML_RENDER_CHARS;
    }

    function getLargeMailRawFallbackText(raw) {
      const rawSource = String(raw || '');
      if (!rawSource) {
        return '';
      }
      let splitIdx = rawSource.indexOf('\r\n\r\n');
      let separatorLength = 4;
      if (splitIdx === -1) {
        splitIdx = rawSource.indexOf('\n\n');
        separatorLength = 2;
      }
      const body = splitIdx === -1 ? rawSource : rawSource.slice(splitIdx + separatorLength);
      return clipMailSource(body || rawSource, MAX_MAIL_RAW_FALLBACK_CHARS).trim();
    }

    function getMailPlainText(text, html, fallback = '') {
      const normalizedText = String(text || '').trim();
      if (normalizedText && !isStubPlainText(normalizedText, html)) {
        return normalizedText;
      }
      const htmlSource = String(html || '');
      if (!htmlSource) {
        return String(fallback || '').trim();
      }
      if (htmlSource.length > MAX_MAIL_HTML_TO_TEXT_CHARS) {
        return '邮件 HTML 内容过大，已跳过完整 HTML 解析并改用纯文本回退显示。';
      }
      return htmlToText(htmlSource) || String(fallback || '').trim();
    }

    function parseEmailBodySafely(raw) {
      const rawSource = String(raw || '');
      if (!rawSource) {
        return { text: '', rawTooLarge: false };
      }
      if (rawSource.length > MAX_MAIL_RAW_PARSE_CHARS) {
        return {
          text: getLargeMailRawFallbackText(rawSource),
          html: '',
          rawTooLarge: true
        };
      }
      return {
        ...parseEmailBody(rawSource),
        rawTooLarge: false
      };
    }

    function htmlToText(html) {
      if (!html) return '';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body?.textContent?.replace(/\u00a0/g, ' ').trim() || '';
    }

    function isStubPlainText(text, html) {
      const normalized = String(text || '').trim();
      if (!normalized) return false;
      // If there's no HTML to fall back to, trust the text as-is
      const htmlSource = String(html || '').trim();
      if (!htmlSource) return false;
      // Stub patterns: emails whose plain-text part is just a note telling you to view the HTML version
      const stubPatterns = [
        /please\s+open\s+the\s+html\s+version/i,
        /view\s+this\s+(email|message)\s+in\s+(html|your\s+browser)/i,
        /html\s+version\s+of\s+this\s+(email|message)/i,
        /your\s+(email|mail)\s+client\s+does\s+not\s+support\s+html/i,
        /请\s*(打开|查看|使用)\s*(此|该)?\s*(邮件|消息|信件)的?\s*HTML\s*版本/i,
        /您的\s*(邮件|邮箱)\s*(客户端|软件)\s*(不支持|无法\s*显示)\s*HTML/i,
        /this\s+(email|message)\s+is\s+(in|formatted\s+in)\s+html/i,
        /此\s*(邮件|消息|信件)\s*(为|是)\s*HTML\s*(格式|邮件)/i,
        /to\s+view\s+this\s+(email|message).*html/i,
        /如果\s*(您|你)\s*(无法|不能)\s*(查看|显示).*请\s*(点击|打开)/i,
        /if\s+you\s+(cannot|can't)\s+(view|see|read)\s+this/i
      ];
      for (const pattern of stubPatterns) {
        if (pattern.test(normalized)) return true;
      }
      // Heuristic: if text is very short (< 200 chars) and HTML is much longer (> 5x),
      // the text is likely a stub
      if (normalized.length < 200 && htmlSource.length > normalized.length * 5) {
        return true;
      }
      return false;
    }

    function sanitizeEmailHtml(html, options = {}) {
      if (!html) return { html: '', remoteImageCount: 0, domTooComplex: false };
      const allowRemoteImages = options.allowRemoteImages === true;
      let remoteImageCount = 0;
      const doc = new DOMParser().parseFromString(html, 'text/html');

      // DOM complexity guard: bail out before expensive iteration
      const allElements = doc.querySelectorAll('*');
      if (allElements.length > MAX_DOM_ELEMENTS) {
        return { html: '', remoteImageCount: 0, domTooComplex: true };
      }

      const blockedTags = [
        'script',
        'iframe',
        'frame',
        'object',
        'embed',
        'form',
        'input',
        'button',
        'textarea',
        'select',
        'option',
        'base',
        'link',
        'meta[http-equiv="refresh"]'
      ];
      blockedTags.forEach((selector) => {
        doc.querySelectorAll(selector).forEach((node) => node.remove());
      });
      doc.querySelectorAll('style').forEach((node) => {
        let css = String(node.textContent || '')
          .replace(/@import[^;]+;/gi, '')
          .replace(/url\((?!['"]?(?:data:|cid:))[^)]+\)/gi, 'none');
        // Truncate overly large style blocks to prevent renderer overload
        if (css.length > MAX_STYLE_BLOCK_CHARS) {
          css = css.slice(0, MAX_STYLE_BLOCK_CHARS) + '\n/* [style block truncated] */';
        }
        node.textContent = css;
      });

      // Replace <meta viewport> with a wide-viewport setting so that responsive
      // email layouts don't collapse to the iframe's narrow pixel width.
      doc.querySelectorAll('meta[name="viewport"]').forEach((node) => node.remove());
      const wideViewport = doc.createElement('meta');
      wideViewport.setAttribute('name', 'viewport');
      wideViewport.setAttribute('content', 'width=640, initial-scale=1');
      if (doc.head) {
        doc.head.appendChild(wideViewport);
      }

      doc.querySelectorAll('*').forEach((node) => {
        Array.from(node.attributes).forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value || '';
          if (name.startsWith('on') || value.toLowerCase().startsWith('javascript:')) {
            node.removeAttribute(attr.name);
            return;
          }
          const isRemoteUrl = /^(?:https?:)?\/\//i.test(value);
          const tagName = String(node.tagName || '').toUpperCase();
          const isImageLikeTag = tagName === 'IMG' || tagName === 'SOURCE' || tagName === 'IMAGE';
          const srcsetHasRemoteUrl = name === 'srcset'
            && value.split(',').some((candidate) => /^(?:https?:)?\/\//i.test(candidate.trim().split(/\s+/)[0] || ''));
          if (srcsetHasRemoteUrl && tagName === 'IMG') {
            remoteImageCount += 1;
            if (!allowRemoteImages) {
              node.setAttribute('data-blocked-srcset', value);
              node.removeAttribute(attr.name);
              node.setAttribute('alt', `${node.getAttribute('alt') || '图片'}（已阻止远程加载）`);
            }
            return;
          }
          const isSvgImageHref = tagName === 'IMAGE' && (name === 'href' || name === 'xlink:href');
          if ((name === 'src' || name === 'poster' || name === 'background' || isSvgImageHref) && isRemoteUrl) {
            if (isImageLikeTag) {
              remoteImageCount += 1;
            }
            if (!allowRemoteImages || !isImageLikeTag || (name !== 'src' && !isSvgImageHref)) {
              node.setAttribute(`data-blocked-${name}`, value);
              node.removeAttribute(attr.name);
              if (tagName === 'IMG') {
                node.setAttribute('alt', `${node.getAttribute('alt') || '图片'}（已阻止远程加载）`);
              }
            }
          }
          if (tagName === 'A' && name === 'href' && /^(?:https?:)?\/\//i.test(value)) {
            node.setAttribute('target', '_blank');
            node.setAttribute('rel', 'noopener noreferrer nofollow');
          }
          if (name === 'style' && /url\(/i.test(value)) {
            // Only strip url() references from inline styles, keep other properties
            const cleaned = value.replace(/url\((?!['"]?(?:data:|cid:))[^)]*\)/gi, 'none');
            if (cleaned.trim()) {
              node.setAttribute('style', cleaned);
            } else {
              node.removeAttribute(attr.name);
            }
          }
        });
      });

      return {
        html: `<!DOCTYPE html>${doc.documentElement.outerHTML}`,
        remoteImageCount,
        domTooComplex: false
      };
    }

    function renderPlainText(container, text) {
      container.innerHTML = '';
      const pre = document.createElement('pre');
      pre.style.whiteSpace = 'pre-wrap';
      pre.style.wordBreak = 'break-word';
      pre.style.fontFamily = 'inherit';
      pre.style.margin = '0';
      pre.textContent = text || '(无内容)';
      container.appendChild(pre);
    }

    function renderSafeHtml(container, html, extraCss = '', options = {}) {
      container.innerHTML = '';
      const sanitized = sanitizeEmailHtml(html, options);

      // If DOM was too complex or srcdoc too large, fall back to plain text
      if (sanitized.domTooComplex || sanitized.html.length > MAX_IFRAME_SRCDOC_CHARS) {
        const fallbackText = htmlToText(html) || '(邮件内容过于复杂，无法渲染 HTML 视图)';
        renderPlainText(container, fallbackText);
        return {
          hasRemoteImages: false,
          remoteImageCount: 0,
          domTooComplex: true
        };
      }

      const iframe = document.createElement('iframe');
      const minimumIframeHeight = Math.max(
        360,
        Math.min(MIN_MAIL_IFRAME_HEIGHT, Number(window.innerHeight || 680) - 160)
      );
      iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox allow-same-origin');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.className = 'mail-html-frame';
      iframe.style.height = `${minimumIframeHeight}px`;
      iframe.style.minHeight = `${minimumIframeHeight}px`;
      iframe.style.maxHeight = `${MAX_MAIL_IFRAME_HEIGHT}px`;
      iframe.style.background = '#ffffff';
      iframe.srcdoc = sanitized.html;
      container.appendChild(iframe);

      iframe.addEventListener('load', () => {
        try {
          const doc = iframe.contentDocument;
          if (doc) {
            const style = doc.createElement('style');
            style.textContent = `
              html, body { background: #ffffff !important; color: #202124 !important; }
              body { margin: 0 !important; padding: 8px !important; word-break: break-word; overflow-wrap: break-word; }
              img { max-width: 100% !important; height: auto !important; }
              table { border-collapse: collapse; }
              td, th { word-break: break-word; }
              ${extraCss}
            `;
            doc.head.appendChild(style);

            // Force the email to render at desktop width inside the iframe.
            // Many HTML emails are designed for 600-640px and break at narrower widths.
            const EMAIL_RENDER_MIN_WIDTH = 640;
            const scrollWrapper = doc.createElement('div');
            scrollWrapper.id = '__mail-scroll-wrapper';
            scrollWrapper.style.cssText = `min-width:${EMAIL_RENDER_MIN_WIDTH}px;`;
            while (doc.body.firstChild) {
              scrollWrapper.appendChild(doc.body.firstChild);
            }
            doc.body.appendChild(scrollWrapper);
            doc.body.style.overflowX = 'auto';
            const syncIframeHeight = () => {
              if (!iframe.isConnected) {
                return false;
              }
              const measuredHeight = Math.max(
                Number(scrollWrapper.scrollHeight || 0),
                Number(scrollWrapper.getBoundingClientRect?.().height || 0),
                Number(doc.documentElement?.scrollHeight || 0),
                Number(doc.body?.scrollHeight || 0),
                minimumIframeHeight
              );
              const nextHeight = Math.min(
                Math.max(Math.ceil(measuredHeight) + 4, minimumIframeHeight),
                MAX_MAIL_IFRAME_HEIGHT
              );
              iframe.style.height = `${nextHeight}px`;
              return true;
            };

            syncIframeHeight();
            window.requestAnimationFrame(syncIframeHeight);
            [120, 400, 1000].forEach((delay) => window.setTimeout(syncIframeHeight, delay));

            if (typeof ResizeObserver === 'function') {
              const resizeObserver = new ResizeObserver(() => {
                if (!syncIframeHeight()) {
                  resizeObserver.disconnect();
                }
              });
              resizeObserver.observe(scrollWrapper);
              window.setTimeout(() => resizeObserver.disconnect(), 10000);
            }
          }
        } catch (error) {
          iframe.style.height = `${Math.max(minimumIframeHeight, FALLBACK_MAIL_IFRAME_HEIGHT)}px`;
        }
      });

      return {
        hasRemoteImages: sanitized.remoteImageCount > 0,
        remoteImageCount: sanitized.remoteImageCount
      };
    }

    function createMailInsightSection(title, count, options = {}) {
      const section = document.createElement('details');
      section.className = 'mail-insight-section';
      if (options.open === true) {
        section.open = true;
      }

      const summary = document.createElement('summary');
      summary.className = 'mail-insight-summary';

      const summaryMain = document.createElement('div');
      summaryMain.className = 'mail-insight-summary-main';

      const label = document.createElement('span');
      label.className = 'mail-insight-label';
      label.textContent = title;

      const countText = document.createElement('span');
      countText.className = 'mail-insight-count';
      countText.textContent = `${count} 个候选`;

      summaryMain.appendChild(label);
      summaryMain.appendChild(countText);
      summary.appendChild(summaryMain);

      const toggleText = document.createElement('span');
      toggleText.className = 'mail-insight-toggle';
      toggleText.textContent = options.open === true ? '收起' : '展开';
      summary.appendChild(toggleText);

      section.addEventListener('toggle', () => {
        toggleText.textContent = section.open ? '收起' : '展开';
      });

      const content = document.createElement('div');
      content.className = 'mail-insight-content';

      section.appendChild(summary);
      section.appendChild(content);
      return { section, content };
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function normalizeHttpUrl(value) {
      try {
        const url = new URL(String(value || '').trim());
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
      } catch {
        return '';
      }
    }

    function createMailInsightCopyButton(title, onClick) {
      const button = document.createElement('button');
      button.className = 'icon-btn mail-insight-copy-btn';
      button.title = title;
      button.setAttribute('aria-label', title);
      button.style.flexShrink = '0';
      button.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      button.addEventListener('click', onClick);
      return button;
    }

    function renderMailInsights(container, insights, options = {}) {
      if (!container) return;
      container.innerHTML = '';
      const normalizedInsights = {
        codes: Array.isArray(insights?.codes) ? insights.codes : [],
        links: Array.isArray(insights?.links)
          ? insights.links
            .map((link) => {
              const url = normalizeHttpUrl(link?.url);
              return url ? { url, label: link?.label || url } : null;
            })
            .filter(Boolean)
          : []
      };
      const hasCodes = normalizedInsights.codes.length > 0;
      const hasLinks = normalizedInsights.links.length > 0;
      const hasToolbar = Boolean(options.statusText || options.noteText || options.onRetry);
      if (!hasCodes && !hasLinks && !hasToolbar) {
        container.classList.add('hidden');
        return;
      }

      container.classList.remove('hidden');

      if (hasToolbar) {
        const toolbar = document.createElement('div');
        toolbar.className = 'mail-insight-toolbar';
        toolbar.style.display = 'flex';
        toolbar.style.alignItems = 'flex-start';
        toolbar.style.justifyContent = 'space-between';
        toolbar.style.gap = '10px';

        const meta = document.createElement('div');
        meta.className = 'mail-insight-toolbar-meta';
        meta.style.display = 'flex';
        meta.style.flexDirection = 'column';
        meta.style.gap = '4px';
        meta.style.minWidth = '0';

        if (options.statusText) {
          const status = document.createElement('div');
          status.className = `mail-insight-status ${options.statusType || 'info'}`;
          status.style.fontSize = '11px';
          status.style.fontWeight = '600';
          status.style.lineHeight = '1.4';
          status.style.color = options.statusType === 'error'
            ? 'var(--error)'
            : (options.statusType === 'success' ? '#1b8f3a' : 'var(--primary)');
          status.textContent = options.statusText;
          meta.appendChild(status);
        }

        const helperText = document.createElement('div');
        helperText.className = 'mail-insight-note';
        helperText.textContent = options.noteText || '仅展示更可能有用的验证码和操作链接，避免遮挡正文。';
        meta.appendChild(helperText);

        toolbar.appendChild(meta);

        if (typeof options.onRetry === 'function') {
          const retryBtn = document.createElement('button');
          retryBtn.className = 'icon-btn mail-tool-btn mail-insight-toolbar-btn';
          retryBtn.style.flexShrink = '0';
          retryBtn.title = options.retryLabel || '重试提取';
          retryBtn.setAttribute('aria-label', options.retryLabel || '重试提取');
          retryBtn.disabled = options.retryDisabled === true;
          retryBtn.innerHTML = options.retryDisabled === true
            ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>'
            : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
          retryBtn.addEventListener('click', () => {
            if (!retryBtn.disabled) {
              options.onRetry();
            }
          });
          toolbar.appendChild(retryBtn);
        }

        container.appendChild(toolbar);
      }

      if (hasCodes) {
        const { section, content } = createMailInsightSection('验证码', normalizedInsights.codes.length, {
          open: normalizedInsights.codes.length === 1
        });

        const codeGroup = document.createElement('div');
        codeGroup.className = 'mail-insight-group mail-insight-code-list';

        normalizedInsights.codes.forEach((code) => {
          const row = document.createElement('div');
          row.className = 'mail-insight-code-row';

          const chip = document.createElement('button');
          chip.className = 'insight-chip';
          chip.innerHTML = `<code>${escapeHtml(code)}</code>`;
          chip.addEventListener('click', () => copyToClipboard(code, chip));

          const copyBtn = createMailInsightCopyButton('复制验证码', () => copyToClipboard(code, copyBtn));

          const fillBtn = document.createElement('button');
          fillBtn.className = 'icon-btn mail-insight-fill-btn';
          fillBtn.title = '填入当前页面验证码输入框';
          fillBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/><path d="M5 3h14"/></svg>';
          fillBtn.addEventListener('click', async () => {
            try {
              await sendToActivePage({ type: 'fill-value', kind: 'verificationCode', value: code });
              copyToClipboard(code, fillBtn);
            } catch (error) {
              showMessage(fillProfileMessage, `填充失败: ${error.message}`, 'error');
            }
          });
          bindFillPreview(fillBtn, { kind: 'verificationCode' });

          row.appendChild(chip);
          row.appendChild(copyBtn);
          row.appendChild(fillBtn);
          codeGroup.appendChild(row);
        });

        content.appendChild(codeGroup);
        container.appendChild(section);
      }

      if (hasLinks) {
        const { section, content } = createMailInsightSection('链接', normalizedInsights.links.length, {
          open: false
        });

        const linkGroup = document.createElement('div');
        linkGroup.className = 'mail-insight-group mail-insight-link-list';

        normalizedInsights.links.forEach((link) => {
          const row = document.createElement('div');
          row.className = 'mail-insight-link-row';
          row.style.display = 'flex';
          row.style.alignItems = 'flex-start';
          row.style.gap = '6px';

          const anchor = document.createElement('a');
          anchor.className = 'insight-link';
          anchor.style.flex = '1';
          anchor.href = link.url;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
          anchor.textContent = link.label;
          anchor.title = link.url;

          const copyBtn = createMailInsightCopyButton('复制链接', () => copyToClipboard(link.url, copyBtn));

          row.appendChild(anchor);
          row.appendChild(copyBtn);
          linkGroup.appendChild(row);
        });

        content.appendChild(linkGroup);
        container.appendChild(section);
      }
    }

    function renderEmailBody(container, raw, options = {}) {
      const parsed = parseEmailBodySafely(raw);
      const html = parsed.html || '';
      const safeHtmlAvailable = !parsed.rawTooLarge && Boolean(html) && !isMailHtmlTooLarge(html);
      const plainText = parsed.rawTooLarge
        ? (parsed.text || '(无内容)')
        : (getMailPlainText(parsed.text, html, raw) || raw || '(无内容)');
      renderMailInsights(options.insightsContainer, options.insightsOverride || { codes: [], links: [] }, options.insightsRenderOptions || {});

      if (options.viewMode === 'plain-text' || !safeHtmlAvailable) {
        const fallbackText = parsed.rawTooLarge
          ? `邮件原始内容过大，已跳过完整 MIME 解析并切换为纯文本预览。\n\n${plainText || '(无内容)'}`
          : (!safeHtmlAvailable && html
            ? `邮件 HTML 内容过大，已自动切换为纯文本回退显示。\n\n${plainText || '(无内容)'}`
            : plainText);
        renderPlainText(container, fallbackText);
        return {
          ...parsed,
          insights: options.insightsOverride || { codes: [], links: [] },
          html: safeHtmlAvailable ? parsed.html : '',
          hasRemoteImages: false,
          safeHtmlAvailable
        };
      }

      const renderResult = renderSafeHtml(container, html, '', {
        allowRemoteImages: options.allowRemoteImages === true
      });

      // If renderSafeHtml fell back to plain text due to DOM complexity
      if (renderResult.domTooComplex) {
        return {
          ...parsed,
          insights: options.insightsOverride || { codes: [], links: [] },
          hasRemoteImages: false,
          remoteImageCount: 0,
          safeHtmlAvailable: false
        };
      }

      return {
        ...parsed,
        insights: options.insightsOverride || { codes: [], links: [] },
        hasRemoteImages: renderResult.hasRemoteImages,
        remoteImageCount: renderResult.remoteImageCount,
        safeHtmlAvailable: true
      };
    }

    function renderMoeEmailBody(container, message, insightsContainer, viewMode, allowRemoteImages = false) {
      const html = message?.html || '';
      const safeHtmlAvailable = Boolean(html) && !isMailHtmlTooLarge(html);
      const plainText = getMailPlainText(message?.content, html, '(无内容)') || '(无内容)';
      const insightsOverride = arguments[5];
      const insightsRenderOptions = arguments[6] || {};
      renderMailInsights(insightsContainer, insightsOverride || { codes: [], links: [] }, insightsRenderOptions);

      if (viewMode === 'plain-text' || !safeHtmlAvailable) {
        const fallbackText = !safeHtmlAvailable && html
          ? `邮件 HTML 内容过大，已自动切换为纯文本回退显示。\n\n${plainText || '(无内容)'}`
          : plainText;
        renderPlainText(container, fallbackText);
        return {
          insights: insightsOverride || { codes: [], links: [] },
          hasRemoteImages: false,
          safeHtmlAvailable
        };
      }

      const renderResult = renderSafeHtml(container, html, '', { allowRemoteImages });
      return {
        insights: insightsOverride || { codes: [], links: [] },
        ...renderResult,
        safeHtmlAvailable: !renderResult.domTooComplex
      };
    }

    function parseEmailBody(raw) {
      if (!raw) return { text: '' };

      function parsePart(content) {
        let bestHtml = null;
        let bestText = null;

        const boundaryMatch = content.match(/boundary="?([^"\r\n;]+)"?/i);
        let boundary = boundaryMatch ? boundaryMatch[1].trim() : null;
        if (!boundary) {
          const partsMatch = content.match(/^--([a-zA-Z0-9_=\-\.]+)[\r\n]/m);
          if (partsMatch) boundary = partsMatch[1];
        }

        if (boundary) {
          const parts = content.split('--' + boundary);
          for (let part of parts) {
            part = part.trim();
            if (!part || part === '--') continue;

            let splitIdx = part.indexOf('\r\n\r\n');
            if (splitIdx === -1) splitIdx = part.indexOf('\n\n');
            if (splitIdx === -1) continue;

            const headersRaw = part.substring(0, splitIdx);
            const headers = headersRaw.toLowerCase();
            let body = part.substring(splitIdx).trim();

            if (headers.includes('content-type: multipart/')) {
              const nested = parsePart(part);
              if (nested.html && !bestHtml) bestHtml = nested.html;
              if (nested.text && !bestText) bestText = nested.text;
              continue;
            }

            if (headers.includes('content-transfer-encoding: base64')) {
              body = decodeBase64UTF8(body);
            } else if (headers.includes('content-transfer-encoding: quoted-printable')) {
              body = decodeQuotedPrintable(body);
            }

            if (headers.includes('content-type: text/html')) bestHtml = body;
            else if (headers.includes('content-type: text/plain')) bestText = body;
          }
        }

        if (bestHtml) return { html: bestHtml };
        if (bestText) return { text: bestText };
        return null;
      }

      const parsed = parsePart(raw);
      if (parsed) return parsed;

      let splitIdx = raw.indexOf('\r\n\r\n');
      if (splitIdx === -1) splitIdx = raw.indexOf('\n\n');
      let headers = '';
      let body = raw;
      if (splitIdx !== -1) {
        headers = raw.substring(0, splitIdx).toLowerCase();
        body = raw.substring(splitIdx).trim();
      }
      if (headers.includes('content-transfer-encoding: base64')) body = decodeBase64UTF8(body);
      else if (headers.includes('content-transfer-encoding: quoted-printable')) body = decodeQuotedPrintable(body);
      if (headers.includes('content-type: text/html')) return { html: body };
      return { text: body };
    }

    function decodeQuotedPrintable(str) {
      str = str.replace(/=\r?\n/g, '');
      str = str.replace(/=([A-F0-9]{2})/gi, '%$1');
      try {
        return decodeURIComponent(str);
      } catch (error) {
        const bytes = [];
        for (let i = 0; i < str.length; i += 1) {
          if (str[i] === '%' && i + 2 < str.length) {
            bytes.push(parseInt(str.substring(i + 1, i + 3), 16));
            i += 2;
          } else {
            bytes.push(str.charCodeAt(i));
          }
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
      }
    }

    function decodeBase64UTF8(str) {
      try {
        const binString = atob(str.replace(/\s/g, ''));
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i += 1) {
          bytes[i] = binString.charCodeAt(i);
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      } catch (error) {
        return str;
      }
    }

    return {
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
    };
  }

  window.PopupMailRenderer = {
    createMailRenderer
  };
})();
