(function () {
  'use strict';

  function createMailReaderState(options) {
    let mail = null;
    let viewMode = 'safe-html';
    let allowRemoteImages = false;
    let translationText = '';
    let translationRequestToken = 0;
    let insights = null;
    let insightStatus = 'idle';
    let insightError = '';
    let insightRequestToken = 0;

    function begin(nextMail = null) {
      translationRequestToken += 1;
      insightRequestToken += 1;
      mail = nextMail;
      viewMode = 'safe-html';
      allowRemoteImages = options.getDefaultRemoteImages() === true;
      translationText = '';
      insights = null;
      insightStatus = 'idle';
      insightError = '';
    }

    return {
      elements: options.elements,
      begin,
      getMail: () => mail,
      setMail: (value) => { mail = value; },
      getViewMode: () => viewMode,
      setViewMode: (value) => { viewMode = value; },
      getAllowRemoteImages: () => allowRemoteImages,
      setAllowRemoteImages: (value) => { allowRemoteImages = value; },
      getTranslationText: () => translationText,
      setTranslationText: (value) => { translationText = value; },
      nextTranslationToken: () => ++translationRequestToken,
      isTranslationTokenCurrent: (token) => token === translationRequestToken,
      getInsights: () => insights,
      setInsights: (value) => { insights = value; },
      getInsightStatus: () => insightStatus,
      setInsightStatus: (value) => { insightStatus = value; },
      getInsightError: () => insightError,
      setInsightError: (value) => { insightError = value; },
      nextInsightToken: () => ++insightRequestToken,
      isInsightTokenCurrent: (token) => token === insightRequestToken,
      isDeletePending: () => options.isDeletePending?.(mail) === true,
      getIdentity: () => options.getIdentity(mail),
      getTranslationSource: options.getTranslationSource,
      getMetadata: options.getMetadata,
      renderBody: options.renderBody
    };
  }

  function createBatchSelectionController(options) {
    const selected = new Set();
    let active = false;
    let deleting = false;
    let revision = 0;

    function updateButton() {
      const count = selected.size;
      options.deleteButton.textContent = deleting
        ? '删除中...'
        : (count ? `删除所选 (${count})` : '删除所选');
      options.deleteButton.disabled = deleting || count === 0;
    }

    function syncUi() {
      options.toggleButton.classList.toggle('batch-mode-active', active);
      options.actionBar.classList.toggle('hidden', !active);
      options.toggleButton.disabled = deleting;
      options.cancelButton.disabled = deleting;
      updateButton();
    }

    function setActive(nextActive, settings = {}) {
      const normalizedActive = nextActive === true;
      const stateChanged = active !== normalizedActive
        || (settings.clearSelection === true && selected.size > 0);
      active = normalizedActive;
      if (settings.clearSelection === true) {
        selected.clear();
      }
      if (stateChanged) {
        revision += 1;
      }
      syncUi();
      if (settings.render !== false) {
        options.render();
      }
    }

    function setSelected(key, checked) {
      if (deleting) {
        return false;
      }
      const hadKey = selected.has(key);
      if (checked) {
        selected.add(key);
      } else {
        selected.delete(key);
      }
      if (hadKey !== selected.has(key)) {
        revision += 1;
      }
      updateButton();
      return true;
    }

    function attachCheckbox(row, key, settings = {}) {
      if (!active) {
        return null;
      }
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'batch-checkbox';
      checkbox.checked = selected.has(key);
      checkbox.disabled = deleting;
      checkbox.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!setSelected(key, checkbox.checked)) {
          checkbox.checked = selected.has(key);
        }
      });
      row.prepend(checkbox);
      row.style.cursor = 'default';
      row.addEventListener('click', (event) => {
        if (deleting || event.target.closest(settings.ignoreSelector || 'button, input')) {
          return;
        }
        checkbox.checked = !checkbox.checked;
        setSelected(key, checkbox.checked);
      });
      return checkbox;
    }

    async function deleteSelection() {
      if (deleting || !selected.size) {
        return;
      }
      const snapshot = new Set(selected);
      const promptText = typeof options.confirmDelete === 'function'
        ? options.confirmDelete(snapshot)
        : options.confirmDelete;
      if (!confirm(promptText || '确定要删除所选项目吗？')) {
        return;
      }
      const operationRevision = revision;
      deleting = true;
      syncUi();
      options.render();
      let shouldRenderAfterFailure = false;
      try {
        await options.deleteSelected(snapshot);
        if (revision !== operationRevision) {
          return;
        }
        deleting = false;
        setActive(false, { clearSelection: true, render: false });
        await (options.afterDelete ? options.afterDelete() : options.render());
      } catch (error) {
        if (revision === operationRevision && typeof options.onError === 'function') {
          options.onError(error);
        } else {
          console.error('批量删除失败:', error);
        }
        if (revision === operationRevision) {
          shouldRenderAfterFailure = true;
        }
      } finally {
        deleting = false;
        syncUi();
        if (shouldRenderAfterFailure) {
          options.render();
        }
      }
    }

    options.toggleButton.addEventListener('click', () => {
      setActive(!active, { clearSelection: !active });
    });
    options.cancelButton.addEventListener('click', () => setActive(false));
    options.deleteButton.addEventListener('click', deleteSelection);
    syncUi();

    return {
      isActive: () => active,
      isDeleting: () => deleting,
      getSelected: () => new Set(selected),
      attachCheckbox,
      setActive,
      updateButton
    };
  }

  function createInboxController(options) {
    const { elements, adapter, deps } = options;
    let target = null;
    let messages = [];
    let currentMessage = null;
    let listRequestToken = 0;
    let detailRequestToken = 0;
    let mode = 'closed';
    let batchController = null;
    const pendingDeleteKeys = new Set();

    const normalizeIdentity = (value) => String(value ?? '');
    const getTargetIdentity = (value) => normalizeIdentity(adapter.getTargetIdentity(value));
    const hasOpenTarget = () => Boolean(target && adapter.getTargetIdentity(target));
    const getDeleteKey = (message, messageTarget = target) => (
      `${getTargetIdentity(messageTarget)}\n${normalizeIdentity(adapter.getMessageIdentity(message))}`
    );

    function showList() {
      elements.content.classList.add('hidden');
      elements.list.classList.remove('hidden');
      elements.backToListButton.classList.add('hidden');
      currentMessage = null;
      mode = target ? 'list' : 'closed';
    }

    function appendSummary(container, message) {
      const header = document.createElement('div');
      header.className = 'mail-item-header';
      const subject = document.createElement('div');
      subject.className = 'mail-subject';
      subject.textContent = adapter.getMessageSubject(message) || '(无主题)';
      const time = document.createElement('div');
      time.className = 'mail-time';
      time.textContent = new Date(adapter.getMessageTime(message)).toLocaleString();
      const sender = document.createElement('div');
      sender.className = 'mail-sender';
      sender.textContent = adapter.getMessageSender(message) || '未知';
      header.appendChild(subject);
      header.appendChild(time);
      container.appendChild(header);
      container.appendChild(sender);
    }

    function renderMessages() {
      elements.list.innerHTML = '';
      if (!messages.length) {
        deps.renderInlineNotice(elements.list, '收件箱为空');
        return;
      }
      messages.forEach((message) => {
        const item = document.createElement('div');
        item.className = 'mail-item';
        const batchActive = batchController?.isActive() === true;
        if (adapter.flexMessageItems === true || batchActive) {
          item.style.display = 'flex';
          item.style.alignItems = 'center';
        }
        if (batchActive) {
          batchController.attachCheckbox(item, adapter.getMessageIdentity(message), {
            ignoreSelector: 'input'
          });
        } else {
          item.addEventListener('click', () => showDetail(message));
        }

        if (adapter.wrapMessageSummary === true || batchActive) {
          const summary = document.createElement('div');
          summary.style.flex = '1';
          summary.style.minWidth = '0';
          appendSummary(summary, message);
          item.appendChild(summary);
        } else {
          appendSummary(item, message);
        }
        elements.list.appendChild(item);
      });
    }

    async function refresh() {
      if (!hasOpenTarget()) {
        return;
      }
      const requestTarget = target;
      const requestIdentity = getTargetIdentity(requestTarget);
      const requestToken = ++listRequestToken;
      const isCurrentRequest = () => requestToken === listRequestToken
        && getTargetIdentity(target) === requestIdentity;
      deps.renderInlineNotice(elements.list, '加载中...');
      try {
        const result = await adapter.fetchMessages(requestTarget);
        if (!isCurrentRequest()) {
          return;
        }
        messages = Array.isArray(result) ? result : [];
        adapter.onMessagesLoaded?.(requestTarget, messages);
        renderMessages();
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        deps.renderInlineNotice(elements.list, `加载失败: ${deps.getErrorText(error)}`, 'error');
      }
    }

    function open(nextTarget) {
      detailRequestToken += 1;
      batchController?.setActive(false, { clearSelection: true, render: false });
      adapter.resetDetail();
      target = nextTarget;
      messages = [];
      mode = 'list';
      elements.homePanes.forEach((pane) => pane.classList.add('hidden'));
      elements.pane.classList.remove('hidden');
      elements.backToHomeButton.classList.remove('hidden');
      elements.tabBar.classList.add('hidden');
      elements.mainTitle.textContent = adapter.title;
      if (elements.mainSubtitle) {
        elements.mainSubtitle.textContent = adapter.subtitle;
      }
      elements.inboxTitle.textContent = adapter.getTargetTitle(nextTarget);
      showList();
      elements.backToHomeButton.onclick = close;
      adapter.onOpen?.(nextTarget);
      deps.storageSet({
        activeInbox: { type: adapter.type, ...adapter.serializeTarget(nextTarget) }
      }).catch(() => {});
      refresh();
    }

    function close() {
      const hadOpenInbox = hasOpenTarget();
      batchController?.setActive(false, { clearSelection: true, render: false });
      elements.pane.classList.add('hidden');
      elements.backToHomeButton.classList.add('hidden');
      elements.homePanes.forEach((pane) => pane.classList.remove('hidden'));
      elements.tabBar.classList.remove('hidden');
      deps.updateHeaderForTab(deps.getActiveTab());
      showList();
      adapter.resetDetail();
      messages = [];
      target = null;
      mode = 'closed';
      listRequestToken += 1;
      detailRequestToken += 1;
      if (hadOpenInbox) {
        deps.storageSet({ activeInbox: null }).catch(() => {});
      }
    }

    function backToList() {
      detailRequestToken += 1;
      showList();
      adapter.resetDetail();
    }

    function applyDetail(summary, detail) {
      currentMessage = adapter.mergeMessageDetail
        ? adapter.mergeMessageDetail(summary, detail)
        : detail;
      adapter.renderDetail(currentMessage);
    }

    function showDetail(message) {
      const requestToken = ++detailRequestToken;
      const targetIdentity = getTargetIdentity(target);
      const messageIdentity = normalizeIdentity(adapter.getMessageIdentity(message));
      const isCurrentDetail = () => requestToken === detailRequestToken
        && mode === 'detail'
        && getTargetIdentity(target) === targetIdentity
        && normalizeIdentity(adapter.getMessageIdentity(currentMessage)) === messageIdentity;

      mode = 'detail';
      currentMessage = message;
      elements.list.classList.add('hidden');
      elements.content.classList.remove('hidden');
      elements.backToListButton.classList.remove('hidden');
      adapter.prepareDetail(message);

      if (!adapter.loadMessageDetail) {
        applyDetail(message, message);
        return;
      }
      Promise.resolve().then(() => adapter.loadMessageDetail(message, target)).then((detail) => {
        if (isCurrentDetail()) {
          applyDetail(message, detail);
        }
      }).catch((error) => {
        if (isCurrentDetail()) {
          currentMessage = null;
          adapter.renderDetailError(error);
        }
      });
    }

    elements.backToListButton.addEventListener('click', backToList);
    elements.refreshButton.addEventListener('click', refresh);

    if (adapter.deleteMessage && elements.deleteButton) {
      elements.deleteButton.addEventListener('click', async () => {
        if (!currentMessage || !confirm(adapter.confirmDeleteMessage || '确定要删除这封邮件吗？')) {
          return;
        }
        const deleteRequestToken = detailRequestToken;
        const deleteTargetIdentity = getTargetIdentity(target);
        const deleteMessageIdentity = normalizeIdentity(adapter.getMessageIdentity(currentMessage));
        const deleteKey = getDeleteKey(currentMessage, target);
        if (pendingDeleteKeys.has(deleteKey)) {
          return;
        }
        const isCurrentDelete = () => deleteRequestToken === detailRequestToken
          && mode === 'detail'
          && getTargetIdentity(target) === deleteTargetIdentity
          && normalizeIdentity(adapter.getMessageIdentity(currentMessage)) === deleteMessageIdentity;
        pendingDeleteKeys.add(deleteKey);
        adapter.setDeletePending?.(true);
        try {
          await adapter.deleteMessage(currentMessage, target);
          if (!isCurrentDelete()) {
            return;
          }
          backToList();
          await refresh();
        } catch (error) {
          if (isCurrentDelete()) {
            alert('删除失败: ' + error.message);
          }
        } finally {
          pendingDeleteKeys.delete(deleteKey);
          if (isCurrentDelete()) {
            adapter.setDeletePending?.(false);
          }
        }
      });
    }

    if (options.batch) {
      batchController = createBatchSelectionController({
        ...options.batch,
        render: renderMessages,
        afterDelete: refresh
      });
    }

    return {
      open,
      close,
      refresh,
      renderMessages,
      isOpen: hasOpenTarget,
      getMode: () => mode,
      getTarget: () => target,
      getMessages: () => messages.slice(),
      isMessageDeletePending: (message = currentMessage) => pendingDeleteKeys.has(getDeleteKey(message)),
      batch: batchController
    };
  }

  window.PopupMailInboxController = {
    createMailReaderState,
    createBatchSelectionController,
    createInboxController
  };
})();
