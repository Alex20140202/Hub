import { all, get, run, db } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import { dailySeries, track } from './seed.js';
import { pendingCount as pendingComments } from './comments.js';

export function overview() {
  const one = (sql, params = []) => get(sql, params)?.c ?? 0;
  return {
    posts: one("SELECT COUNT(*) AS c FROM posts WHERE status='published'"),
    drafts: one("SELECT COUNT(*) AS c FROM posts WHERE status='draft'"),
    users: one('SELECT COUNT(*) AS c FROM users'),
    comments: one("SELECT COUNT(*) AS c FROM comments WHERE status='published'"),
    pendingComments: one("SELECT COUNT(*) AS c FROM comments WHERE status='pending'"),
    notes: one('SELECT COUNT(*) AS c FROM notes'),
    todos: one('SELECT COUNT(*) AS c FROM todos'),
    links: one('SELECT COUNT(*) AS c FROM links'),
    files: one('SELECT COUNT(*) AS c FROM files'),
    shortLinks: one('SELECT COUNT(*) AS c FROM short_links'),
    shortClicks: get('SELECT COALESCE(SUM(clicks),0) AS c FROM short_links').c,
    messages: one('SELECT COUNT(*) AS c FROM messages'),
    subscribers: one('SELECT COUNT(*) AS c FROM subscribers'),
    views: get("SELECT COALESCE(SUM(views),0) AS c FROM posts WHERE status='published'").c,
    storage: get('SELECT COALESCE(SUM(size),0) AS c FROM files').c,
  };
}

export function dashboard(userId) {
  const myPosts = get("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND status='published'", [userId])?.c ?? 0;
  const myDrafts = get("SELECT COUNT(*) AS c FROM posts WHERE author_id = ? AND status='draft'", [userId])?.c ?? 0;
  const myViews = get("SELECT COALESCE(SUM(views),0) AS c FROM posts WHERE author_id = ? AND status='published'", [userId])?.c ?? 0;
  const myLikes = get("SELECT COALESCE(SUM(likes),0) AS c FROM posts WHERE author_id = ?", [userId])?.c ?? 0;
  const myComments = get('SELECT COUNT(*) AS c FROM comments WHERE author_id = ?', [userId])?.c ?? 0;
  const myTodos = get('SELECT COUNT(*) AS c FROM todos WHERE user_id = ?', [userId])?.c ?? 0;
  const myDone = get('SELECT COUNT(*) AS c FROM todos WHERE user_id = ? AND done = 1', [userId])?.c ?? 0;
  return {
    mine: { posts: myPosts, drafts: myDrafts, views: myViews, likes: myLikes, comments: myComments, todos: myTodos, done: myDone },
    global: overview(),
    trend: dailySeries(14),
    topPosts: all(
      `SELECT id, title, slug, views, likes, reading_time FROM posts
       WHERE author_id = ? AND status='published' ORDER BY views DESC LIMIT 5`,
      [userId],
    ),
    recentComments: all(
      `SELECT c.id, c.body, c.created_at, p.title, p.slug
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.author_id = ? ORDER BY c.created_at DESC LIMIT 5`,
      [userId],
    ),
  };
}

export function topPosts(limit = 8) {
  return all(
    `SELECT p.id, p.title, p.slug, p.views, p.likes, p.published_at, p.reading_time,
            u.nickname, u.username, u.avatar_color
     FROM posts p JOIN users u ON u.id = p.author_id
     WHERE p.status='published' ORDER BY p.views DESC LIMIT ?`,
    [limit],
  );
}

export function popularTags(limit = 12) {
  return all(
    `SELECT t.name, t.slug, COUNT(pt.post_id) AS c FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     JOIN posts p ON p.id = pt.post_id AND p.status='published'
     GROUP BY t.id ORDER BY c DESC LIMIT ?`,
    [limit],
  );
}

export function heatmap(days = 90) {
  const rows = all(
    `SELECT substr(created_at,1,10) AS day, COUNT(*) AS c FROM events
     WHERE created_at >= datetime('now', ?) GROUP BY day`,
    [`-${days} days`],
  );
  const map = new Map(rows.map((r) => [r.day, r.c]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ day: d, count: map.get(d) || 0 });
  }
  return out;
}

export function typeBreakdown() {
  return all('SELECT type, COUNT(*) AS c FROM events GROUP BY type ORDER BY c DESC');
}

export function hourlyDistribution() {
  return all(
    `SELECT CAST(substr(created_at, 12, 2) AS INTEGER) AS hour, COUNT(*) AS c
     FROM events GROUP BY hour ORDER BY hour`,
  );
}

export { dailySeries, track, pendingComments, db };
