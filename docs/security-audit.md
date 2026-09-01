# Audit des dépendances

État vérifié le 2 septembre 2026 avec `npm audit --omit=dev`.

## Frontend

L'audit ne signale aucune vulnérabilité connue.

## Backend

Npm remonte cinq occurrences de sévérité haute, issues de deux avis transitifs du paquet CLI `prisma` 7.9.1 :

- `deepmerge-ts` 7.1.5 via `@prisma/config` : épuisement de pile avec un graphe récursif non fiable ;
- `mysql2` 3.15.3 via `prisma` : repli possible vers `mysql_clear_password`.

L'application s'exécute sur PostgreSQL avec `@prisma/adapter-pg` et ne configure aucune connexion MySQL. `@prisma/config` intervient dans les commandes de génération et de migration à partir de fichiers contrôlés par le dépôt. Ces constats réduisent l'exposition de l'application, sans annuler les avis.

Npm ne propose actuellement aucun correctif pour ces deux avis. Un downgrade forcé n'est pas appliqué automatiquement, car il modifierait le client, le générateur et le système de configuration déjà validés en Prisma 7. La commande `npm audit fix --force` ne doit pas être utilisée.

À chaque mise à jour stable de Prisma :

1. vérifier les versions transitives de `deepmerge-ts` et `mysql2` ;
2. relancer `npm audit --omit=dev` ;
3. exécuter `npm run verify` et les migrations sur une base de test avant mise en production.
