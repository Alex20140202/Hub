const ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz';

/** 生成短 slug：中文等非 ASCII 标题会退化为随机短码，保证 URL 干净唯一。 */
export function newSlug(text) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  if (!base) return randomId(6);
  return /[a-z]/.test(base) ? base : `${randomId(6)}`;
}

export function randomId(length = 7) {
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}
