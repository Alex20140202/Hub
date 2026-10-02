const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] ?? (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);
const COLOR = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

function emit(level, args) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toTimeString().slice(0, 8);
  const tag = `${COLOR[level]}${level.toUpperCase().padEnd(5)}${RESET}`;
  const stream = LEVELS[level] >= LEVELS.error ? process.stderr : process.stdout;
  stream.write(`${time} ${tag} ${args.map(String).join(' ')}\n`);
}

export const logger = {
  debug: (...args) => emit('debug', args),
  info: (...args) => emit('info', args),
  warn: (...args) => emit('warn', args),
  error: (...args) => emit('error', args),
};
