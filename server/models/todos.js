import { all, get, run } from '../db.js';
import { randomId, nowIso } from '../lib/id.js';
import HttpError from '../lib/http-error.js';

function shape(row) {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    priority: row.priority,
    done: !!row.done,
    dueAt: row.due_at,
    project: row.project,
    position: row.position,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    overdue: !!(!row.done && row.due_at && new Date(row.due_at) < new Date()),
  };
}

export function list(userId, { done = null, project = null, q = '' } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (done !== null) {
    where.push('done = ?');
    params.push(done ? 1 : 0);
  }
  if (project) {
    where.push('project = ?');
    params.push(project);
  }
  if (q) {
    where.push('(title LIKE ? OR detail LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  return all(
    `SELECT * FROM todos WHERE ${where.join(' AND ')} ORDER BY done ASC, priority ASC, position ASC, created_at ASC`,
    params,
  ).map(shape);
}

export function projects(userId) {
  return all(
    `SELECT project, COUNT(*) AS total, SUM(done) AS done FROM todos
     WHERE user_id = ? AND project IS NOT NULL AND project != ''
     GROUP BY project ORDER BY total DESC`,
    [userId],
  );
}

export function stats(userId) {
  const row = get(
    `SELECT COUNT(*) AS total,
            SUM(done) AS done,
            SUM(CASE WHEN done=0 AND due_at IS NOT NULL AND due_at < ? THEN 1 ELSE 0 END) AS overdue
     FROM todos WHERE user_id = ?`,
    [nowIso(), userId],
  );
  return {
    total: row.total || 0,
    done: row.done || 0,
    open: (row.total || 0) - (row.done || 0),
    overdue: row.overdue || 0,
    rate: row.total ? Math.round(((row.done || 0) / row.total) * 100) : 0,
  };
}

export function find(id, userId) {
  const row = get('SELECT * FROM todos WHERE id = ? AND user_id = ?', [id, userId]);
  if (!row) throw HttpError.notFound('待办不存在');
  return shape(row);
}

export function create(userId, { title, detail = '', priority = 2, dueAt = null, project = null }) {
  const maxPos = get('SELECT COALESCE(MAX(position), 0) AS p FROM todos WHERE user_id = ?', [userId]).p;
  const id = randomId(10);
  run(
    `INSERT INTO todos (id, user_id, title, detail, priority, done, due_at, project, position, created_at, updated_at)
     VALUES (?,?,?,?,?,0,?,?,?,?,?)`,
    [id, userId, title, detail, priority, dueAt, project, maxPos + 1, nowIso(), nowIso()],
  );
  return shape(get('SELECT * FROM todos WHERE id = ?', [id]));
}

export function update(id, userId, patch) {
  const todo = get('SELECT * FROM todos WHERE id = ? AND user_id = ?', [id, userId]);
  if (!todo) throw HttpError.notFound('待办不存在');
  const done = patch.done === undefined ? todo.done : patch.done ? 1 : 0;
  run(
    `UPDATE todos SET title=?, detail=?, priority=?, done=?, due_at=?, project=?, position=?, completed_at=?, updated_at=?
     WHERE id = ?`,
    [
      patch.title ?? todo.title,
      patch.detail === undefined ? todo.detail : patch.detail,
      patch.priority ?? todo.priority,
      done,
      patch.dueAt === undefined ? todo.due_at : patch.dueAt,
      patch.project === undefined ? todo.project : patch.project,
      patch.position ?? todo.position,
      done ? todo.completed_at || nowIso() : null,
      nowIso(),
      id,
    ],
  );
  return shape(get('SELECT * FROM todos WHERE id = ?', [id]));
}

export function remove(id, userId) {
  const todo = get('SELECT id FROM todos WHERE id = ? AND user_id = ?', [id, userId]);
  if (!todo) throw HttpError.notFound('待办不存在');
  run('DELETE FROM todos WHERE id = ?', [id]);
  return true;
}

export function clearCompleted(userId) {
  const res = run('DELETE FROM todos WHERE user_id = ? AND done = 1', [userId]);
  return res.changes;
}

export function reorder(userId, ids) {
  ids.forEach((id, index) => {
    run('UPDATE todos SET position = ? WHERE id = ? AND user_id = ?', [index, id, userId]);
  });
  return true;
}
