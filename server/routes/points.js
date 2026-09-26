/** 积分中心与商城接口 */
import { Router, readBody } from '../http/router.js';
import * as points from '../models/points.js';
import * as shop from '../models/shop.js';
import { findById } from '../models/users.js';
import * as v from '../lib/validate.js';
import HttpError from '../lib/http-error.js';
import { track } from '../models/seed.js';

const router = new Router();

router.use(async (ctx) => {
  if (!['GET', 'HEAD'].includes(ctx.method)) {
    const parsed = await readBody(ctx.req);
    ctx.body = parsed.body;
  }
});

function requireUser(ctx) {
  if (!ctx.user) throw HttpError.unauthorized();
  return ctx.user;
}

/** 积分概览：余额、签到状态、流水摘要、排行榜 */
router.get('/points/overview', async (ctx) => {
  const user = requireUser(ctx);
  const me = findById(user.id);
  const summary = points.logs(user.id, { limit: 8 });
  ctx.ok({
    points: me.points,
    streak: me.streak,
    checkin: points.checkinState(user.id),
    week: points.checkinWeek(user.id),
    storageBonus: me.storage_bonus,
    earned: summary.earned,
    spent: summary.spent,
    logs: summary.items,
    leaderboard: points.leaderboard(8),
    rules: Object.entries(points.RULES).map(([reason, r]) => ({ reason, delta: r.delta, detail: r.detail })),
    owned: shop.ownedIds(user.id).size,
  });
});

/** 每日签到 */
router.post('/points/checkin', async (ctx) => {
  const user = requireUser(ctx);
  const result = points.checkin(user.id);
  track('checkin', { userId: user.id, meta: { streak: result.streak, gained: result.gained } });
  ctx.ok({ ...result, message: `签到成功，获得 ${result.gained} 积分` });
});

/** 积分流水 */
router.get('/points/logs', async (ctx) => {
  const user = requireUser(ctx);
  const limit = v.int(ctx.query.limit, '每页', { min: 1, max: 100, fallback: 20 });
  const page = v.int(ctx.query.page, '页码', { min: 1, fallback: 1 });
  ctx.ok(points.logs(user.id, { limit, offset: (page - 1) * limit }));
});

/** 排行榜 */
router.get('/points/leaderboard', async (ctx) => {
  ctx.ok({
    items: points.leaderboard(v.int(ctx.query.limit, '数量', { min: 1, max: 50, fallback: 20 })),
  });
});

/* ================= 商城 ================= */

router.get('/shop/items', async (ctx) => {
  const items = shop.listItems();
  const owned = ctx.user ? shop.ownedIds(ctx.user.id) : new Set();
  ctx.ok({
    items: items.map((i) => ({ ...i, owned: owned.has(i.id) })),
    kinds: shop.KINDS,
    balance: ctx.user ? points.balance(ctx.user.id) : 0,
  });
});

router.get('/shop/mine', async (ctx) => {
  const user = requireUser(ctx);
  ctx.ok({ items: shop.myItems(user.id) });
});

router.post('/shop/redeem/:id', async (ctx) => {
  const user = requireUser(ctx);
  const result = shop.redeem(user.id, ctx.params.id);
  track('redeem', { userId: user.id, target: result.item.id, meta: { price: result.item.price } });
  ctx.ok({ ...result, message: `兑换成功：${result.item.name}` });
});

router.post('/shop/use/:id', async (ctx) => {
  const user = requireUser(ctx);
  ctx.ok(shop.useItem(user.id, ctx.params.id));
});

/* ================= 管理后台 ================= */

function requireAdmin(ctx) {
  if (!ctx.user) throw HttpError.unauthorized();
  if (ctx.user.role !== 'admin') throw HttpError.forbidden('仅管理员可访问');
}

router.get('/admin/points', async (ctx) => {
  requireAdmin(ctx);
  ctx.ok({ economy: points.economy(), shop: shop.stats(), items: shop.listItems({ includeInactive: true }) });
});

router.post('/admin/shop/items', async (ctx) => {
  requireAdmin(ctx);
  const item = shop.create({
    name: v.str(ctx.body.name, '名称', { max: 40 }),
    description: v.str(ctx.body.description, '描述', { required: false, max: 200 }),
    icon: v.str(ctx.body.icon, '图标', { required: false, max: 8 }) || '🎁',
    price: v.int(ctx.body.price, '价格', { min: 1, max: 99999 }),
    kind: v.oneOf(ctx.body.kind, '类型', Object.keys(shop.KINDS)),
    payload: ctx.body.payload || null,
    stock: ctx.body.stock === undefined || ctx.body.stock === null ? -1 : v.int(ctx.body.stock, '库存', { min: -1, max: 99999 }),
    sort: v.int(ctx.body.sort, '排序', { min: 0, max: 9999, fallback: 100 }),
  });
  ctx.created({ item });
});

router.patch('/admin/shop/items/:id', async (ctx) => {
  requireAdmin(ctx);
  const patch = {};
  if (ctx.body.name !== undefined) patch.name = v.str(ctx.body.name, '名称', { max: 40 });
  if (ctx.body.description !== undefined) patch.description = v.str(ctx.body.description, '描述', { required: false, max: 200 });
  if (ctx.body.icon !== undefined) patch.icon = v.str(ctx.body.icon, '图标', { required: false, max: 8 });
  if (ctx.body.price !== undefined) patch.price = v.int(ctx.body.price, '价格', { min: 1, max: 99999 });
  if (ctx.body.stock !== undefined) patch.stock = v.int(ctx.body.stock, '库存', { min: -1, max: 99999 });
  if (ctx.body.sort !== undefined) patch.sort = v.int(ctx.body.sort, '排序', { min: 0, max: 9999 });
  if (ctx.body.active !== undefined) patch.active = !!v.bool(ctx.body.active, false);
  ctx.ok({ item: shop.update(ctx.params.id, patch) });
});

export default router;
