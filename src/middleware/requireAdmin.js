const { safeEqual } = require('./security');

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!process.env.ADMIN_KEY) {
    return res.status(503).json({ error: 'Administration non configurée' });
  }
  if (!safeEqual(key, process.env.ADMIN_KEY)) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
}

module.exports = requireAdmin;
