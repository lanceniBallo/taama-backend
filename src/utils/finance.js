const pool = require('../db');

// Taux par défaut (utilisés tant que l'admin n'a rien changé, ou si la base ne répond pas)
const COMMISSION_RATES = Object.freeze({
  hotel: 12,
  ticket: 8,
  bus: 8,
  flight: 5,
  airline: 5,
  vehicle: 10,
  car_rental: 10,
  insurance: 15,
  apartment: 10,
  real_estate: 10,
  taxi: 10,
});

// Un seul taux par service : les types synonymes partagent le même réglage
const CANONICAL = Object.freeze({ bus: 'ticket', flight: 'airline', car_rental: 'vehicle' });
function canonicalType(type) {
  const t = String(type || '').toLowerCase();
  return CANONICAL[t] || t;
}

function getCommissionRate(type) {
  const t = String(type || '').toLowerCase();
  return Number(COMMISSION_RATES[t] ?? COMMISSION_RATES[canonicalType(t)] ?? 10);
}

// Taux réglé par l'admin (écran Paramètres), avec petit cache d'une minute
let cache = { at: 0, rates: null };
async function getLiveCommissionRate(type) {
  try {
    if (!cache.rates || Date.now() - cache.at > 60_000) {
      const { rows } = await pool.query('SELECT type, rate_percent FROM commission_rates');
      cache = { at: Date.now(), rates: Object.fromEntries(rows.map((r) => [r.type, Number(r.rate_percent)])) };
    }
    const live = cache.rates[canonicalType(type)];
    if (Number.isFinite(live)) return live;
  } catch (_) { /* table absente ou base indisponible : taux par défaut */ }
  return getCommissionRate(type);
}
function clearRateCache() { cache = { at: 0, rates: null }; }

function splitAmount(price, type, rateOverride) {
  const gross = Number(price);
  if (!Number.isInteger(gross) || gross < 0) throw new Error('Montant invalide');
  const rate = Number.isFinite(Number(rateOverride)) && rateOverride !== undefined ? Number(rateOverride) : getCommissionRate(type);
  const commission = Math.round(gross * rate / 100);
  return { rate, commission, partnerAmount: gross - commission };
}

module.exports = { COMMISSION_RATES, canonicalType, getCommissionRate, getLiveCommissionRate, clearRateCache, splitAmount };
