(function () {
  'use strict';

  function createEditor(container, addButton, options = {}) {
    if (!container || !addButton) return null;
    let rows = [];

    function renumber() {
      rows.forEach((row, index) => { row.title.textContent = `账号 ${index + 1}`; });
    }

    function readRow(row) {
      return { id: row.id, name: row.name.value.trim(),
        accountId: row.accountId.value.trim().toLowerCase(), apiToken: row.apiToken.value.trim() };
    }

    function validate(record, index) {
      if (!/^[a-f0-9]{32}$/i.test(record.accountId) || !record.apiToken || /[\r\n]/.test(record.apiToken)) {
        throw new Error(`Clef 账号 ${index + 1}：请填写有效的 Account ID 和该账号对应的单个 API Token`);
      }
    }

    async function testRow(row) {
      if (row.testButton.disabled) return { ok: false, error: '该账号正在测试，请稍后重试' };
      const account = readRow(row);
      const model = options.getModel?.();
      try { validate(account, rows.indexOf(row)); } catch (error) {
        row.status.textContent = error.message;
        row.status.classList.add('clef-account-error');
        row.status.classList.remove('hidden');
        return { ok: false, error: error.message };
      }
      row.testButton.disabled = true;
      row.testButton.textContent = '测试中...';
      row.status.textContent = '正在测试此账号与 Key...';
      row.status.classList.remove('hidden', 'clef-account-error');
      try {
        const result = await options.testAccount(account, model);
        const stale = !rows.includes(row) || JSON.stringify(readRow(row)) !== JSON.stringify(account) || options.getModel?.() !== model;
        if (rows.includes(row)) {
          row.status.textContent = window.PopupAiConnectionTest.describe(stale ? { stale: true } : result);
          row.status.classList.toggle('clef-account-error', !stale && !result.ok);
          row.status.classList.remove('hidden');
        }
        return stale ? { ...result, ok: false, stale: true } : result;
      } catch {
        if (rows.includes(row)) {
          row.status.textContent = '测试失败，请检查网络和配置后重试';
          row.status.classList.add('clef-account-error');
        }
        return { ok: false, error: '测试失败，请检查网络和配置后重试' };
      } finally {
        row.testButton.disabled = false;
        row.testButton.textContent = '测试连接';
      }
    }

    function addAccount(account = {}) {
      const card = document.createElement('div');
      card.className = 'clef-account-card';
      const heading = document.createElement('div');
      heading.className = 'clef-account-heading';
      const title = document.createElement('strong');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn text-btn';
      remove.textContent = '删除账号';
      heading.appendChild(title);
      heading.appendChild(remove);
      card.appendChild(heading);

      const input = (type, label, value) => {
        const element = document.createElement('input');
        element.type = type;
        element.className = 'wide-select';
        element.placeholder = label;
        element.setAttribute('aria-label', label);
        element.autocomplete = 'off';
        element.value = value || '';
        card.appendChild(element);
        return element;
      };
      const name = input('text', '账号备注（可选）', account.name);
      name.maxLength = 60;
      const accountId = input('text', 'Cloudflare Account ID（32 位）', account.accountId);
      const apiToken = input('password', '此账号对应的 API Token', account.apiToken);
      const status = document.createElement('div');
      status.className = 'tool-note clef-account-status hidden';
      status.setAttribute('role', 'status');
      card.appendChild(status);
      const testButton = document.createElement('button');
      testButton.type = 'button';
      testButton.className = 'btn text-btn clef-account-test-button';
      testButton.textContent = '测试连接';
      testButton.disabled = !options.testAccount;
      card.appendChild(testButton);
      const row = { id: account.id || crypto.randomUUID(), card, title, name, accountId, apiToken, status, testButton };
      testButton.addEventListener('click', () => testRow(row));
      [name, accountId, apiToken].forEach((element) => element.addEventListener('input', () => {
        // 凭据编辑后使用新身份，防止旧在途请求把失败标到刚输入的新 Key 上。
        if (element !== name) row.id = crypto.randomUUID();
        status.textContent = '';
        status.classList.add('hidden');
      }));
      remove.addEventListener('click', () => {
        rows = rows.filter((item) => item !== row);
        container.removeChild(card);
        renumber();
      });
      rows.push(row);
      container.appendChild(card);
      renumber();
    }

    addButton.addEventListener('click', () => addAccount());
    return {
      setAccounts(accounts) {
        rows = [];
        container.replaceChildren();
        if (!accounts.length) addAccount();
        else accounts.forEach(addAccount);
      },
      getAccounts() {
        const records = rows.map((row, index) => {
          const record = readRow(row);
          if (!record.name && !record.accountId && !record.apiToken) return null;
          validate(record, index);
          return record;
        }).filter(Boolean);
        return window.PopupClefInsight.normalizeAccounts(records);
      },
      getDraftAccounts() { return rows.map(readRow); },
      clearStatuses() {
        rows.forEach((row) => {
          row.status.textContent = '';
          row.status.classList.add('hidden');
        });
      },
      async testAllAccounts() {
        const results = [];
        for (const [index, row] of [...rows].entries()) {
          if (!rows.includes(row)) continue;
          const result = await testRow(row);
          results.push({ ...result, label: row.name.value.trim() || `账号 ${index + 1}` });
        }
        return window.PopupAiConnectionTest.batchResult(results);
      },
      setAccountStatus(account, success) {
        const row = rows.find((item) => item.id === account.id
          && item.accountId.value.trim().toLowerCase() === account.accountId);
        if (!row) return;
        row.status.textContent = success ? '最近一次调用成功' : `最近一次调用失败：${account.message}`;
        row.status.classList.toggle('clef-account-error', !success);
        row.status.classList.remove('hidden');
      }
    };
  }

  window.PopupClefAccounts = { createEditor };
})();
