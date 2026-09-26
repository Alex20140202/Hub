/** 滑动窗口内存限流器 */
export function createRateLimiter({ windowMs = 60_000, max = 120, key = (req) => req.socket.remoteAddress } = {}) {
  const hits = new Map();

  function prune(now) {
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => now - t < windowMs);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }
  let lastPrune = Date.now();

  return function check(req) {
    const now = Date.now();
    if (now - lastPrune > windowMs) {
      prune(now);
      lastPrune = now;
    }
    const k = key(req);
    const arr = hits.get(k) || [];
    const recent = arr.filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - recent[0])) / 1000);
      const err = new Error(`请求过于频繁，${retryAfter} 秒后再试`);
      err.status = 429;
      err.retryAfter = retryAfter;
      throw err;
    }
    recent.push(now);
    hits.set(k, recent);
    return { remaining: max - recent.length };
  };
}

/** 并发闸门，限制同时执行的任务数 */
export function createLimiter(concurrency = 4) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}
