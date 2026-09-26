const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;
const useColor = process.stdout.isTTY;

function paint(color, text) {
  return useColor ? `${color}${text}${RESET}` : text;
}

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(
    now.getSeconds(),
  ).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
  const tag = paint(COLORS[level], level.toUpperCase().padEnd(5));
  const head = useColor ? `${DIM}${ts}${RESET}` : ts;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${head} ${tag} ${args.map(fmt).join(' ')}\n`);
}

function fmt(v) {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack || v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const logger = {
  debug: (...a) => emit('debug', a),
  info: (...a) => emit('info', a),
  warn: (...a) => emit('warn', a),
  error: (...a) => emit('error', a),
  child(bindings) {
    const prefix = Object.entries(bindings).map(([k, v]) => `${k}=${v}`).join(' ');
    return {
      debug: (...a) => emit('debug', [DIM + prefix, ...a]),
      info: (...a) => emit('info', [DIM + prefix, ...a]),
      warn: (...a) => emit('warn', [DIM + prefix, ...a]),
      error: (...a) => emit('error', [DIM + prefix, ...a]),
    };
  },
};

export default logger;
