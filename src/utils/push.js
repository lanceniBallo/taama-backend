// Taama — notifications push (Web Push, norme VAPID) sans dépendance externe.
// Envoie une notification "vide" (sans contenu chiffré) : le téléphone affiche
// alors "Nouvelle réservation" grâce au service worker de l'app partenaire.
// Variables Railway nécessaires : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ex. mailto:contact@taama.ml)
const crypto = require('crypto');
const pool = require('../db');

let tableReady = null;
function ensureTable() {
  if (!tableReady) {
    tableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS partner_push_subscriptions (
        id SERIAL PRIMARY KEY,
        partner_id UUID NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT now()
      )`).catch((e) => { tableReady = null; throw e; });
  }
  return tableReady;
}

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function isConfigured() {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let privateKeyObj = null;
function privateKey() {
  if (!privateKeyObj) {
    const pub = fromB64u(process.env.VAPID_PUBLIC_KEY); // 65 octets : 0x04 + X + Y
    privateKeyObj = crypto.createPrivateKey({
      key: { kty: 'EC', crv: 'P-256', d: process.env.VAPID_PRIVATE_KEY, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
      format: 'jwk',
    });
  }
  return privateKeyObj;
}

function vapidHeader(endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: process.env.VAPID_SUBJECT || 'mailto:contact@taama.ml',
  }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), { key: privateKey(), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${body}.${b64u(sig)}, k=${process.env.VAPID_PUBLIC_KEY}`;
}

async function saveSubscription(partnerId, endpoint) {
  await ensureTable();
  await pool.query(
    `INSERT INTO partner_push_subscriptions (partner_id, endpoint) VALUES ($1, $2)
     ON CONFLICT (endpoint) DO UPDATE SET partner_id = EXCLUDED.partner_id`,
    [partnerId, endpoint]
  );
}

async function removeSubscription(endpoint) {
  await ensureTable();
  await pool.query('DELETE FROM partner_push_subscriptions WHERE endpoint = $1', [endpoint]);
}

// Prévient tous les appareils d'un partenaire. Ne lève jamais d'erreur : une notification
// ratée ne doit pas empêcher la réservation du client.
async function notifyPartner(partnerId) {
  if (!partnerId || !isConfigured()) return;
  try {
    await ensureTable();
    const { rows } = await pool.query('SELECT endpoint FROM partner_push_subscriptions WHERE partner_id = $1', [partnerId]);
    await Promise.all(rows.map(async ({ endpoint }) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { TTL: '86400', Urgency: 'high', Authorization: vapidHeader(endpoint), 'Content-Length': '0' },
        });
        if (res.status === 404 || res.status === 410) await removeSubscription(endpoint); // appareil désinscrit
        else if (!res.ok) console.error('push:', res.status, await res.text().catch(() => ''));
      } catch (e) { console.error('push envoi:', e.message); }
    }));
  } catch (e) { console.error('push:', e.message); }
}

module.exports = { isConfigured, saveSubscription, removeSubscription, notifyPartner };
