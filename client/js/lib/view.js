import { fetchFragment } from './api.js';

/**
 * 重新拉取当前页面的服务端片段并替换内容区。
 *
 * 站点是「服务端唯一渲染源」：任何写操作成功后都该调用这里，
 * 由服务端重新渲染当前视图，而不是在客户端各处手动改 DOM。
 * 单独成模块是为了让 main.js 与 ui/forms.js 都能用，不产生循环依赖。
 */
export async function refreshView({ showError = true } = {}) {
  const host = document.getElementById('main');
  if (!host) return false;

  host.classList.add('is-busy');
  try {
    const html = await fetchFragment(location.pathname + location.search);
    if (!html.trim()) return false;

    // 片段是若干并列的顶层元素，必须整体搬入；
    // #main 只作为外壳保留（id 与 .page 布局类不变）
    const holder = document.createElement('div');
    holder.innerHTML = html;
    host.replaceChildren(...holder.childNodes);
    host.classList.add('fade-in');
    document.dispatchEvent(new CustomEvent('hub:view-refreshed'));
    return true;
  } catch (error) {
    if (showError) {
      // 片段拉取失败时兜底整页加载，保证用户看到最新内容
      location.reload();
    }
    return false;
  } finally {
    document.getElementById('main')?.classList.remove('is-busy');
  }
}
