import { el, clear } from '../lib/dom.js';
import { store, emit, applySkin } from '../lib/store.js';
import { PointsAPI, ShopAPI } from '../lib/api.js';
import { dateTime, timeAgo } from '../lib/format.js';
import { empty, skeleton, statCard, field } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { confirmDialog } from '../ui/modal.js';
import { go } from '../lib/router.js';

const TABS = [
  { id: 'overview', label: '总览' },
  { id: 'shop', label: '积分商城' },
  { id: 'logs', label: '积分流水' },
  { id: 'mine', label: '我的道具' },
];

const KIND_TONE = {
  theme: 'indigo',
  frame: 'amber',
  badge: 'purple',
  storage: 'green',
  rename: 'blue',
};

let activeTab = 'overview';

export default async function pointsView(host, ctx) {
  const tab = ctx?.query?.tab;
  if (tab && TABS.some((t) => t.id === tab)) activeTab = tab;
  if (!store.user) return;

  host.replaceChildren(skeleton(3, { title: true }));

  const [overview, shopData] = await Promise.all([PointsAPI.overview(), ShopAPI.items()]);

  const tabs = el('div.segmented', { role: 'tablist' });
  const panel = el('div.points-panel');

  const renderTab = async () => {
    for (const btn of tabs.children) btn.classList.toggle('active', btn.dataset.tab === activeTab);
    clear(panel);
    panel.append(el('div.card', {}, skeleton(2)));
    try {
      const node = await PANELS[activeTab]({ overview, shop: shopData });
      clear(panel).append(node);
    } catch (err) {
      clear(panel).append(el('div.card', {}, empty('加载失败', err.message, null, '⚠️')));
    }
  };

  for (const t of TABS) {
    const btn = el('button', { type: 'button', dataset: { tab: t.id }, onclick: () => {
      activeTab = t.id;
      history.replaceState(null, '', `#/points?tab=${t.id}`);
      renderTab();
    } }, t.label);
    tabs.append(btn);
  }

  host.replaceChildren(
    el('div.page-head', {}, [
      el('div.row-between.wrap', {}, [
        el('div', {}, [
          el('h1', {}, '积分中心'),
          el('p', {}, '签到、创作与互动都能积累积分，用来兑换真正生效的道具'),
        ]),
        el('div.points-balance', {}, [
          el('span.label', {}, '可用积分'),
          el('strong', {}, overview.points.toLocaleString('zh-CN')),
        ]),
      ]),
    ]),
    el('div.card.points-hero', {}, [
      el('div.points-hero-main', {}, [
        el('div.row', {}, [
          el('span.points-chip', { class: overview.checkin.doneToday ? 'done' : '' },
            overview.checkin.doneToday ? '今日已签到' : '今日未签到'),
          el('span.points-chip.subtle', {}, `连续 ${overview.streak} 天`),
        ]),
        el('h2', {}, overview.checkin.doneToday ? '明天再来，保持连续签到' : '签到领积分，连签有加成'),
        el('p.small.muted', {}, `连续 3 天起每天额外 +5 分，连续 7 天再 +10 分。今日可获得 ${overview.checkin.doneToday ? 0 : 5 + (overview.streak >= 2 ? 5 : 0) + (overview.streak >= 6 ? 10 : 0)} 分`),
        el('div.checkin-week', {}, (overview.week || []).map((d) => el('div.day', { class: d.checked ? 'on' : '', title: d.date }, [
          el('span.d', {}, d.label),
          el('i.dot'),
        ]))),
        el('div.row', { style: { marginTop: '14px' } }, [
          el('button.btn.btn-primary', {
            type: 'button',
            disabled: overview.checkin.doneToday,
            onclick: async (e) => {
              e.target.disabled = true;
              try {
                const r = await PointsAPI.checkin();
                toast.success(r.message);
                store.user.points = r.balance;
                emit('user', store.user);
                pointsView(host, { query: { tab: activeTab } });
              } catch (err) {
                toast.error(err.message);
                e.target.disabled = false;
              }
            },
          }, overview.checkin.doneToday ? '✓ 今日已签到' : '立即签到'),
          el('a.btn.btn-ghost', { href: '#/blog/new' }, '写文章赚积分'),
        ]),
      ]),
      el('div.stat-grid.stat-grid-4', {}, [
        statCard({ label: '累计获得', value: overview.earned, icon: '📈', hint: '来自签到与创作' }),
        statCard({ label: '累计消费', value: overview.spent, icon: '🛒', hint: '商城兑换' }),
        statCard({ label: '连续签到', value: `${overview.streak} 天`, icon: '🔥', hint: overview.checkin.lastCheckin ? `上次 ${timeAgo(overview.checkin.lastCheckin)}` : '还没签过到' }),
        statCard({ label: '已拥有道具', value: overview.owned, icon: '🎁', hint: `扩容 ${overview.storageBonus || 0}MB` }),
      ]),
    ]),
    tabs,
    panel,
  );

  await renderTab();
}

const PANELS = {
  overview: ({ overview }) =>
    el('div.grid.grid-sidebar', {}, [
      el('div.col', { style: { gap: '20px' } }, [
        el('div.card', {}, [
          el('div.card-title', {}, '💡 如何获得积分'),
          el('table.table', {}, [
            el('thead', {}, el('tr', {}, [el('th', {}, '行为'), el('th', {}, '积分'), el('th', {}, '说明')])),
            el('tbody', {}, (overview.rules || []).map((r) => el('tr', {}, [
              el('td', {}, r.detail),
              el('td', {}, el('span.points-chip.subtle', {}, `+${r.delta}`)),
              el('td.small.muted', {}, REASON_NOTE[r.reason] || '—'),
            ]))),
          ]),
        ]),
        el('div.card', {}, [
          el('div.card-title', {}, '🧾 最近积分记录'),
          logList(overview.logs || []),
          el('div.small.muted', { style: { marginTop: '10px' } }, '完整记录见「积分流水」标签页'),
        ]),
      ]),
      el('div.col', { style: { gap: '20px' } }, [
        el('div.card', {}, [
          el('div.card-title', {}, '🏆 积分排行榜'),
          el('ol.rank-list', {}, (overview.leaderboard || []).map((u) => el('li', { class: u.id === store.user.id ? 'me' : '' }, [
            el('span.rank-no', {}, String(u.rank)),
            el('span.rank-name', {}, [u.nickname || u.username, u.id === store.user.id ? el('span.badge.badge-primary', {}, '我') : null]),
            el('span.rank-points', {}, u.points.toLocaleString('zh-CN')),
          ]))),
          el('div.small.muted', { style: { marginTop: '10px' } }, '排名依据当前积分余额，同分按文章数'),
        ]),
      ]),
    ]),

  shop: async ({ shop, overview }) => {
    const node = el('div', {});
    const mine = await ShopAPI.mine().catch(() => ({ items: [] }));
    const groups = new Map();
    for (const item of shop.items) {
      if (!groups.has(item.kind)) groups.set(item.kind, []);
      groups.get(item.kind).push(item);
    }
    for (const [kind, items] of groups) {
      const kindLabel = shop.kinds?.[kind]?.label || kind;
      node.append(
        el('div.section-head', {}, [el('h3', {}, `${shop.kinds?.[kind]?.icon || '🎁'} ${kindLabel}`), el('span.small.muted', {}, `${items.length} 件`)]),
        el('div.shop-grid', {}, items.map((item) => itemCard(item, overview, mine.items))),
      );
    }
    return node;
  },

  logs: async () => {
    const data = await PointsAPI.logs({ limit: 50 });
    return el('div.card', {}, [
      el('div.row-between.wrap', {}, [
        el('div.card-title', {}, '🧾 积分流水'),
        el('div.row', {}, [
          el('span.small.muted', {}, `共 ${data.total} 条 · 收入 ${data.earned} / 支出 ${data.spent}`),
        ]),
      ]),
      data.items.length ? logList(data.items) : empty('还没有积分记录', '去签到或发布第一篇文章吧', null, '🪙'),
    ]);
  },

  mine: async () => {
    const mine = await ShopAPI.mine();
    return el('div.card', {}, [
      el('div.card-title', {}, '🎒 我的道具'),
      mine.items.length
        ? el('div.shop-grid', {}, mine.items.map((item) => itemCard(item, { points: store.user?.points || 0 }, mine.items, true)))
        : empty('还没有任何道具', '去积分商城看看能兑换什么', el('button.btn.btn-primary', {
          type: 'button',
          onclick: () => go('/points?tab=shop'),
        }, '去商城'), '🛍'),
    ]);
  },
};

const REASON_NOTE = {
  register: '注册即送',
  checkin: '每天一次',
  checkin_streak: '连签额外奖励',
  create_post: '发布即得',
  create_comment: '每天前 10 条',
  upload_file: '上传任意文件',
  create_note: '每天前 20 条',
  finish_todo: '每天前 20 条',
  create_short: '每天前 20 条',
  receive_like: '每天最多 50 次',
  comment_liked: '每天最多 30 次',
  complete_profile: '仅一次',
};

function logList(items) {
  return el('ul.log-list', {}, items.map((r) => el('li', {}, [
    el('div.log-main', {}, [
      el('div', {}, r.detail || r.reason),
      el('div.small.muted', {}, dateTime(r.createdAt)),
    ]),
    el('div.log-right', {}, [
      el('strong', { class: r.delta > 0 ? 'up' : 'down' }, `${r.delta > 0 ? '+' : ''}${r.delta}`),
      el('span.small.muted', {}, `余额 ${r.balance}`),
    ]),
  ])));
}

function itemCard(item, overview, ownedItems = [], isMine = false) {
  const owned = ownedItems.some((m) => m.id === item.id) || item.owned;
  const affordable = (overview?.points || 0) >= item.price;
  const soldOut = item.stock === 0;
  const used = isMine && item.state === 'used';

  const action = used
    ? el('span.badge.badge-muted', {}, '已使用')
    : item.kind === 'rename' && owned && isMine
      ? el('button.btn.btn-ghost.btn-sm', {
        type: 'button',
        onclick: async (e) => {
          const ok = await confirmDialog({ title: '使用改名券', message: `使用「${item.name}」后可在设置中修改用户名`, confirmText: '使用' });
          if (!ok) return;
          e.target.disabled = true;
          try {
            await ShopAPI.use(item.ownedId);
            toast.success('改名券已使用，去设置里修改用户名吧');
            go('/settings');
          } catch (err) {
            toast.error(err.message);
            e.target.disabled = false;
          }
        },
      }, '去使用')
      : owned
      ? el('span.badge.badge-success', {}, '已拥有')
      : el('button.btn.btn-primary.btn-sm', {
        type: 'button',
        disabled: soldOut || (!affordable && !isMine),
        title: !affordable && !isMine ? '积分不足' : '',
        onclick: async (e) => {
          const ok = await confirmDialog({
            title: '确认兑换',
            message: `将消耗 ${item.price} 积分兑换「${item.name}」`,
            confirmText: '兑换',
          });
          if (!ok) return;
          e.target.disabled = true;
          try {
            const r = await ShopAPI.redeem(item.id);
            toast.success(r.message);
            store.user.points = r.points;
            emit('user', store.user);
            if (item.kind === 'theme' || item.kind === 'frame') {
              applyOwnedEffect(item);
            }
            location.reload();
          } catch (err) {
            toast.error(err.message);
            e.target.disabled = false;
          }
        },
      }, soldOut ? '已售罄' : `${item.price} 积分`);

  return el(`div.shop-item${owned ? '.owned' : ''}`, {}, [
    el('div.shop-icon', { class: KIND_TONE[item.kind] || '' }, item.icon),
    el('div.shop-body', {}, [
      el('div.row-between', {}, [
        el('strong', {}, item.name),
        el('span.badge', { class: `badge-${KIND_TONE[item.kind] || 'muted'}` }, item.kindLabel),
      ]),
      el('p.small.muted', {}, item.description),
      item.stock > 0 ? el('div.small.muted', {}, `剩余 ${item.stock} 件 · 已兑 ${item.sold} 件`) : null,
    ]),
    el('div.shop-action', {}, action),
  ]);
}

/** 皮肤 / 头像框兑换后立刻生效 */
function applyOwnedEffect(item) {
  if (item.kind === 'theme' && item.payload?.value) {
    store.user.skin = item.payload.value;
    applySkin(item.payload.value);
  }
  if (item.kind === 'frame' && item.payload?.value) {
    store.user.frame = item.payload.value;
  }
}
