/*
 * 提前应用主题，避免刷新时先闪一下浅色再切暗色。
 *
 * 这个脚本必须放在 <head> 里同步执行（不能加 defer/async），
 * 否则要等 DOM 就绪才跑，闪烁已经发生了。
 * 抽成外部文件是为了让 CSP 的 script-src 可以收紧成 'self'，
 * 不必为了一个 5 行防闪烁脚本开 'unsafe-inline'。
 */
(function () {
  try {
    var t = localStorage.getItem('hub.theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    /* 隐私模式下 localStorage 可能不可用，忽略即可 */
  }
})();