# Déploiement

## Architecture recommandée

- Construire le frontend Vite comme site statique avec `npm run build`.
- Déployer l'API Fastify séparément depuis `server/Dockerfile`.
- Définir `VITE_API_URL` avec l'URL HTTPS publique de l'API, ou router `/api` vers l'API sur le même domaine.
- Conserver PostgreSQL, Auth et le bucket public `hotel-public` dans le même projet Supabase.

Node.js 22 est la version de référence en CI et dans l'image Docker. Le backend local reste compatible avec Node 20, avec un transport WebSocket explicite pour le SDK Supabase.

## Ordre d'une mise en ligne

1. Sauvegarder la base Supabase.
2. Construire la cible de migration puis exécuter celle-ci avec les variables de production :

   ```sh
   docker build --target migrate -t hotel-rivage-migrate ./server
   docker run --rm --env-file server/.env hotel-rivage-migrate
   ```

3. Construire et déployer l'API :

   ```sh
   docker build --target runtime -t hotel-rivage-api ./server
   docker run --rm -p 3001:3001 --env-file server/.env hotel-rivage-api
   ```

4. Vérifier `/health/live`, puis `/health`.
5. Construire le frontend avec `VITE_API_URL=https://api.exemple.fr` et publier `dist/`.
6. Tester une recherche, une demande de réservation, la connexion admin, un paiement de test, un PDF et un téléversement d'image.

La migration et le démarrage de l'API sont séparés volontairement : plusieurs instances ne doivent pas tenter de migrer la base simultanément.

## Variables indispensables

- `DATABASE_URL`, avec TLS activé ;
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY` ;
- `SUPABASE_STORAGE_BUCKET` ;
- `CORS_ORIGIN` et `FRONTEND_URL` avec les domaines HTTPS réels ;
- `NODE_ENV=production`, `HOST=0.0.0.0` et `TRUST_PROXY=true` uniquement derrière un proxy maîtrisé.

Stripe et Resend restent facultatifs. S'ils sont activés, configurer le webhook Stripe, vérifier le domaine d'expédition et utiliser exclusivement des secrets de production côté serveur.

## Exploitation

- Exécuter `npm run privacy:anonymize` sans option pour prévisualiser les échéances, puis avec `-- --apply` après contrôle. Planifier ce job au moins une fois par mois.
- Sauvegarder PostgreSQL et définir une politique de restauration testée.
- Surveiller les réponses 5xx, les échecs de notifications et les événements Stripe non traités.
- Faire tourner les secrets immédiatement après une exposition ou un partage accidentel.
- Lancer `npm run verify` avant chaque mise en production ; la CI exécute la même commande sous Node 22.
