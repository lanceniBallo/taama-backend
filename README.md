# Taama — Backend (MVP)

API minimale pour brancher le prototype front-end sur une vraie base de données.

## Démarrage

1. Installer PostgreSQL (localement, ou via un service comme Railway/Render/Supabase).
2. Copier `.env.example` en `.env` et renseigner `DATABASE_URL` et `JWT_SECRET`.
3. Créer les tables :
   ```
   psql -d taama -f db/schema.sql
   ```
4. Installer les dépendances et lancer le serveur :
   ```
   npm install
   npm run dev
   ```
   Le serveur démarre sur `http://localhost:4000`.

## Endpoints principaux

| Méthode | Route | Description |
|---|---|---|
| POST | `/auth/request-otp` | Envoie un code OTP au numéro de téléphone |
| POST | `/auth/verify-otp` | Vérifie le code et renvoie un token de session |
| GET | `/listings?type=hotel` | Liste les offres (hotel, ticket, vehicle, insurance) |
| GET | `/listings/:id` | Détail d'une offre |
| POST | `/listings` | Créer une offre (admin/partenaire) |
| GET | `/bookings` | Mes réservations (auth requise) |
| POST | `/bookings` | Créer une réservation (auth requise) |
| PATCH | `/bookings/:id/confirm` | Confirme le paiement (à appeler par le webhook Mobile Money) |

## Prochaines étapes

- Remplacer l'envoi de l'OTP en console par un vrai service SMS (Twilio ou un fournisseur local).
- Brancher les API Orange Money / Moov Money : à la création d'une réservation, initier le paiement, puis confirmer via leur webhook sur `/bookings/:id/confirm`.
- Ajouter un petit panneau admin pour que tu puisses toi-même saisir les offres des premiers partenaires (`POST /listings`).
- Remplacer les `useState` du fichier `taama-standalone-3.html` par des appels `fetch` vers ces routes.
