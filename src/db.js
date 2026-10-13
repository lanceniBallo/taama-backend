const { Pool } = require("pg");
require("dotenv").config();

// Sur le plan gratuit Railway, Postgres se met en veille. Au réveil, les
// premières connexions échouent pendant quelques secondes : on réessaie
// automatiquement au lieu de renvoyer "Erreur serveur" à l'utilisateur.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
});

// Une connexion inactive coupée par la mise en veille ne doit pas planter le serveur.
pool.on("error", (err) => console.error("db (connexion inactive):", err.code || err.message || err));

const RETRYABLE = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "57P01", "57P03", "08006", "08001"]);
function isConnectionError(err) {
  if (!err) return false;
  if (RETRYABLE.has(err.code)) return true;
  if (Array.isArray(err.errors) && err.errors.some((e) => RETRYABLE.has(e.code))) return true; // AggregateError
  return /timeout|terminated|Connection|connect/i.test(err.message || "");
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  let last;
  for (let i = 0; i < 6; i++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      if (!isConnectionError(err) || i === 5) throw err;
      console.error(`db: base indisponible (${err.code || (err.errors && err.errors[0] && err.errors[0].code) || "connexion"}), nouvel essai ${i + 1}/5`);
      await wait(1500 * (i + 1));
    }
  }
  throw last;
}

const rawQuery = pool.query.bind(pool);
const rawConnect = pool.connect.bind(pool);
pool.query = (...args) => {
  if (typeof args[args.length - 1] === "function") return rawQuery(...args); // style callback : inchangé
  return withRetry(() => rawQuery(...args));
};
pool.connect = (...args) => {
  if (typeof args[0] === "function") return rawConnect(...args);
  return withRetry(() => rawConnect());
};

module.exports = pool;
