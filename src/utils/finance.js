const COMMISSION_RATES = Object.freeze({
  hotel: 12,
  ticket: 8,
  bus: 8,
  flight: 5,
  vehicle: 10,
  car_rental: 10,
  insurance: 15,
  apartment: 10,
  real_estate: 10,
});

function getCommissionRate(type) {
  return Number(COMMISSION_RATES[String(type || '').toLowerCase()] ?? 10);
}

function splitAmount(price, type) {
  const gross = Number(price);
  if (!Number.isInteger(gross) || gross < 0) throw new Error('Montant invalide');
  const rate = getCommissionRate(type);
  const commission = Math.round(gross * rate / 100);
  return { rate, commission, partnerAmount: gross - commission };
}

module.exports = { COMMISSION_RATES, getCommissionRate, splitAmount };
