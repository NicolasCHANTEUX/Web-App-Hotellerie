# Déploiement

Avant de préparer une nouvelle installation, compléter la [fiche d'onboarding établissement](./onboarding-establishment.md).

## Architecture recommandée

- Construire le frontend Vite comme site statique avec `npm run build:production`. Cette commande refuse une URL canonique absente ou locale.
- Déployer l'API Fastify séparément depuis `server/Dockerfile`.
- Définir `VITE_API_URL` avec l'URL HTTPS publique de l'API, ou router `/api` vers l'API sur le même domaine.
- Définir `VITE_PUBLIC_SITE_URL` avec l'origine HTTPS canonique du site ; le build l'utilise pour `robots.txt`, `sitemap.xml`, les URL canoniques et les métadonnées sociales.
- Rendre l'API publique accessible pendant le build pour alimenter le HTML initial et ajouter automatiquement les hébergements publiés au sitemap. Les données de l'API sont prioritaires. Si elle est inaccessible, définir `VITE_PUBLIC_PROPERTY_NAME`, `VITE_PUBLIC_PROPERTY_CITY` et `VITE_PUBLIC_ROOM_SLUGS` comme fallbacks de build.
- Définir au besoin `VITE_PUBLIC_META_DESCRIPTION` et `VITE_PUBLIC_SOCIAL_IMAGE` pour personnaliser la description et l'image sociale statiques. L'image peut être une URL absolue ou un chemin public du frontend.
- Conserver PostgreSQL, Auth et le bucket public `hotel-public` dans le même projet Supabase.

Node.js 22 est la version de référence pour le développement local, la CI et l'image Docker. Le transport WebSocket explicite du SDK Supabase reste utilisé par le backend.

## Projet Vercel avec services

Choisir le framework **Services** dans les reglages du projet Vercel. Le fichier `vercel.json` declare `app` (Vite, racine du depot) et `server` (Fastify, `server/Dockerfile.vercel`). Les routes publiques `/api/*` vont au serveur ; toutes les autres vont au site. La regle interne du service Vite renvoie les routes de l'application React vers `index.html`.

Le navigateur appelle l'API publique sur le meme domaine avec `/api`. Laisser `VITE_API_URL` absente dans Vercel, ou lui donner `/api`. Aucun binding entre services n'est necessaire actuellement : il n'existe pas d'appel serveur-vers-serveur. Le generateur SEO s'execute pendant le build, avant la disponibilite des bindings ; fournir `VITE_PUBLIC_SITE_URL`, `VITE_PUBLIC_PROPERTY_NAME` et, si necessaire, `VITE_PUBLIC_ROOM_SLUGS` pour ses metadonnees et son sitemap.

Configurer les variables de production du backend indiquees ci-dessous dans Vercel, notamment `DATABASE_URL`, les cles Supabase, `BOOKING_ACCESS_TOKEN_SECRET`, `BOOKING_REFERENCE_PREFIX` et `TRUST_PROXY`. Donner a `FRONTEND_URL` et `CORS_ORIGIN` l'origine HTTPS publique du site (ajouter les origines de preview si elles doivent fonctionner). Ne pas definir manuellement `PORT`, `HOST`, `NODE_ENV` ou `BACKGROUND_WORKER_MODE` : l'image Vercel les definit. Le backend en conteneur ecoute sur le port 80 et desactive son worker integre, car Vercel peut demarrer plusieurs instances et les arreter entre les requetes.

Appliquer les migrations Prisma avant le deploiement avec la cible `migrate` du Dockerfile habituel. La migration des compteurs de limitation est obligatoire : sans elle, les routes limitees refusent les requetes. Si les notifications ou la purge des images sont utilisees, executer le worker `start:notifications` sur un hebergement de processus permanent. Apres deploiement, verifier `/api/health/live`, `/api/health`, `/api/property`, les routes React en acces direct et le webhook Stripe sur `/api/payments/stripe/webhook` si Stripe est active.

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
5. Construire le frontend avec `VITE_API_URL=https://api.exemple.fr`, `VITE_PUBLIC_SITE_URL=https://www.exemple.fr` et `npm run build:production`, puis exécuter `npm run seo:verify` et publier `dist/`.
6. Tester une recherche, une demande de réservation, l'ouverture du lien reçu par e-mail, la connexion admin, un paiement de test, un PDF et un téléversement d'image. Les liens des e-mails sont construits à partir de `FRONTEND_URL` : vérifier qu'il s'agit bien du domaine public du site.

La migration et le démarrage de l'API sont séparés volontairement : plusieurs instances ne doivent pas tenter de migrer la base simultanément.

## Variables indispensables

- `DATABASE_URL`, avec TLS activé ;
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` et `SUPABASE_SECRET_KEY` ;
- `SUPABASE_STORAGE_BUCKET` ;
- `CORS_ORIGIN` et `FRONTEND_URL` avec les domaines HTTPS réels ;
- `PUBLIC_PROPERTY_SLUG`, correspondant à l'établissement affiché par le site public : le catalogue, la recherche, les devis et les réservations du site ne portent que sur lui ;
- `BOOKING_REFERENCE_PREFIX`, composé de 2 à 8 lettres majuscules ou chiffres et choisi avec l'établissement ;
- `BACKGROUND_WORKER_MODE=embedded` pour une seule instance, ou `standalone` lorsque les traitements sont exécutés par un processus dédié ;
- `NODE_ENV=production` et `HOST=0.0.0.0` ;
- `TRUST_PROXY`, obligatoire en production : `false` si les clients atteignent directement l'API, sinon le nombre de proxies placés devant elle (`1` sur la plupart des hébergeurs) ou leurs adresses. Sans ce réglage derrière un proxy, tous les visiteurs partagent les mêmes limites de tentatives.

Dans Supabase, `Authentication > URL Configuration` doit indiquer l'origine publique comme `Site URL` et autoriser `https://<domaine>/admin/activation` dans `Redirect URLs` : c'est la page des liens d'invitation et de réinitialisation du mot de passe. Supabase envoie ces e-mails lui-même. Son serveur d'envoi intégré n'accepte que quelques messages par heure : configurer un SMTP (`Authentication > Emails > SMTP Settings`, par exemple celui de Resend) et traduire en français les modèles « Invite user » et « Reset password ».

L'adresse e-mail de l'établissement (`Property.email`) reçoit les messages du formulaire de contact, chaque nouvelle demande de réservation du site et les paiements en ligne qui n'ont pas pu confirmer automatiquement un séjour. Elle doit donc être relevée chaque jour.

Stripe et Resend restent facultatifs. S'ils sont activés, configurer le webhook Stripe, vérifier le domaine d'expédition et utiliser exclusivement des secrets de production côté serveur.

## Exploitation

Le CDN ou serveur statique qui publie `dist/` doit envoyer la politique CSP du projet en en-tête HTTP, ainsi que `Strict-Transport-Security`, `Referrer-Policy`, `Permissions-Policy` et `X-Content-Type-Options`. La balise CSP de `index.html` reste une protection de repli et ne remplace pas ces en-têtes de production.

Le frontend utilise l'historique HTML5. Toute route qui ne correspond pas à un fichier statique doit donc être réécrite vers `index.html` :

```nginx
location / {
  try_files $uri $uri/ /index.html;
}
```

Le fichier `public/_redirects`, copié dans `dist/`, fournit la règle équivalente pour Netlify et Cloudflare Pages. Sur Vercel, configurer une rewrite de `/(.*)` vers `/index.html`. Après déploiement, tester impérativement un accès direct et un rafraîchissement sur `/contact`, `/hebergements/...` et `/admin/connexion`.

Si l'API est exposée sous `/api` sur le même domaine, sa route ou son proxy doit être déclaré avant le catch-all SPA. Vérifier explicitement que `/api/property` renvoie du JSON et jamais `index.html`.

En production avec plusieurs instances API, définir `BACKGROUND_WORKER_MODE=standalone` partout puis lancer exactement un processus dédié :

```sh
npm --prefix server run start:notifications
```

Ce processus traite l'outbox de notifications et purge chaque heure les images de catalogue remplacées, ainsi que les téléversements restés sans rattachement pendant plus de 24 heures. Le mode `embedded` reste le comportement par défaut pour le développement et les déploiements mono-instance.

- Exécuter `npm run privacy:anonymize` sans option pour prévisualiser les échéances, puis avec `-- --apply` après contrôle. Planifier ce job au moins une fois par mois.
- Sauvegarder PostgreSQL et définir une politique de restauration testée.
- Surveiller les réponses 5xx, les échecs de notifications et les événements Stripe non traités.
- Faire tourner les secrets immédiatement après une exposition ou un partage accidentel.
- Lancer `npm run verify`, `npm run test:integration` (sur une base jetable) et `npm run test:e2e` avant chaque mise en production. La CI exécute indépendamment les validations de code, le build strict et les smokes d'une part, puis Playwright d'autre part, afin qu'un échec reste visible dans chaque famille de tests.
