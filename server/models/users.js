import { all, get, run } from '../db.js';
import { randomId, nowIso, slugify } from '../lib/id.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import HttpError from '../lib/http-error.js';

const COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const PUBLIC_FIELDS = `id, username, email, role, nickname, bio, avatar_color, website, location, theme, post_count, created_at, last_login`;

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    avatar: row.avatar_color || '#6366f1',
    joinedAt: row.created_at,
  };
}

export function findByLogin(login) {
  return get('SELECT * FROM users WHERE email = ? OR username = ?', [String(login).toLowerCase(), login]);
}

export function findById(id) {
  return get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`, [id]);
}

export function findFull(id) {
  return get('SELECT * FROM users WHERE id = ?', [id]);
}

export function list({ page = 1, size = 20, q = '', sort = 'created_at' } = {}) {
  const offset = (page - 1) * size;
  const like = `%${q}%`;
  const where = q ? 'WHERE username LIKE ? OR nickname LIKE ? OR email LIKE ?' : '';
  const params = q ? [like, like, like] : [];
  const sortable = { created_at: 'created_at', posts: 'post_count', last_login: 'last_login' };
  const order = `ORDER BY ${sortable[sort] || 'created_at'} DESC`;
  const rows = all(`SELECT ${PUBLIC_FIELDS} FROM users ${where} ${order} LIMIT ? OFFSET ?`, [
    ...params,
    size,
    offset,
  ]);
  const total = get(`SELECT COUNT(*) AS c FROM users ${where}`, params).c;
  return { items: rows.map(decorate), total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
}

export function create({ username, email, password, nickname, role = 'user', bio = '' }) {
  if (findByLogin(username) || findByLogin(email)) {
    throw HttpError.conflict('用户名或邮箱已被注册');
  }
  const id = randomId(10);
  run(
    `INSERT INTO users (id, username, email, password, role, nickname, bio, avatar_color, created_at, last_login)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      username,
      email,
      hashPassword(password),
      role,
      nickname || username,
      bio,
      COLORS[Math.floor(Math.random() * COLORS.length)],
      nowIso(),
      nowIso(),
    ],
  );
  return findById(id);
}

export function authenticate(login, password) {
  const row = findByLogin(login);
  if (!row) return null;
  if (!verifyPassword(password, row.password)) return null;
  run('UPDATE users SET last_login = ? WHERE id = ?', [nowIso(), row.id]);
  return findById(row.id);
}

export function updateProfile(id, patch) {
  const fields = [];
  const params = [];
  const mapping = {
    nickname: 'nickname',
    bio: 'bio',
    website: 'website',
    location: 'location',
    theme: 'theme',
    avatarColor: 'avatar_color',
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (patch[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(patch[key]);
    }
  }
  if (patch.username !== undefined) {
    const taken = get('SELECT id FROM users WHERE username = ? AND id != ?', [patch.username, id]);
    if (taken) throw HttpError.conflict('该用户名已被占用');
    fields.push('username = ?');
    params.push(patch.username);
  }
  if (patch.email !== undefined) {
    const taken = get('SELECT id FROM users WHERE email = ? AND id != ?', [patch.email, id]);
    if (taken) throw HttpError.conflict('该邮箱已被注册');
    fields.push('email = ?');
    params.push(patch.email);
  }
  if (patch.password) {
    fields.push('password = ?');
    params.push(hashPassword(patch.password));
  }
  if (fields.length) {
    run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
  }
  return findById(id);
}

export function remove(id) {
  const row = get('SELECT role FROM users WHERE id = ?', [id]);
  if (!row) throw HttpError.notFound('用户不存在');
  if (row.role === 'admin') {
    const admins = get("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").c;
    if (admins <= 1) throw HttpError.badRequest('至少需要保留一个管理员');
  }
  run('DELETE FROM users WHERE id = ?', [id]);
  return true;
}

export function setRole(id, role) {
  run('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  return findById(id);
}

export function touchPostCount(userId, delta) {
  run('UPDATE users SET post_count = MAX(0, post_count + ?) WHERE id = ?', [delta, userId]);
}

export function leaderboard(limit = 8) {
  return all(
    `SELECT u.id, u.username, u.nickname, u.avatar_color, u.post_count,
            (SELECT COUNT(*) FROM comments c WHERE c.author_id = u.id) AS comments,
            (SELECT COALESCE(SUM(views),0) FROM posts p WHERE p.author_id = u.id) AS views
     FROM users u ORDER BY views DESC, comments DESC LIMIT ?`,
    [limit],
  );
}

export { slugify };
