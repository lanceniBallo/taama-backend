const crypto = require('crypto');

const buckets = new Map();

function rateLimit({ windowMs = 60_000, max = 30, keyFn = (req) => req.ip || 'unknown' } = {}) {
  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.set('Retry-After', String(Math.ceil((bucket.start + windowMs - now) / 1000)));
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' });
    }
    next();
  };
}

function safeEqual(a, b) {
  if (!a || !b) return false;
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`${name} est obligatoire en production`);
}

module.exports = { rateLimit, safeEqual, requireEnv };
