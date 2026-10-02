import { all, get, run } from '../db.js';

const COLUMNS = `id, user_id AS userId, title, detail, priority, done, due_at AS dueAt, position, created_at AS createdAt, completed_at AS completedAt`;

const shape = (row) => (row ? { ...row, done: Boolean(row.done) } : null);

const PRIORITY_ORDER = "CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END";

export function listTodos(userId, { q = '', filter = 'all' } = {}) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (filter === 'open') where.push('done = 0');
  if (filter === 'done') where.push('done = 1');
  if (filter === 'today') where.push("done = 0 AND due_at IS NOT NULL AND due_at <= date('now', 'localtime', '+1 day')");
  if (q) {
    where.push('(title LIKE ? OR detail LIKE ?)');
    const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    params.push(like, like);
  }
  const rows = all(
    `SELECT ${COLUMNS} FROM todos WHERE ${where.join(' AND ')} ORDER BY done, ${PRIORITY_ORDER}, position, id`,
    ...params,
  );
  return rows.map(shape);
}

export const getTodo = (id, userId) => shape(get(`SELECT ${COLUMNS} FROM todos WHERE id = ? AND user_id = ?`, id, userId));

export function createTodo(userId, input) {
  const next = get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM todos WHERE user_id = ?', userId).p;
  const { lastInsertRowid } = run(
    'INSERT INTO todos (user_id, title, detail, priority, due_at, position) VALUES (?, ?, ?, ?, ?, ?)',
    userId,
    input.title,
    input.detail ?? '',
    input.priority ?? 'normal',
    input.dueAt ?? null,
    next,
  );
  return getTodo(lastInsertRowid, userId);
}

export function updateTodo(id, userId, input) {
  const current = getTodo(id, userId);
  if (!current) return null;
  if (input.done !== undefined && input.done !== current.done) {
    run(
      input.done
        ? "UPDATE todos SET done = 1, completed_at = datetime('now') WHERE id = ? AND user_id = ?"
        : 'UPDATE todos SET done = 0, completed_at = NULL WHERE id = ? AND user_id = ?',
      id,
      userId,
    );
  }
  run(
    'UPDATE todos SET title = ?, detail = ?, priority = ?, due_at = ? WHERE id = ? AND user_id = ?',
    input.title ?? current.title,
    input.detail ?? current.detail,
    input.priority ?? current.priority,
    input.dueAt === undefined ? current.dueAt : input.dueAt,
    id,
    userId,
  );
  return getTodo(id, userId);
}

export const deleteTodo = (id, userId) => run('DELETE FROM todos WHERE id = ? AND user_id = ?', id, userId).changes > 0;

export const clearCompleted = (userId) => run('DELETE FROM todos WHERE user_id = ? AND done = 1', userId).changes;

export function reorder(userId, orderedIds) {
  const owned = new Set(listTodos(userId).map((todo) => todo.id));
  const safe = orderedIds.filter((id) => owned.has(Number(id)));
  safe.forEach((id, index) => run('UPDATE todos SET position = ? WHERE id = ? AND user_id = ?', index + 1, id, userId));
  return safe.length;
}

export const todoStats = (userId) => ({
  total: get('SELECT COUNT(*) AS n FROM todos WHERE user_id = ?', userId).n,
  open: get('SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND done = 0', userId).n,
  done: get('SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND done = 1', userId).n,
  overdue: get(
    "SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND done = 0 AND due_at IS NOT NULL AND due_at < datetime('now', 'localtime')",
    userId,
  ).n,
  dueToday: get(
    "SELECT COUNT(*) AS n FROM todos WHERE user_id = ? AND done = 0 AND due_at IS NOT NULL AND date(due_at) = date('now', 'localtime')",
    userId,
  ).n,
});

export const upcomingTodos = (userId, limit = 5) =>
  all(
    `SELECT ${COLUMNS} FROM todos WHERE user_id = ? AND done = 0 ORDER BY ${PRIORITY_ORDER}, (due_at IS NULL), due_at, position LIMIT ?`,
    userId,
    limit,
  ).map(shape);
