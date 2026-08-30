# Migration source of truth

The canonical migration history is `server/prisma/migrations` and must be applied with:

```bash
npm run db:migrate:deploy
```

The SQL files in this directory are retained only as historical Supabase SQL Editor snapshots. Do not apply them in addition to Prisma migrations and do not add new migrations here.
