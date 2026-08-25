# Architecture Hôtel Rivage

## Vue d'ensemble

L'application est un monolithe modulaire TypeScript : React/Vite pour le site et l'administration, Fastify pour l'API et PostgreSQL/Supabase comme source de vérité. Prisma décrit le modèle et les migrations SQL conservent les contraintes PostgreSQL que le schéma seul ne peut pas exprimer.

Les principaux modules backend sont :

- `catalog` : types de chambres, équipements, options, tarifs et promotions ;
- `availability` : chambres physiques, holds, allocations et blocages ;
- `booking` : devis TTC, création idempotente et instantanés contractuels ;
- `payments` et `billing` : Stripe, règlements manuels, remboursements, factures et avoirs PDF ;
- `notifications` : outbox transactionnelle et livraison asynchrone ;
- `contact` : réception persistée des demandes publiques ;
- `admin` : authentification, autorisations, réservations, chambres et catalogue ;
- `media` : couvertures envoyées dans Supabase Storage ;
- `privacy` : échéances de conservation et anonymisation contrôlée.

## Réservation et disponibilité

Les périodes hôtelières utilisent toujours l'intervalle semi-ouvert `[arrivée, départ)`. Une sortie et une entrée le même jour sont donc compatibles.

Une demande publique est traitée dans une transaction `SERIALIZABLE`. Le serveur recalcule le montant, choisit une chambre physique libre, crée un `ReservationHold`, son `RoomAllocation`, puis la réservation `PENDING_PAYMENT`. La contrainte d'exclusion PostgreSQL empêche deux allocations actives de se chevaucher sur une même chambre. Les reprises après conflit sont bornées et idempotentes.

La création depuis l'administration réutilise exactement ce moteur de disponibilité et de tarification, avec une clé d'idempotence distincte par saisie. Elle convertit ensuite l'option en allocation confirmée, enregistre le canal (`PHONE`, `EMAIL`, `WALK_IN` ou `ADMIN`), fige l'acceptation des conditions et journalise l'administrateur à l'origine de l'opération.

Les noms, tarifs, taxes, conditions et options sont figés dans des instantanés. Une modification ultérieure du catalogue ne réécrit jamais une réservation historique.

## Prix, taxes et promotions

Le navigateur affiche le devis retourné par le serveur et ne calcule pas le montant contractuel. Les chambres et options sont configurées en prix TTC. La TVA incluse est ventilée par ligne ; les taxes additionnelles, notamment la taxe de séjour, sont détaillées puis incluses dans le total avant validation.

Les promotions sont rattachées aux types de chambres, bornées dans le temps et évaluées pour toute la période du séjour. Les réservations conservent le prix de référence, la réduction et le prix effectivement accepté.

## Paiements et facturation

Le mode manuel fonctionne sans prestataire externe. Lorsque Stripe est configuré, l'API crée une session Checkout et le webhook signé devient la source de vérité du paiement. `PaymentProviderEvent` garantit l'idempotence des événements et ne conserve qu'une empreinte du payload bancaire.

Les paiements réussis peuvent émettre une facture numérotée. Les remboursements créent un paiement inverse et un avoir distinct rattaché à la facture originale. Les documents sont générés côté serveur depuis leurs instantanés immuables.

## Messages et notifications

Les notifications sont écrites dans la même transaction que l'événement métier. Un worker les livre ensuite via le fournisseur configuré ; une panne d'e-mail ne peut donc pas annuler une réservation, un paiement ou une demande de contact.

Le formulaire public `POST /contact-requests` valide strictement les champs, exige le consentement, limite les tentatives, protège les reprises par clé d'idempotence et conserve chaque demande en base avant de notifier l'adresse de l'établissement.

## Administration et sécurité

Les routes `/admin/*` exigent un jeton Supabase Auth et une `AdminMembership` active. Les autorisations sont contrôlées côté serveur ; l'interface ne constitue jamais la barrière de sécurité. Les mutations sensibles utilisent un verrou optimiste lorsque nécessaire et écrivent un `AuditLog`.

Le planning croise les allocations de chambres sur quatorze jours avec les dossiers de réservation. `ADMIN` et `RECEPTION` peuvent ouvrir les séjours et exécuter les opérations quotidiennes. `HOUSEKEEPING` voit les occupations et blocages sans identité client. Le cycle opérationnel est explicite : `CONFIRMED` → `CHECKED_IN` le jour du séjour, puis `COMPLETED` à partir du départ ; les absences et annulations suivent des transitions contrôlées côté serveur.

Les tables applicatives ont RLS activée sans politique publique. Les secrets, jetons et mots de passe sont masqués dans les logs. Le rate limiting protège les créations de réservation, les connexions et les demandes de contact.

## Conservation des données

Les données de réservation suivent l'échéance comptable configurée, actuellement dix ans. Les demandes de contact sont conservées trois ans. La commande d'anonymisation reste en aperçu par défaut et ne modifie la base qu'avec `--apply`.

## Déploiement

Les migrations et le démarrage de l'API sont séparés. Une livraison applique d'abord `npm --prefix server run db:migrate:deploy`, puis démarre l'image construite depuis `server/Dockerfile`. Les validations locales et CI utilisent `npm run verify`.

La procédure complète, les variables d'environnement et le retour arrière sont documentés dans [deployment.md](./deployment.md).
