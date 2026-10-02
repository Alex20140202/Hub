import { all, get, run } from '../db.js';

/* --------------------------------- 活动流 --------------------------------- */

export function recordEvent(userId, kind, target = '', meta = '') {
  run(
    "INSERT INTO events (user_id, kind, target, meta, day) VALUES (?, ?, ?, ?, date('now', 'localtime'))",
    userId ?? null,
    kind,
    String(target).slice(0, 120),
    typeof meta === 'string' ? meta : JSON.stringify(meta ?? {}),
  );
}

export const recentEvents = (userId, limit = 12) =>
  all(
    'SELECT id, kind, target, created_at AS createdAt FROM events WHERE user_id = ? ORDER BY id DESC LIMIT ?',
    userId,
    limit,
  );

/** 近 N 天每日事件数，用于仪表盘趋势图。 */
export function dailyTrend(userId, days = 14) {
  const rows = all(
    `SELECT day, COUNT(*) AS count FROM events
      WHERE user_id = ? AND day >= date('now', 'localtime', ?)
      GROUP BY day`,
    userId,
    `-${days - 1} days`,
  );
  const map = new Map(rows.map((row) => [row.day, row.count]));
  const today = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (days - 1 - index));
    const day = date.toISOString().slice(0, 10);
    return { day, count: map.get(day) ?? 0 };
  });
}

/** 最近 N 天的活跃热力矩阵（按周分组）。 */
export function activityHeatmap(userId, weeks = 12) {
  const rows = all(
    `SELECT day, COUNT(*) AS count FROM events
      WHERE user_id = ? AND day >= date('now', 'localtime', ?)
      GROUP BY day`,
    userId,
    `-${weeks * 7} days`,
  );
  const map = new Map(rows.map((row) => [row.day, row.count]));
  const today = new Date();
  const cells = [];
  for (let i = weeks * 7 - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const day = date.toISOString().slice(0, 10);
    cells.push({ day, count: map.get(day) ?? 0 });
  }
  return cells;
}

export const streak = (userId) => {
  const rows = all(
    "SELECT DISTINCT day FROM events WHERE user_id = ? AND day <= date('now', 'localtime') ORDER BY day DESC LIMIT 400",
    userId,
  );
  if (!rows.length) return 0;
  const days = new Set(rows.map((row) => row.day));
  const cursor = new Date();
  if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
};

export const eventKinds = () => all('SELECT kind, COUNT(*) AS count FROM events GROUP BY kind ORDER BY count DESC');

/* --------------------------------- 站点设置 --------------------------------- */

const DEFAULTS = { site_name: 'Hub 超级中心', site_tagline: '一处收纳你的笔记、待办、书签与文件', allow_registration: 'true' };

export const getSettings = () => {
  const rows = all('SELECT key, value FROM settings');
  const map = { ...DEFAULTS };
  for (const row of rows) map[row.key] = row.value;
  return map;
};

export function updateSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    run(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      key,
      String(value),
    );
  }
  return getSettings();
}
