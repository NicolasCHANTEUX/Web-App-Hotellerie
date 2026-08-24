# Hotel Rivage

Application hoteliere React 19 + Vite + TypeScript, reliee a une API Node/Fastify et a une base PostgreSQL Supabase.

## Fonctionnel

- Pages Accueil, Hebergements, Detail, Reservation, Confirmation, Contact et Mentions legales.
- Catalogue, tarifs, equipements et options charges depuis Supabase.
- Recherche de disponibilite selon les dates, la capacite et les chambres physiques occupees.
- Etats de chargement, erreur, relance et absence de resultat.
- Tunnel de reservation en cinq etapes avec creation serveur au statut `PENDING_PAYMENT`.
- Espace administrateur protege avec reservations et cartes de chambres, filtrees par periode et disponibilite.
- Navigation responsive, formulaires, galerie et lightbox.

Le paiement en ligne n'est pas encore branche : les reservations sont enregistrees, mais leur reglement reste a finaliser hors ligne.

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

Cette commande remplace automatiquement une ancienne instance du projet, attend que l'API soit prete, puis lance Vite. Elle utilise toujours les ports fixes ci-dessous afin d'eviter une instance frontend inutilisable sur `5174`.

- Frontend : `http://127.0.0.1:5173`
- API : `http://127.0.0.1:3001`
- Sante API : `http://127.0.0.1:3001/health`
- Processus API : `http://127.0.0.1:3001/health/live`

Pour arreter proprement toute la pile depuis un autre terminal :

```powershell
npm run dev:stop
```

## Verifier la production

```powershell
npm run build:all
```

Les details de la base et des migrations sont documentes dans `server/README.md`.
