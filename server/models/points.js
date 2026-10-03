import { all, get, run, tx } from '../db.js';

/* --------------------------------- 积分规则 --------------------------------- */

/** 行为 → 分值。dailyLimit 为每日可触发次数上限，防止刷量。 */
export const RULES = {
  'user.register': { points: 20, label: '注册账号', daily: 1 },
  'user.checkin': { points: 5, label: '每日签到', daily: 1 },
  'post.publish': { points: 20, label: '发布文章', daily: 20 },
  'comment.create': { points: 3, label: '发表评论', daily: 10 },
  'file.upload': { points: 5, label: '上传文件', daily: 20 },
  'note.create': { points: 2, label: '新建笔记', daily: 20 },
  'todo.complete': { points: 2, label: '完成待办', daily: 20 },
  'short.create': { points: 1, label: '创建短链', daily: 20 },
  'post.liked': { points: 1, label: '文章被点赞', daily: 50 },
  'comment.liked': { points: 2, label: '评论被点赞', daily: 30 },
  'profile.complete': { points: 15, label: '完善资料', daily: 1 },
};

const todayCount = (userId, reason) =>
  get("SELECT COUNT(*) AS n FROM point_logs WHERE user_id = ? AND reason = ? AND date(created_at) = date('now', 'localtime')", userId, reason).n;

/**
 * 记一笔积分并返回结果。超出每日上限则不加分。
 * 必须在事务中调用，保证余额与流水一致。
 */
export function award(userId, reason, { note = '' } = {}) {
  const rule = RULES[reason];
  if (!rule) return { granted: 0, balance: balanceOf(userId), capped: false };
  if (todayCount(userId, reason) >= rule.daily) {
    return { granted: 0, balance: balanceOf(userId), capped: true };
  }
  const balance = balanceOf(userId) + rule.points;
  run('UPDATE users SET points = ? WHERE id = ?', balance, userId);
  run('INSERT INTO point_logs (user_id, delta, balance, reason) VALUES (?, ?, ?, ?)', userId, rule.points, balance, note || rule.label);
  return { granted: rule.points, balance, capped: false };
}

export const balanceOf = (userId) => get('SELECT points FROM users WHERE id = ?', userId)?.points ?? 0;

export const spend = (userId, cost) => {
  const balance = balanceOf(userId);
  if (balance < cost) return { ok: false, balance };
  run('UPDATE users SET points = ? WHERE id = ?', balance - cost, userId);
  run('INSERT INTO point_logs (user_id, delta, balance, reason) VALUES (?, ?, ?, ?)', userId, -cost, balance - cost, '商城兑换');
  return { ok: true, balance: balance - cost };
};

export function listLogs(userId, { limit = 20, page = 1 } = {}) {
  const offset = (Math.max(1, page) - 1) * limit;
  const items = all(
    'SELECT id, delta, balance, reason, created_at AS createdAt FROM point_logs WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    userId,
    limit,
    offset,
  );
  const total = get('SELECT COUNT(*) AS n FROM point_logs WHERE user_id = ?', userId).n;
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export const earnedTotal = (userId) =>
  get("SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta ELSE 0 END), 0) AS n FROM point_logs WHERE user_id = ?", userId).n;

export const leaderboard = (limit = 10) =>
  all(
    `SELECT u.id, u.nickname, u.username, u.avatar_hue AS avatarHue, u.points,
            (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.status = 'published') AS posts
       FROM users u WHERE u.points > 0 ORDER BY u.points DESC, u.id LIMIT ?`,
    limit,
  ).map((row, index) => ({ ...row, rank: index + 1 }));

export const myRank = (userId) => {
  const points = balanceOf(userId);
  if (points <= 0) return null;
  const better = get('SELECT COUNT(*) AS n FROM users WHERE points > ?', points).n;
  return better + 1;
};

/* ---------------------------------- 每日签到 ---------------------------------- */

export function checkin(userId) {
  return tx(() => {
    const today = get("SELECT date('now', 'localtime') AS day").day;
    if (get('SELECT 1 AS x FROM checkins WHERE user_id = ? AND day = ?', userId, today)) {
      return { already: true, streak: currentStreak(userId), reward: 0, balance: balanceOf(userId) };
    }

    const yesterday = get("SELECT date('now', 'localtime', '-1 day') AS day").day;
    const last = get('SELECT streak FROM checkins WHERE user_id = ? AND day = ?', userId, yesterday);
    const streak = (last?.streak ?? 0) + 1;

    // 连签 3 天起额外 +5，满 7 天再额外 +10
    let reward = RULES['user.checkin'].points;
    if (streak >= 3) reward += 5;
    if (streak % 7 === 0) reward += 10;

    const balance = balanceOf(userId) + reward;
    run('INSERT INTO checkins (user_id, day, streak, reward) VALUES (?, ?, ?, ?)', userId, today, streak, reward);
    run('UPDATE users SET points = ? WHERE id = ?', balance, userId);
    run('INSERT INTO point_logs (user_id, delta, balance, reason) VALUES (?, ?, ?, ?)', userId, reward, balance, `每日签到 · 连签 ${streak} 天`);
    return { already: false, streak, reward, balance };
  });
}

export const currentStreak = (userId) =>
  get("SELECT streak FROM checkins WHERE user_id = ? ORDER BY day DESC LIMIT 1", userId)?.streak ?? 0;

/** 最近 N 天的签到日历。 */
export const checkinCalendar = (userId, days = 28) => {
  const rows = all(
    "SELECT day, streak, reward FROM checkins WHERE user_id = ? AND day >= date('now', 'localtime', ?)",
    userId,
    `-${days} days`,
  );
  const map = new Map(rows.map((row) => [row.day, row]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (days - 1 - index));
    const day = date.toISOString().slice(0, 10);
    const hit = map.get(day);
    return { day, checked: Boolean(hit), streak: hit?.streak ?? 0, reward: hit?.reward ?? 0, isToday: index === days - 1 };
  });
};

/* ----------------------------------- 商城 ----------------------------------- */

export const listShopItems = () =>
  all('SELECT * FROM shop_items WHERE active = 1 ORDER BY position, cost').map(shapeItem);

const shapeItem = (row) => ({
  ...row,
  stock: row.stock === null ? null : Number(row.stock),
  sold: Number(row.sold),
  soldOut: row.stock !== null && row.sold >= row.stock,
});

export const myItems = (userId) =>
  all(
    `SELECT ui.id AS ownedId, ui.used, ui.created_at AS acquiredAt, si.*
       FROM user_items ui JOIN shop_items si ON si.id = ui.item_id
      WHERE ui.user_id = ? ORDER BY ui.id DESC`,
    userId,
  ).map((row) => ({ ...shapeItem(row), ownedId: row.ownedId, used: Boolean(row.used) }));

/** 兑换道具：扣积分、扣库存、发货，整个过程在一个事务里。 */
export function redeem(userId, itemId) {
  return tx(() => {
    const item = get('SELECT * FROM shop_items WHERE id = ? AND active = 1', itemId);
    if (!item) return { ok: false, error: '道具不存在或已下架' };
    if (item.stock !== null && item.sold >= item.stock) return { ok: false, error: '该道具已售罄' };

    const paid = spend(userId, item.cost);
    if (!paid.ok) return { ok: false, error: `积分不足，还差 ${item.cost - paid.balance}` };

    run('UPDATE shop_items SET sold = sold + 1 WHERE id = ?', itemId);
    const { lastInsertRowid } = run('INSERT INTO user_items (user_id, item_id) VALUES (?, ?)', userId, itemId);

    // 皮肤 / 头像框 / 称号 / 存储 属唯一类：兑换即自动装备，用户不必再手动点一次
    const equipped = equipOwned(userId, item);
    return { ok: true, item: shapeItem(item), ownedId: lastInsertRowid, balance: paid.balance, equipped };
  });
}

/** 把唯一类道具装备到用户档案上。返回被写入的字段名。 */
export function equipOwned(userId, item) {
  switch (item.kind) {
    case 'skin':
      run('UPDATE users SET skin = ? WHERE id = ?', item.payload, userId);
      return 'skin';
    case 'frame':
      run('UPDATE users SET frame = ? WHERE id = ?', item.payload, userId);
      return 'frame';
    case 'title':
      run('UPDATE users SET title = ? WHERE id = ?', item.payload, userId);
      return 'title';
    case 'storage':
      run('UPDATE users SET storage_bonus = storage_bonus + ? WHERE id = ?', Number(item.payload) || 0, userId);
      return 'storage';
    default:
      return null;
  }
}

/** 当前用户的完整外观（供渲染与客户端使用）。 */
export const cosmeticsOf = (userId) => {
  const user = get('SELECT skin, frame, title, badges, storage_bonus AS storageBonus FROM users WHERE id = ?', userId);
  if (!user) return { skin: '', frame: '', title: '', badges: [], storageBonus: 0 };
  return { ...user, badges: user.badges ? user.badges.split(' ').filter(Boolean) : [] };
};

/** 使用一次性道具（如改名券）。 */
export function useOwned(userId, ownedId) {
  return tx(() => {
    const owned = get('SELECT * FROM user_items WHERE id = ? AND user_id = ? AND used = 0', ownedId, userId);
    if (!owned) return { ok: false, error: '道具不存在或已使用' };
    const item = get('SELECT * FROM shop_items WHERE id = ?', owned.item_id);
    if (item.kind !== 'consumable') return { ok: false, error: '该道具无法手动使用' };
    run('UPDATE user_items SET used = 1 WHERE id = ?', ownedId);

    // 幸运 Cookie：随机发放积分
    if (item.payload === 'lucky') {
      const reward = 50 + Math.floor(Math.random() * 251);
      const balance = balanceOf(userId) + reward;
      run('UPDATE users SET points = ? WHERE id = ?', balance, userId);
      run('INSERT INTO point_logs (user_id, delta, balance, reason) VALUES (?, ?, ?, ?)', userId, reward, balance, '幸运 Cookie');
      return { ok: true, item: shapeItem(item), reward, balance };
    }
    return { ok: true, item: shapeItem(item) };
  });
}

export const overview = (userId) => ({
  ...cosmeticsOf(userId),
  balance: balanceOf(userId),
  streak: currentStreak(userId),
  rank: myRank(userId),
  earned: earnedTotal(userId),
  checkedToday: Boolean(get("SELECT 1 AS x FROM checkins WHERE user_id = ? AND day = date('now', 'localtime')", userId)),
  calendar: checkinCalendar(userId),
  totals: {
    earned: get("SELECT COALESCE(SUM(delta), 0) AS n FROM point_logs WHERE user_id = ? AND delta > 0", userId).n,
    spent: get("SELECT COALESCE(-SUM(delta), 0) AS n FROM point_logs WHERE user_id = ? AND delta < 0", userId).n,
  },
});

export const economy = () => ({
  users: get('SELECT COUNT(*) AS n FROM users').n,
  circulating: get('SELECT COALESCE(SUM(points), 0) AS n FROM users').n,
  logs: get('SELECT COUNT(*) AS n FROM point_logs').n,
  checkins: get('SELECT COUNT(*) AS n FROM checkins').n,
  shop: { items: get('SELECT COUNT(*) AS n FROM shop_items').n, redeemed: get('SELECT COALESCE(SUM(sold), 0) AS n FROM shop_items').n },
});

export function upsertItem(input) {
  const existing = input.id ? get('SELECT * FROM shop_items WHERE id = ?', input.id) : get('SELECT * FROM shop_items WHERE sku = ?', input.sku);
  if (existing) {
    run(
      'UPDATE shop_items SET name = ?, description = ?, cost = ?, stock = ?, active = ? WHERE id = ?',
      input.name ?? existing.name,
      input.description ?? existing.description,
      input.cost ?? existing.cost,
      input.stock === undefined ? existing.stock : input.stock,
      input.active === undefined ? existing.active : input.active ? 1 : 0,
      existing.id,
    );
    return shapeItem(get('SELECT * FROM shop_items WHERE id = ?', existing.id));
  }
  const { lastInsertRowid } = run(
    'INSERT INTO shop_items (sku, name, description, kind, cost, stock, payload, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    input.sku,
    input.name,
    input.description ?? '',
    input.kind ?? 'cosmetic',
    input.cost ?? 0,
    input.stock ?? null,
    input.payload ?? '',
    input.position ?? 0,
  );
  return shapeItem(get('SELECT * FROM shop_items WHERE id = ?', lastInsertRowid));
}

/** 某用户是否持有该道具（未使用的）。 */
export const ownsItem = (itemId, userId) =>
  Boolean(get('SELECT 1 AS x FROM user_items WHERE item_id = ? AND user_id = ? AND used = 0', itemId, userId));

export const ownedItemKinds = (userId) =>
  all("SELECT si.kind, si.sku, si.payload, MIN(ui.id) AS ownedId FROM user_items ui JOIN shop_items si ON si.id = ui.item_id WHERE ui.user_id = ? AND ui.used = 0 GROUP BY si.sku", userId);
