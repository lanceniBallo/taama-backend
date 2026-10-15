// Taama — notifications push vers les CLIENTS (avec message chiffré, norme RFC 8291).
// Utilise les mêmes clés VAPID que les notifications partenaires (variables Railway).
const crypto = require('crypto');
const pool = require('../db');

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS user_push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id UUID NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      )`).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

function isConfigured() { return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY); }

let vapidKey = null;
function vapidHeader(endpoint) {
  if (!vapidKey) {
    const pub = fromB64u(process.env.VAPID_PUBLIC_KEY);
    vapidKey = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: process.env.VAPID_PRIVATE_KEY, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) }, format: 'jwk' });
  }
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:contact@taama.ml' }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), { key: vapidKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${body}.${b64u(sig)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Chiffrement "aes128gcm" d'un message pour un appareil (RFC 8291 / RFC 8188)
function encrypt(payload, p256dh, authSecret) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const salt = crypto.randomBytes(16);

  const prkKey = hmac(auth, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const plain = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);
  const body = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);

  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

async function saveSubscription(userId, sub) {
  await ensureTable();
  await pool.query(
    `INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth]);
}

async function removeSubscription(endpoint) {
  await ensureTable();
  await pool.query('DELETE FROM user_push_subscriptions WHERE endpoint = $1', [endpoint]);
}

// Envoie { title, body, url, tag } à tous les appareils du client. Ne lève jamais d'erreur.
async function notifyUser(userId, message) {
  if (!userId || !isConfigured()) return;
  try {
    await ensureTable();
    const { rows } = await pool.query('SELECT endpoint, p256dh, auth FROM user_push_subscriptions WHERE user_id = $1', [userId]);
    const payload = JSON.stringify(message);
    await Promise.all(rows.map(async (s) => {
      try {
        const res = await fetch(s.endpoint, {
          method: 'POST',
          headers: { TTL: '86400', Urgency: 'high', Authorization: vapidHeader(s.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' },
          body: encrypt(payload, s.p256dh, s.auth),
        });
        if (res.status === 404 || res.status === 410) await removeSubscription(s.endpoint);
        else if (!res.ok) console.error('push client:', res.status, await res.text().catch(() => ''));
      } catch (e) { console.error('push client envoi:', e.message); }
    }));
  } catch (e) { console.error('push client:', e.message); }
}

module.exports = { isConfigured, saveSubscription, removeSubscription, notifyUser, _encrypt: encrypt };
