# Hotel Rivage - backend

Socle backend du projet Hotel Rivage : Node.js, TypeScript, Prisma et PostgreSQL 17.

## Demarrage local

```powershell
Copy-Item .env.example .env
docker compose up -d
npm install
npm run db:format
npm run db:validate
npm run db:generate
```

## Appliquer la base

La migration initiale est deja generee dans `prisma/migrations`. Elle inclut les contraintes PostgreSQL de dates, de montants et de non-chevauchement des chambres physiques :

```powershell
npx prisma migrate dev
npm run db:seed
```

`prisma/manual/room_allocation_constraints.sql` conserve une copie lisible des regles natives a reporter dans toute migration initiale regeneree. Prisma ne les exprime pas dans `schema.prisma`.

La conception detaillee se trouve dans `docs/architecture.md`.
