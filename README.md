# Hotel Rivage

Application hoteliere React 19 + Vite + TypeScript, reliee a une API Node/Fastify et a une base PostgreSQL Supabase.

## Fonctionnel

- Pages Accueil, Hebergements, Detail, Reservation, Confirmation, Contact et Mentions legales.
- Catalogue, tarifs, equipements et options charges depuis Supabase.
- Recherche de disponibilite selon les dates, la capacite et les chambres physiques occupees.
- Etats de chargement, erreur, relance et absence de resultat.
- Tunnel de reservation en cinq etapes.
- Navigation responsive, formulaires, galerie et lightbox.

La creation definitive de reservation et le paiement restent simules. Ils constituent le prochain sprint backend.

## Installation

```powershell
npm install
npm --prefix server install
```

La connexion Supabase est configuree dans `server/.env`, fichier ignore par Git. Le certificat public Supabase est conserve dans `server/certs`.

## Lancer toute l'application

```powershell
npm run dev:full
```

- Frontend : `http://127.0.0.1:5173`
- API : `http://127.0.0.1:3001`
- Sante API : `http://127.0.0.1:3001/health`

## Verifier la production

```powershell
npm run build:all
```

Les details de la base et des migrations sont documentes dans `server/README.md`.
