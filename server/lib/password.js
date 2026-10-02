import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

const N = 16384;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** 生成 scrypt 密码哈希，格式 scrypt$N$salt$hash。 */
export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N, maxmem: MAXMEM });
  return `scrypt$${N}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, cost, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const actual = scryptSync(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(cost) || N,
      maxmem: MAXMEM,
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

const COMMON = ['123456', 'password', 'qwerty', 'admin', '111111', 'abc123', 'password1', '12345678'];

/** 0-4 的密码强度评分，供注册页实时提示。 */
export function scorePassword(password) {
  const value = String(password || '');
  if (!value) return { score: 0, label: '请输入密码', hints: ['至少 8 个字符'] };
  const hints = [];
  let score = 0;
  if (value.length >= 8) score += 1;
  else hints.push('至少 8 个字符');
  if (value.length >= 12) score += 1;
  else if (value.length >= 8) hints.push('12 个字符以上更安全');
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  else hints.push('混合大小写字母');
  if (/\d/.test(value) && /[^\w\s]/.test(value)) score += 1;
  else hints.push('加入数字与符号');
  if (COMMON.includes(value.toLowerCase())) {
    score = 0;
    hints.unshift('这是最常见的弱密码');
  }
  const labels = ['太弱', '偏弱', '一般', '不错', '很强'];
  return { score, label: labels[score] ?? '太弱', hints: hints.slice(0, 2) };
}
