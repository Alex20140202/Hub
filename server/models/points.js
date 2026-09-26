/**
 * 积分体系： earn() 统一加分、checkin() 每日签到、流水与排行榜
 * 商城相关（道具、兑换、库存）见 shop.js
 */
import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';

/** 行为奖励表：reason -> { delta, detail } */
export const RULES = {
  register: { delta: 20, detail: '注册奖励' },
  welcome: { delta: 150, detail: '新手礼包' },
  checkin: { delta: 5, detail: '每日签到' },
  checkin_streak: { delta: 5, detail: '连续签到加成' },
  create_post: { delta: 20, detail: '发布文章' },
  create_comment: { delta: 3, detail: '发表评论' },
  upload_file: { delta: 5, detail: '上传文件' },
  create_note: { delta: 2, detail: '新建笔记' },
  finish_todo: { delta: 2, detail: '完成待办' },
  create_short: { delta: 1, detail: '创建短链' },
  receive_like: { delta: 1, detail: '文章被点赞' },
  comment_liked: { delta: 2, detail: '评论被点赞' },
  complete_profile: { delta: 15, detail: '完善个人资料' },
};

/** 同一行为每日最多计分次数，防止刷量 */
const DAILY_CAP = {
  create_comment: 10,
  create_note: 20,
  finish_todo: 20,
  create_short: 20,
  receive_like: 50,
  comment_liked: 30,
};

function today() {
  return nowIso().slice(0, 10);
}

export function balance(userId) {
  return get('SELECT points FROM users WHERE id = ?', [userId])?.points ?? 0;
}

export function streakOf(userId) {
  return get('SELECT streak, last_checkin FROM users WHERE id = ?', [userId]) || { streak: 0, last_checkin: null };
}

/**
 * 增加积分并写入流水。
 * @param {string} userId
 * @param {string} reason RULES 中的键
 * @param {{ amount?: number, detail?: string }} [opts]
 */
export function earn(userId, reason, { amount, detail } = {}) {
  if (!userId) return null;
  const rule = RULES[reason];
  const delta = amount ?? rule?.delta ?? 0;
  if (!delta) return null;

  if (DAILY_CAP[reason]) {
    const used = get(
      `SELECT COUNT(*) AS c FROM point_logs
       WHERE user_id = ? AND reason = ? AND created_at >= ?`,
      [userId, reason, `${today()}T00:00:00.000Z`],
    ).c;
    if (used >= DAILY_CAP[reason]) return null;
  }

  const next = balance(userId) + delta;
  run('UPDATE users SET points = MAX(0, points + ?) WHERE id = ?', [delta, userId]);
  run(
    'INSERT INTO point_logs (id, user_id, delta, balance, reason, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    [randomId(12), userId, delta, Math.max(0, next), reason, detail || rule?.detail || reason, nowIso()],
  );
  return { delta, balance: Math.max(0, next) };
}

/** 扣减积分（商城消费），余额不足抛错 */
export function spend(userId, amount, reason, detail) {
  const current = balance(userId);
  if (current < amount) throw HttpError.badRequest(`积分不足，还差 ${amount - current} 分`);
  run('UPDATE users SET points = points - ? WHERE id = ?', [amount, userId]);
  run(
    'INSERT INTO point_logs (id, user_id, delta, balance, reason, detail, created_at) VALUES (?,?,?,?,?,?,?)',
    [randomId(12), userId, -amount, current - amount, reason, detail || '积分消费', nowIso()],
  );
  return { delta: -amount, balance: current - amount };
}

/** 每日签到：连续签到额外奖励，断签归零 */
export function checkin(userId) {
  const row = streakOf(userId);
  if (row.last_checkin === today()) throw HttpError.badRequest('今天已经签到过啦');

  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
  const streak = row.last_checkin === yesterday ? row.streak + 1 : 1;
  const bonus = streak % 7 === 0 ? 10 : streak >= 3 ? 5 : 0;

  run('UPDATE users SET streak = ?, last_checkin = ?, checkin_days = checkin_days + 1 WHERE id = ?', [
    streak,
    today(),
    userId,
  ]);
  const base = earn(userId, 'checkin', { detail: `每日签到 · 第 ${streak} 天` });
  let extra = null;
  if (bonus > 0) {
    extra = earn(userId, 'checkin_streak', {
      amount: bonus,
      detail: streak % 7 === 0 ? `连续签到 ${streak} 天 · 全勤奖励` : `连续签到 ${streak} 天`,
    });
  }
  const gained = (base?.delta || 0) + (extra?.delta || 0);
  run('INSERT OR REPLACE INTO checkins (user_id, day, streak, gained, created_at) VALUES (?,?,?,?,?)', [
    userId,
    today(),
    streak,
    gained,
    nowIso(),
  ]);
  return { streak, bonus, gained, balance: extra?.balance ?? base?.balance ?? 0 };
}

export function checkinState(userId) {
  const row = streakOf(userId);
  return {
    streak: row.streak,
    doneToday: row.last_checkin === today(),
    lastCheckin: row.last_checkin,
  };
}

/** 本周签到日历（周一至周日），数据来自 checkins 表 */
export function checkinWeek(userId) {
  const days = all('SELECT day, streak FROM checkins WHERE user_id = ?', [userId]);
  const map = new Map(days.map((r) => [r.day, r.streak]));
  // 与 today() 保持一致，统一按 UTC 日期计算
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    return {
      date,
      label: '一二三四五六日'[i],
      checked: map.has(date),
      streak: map.get(date) || 0,
      future: d.getTime() > now.getTime(),
      isToday: date === today(),
    };
  });
}

export function logs(userId, { limit = 30, offset = 0 } = {}) {
  const items = all(
    'SELECT id, delta, balance, reason, detail, created_at FROM point_logs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?',
    [userId, limit, offset],
  ).map((r) => ({
    id: r.id,
    delta: r.delta,
    balance: r.balance,
    reason: r.reason,
    detail: r.detail,
    createdAt: r.created_at,
  }));
  const total = get('SELECT COUNT(*) AS c FROM point_logs WHERE user_id = ?', [userId]).c;
  const earned = get("SELECT COALESCE(SUM(delta),0) AS c FROM point_logs WHERE user_id = ? AND delta > 0", [userId]).c;
  const spent = get("SELECT COALESCE(-SUM(delta),0) AS c FROM point_logs WHERE user_id = ? AND delta < 0", [userId]).c;
  return { items, total, earned, spent, page: Math.floor(offset / limit) + 1, pages: Math.max(1, Math.ceil(total / limit)) };
}

export function leaderboard(limit = 10) {
  return all(
    `SELECT u.id, u.username, u.nickname, u.avatar_color, u.points,
            (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS posts
     FROM users u WHERE u.points > 0 ORDER BY u.points DESC, posts DESC LIMIT ?`,
    [limit],
  ).map((r, i) => ({
    rank: i + 1,
    id: r.id,
    username: r.username,
    nickname: r.nickname,
    avatar: r.avatar_color,
    points: r.points,
    posts: r.posts,
  }));
}

export function economy() {
  const one = (sql) => get(sql)?.c ?? 0;
  return {
    totalPoints: one('SELECT COALESCE(SUM(points),0) AS c FROM users'),
    earned: one('SELECT COALESCE(SUM(delta),0) AS c FROM point_logs WHERE delta > 0'),
    spent: one("SELECT COALESCE(-SUM(delta),0) AS c FROM point_logs WHERE delta < 0"),
    todayEarned: one(
      "SELECT COALESCE(SUM(delta),0) AS c FROM point_logs WHERE delta > 0 AND created_at >= datetime('now','start of day')",
    ),
    todayCheckins: one("SELECT COUNT(*) AS c FROM users WHERE last_checkin = date('now')"),
    holders: one('SELECT COUNT(*) AS c FROM users WHERE points > 0'),
    redeems: one('SELECT COUNT(*) AS c FROM user_items'),
  };
}

export { today };
