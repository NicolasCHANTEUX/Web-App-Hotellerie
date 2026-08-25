# Hotel Rivage

Application hoteliere React 19 + Vite + TypeScript, reliee a une API Node/Fastify et a une base PostgreSQL Supabase.

## Fonctionnel

- Pages Accueil, Hebergements, Detail, Reservation, Confirmation, Contact et Mentions legales. Le formulaire Contact est persisté côté serveur et transmis par l'outbox e-mail.
- Catalogue, tarifs, equipements et options charges depuis Supabase.
- Recherche de disponibilite selon les dates, la capacite et les chambres physiques occupees.
- Etats de chargement, erreur, relance et absence de resultat.
- Tunnel de reservation en cinq etapes avec devis TTC serveur, acceptation explicite des CGV et option de chambre temporaire.
- Paiement manuel complet et paiement Stripe optionnel, factures et avoirs PDF.
- Espace administrateur protege avec reservations paginees, cartes de chambres et gestion du catalogue, des promotions et des images.
- Navigation responsive, formulaires, galerie et lightbox.

Sans clés Stripe, l'application reste volontairement en mode manuel et ne montre aucun bouton de paiement en ligne.

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

Pour lancer les validations Prisma, les tests backend, le build frontend et les deux tests de rendu :

```powershell
npm run verify
```

Les détails de la base sont documentés dans `server/README.md` et la procédure de mise en ligne dans `docs/deployment.md`.
