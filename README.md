# Taama — Backend API

Backend Node.js/Express/PostgreSQL pour la plateforme Taama.

## Architecture recommandée

- Frontends : Vercel (`taama.ml`, `partner.taama.ml`, `admin.taama.ml`)
- API : Railway (`api.taama.ml`)
- PostgreSQL : Railway, réseau privé
- Stockage de documents : objet (R2/S3) quand les PDF/documents seront activés

## Installation

```bash
npm install
cp .env.example .env
npm start
```

En local, utiliser PostgreSQL et renseigner `DATABASE_URL`.

## Base de données

Sur une base vide :

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/schema_partners.sql
psql "$DATABASE_URL" -f db/migration_revenus_taama.sql
psql "$DATABASE_URL" -f db/migration_production_security.sql
```

Sur une base déjà utilisée, **faire une sauvegarde avant migration** et exécuter les migrations dans l'ordre.

## Variables de production obligatoires

- `DATABASE_URL`
- `JWT_SECRET`
- `ADMIN_KEY`
- `PAYMENT_WEBHOOK_SECRET`
- `CORS_ORIGINS`
- `NODE_ENV=production`

Les clés Orange Money/Moov Money/SMS restent côté serveur et ne doivent jamais être mises dans les frontends.

## API principales

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/auth/request-otp` | publique | Demande OTP |
| POST | `/auth/verify-otp` | publique | Vérifie OTP et crée une session |
| POST | `/auth/partner-login` | publique | Connexion partenaire |
| GET | `/listings` | publique | Offres actives |
| GET | `/listings/:id` | publique | Détail d'une offre active |
| POST | `/listings` | admin/partenaire | Créer une offre |
| GET | `/bookings` | client | Mes réservations |
| POST | `/bookings` | client | Créer une réservation |
| PATCH | `/bookings/:id/confirm` | webhook | Confirmer un paiement |
| GET | `/partner/bookings` | partenaire | Réservations du partenaire |
| PATCH | `/partner/bookings/:id/confirm` | partenaire | Confirmer une réservation payée |
| PATCH | `/partner/bookings/:id/reject` | partenaire | Rejeter une réservation |
| GET | `/partner/finance/summary` | partenaire | Solde et revenus |
| POST | `/partner/finance/withdrawals` | partenaire | Demande de retrait |
| GET | `/admin/finance/summary` | admin | Synthèse financière |
| GET | `/admin/finance/withdrawals` | admin | Retraits |
| PATCH | `/admin/finance/withdrawals/:id/pay` | admin | Marquer un retrait payé |
| POST | `/admin/finance/withdrawals/:id/reject` | admin | Rejeter un retrait |
| GET | `/health` | publique | Health check Railway |

## Sécurité ajoutée dans cette version

- CORS configurable par liste blanche.
- Rate limiting léger sur API, OTP, login partenaire et routes admin.
- `x-powered-by` désactivé.
- `simple-login` désactivé en production.
- `dev_otp` uniquement hors production.
- Webhook paiement refusé si `PAYMENT_WEBHOOK_SECRET` n'est pas configuré.
- Comparaison du secret webhook/admin en temps constant.
- `/listings` en création protégé par admin ou partenaire.
- Un partenaire ne peut créer une offre qu'en son propre nom.
- Les offres publiques inactives ne sont plus exposées par le détail public.
- Les revenus partenaires et financiers ne comptent que les paiements réellement confirmés.
- Suppression partenaire transformée en archivage (`is_active=false`) pour préserver l'historique.
- Confirmation partenaire refusée tant que le paiement n'est pas confirmé.
- Verrouillage du partenaire lors du calcul/création d'un retrait.
- Références de réservation générées avec `crypto.randomBytes`.
- Idempotence de confirmation paiement via `payment_reference` unique.

## Important

Le fournisseur SMS et les API Orange Money/Moov Money ne sont pas encore intégrés dans ce dépôt. Les variables sont prévues, mais aucune clé réelle ne doit être ajoutée au code source.
