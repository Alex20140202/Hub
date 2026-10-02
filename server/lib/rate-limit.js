/**
 * 固定窗口限流器：按「作用域 + 标识」计数，超限返回 true。
 * 定时清理过期桶，避免长期运行内存增长。
 */
export function createLimiter({ windowMs, max, name = 'limit' }) {
  const buckets = new Map();

  const sweep = () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  };
  const timer = setInterval(sweep, windowMs).unref();
  timer.unref?.();

  return {
    name,
    /** 消费一次额度，超限返回 true。 */
    take(key) {
      const now = Date.now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return false;
      }
      bucket.count += 1;
      return bucket.count > max;
    },
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
