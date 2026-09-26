/** 积分商城：道具目录、兑换、库存与用户已购道具 */
import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';
import { spend } from './points.js';

/** kind: theme 主题皮肤 / frame 头像框 / badge 勋章 / storage 存储扩容 / rename 改名券 */
export const KINDS = {
  theme: { label: '主题皮肤', icon: '🎨' },
  frame: { label: '头像框', icon: '🖼' },
  badge: { label: '勋章', icon: '🏅' },
  storage: { label: '存储扩容', icon: '💾' },
  rename: { label: '改名券', icon: '✏️' },
};

function shape(row) {
  let payload = null;
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload);
    } catch {
      payload = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    price: row.price,
    kind: row.kind,
    kindLabel: KINDS[row.kind]?.label || row.kind,
    payload,
    stock: row.stock,
    active: !!row.active,
    sold: row.sold,
    sort: row.sort,
  };
}

export function listItems({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  return all(`SELECT * FROM shop_items ${where} ORDER BY sort, price`).map(shape);
}

export function findItem(id) {
  const row = get('SELECT * FROM shop_items WHERE id = ?', [id]);
  return row ? shape(row) : null;
}

export function ownedIds(userId) {
  return new Set(
    all("SELECT item_id FROM user_items WHERE user_id = ? AND state = 'owned'", [userId]).map((r) => r.item_id),
  );
}

export function myItems(userId) {
  return all(
    `SELECT ui.id AS owned_id, ui.state, ui.created_at, ui.used_at, si.*
     FROM user_items ui JOIN shop_items si ON si.id = ui.item_id
     WHERE ui.user_id = ? ORDER BY ui.created_at DESC`,
    [userId],
  ).map((row) => ({ ...shape(row), ownedId: row.owned_id, state: row.state, acquiredAt: row.created_at, usedAt: row.used_at }));
}

/** 兑换：扣积分 + 发放道具 */
export function redeem(userId, itemId) {
  const item = findItem(itemId);
  if (!item || !item.active) throw HttpError.notFound('道具不存在或已下架');
  if (ownedIds(userId).has(itemId)) throw HttpError.badRequest('你已经拥有该道具了');
  if (item.stock === 0) throw HttpError.badRequest('该道具已售罄');

  const result = spend(userId, item.price, 'redeem', `兑换「${item.name}」`);
  if (item.stock > 0) run('UPDATE shop_items SET stock = stock - 1 WHERE id = ?', [itemId]);
  run('UPDATE shop_items SET sold = sold + 1 WHERE id = ?', [itemId]);
  run('INSERT INTO user_items (id, user_id, item_id, state, created_at) VALUES (?,?,?,?,?)', [
    randomId(12),
    userId,
    itemId,
    'owned',
    nowIso(),
  ]);

  applyEffect(userId, item);
  return { item, points: result.balance };
}

/** 道具即时生效（主题 / 头像框 / 扩容） */
export function applyEffect(userId, item) {
  if (item.kind === 'theme' && item.payload?.value) {
    run('UPDATE users SET skin = ? WHERE id = ?', [item.payload.value, userId]);
  }
  if (item.kind === 'frame' && item.payload?.value) {
    run('UPDATE users SET frame = ? WHERE id = ?', [item.payload.value, userId]);
  }
  if (item.kind === 'storage' && item.payload?.mb) {
    run('UPDATE users SET storage_bonus = storage_bonus + ? WHERE id = ?', [item.payload.mb, userId]);
  }
}

/** 使用一次性道具（改名券） */
export function useItem(userId, itemId) {
  const row = get(
    "SELECT ui.id, ui.state, si.kind, si.name FROM user_items ui JOIN shop_items si ON si.id = ui.item_id WHERE ui.id = ? AND ui.user_id = ?",
    [itemId, userId],
  );
  if (!row) throw HttpError.notFound('道具不存在');
  if (row.state === 'used') throw HttpError.badRequest('该道具已使用');
  if (row.kind !== 'rename') throw HttpError.badRequest('该道具无需手动使用');
  run("UPDATE user_items SET state = 'used', used_at = ? WHERE id = ?", [nowIso(), itemId]);
  return { ok: true, name: row.name };
}

export function create(payload) {
  const id = randomId(8);
  run(
    `INSERT INTO shop_items (id, name, description, icon, price, kind, payload, stock, active, sort, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      payload.name,
      payload.description || '',
      payload.icon || '🎁',
      payload.price,
      payload.kind,
      payload.payload ? JSON.stringify(payload.payload) : null,
      payload.stock === undefined ? -1 : payload.stock,
      payload.active === false ? 0 : 1,
      payload.sort ?? 100,
      nowIso(),
    ],
  );
  return findItem(id);
}

export function update(id, patch) {
  const current = get('SELECT * FROM shop_items WHERE id = ?', [id]);
  if (!current) throw HttpError.notFound('道具不存在');
  run(
    `UPDATE shop_items SET name = ?, description = ?, icon = ?, price = ?, stock = ?, active = ?, sort = ? WHERE id = ?`,
    [
      patch.name ?? current.name,
      patch.description ?? current.description,
      patch.icon ?? current.icon,
      patch.price ?? current.price,
      patch.stock ?? current.stock,
      patch.active === undefined ? current.active : patch.active ? 1 : 0,
      patch.sort ?? current.sort,
      id,
    ],
  );
  return findItem(id);
}

export function stats() {
  const one = (sql) => get(sql)?.c ?? 0;
  return {
    items: one('SELECT COUNT(*) AS c FROM shop_items'),
    active: one('SELECT COUNT(*) AS c FROM shop_items WHERE active = 1'),
    sold: one('SELECT COALESCE(SUM(sold),0) AS c FROM shop_items'),
    byKind: Object.keys(KINDS).map((kind) => ({
      kind,
      label: KINDS[kind].label,
      count: one(`SELECT COUNT(*) AS c FROM shop_items WHERE kind = '${kind}'`),
    })),
  };
}
