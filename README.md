# Hotel Rivage

Application hoteliere React 19 + Vite + TypeScript, reliee a une API Node/Fastify et a une base PostgreSQL Supabase.

## Fonctionnel

- Pages Accueil, Hebergements, Detail, Reservation, Confirmation, Contact et Mentions legales. Le formulaire Contact est persisté côté serveur et transmis par l'outbox e-mail.
- Catalogue, tarifs, equipements et options charges depuis Supabase.
- Recherche de disponibilite selon les dates, la capacite et les chambres physiques occupees.
- Etats de chargement, erreur, relance et absence de resultat.
- Tunnel de reservation en cinq etapes avec devis TTC serveur, acceptation explicite des CGV et option de chambre temporaire.
- Paiement manuel complet et paiement Stripe optionnel, factures et avoirs PDF.
- Espace administrateur protégé avec création et suivi des réservations, planning opérationnel sur 14 jours, cartes de chambres et gestion du catalogue, des promotions et des images.
- Navigation responsive, formulaires, galerie et lightbox.

Sans clés Stripe, l'application reste volontairement en mode manuel et ne montre aucun bouton de paiement en ligne.

## Architecture

- `src/` : application publique et administration React, chargées dans des bundles séparés.
- `server/` : API Fastify modulaire, moteur de disponibilité, réservation, paiements, facturation et administration.
- `server/prisma/` : schéma PostgreSQL, migrations et données de démonstration.
- Supabase fournit PostgreSQL, Auth et le stockage des images ; le frontend n'accède jamais directement aux données métier.

Le site public charge son identité, ses coordonnées, ses horaires et son nombre de chambres depuis `GET /property`. Le catalogue, les disponibilités et les prix restent calculés côté serveur.

## Installation

```powershell
npm ci
npm --prefix server ci
npm --prefix server run db:generate
```

La connexion Supabase est configuree dans `server/.env`, fichier ignore par Git. Le certificat public Supabase est conserve dans `server/certs`.

Copier les variables frontend documentées dans `.env.example`. En production, `VITE_PUBLIC_SITE_URL` doit contenir l'origine HTTPS canonique utilisée pour le sitemap et les métadonnées sociales.

Ces commandes sont egalement a relancer apres avoir recupere le projet sur une autre machine. Les dossiers `node_modules` et le client Prisma genere sont propres a l'environnement local et ne doivent pas etre recopies entre deux installations.

## Lancer toute l'application

```powershell
npm run dev:full
```

Cette commande remplace automatiquement une ancienne instance du projet, attend que l'API soit prete, puis lance Vite. Elle utilise toujours les ports fixes ci-dessous afin d'eviter une instance frontend inutilisable sur `5174`.

Avec Node 20 ou 22, le frontend utilise le serveur Vite avec rechargement a chaud. Sous Node 24, une politique Windows peut bloquer le pre-bundling natif d'Esbuild dans certains dossiers OneDrive : le script bascule alors automatiquement sur un build surveille servi en preview. Dans ce mode, les changements sont reconstruits automatiquement mais il faut rafraichir le navigateur.

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

Pour lancer les parcours navigateur Playwright (accueil public, formulaire de contact et liste des reservations admin) :

```powershell
npm run test:e2e
```

La commande construit le frontend, demarre temporairement sa previsualisation sur le port `4173`, execute les tests puis ferme le serveur. Apres un `npm run build` deja effectue, `npm run test:e2e:run` relance uniquement les tests navigateur.

Les détails de la base sont documentés dans `server/README.md`, la procédure de mise en ligne dans `docs/deployment.md` et l'état des dépendances dans `docs/security-audit.md`.

## État de livraison

Le dépôt constitue une V1 fonctionnelle de démonstration. Les mentions légales, CGV, coordonnées d'hébergement et politiques commerciales doivent être complétées et validées pour chaque exploitant avant une ouverture commerciale.
