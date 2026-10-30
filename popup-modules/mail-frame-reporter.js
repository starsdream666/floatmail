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
//
// 测量口径：内容包裹层 #__mail-scroll-wrapper 的实际底部位置 + body 底部 padding/border/margin。
// 不用 documentElement / body 的 scrollHeight：它们至少等于视口高度，父侧按上报值设高后
// 视口变大、再测量又变大，会累积增长。
(function () {
  var lastHeight = 0;
  var lastViewport = 0;

  function px(value) {
    var n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }

  function computeHeight() {
    var body = document.body;
    if (!body) { return 0; }
    var wrapper = document.getElementById('__mail-scroll-wrapper');
    var target = wrapper || body;
    var rect = target.getBoundingClientRect();
    var scrollY = window.pageYOffset || (document.documentElement && document.documentElement.scrollTop) || 0;
    // 包裹层内有浮动/溢出子元素时 scrollHeight 会大于 rect.height，取两者较大者
    var contentHeight = Math.max(rect.height, wrapper ? wrapper.scrollHeight : 0);
    // rect.top + scrollY 已包含 body 上方的 margin/padding 以及塌陷进来的子元素上外边距
    var bottom = rect.top + scrollY + contentHeight;
    var style = window.getComputedStyle ? window.getComputedStyle(body) : null;
    if (style && wrapper) {
      bottom += px(style.paddingBottom) + px(style.borderBottomWidth) + px(style.marginBottom);
    } else if (style) {
      bottom += px(style.marginBottom);
    }
    // 宽邮件出现横向滚动条时，它会占用视口高度，补上滚动条厚度避免出现竖向滚动条
    var root = document.documentElement;
    if (root && root.scrollWidth > root.clientWidth && window.innerHeight > root.clientHeight) {
      bottom += window.innerHeight - root.clientHeight;
    }
    return Math.ceil(bottom);
  }

  function measure() {
    var h = computeHeight();
    var viewport = window.innerHeight || 0;
    if (h <= 0) { return; }
    // 内容恰好随视口同步增长（如 height:100vh 的元素）：这是父侧设高引起的反馈，不再上报
    if (lastHeight && viewport > lastViewport && h > lastHeight
      && Math.abs((h - lastHeight) - (viewport - lastViewport)) <= 2) {
      lastViewport = viewport;
      return;
    }
    lastViewport = viewport;
    if (Math.abs(h - lastHeight) <= 2) { return; }
    lastHeight = h;
    try {
      parent.postMessage({ source: 'floatmail-mail-frame', height: h }, '*');
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
