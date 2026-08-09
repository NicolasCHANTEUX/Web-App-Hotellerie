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

Renseigner dans `.env` la chaine PostgreSQL disponible dans `Supabase Dashboard > Connect`. La cle publique peut etre utilisee par un client soumis aux politiques RLS. La cle secrete reste exclusivement dans le backend et n'est pas necessaire pour Prisma.

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

`prisma/manual/room_allocation_constraints.sql` conserve une copie lisible des regles natives a reporter dans toute migration initiale regeneree. Prisma ne les exprime pas dans `schema.prisma`.

La conception detaillee se trouve dans `docs/architecture.md`.
