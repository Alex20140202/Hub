import { notFound, badRequest } from '../lib/http-error.js';
import { createLimiter } from '../lib/rate-limit.js';
import { str, url as vUrl, bool, email as vEmail, logEvent } from '../lib/validate.js';
import { redirect } from '../http/respond.js';
import * as shorts from '../models/shorts.js';
import * as points from '../models/points.js';
import * as posts from '../models/posts.js';
import * as notes from '../models/notes.js';
import * as files from '../models/files.js';
import { subscribe } from '../models/chat.js';
import { getSettings, recordEvent } from '../models/stats.js';
import { countUsers } from '../models/users.js';
import { chatStats } from '../ws/chat.js';

const shortLimiter = createLimiter({ windowMs: 60_000, max: 30, name: 'short' });
const subLimiter = createLimiter({ windowMs: 60_000, max: 5, name: 'subscribe' });

export function registerShorts(router) {
  router.get('/api/shorts', async (ctx) => {
    const user = ctx.requireUser();
    ctx.json(200, { items: shorts.listShorts(user.id), stats: shorts.shortStats(user.id) });
  });

  router.post('/api/shorts', async (ctx) => {
    const user = ctx.requireUser();
    if (shortLimiter.take(user.id)) throw badRequest('创建太频繁了，稍后再试');
    const body = await ctx.input();
    const target = vUrl(body.targetUrl ?? body.url);
    const short = shorts.createShort(user.id, {
      code: body.code ? str(body.code, '短码', { max: 32, required: false, fallback: '' }) : '',
      targetUrl: target,
      title: str(body.title, '备注', { max: 120, required: false, fallback: '' }),
    });
    const gained = points.award(user.id, 'short.create', { note: '创建短链' });
    logEvent(user.id, 'short.create', short.title || target);
    ctx.json(201, { short: { ...short, base: `/s/${short.code}` }, pointsGained: gained.granted, balance: gained.balance });
  });

  router.patch('/api/shorts/:id', async (ctx) => {
    const user = ctx.requireUser();
    const body = await ctx.input();
    if (!shorts.setActive(Number(ctx.params.id), user.id, bool(body.active))) throw notFound('短链不存在');
    ctx.json(200, { short: shorts.getShort(Number(ctx.params.id), user.id) });
  });

  router.delete('/api/shorts/:id', async (ctx) => {
    const user = ctx.requireUser();
    if (!shorts.deleteShort(Number(ctx.params.id), user.id)) throw notFound('短链不存在');
    logEvent(user.id, 'short.delete', '删除短链');
    ctx.json(200, { ok: true });
  });
}

/** 短链跳转：GET /s/:code —— 不需要登录，全站最高频入口。 */
export function registerRedirect(router) {
  router.get('/s/:code', async (ctx) => {
    const hit = shorts.resolveRedirect(ctx.params.code);
    if (!hit) throw notFound('短链不存在或已停用');
    return redirect(ctx.res, hit.targetUrl, 302);
  });
}

export function registerMisc(router) {
  router.post('/api/subscribe', async (ctx) => {
    if (subLimiter.take(ctx.clientIp)) throw badRequest('订阅太频繁了，稍后再试');
    const body = await ctx.input();
    const mail = vEmail(body.email);
    if (!mail) throw badRequest('请填写邮箱');
    const result = subscribe(mail);
    ctx.json(200, { ok: true, existed: Boolean(result.existed) });
  });

  /** 站点首页所需的公开聚合数据。 */
  router.get('/api/home', async (ctx) => {
    const storage = ctx.user ? files.storageStats(ctx.user.id) : null;
    ctx.json(200, {
      settings: getSettings(),
      site: {
        users: countUsers(),
        posts: countPosts(),
        tags: posts.popularTags(12),
        categories: posts.listCategories(),
        chat: chatStats(),
      },
      featured: posts.featuredPosts(3),
      latest: posts.listPosts({ size: 6, sort: 'recent' }).items,
      hot: posts.listPosts({ size: 4, sort: 'hot' }).items,
      mine: ctx.user
        ? {
            notes: notes.countNotes(ctx.user.id),
            posts: posts.archiveStats(ctx.user.id),
            balance: points.balanceOf(ctx.user.id),
            rank: points.myRank(ctx.user.id),
            storage: storage?.used ?? 0,
          }
        : null,
    });
  });
}
