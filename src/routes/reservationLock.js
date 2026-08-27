// =====================================================================
// Taama backend — Verrouillage temporaire des réservations
// Node.js / Express / pg (PostgreSQL)
// =====================================================================
// À adapter : ce fichier suppose que vous avez déjà un pool `pg` configuré
// avec process.env.DATABASE_URL (c'est le cas par défaut sur Railway) et
// un routeur Express monté quelque part (ex: app.use('/reservations', router)).
// Si votre backend utilise un autre ORM (Prisma, Sequelize...), la logique
// SQL ci-dessous reste valable — seule la façon de l'exécuter change.

const express = require('express');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const router = express.Router();

const LOCK_TTL_MINUTES = 12;

// ---------------------------------------------------------------------
// POST /reservations/lock
// Appelé quand le client arrive sur l'écran de paiement (pas avant).
// Body attendu :
//   { inventory_id, user_id, type: "range" | "slot",
//     period: ["2026-09-10","2026-09-15"]  // si type = "range"
//     slot_datetime: "2026-09-10T08:00:00Z" // si type = "slot"
//   }
// ---------------------------------------------------------------------
router.post('/lock', async (req, res) => {
  const { inventory_id, user_id, type, period, slot_datetime } = req.body;

  if (!inventory_id || !user_id || !type) {
    return res.status(400).json({ error: 'inventory_id, user_id et type sont requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let lockRow;

    if (type === 'range') {
      if (!period || period.length !== 2) {
        throw Object.assign(new Error('period doit être [date_debut, date_fin]'), { status: 400 });
      }

      const { rows } = await client.query(
        `SELECT id FROM availability_range
         WHERE inventory_id = $1
           AND period && daterange($2, $3)
           AND status = 'available'
         FOR UPDATE`,
        [inventory_id, period[0], period[1]]
      );

      if (rows.length === 0) {
        throw Object.assign(new Error('Cette période n\'est plus disponible'), { status: 409 });
      }

      const rangeId = rows[0].id;
      await client.query(`UPDATE availability_range SET status = 'locked' WHERE id = $1`, [rangeId]);

      const insert = await client.query(
        `INSERT INTO reservation_lock (user_id, inventory_id, availability_range_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '${LOCK_TTL_MINUTES} minutes')
         RETURNING id, expires_at`,
        [user_id, inventory_id, rangeId]
      );
      lockRow = insert.rows[0];

    } else if (type === 'slot') {
      if (!slot_datetime) {
        throw Object.assign(new Error('slot_datetime est requis'), { status: 400 });
      }

      const { rows } = await client.query(
        `SELECT id FROM availability_slot
         WHERE inventory_id = $1
           AND slot_datetime = $2
           AND status = 'available'
         FOR UPDATE`,
        [inventory_id, slot_datetime]
      );

      if (rows.length === 0) {
        throw Object.assign(new Error('Ce créneau n\'est plus disponible'), { status: 409 });
      }

      const slotId = rows[0].id;
      await client.query(`UPDATE availability_slot SET status = 'locked' WHERE id = $1`, [slotId]);

      const insert = await client.query(
        `INSERT INTO reservation_lock (user_id, inventory_id, availability_slot_id, expires_at)
         VALUES ($1, $2, $3, now() + interval '${LOCK_TTL_MINUTES} minutes')
         RETURNING id, expires_at`,
        [user_id, inventory_id, slotId]
      );
      lockRow = insert.rows[0];

    } else {
      throw Object.assign(new Error('type doit être "range" ou "slot"'), { status: 400 });
    }

    await client.query('COMMIT');
    res.status(201).json({ lock_id: lockRow.id, expires_at: lockRow.expires_at });

  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    if (status === 500) console.error('Erreur reservation_lock:', err);
    res.status(status).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// POST /reservations/:lockId/confirm
// Appelé par votre webhook de paiement (Orange Money, Wave, etc.)
// quand le paiement est validé. booking_id = la réservation déjà créée
// dans votre table `bookings` existante.
// ---------------------------------------------------------------------
router.post('/:lockId/confirm', async (req, res) => {
  const { lockId } = req.params;
  const { booking_id } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM reservation_lock WHERE id = $1 AND status = 'active' FOR UPDATE`,
      [lockId]
    );

    if (rows.length === 0) {
      throw Object.assign(new Error('Verrou introuvable ou déjà traité (probablement expiré)'), { status: 410 });
    }

    const lock = rows[0];

    await client.query(`UPDATE reservation_lock SET status = 'converted' WHERE id = $1`, [lockId]);

    if (lock.availability_range_id) {
      await client.query(`UPDATE availability_range SET status = 'booked' WHERE id = $1`, [lock.availability_range_id]);
    } else {
      await client.query(`UPDATE availability_slot SET status = 'booked' WHERE id = $1`, [lock.availability_slot_id]);
    }

    if (booking_id) {
      await client.query(`UPDATE bookings SET reservation_lock_id = $1 WHERE id = $2`, [lockId, booking_id]);
    }

    await client.query('COMMIT');
    res.json({ status: 'confirmed' });

  } catch (err) {
    await client.query('ROLLBACK');
    const status = err.status || 500;
    if (status === 500) console.error('Erreur confirmation lock:', err);
    res.status(status).json({ error: err.message || 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------
// Job de purge — à appeler toutes les 1-2 minutes.
// Libère les verrous expirés dont le paiement n'a jamais été confirmé.
// ---------------------------------------------------------------------
async function releaseExpiredLocks() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `UPDATE reservation_lock SET status = 'expired'
       WHERE status = 'active' AND expires_at < now()`
    );

    const { rowCount: rangesFreed } = await client.query(
      `UPDATE availability_range SET status = 'available'
       WHERE id IN (
         SELECT availability_range_id FROM reservation_lock
         WHERE status = 'expired' AND availability_range_id IS NOT NULL
       )`
    );

    const { rowCount: slotsFreed } = await client.query(
      `UPDATE availability_slot SET status = 'available'
       WHERE id IN (
         SELECT availability_slot_id FROM reservation_lock
         WHERE status = 'expired' AND availability_slot_id IS NOT NULL
       )`
    );

    await client.query('COMMIT');
    if (rangesFreed || slotsFreed) {
      console.log(`Verrous expirés libérés : ${rangesFreed} plage(s), ${slotsFreed} créneau(x)`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur purge des verrous:', err);
  } finally {
    client.release();
  }
}

module.exports = { router, releaseExpiredLocks };
