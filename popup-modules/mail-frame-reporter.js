// 邮件渲染 iframe 内的高度上报脚本。
//
// 为什么是独立文件而不是内联脚本：
// 渲染帧无 allow-same-origin（不透明源，读不到扩展 storage），并会继承扩展页
// manifest 的 CSP `script-src 'self'`。MV3 的 extension_pages CSP 不允许 hash/nonce
// 源，所以内联脚本（无论带不带 nonce/hash）都会被继承的 'self' 拦下。
// 而"从扩展自身源加载的外部脚本"匹配 'self'，是唯一能在该帧内执行的脚本形式。
// 邮件自带的任何脚本都不是从扩展源加载，一律被 CSP 拦截。
//
// 本脚本只做一件事：测量内容高度并 postMessage 给父窗口。父窗口用 event.source
// 校验来源，只信任本渲染帧发来的高度。
(function () {
  function measure() {
    var wrapper = document.getElementById('__mail-scroll-wrapper');
    var candidates = [
      wrapper && wrapper.scrollHeight,
      wrapper && wrapper.getBoundingClientRect && wrapper.getBoundingClientRect().height,
      document.documentElement && document.documentElement.scrollHeight,
      document.body && document.body.scrollHeight
    ];
    var h = 0;
    for (var i = 0; i < candidates.length; i += 1) {
      var v = Number(candidates[i] || 0);
      if (v > h) { h = v; }
    }
    try {
      parent.postMessage({ source: 'floatmail-mail-frame', height: Math.ceil(h) + 4 }, '*');
    } catch (e) { /* 跨源 postMessage 理论上不会抛，兜底忽略 */ }
  }

  measure();
  if (window.requestAnimationFrame) { window.requestAnimationFrame(measure); }
  [120, 400, 1000].forEach(function (d) { window.setTimeout(measure, d); });
  window.addEventListener('load', measure);

  if (typeof ResizeObserver === 'function') {
    var target = document.getElementById('__mail-scroll-wrapper') || document.body;
    if (target) {
      var ro = new ResizeObserver(measure);
      ro.observe(target);
      window.setTimeout(function () { ro.disconnect(); }, 10000);
    }
  }
})();
