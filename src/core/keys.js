import crypto from 'node:crypto';

export function randomToken(prefix, bytes = 32) {
  return `${prefix}${crypto.randomBytes(bytes).toString('hex')}`;
}

export function ownerKey() {
  return randomToken('freellmapi-', 24);
}

export function friendKey() {
  return randomToken('freellmapi-friend-', 24);
}

export function mask(value) {
  if (!value) return '未配置';
  if (value.length <= 12) return `${value.slice(0, 4)}…`;
  return `${value.slice(0, 12)}…${value.slice(-4)}`;
}

export function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
