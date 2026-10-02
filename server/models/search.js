import { all } from '../db.js';
import { notFound } from '../lib/http-error.js';

const like = (term) => `%${String(term).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

function searchNotes(userId, term, limit) {
  const pattern = like(term);
  return all(
    `SELECT id, 'note' AS type, title AS title, substr(body, 1, 160) AS excerpt, tags, updated_at AS updatedAt
       FROM notes
      WHERE user_id = ? AND (title LIKE ? OR body LIKE ? OR tags LIKE ?)
      ORDER BY updated_at DESC LIMIT ?`,
    userId,
    pattern,
    pattern,
    pattern,
    limit,
  ).map((row) => ({ ...row, href: `#/notes/${row.id}` }));
}

function searchTodos(userId, term, limit) {
  const pattern = like(term);
  return all(
    `SELECT id, 'todo' AS type, title, substr(detail, 1, 160) AS excerpt, '' AS tags, priority, done, created_at AS updatedAt
       FROM todos
      WHERE user_id = ? AND (title LIKE ? OR detail LIKE ?)
      ORDER BY done, id LIMIT ?`,
    userId,
    pattern,
    pattern,
    limit,
  ).map((row) => ({ ...row, done: Boolean(row.done), href: `#/todos` }));
}

function searchLinks(userId, term, limit) {
  const pattern = like(term);
  return all(
    `SELECT id, 'link' AS type, title, substr(description, 1, 160) AS excerpt, tags, url, created_at AS updatedAt
       FROM links
      WHERE user_id = ? AND (title LIKE ? OR url LIKE ? OR description LIKE ? OR tags LIKE ?)
      ORDER BY clicks DESC LIMIT ?`,
    userId,
    pattern,
    pattern,
    pattern,
    pattern,
    limit,
  ).map((row) => ({ ...row, href: `#/links` }));
}

function searchFiles(userId, term, limit) {
  const pattern = like(term);
  return all(
    `SELECT id, 'file' AS type, name AS title, folder AS excerpt, '' AS tags, size, created_at AS updatedAt
       FROM files
      WHERE user_id = ? AND (name LIKE ? OR folder LIKE ?)
      ORDER BY created_at DESC LIMIT ?`,
    userId,
    pattern,
    pattern,
    limit,
  ).map((row) => ({ ...row, href: `#/files` }));
}

// scope 与分组类型统一使用单数，与前端 scopeLabels 对齐
const SCOPES = {
  all: [
    ['note', searchNotes],
    ['todo', searchTodos],
    ['link', searchLinks],
    ['file', searchFiles],
  ],
  note: [['note', searchNotes]],
  todo: [['todo', searchTodos]],
  link: [['link', searchLinks]],
  file: [['file', searchFiles]],
};

/** 跨笔记 / 待办 / 书签 / 文件的聚合搜索。 */
export function globalSearch(userId, term, { scope = 'all', limit = 20 } = {}) {
  const query = String(term || '').trim();
  if (!query) return { term: query, scope, total: 0, groups: [] };
  if (scope !== 'all' && !SCOPES[scope]) throw notFound('未知的搜索范围');

  const perScope = Math.max(3, Math.ceil(limit / SCOPES[scope].length));
  const groups = SCOPES[scope]
    .map(([type, fn]) => ({ type, items: fn(userId, query, perScope) }))
    .filter((group) => group.items.length);

  return {
    term: query,
    scope,
    total: groups.reduce((sum, group) => sum + group.items.length, 0),
    groups,
  };
}
