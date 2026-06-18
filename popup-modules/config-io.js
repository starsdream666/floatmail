(function () {
  'use strict';

  const CATEGORY_KEYS = {
    tempEmail: ['apiUrl', 'adminToken', 'tempMailMeta', 'defaultTempExpiry'],
    moemail: ['moeApiUrl', 'moeApiKey', 'moeEmailCache', 'moeUnreadCounts', 'defaultMoeExpiry'],
    floatWindow: ['floatWindowEnabled', 'floatLayout', 'floatWindowStyle'],
    backgroundMail: ['verifyInterval', 'mailPollingInterval', 'notificationsEnabled'],
    mailDisplay: ['defaultRemoteImagesEnabled', 'translationApiBase', 'translationApiKey', 'translationModel', 'translationTargetLanguage', 'mailInsightApiMode', 'mailInsightApiBase', 'mailInsightApiKey', 'mailInsightModel'],
    siteControl: ['siteAccessMode', 'siteAllowlist', 'siteBlocklist'],
    pageFillRules: ['pageFillRules', 'fastFillEmailSource', 'fastFillDomainMode', 'fastFillDomainSpecific', 'fastFillDomainWhitelist', 'fastFillDomainBlacklist', 'defaultFfTempExpiry', 'defaultFfMoeExpiry'],
    generatedProfile: ['generatedProfile', 'generatedToolAutoCloseSeconds', 'generatedToolHistory'],
    defaultTab: ['defaultTab', 'activeTab', 'tabLayoutMode', 'theme', 'selectedStyle', 'selectedTheme'],
    emailHistory: ['emailHistory', 'verifyStatusCache', 'tempUnreadCounts'],
    bookmarks: ['bookmarks', 'bookmarkSort'],
    bookmarkSort: ['bookmarkSort']
  };

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
        const exportData = {
          _meta: {
            version: '2.6',
            exportedAt: new Date().toISOString(),
            categories
          }
        };

        categories.forEach((category) => {
          const keys = CATEGORY_KEYS[category];
          if (!keys) {
            return;
          }
          exportData[category] = {};
          keys.forEach((key) => {
            if (result[key] !== undefined) {
              exportData[category][key] = result[key];
            }
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

        showMessage(ioMessage, `已导出 ${categories.length} 个分类`, 'success');
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

      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        try {
          const data = JSON.parse(loadEvent.target.result);
          if (!data._meta || !data._meta.categories) {
            showMessage(ioMessage, '无效的配置文件格式', 'error');
            return;
          }

          const categories = getSelectedCategories();
          if (categories.length === 0) {
            showMessage(ioMessage, '请勾选要导入的项目', 'error');
            return;
          }

          const toStore = {};
          let importedCount = 0;

          categories.forEach((category) => {
            if (!data[category] || !CATEGORY_KEYS[category]) {
              return;
            }
            CATEGORY_KEYS[category].forEach((key) => {
              if (data[category][key] !== undefined) {
                toStore[key] = data[category][key];
              }
            });
            importedCount += 1;
          });

          if (importedCount === 0) {
            showMessage(ioMessage, '配置文件中无匹配的勾选项', 'error');
            return;
          }

          chrome.storage.local.set(toStore, () => {
            showMessage(ioMessage, `已导入 ${importedCount} 个分类，刷新中...`, 'success');
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
      categoryKeys: CATEGORY_KEYS
    };
  }

  window.PopupConfigIO = {
    CATEGORY_KEYS,
    initConfigIO
  };
})();
