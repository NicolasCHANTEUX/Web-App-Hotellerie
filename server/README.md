# Hotel Rivage - backend

Socle backend du projet Hotel Rivage : Node.js, TypeScript, Prisma et PostgreSQL heberge par Supabase.

## Configuration Supabase

```powershell
Copy-Item .env.example .env
npm install
npm run db:format
npm run db:validate
npm run db:generate
```

Renseigner dans `.env` la chaine PostgreSQL disponible dans `Supabase Dashboard > Connect`. La cle publique sert a Supabase Auth. La cle secrete reste exclusivement dans le backend ; Prisma ne l'utilise pas, mais le script de provisionnement administrateur en a besoin.

## Appliquer la base

La migration initiale est deja generee dans `prisma/migrations`. Elle inclut les contraintes PostgreSQL de dates, de montants et de non-chevauchement des chambres physiques :

```powershell
npx prisma migrate dev
npm run db:seed
```

Sans chaine PostgreSQL, les memes fichiers peuvent etre executes dans le SQL Editor Supabase, dans cet ordre :

1. `supabase/migrations/20260808193000_init.sql`
2. `supabase/seed.sql`
3. `supabase/verify.sql` pour controler l'installation

La migration active RLS sur toutes les tables sans creer de politique publique. Les appels REST publics sont donc refuses par defaut jusqu'a l'ajout volontaire de politiques.

## API locale

```powershell
npm run dev
```

Routes disponibles :

- `GET /health`
- `GET /room-types`
- `GET /room-types/:slug`
- `GET /extras`
- `GET /availability?arrival=2026-08-08&departure=2026-08-09&adults=2&children=0`
- `POST /bookings`
- `POST /admin/auth/login`
- `GET /admin/me`
- `GET /admin/bookings`
- `GET /admin/bookings/:id`
- `POST /admin/bookings/:id/confirm`
- `GET /admin/rooms?from=2026-08-24&to=2026-08-27&sortOrder=asc`
- `POST /admin/rooms` (`ADMIN` uniquement)
- `PATCH /admin/rooms/:id` (`ADMIN` uniquement)
- `DELETE /admin/rooms/:id` (`ADMIN` uniquement)

Toutes les routes `/admin/*`, sauf la connexion, exigent un jeton Supabase Auth et une appartenance `AdminMembership` active pour l'etablissement. Les reservations et leurs coordonnees sont limitees aux roles `ADMIN` et `RECEPTION`; les autres roles ne voient que l'inventaire des chambres et une identite minimale d'occupation.

La periode `from` / `to` de `/admin/rooms` est optionnelle, mais les deux dates doivent etre fournies ensemble. Le calcul utilise l'intervalle hotelier `[from, to)` : le jour d'arrivee est inclus et le jour de depart est reutilisable. La periode est limitee a 366 nuits. `sortOrder` accepte `asc` (par defaut) ou `desc` et trie les numeros de chambre.

La modification d'une chambre utilise une version optimiste. Le client doit renvoyer exactement le `updatedAt` recu dans la liste, avec au moins un champ editable :

```json
{
  "updatedAt": "2026-08-22T09:15:30.123Z",
  "number": "204",
  "roomTypeId": "123e4567-e89b-42d3-a456-426614174000",
  "floor": 2,
  "status": "ACTIVE",
  "notes": null
}
```

Le JSON est strict : seuls `updatedAt`, `number`, `roomTypeId`, `floor`, `status` et `notes` sont acceptes. Une version obsolete ou un numero duplique renvoie `409`. Le changement de type et le passage a `OUT_OF_SERVICE` sont refuses lorsqu'une reservation ou une option valide actuelle ou future existe, mais restent compatibles avec un blocage operationnel. Le passage a `ARCHIVED` exige en plus l'absence de tout blocage actuel ou futur. Chaque modification reussie est inscrite dans `AuditLog`.

La creation d'une chambre accepte un JSON strict sans `updatedAt`. `number` et `roomTypeId` sont obligatoires; `floor` et `notes` valent `null` par defaut, et `status` vaut `ACTIVE`. Une nouvelle chambre peut etre `ACTIVE` ou `OUT_OF_SERVICE`, mais pas directement `ARCHIVED`. Le type doit appartenir a l'etablissement et le numero doit etre unique, y compris parmi les chambres archivees :

```json
{
  "number": "205",
  "roomTypeId": "123e4567-e89b-42d3-a456-426614174000",
  "floor": 2,
  "status": "ACTIVE",
  "notes": null
}
```

La suppression utilise elle aussi `updatedAt` comme verrou optimiste :

```json
{
  "updatedAt": "2026-08-22T09:15:30.123Z"
}
```

Une chambre n'est supprimee physiquement que si elle n'a jamais ete reliee a une reservation, une option, un blocage de disponibilite ou une allocation, meme passee. Sinon l'API renvoie `409 ROOM_HAS_HISTORY` et demande de l'archiver. Aucune donnee metier n'est supprimee en cascade. Les creations et suppressions sont transactionnelles et produisent respectivement les actions `ROOM_CREATED` et `ROOM_DELETED` dans `AuditLog`.

Une demande publique cree une option de chambre de 24 heures au statut `PENDING_PAYMENT`. La reception peut la confirmer manuellement depuis le detail : le hold est alors converti en allocation de reservation et l'action est journalisee. Les holds expires sont liberes et passent au statut `EXPIRED` lors des lectures ou creations suivantes.

## Premier acces administrateur

1. Creer l'utilisateur et son mot de passe dans `Supabase Dashboard > Authentication > Users`.
2. Depuis le dossier `server`, rattacher cet utilisateur a l'hotel :

```powershell
npm run admin:provision -- --email admin@example.com --property hotel-rivage --role ADMIN --display-name "Prenom Nom"
```

Le script ne cree jamais d'identifiants Supabase. Ajouter `--dry-run` permet de verifier le rattachement sans aucune ecriture.

L'interface est ensuite disponible sur `http://127.0.0.1:5173/admin`.

Pour remplir volontairement l'admin avec quatre reservations de demonstration idempotentes :

```powershell
npm run db:seed:demo
```

Cette commande ecrit dans la base configuree par `DATABASE_URL`; elle n'est jamais executee automatiquement.

## Avant une mise en production publique

Le limiteur actuel est adapte au MVP mono-instance : trois demandes par heure et par IP, plus deux demandes actives maximum pour une meme adresse e-mail ou un meme telephone. Avant exposition publique, ajouter un challenge anti-bot et un store de rate-limit partage entre instances.

Si l'API est placee derriere un reverse proxy de confiance, definir `TRUST_PROXY=true` pour que le limiteur lise l'adresse client transmise par ce proxy. Le laisser a `false` lorsque l'API est directement accessible.

La page de confidentialite signale qu'aucune purge de conservation n'est encore automatisee. Definir puis tester cette politique avant de collecter de vraies donnees personnelles.

## Verifications

```powershell
npm run typecheck
npm test
```

`prisma/manual/room_allocation_constraints.sql` conserve une copie lisible des regles natives a reporter dans toute migration initiale regeneree. Prisma ne les exprime pas dans `schema.prisma`.

La conception detaillee se trouve dans `docs/architecture.md`.
