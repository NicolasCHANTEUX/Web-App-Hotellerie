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

Les migrations sont versionnees dans `prisma/migrations`. La migration initiale inclut les contraintes PostgreSQL de dates, de montants et de non-chevauchement des chambres physiques. La migration `business_foundation_v2` ajoute le detail fiscal, les conditions contractuelles figees, la facturation multi-documents, les evenements de paiement et les metadonnees de stockage :

Sur une base locale ou de developpement isolee :

```powershell
npm run db:migrate
npm run db:seed
```

Sur une base Supabase partagee, faire d'abord une sauvegarde puis appliquer uniquement les migrations versionnees :

```powershell
npm run db:migrate:status
npm run db:migrate:deploy
```

Le lancement `dev:full` ne migre jamais la base automatiquement. Toujours vérifier `npm run db:migrate:status` avant de démarrer une version qui contient une nouvelle migration.

Si une base creee avant l'adoption de Prisma Migrate contient deja le schema initial mais que `db:migrate:status` annonce encore `20260808193000_init`, verifier d'abord le socle sans aucune ecriture :

```powershell
npm run db:migrate:baseline-check
```

La commande controle les 20 tables initiales, les contraintes critiques et RLS. Ce n'est qu'apres un resultat sans element manquant que la migration initiale peut etre marquee comme deja appliquee avec `npx prisma migrate resolve --applied 20260808193000_init`. Ne jamais utiliser `resolve` pour masquer une migration partiellement appliquee.

`prisma/migrations` est l'unique historique de migrations. Les anciens fichiers de `supabase/migrations` sont des instantanes historiques et ne doivent plus etre appliques en parallele. Le SQL Editor Supabase peut toujours servir aux requetes de diagnostic, mais toute evolution de schema doit etre creee et versionnee avec Prisma Migrate.

La migration active RLS sur toutes les tables sans creer de politique publique. Les appels REST publics sont donc refuses par defaut jusqu'a l'ajout volontaire de politiques.

## API locale

```powershell
npm run dev
```

Routes disponibles :

- `GET /health/live` (processus API disponible, sans interroger PostgreSQL)
- `GET /health`
- `GET /room-types`
- `GET /room-types/:slug`
- `GET /extras`
- `GET /property` (coordonnées publiques, horaires et nombre de chambres actives de `PUBLIC_PROPERTY_SLUG`)
- `GET /availability?arrival=2026-08-08&departure=2026-08-09&adults=2&children=0`
- `POST /quotes`
- `POST /bookings`
- `POST /contact-requests`
- `GET /payments/config`
- `POST /payments/stripe/checkout`
- `GET /payments/stripe/status?sessionId=cs_...`
- `POST /payments/stripe/webhook`
- `POST /admin/auth/login`
- `GET /admin/me`
- `GET /admin/bookings`
- `GET /admin/booking-options?arrival=2026-08-25&departure=2026-08-26&adults=2&children=0`
- `POST /admin/booking-quotes`
- `POST /admin/bookings` (`ADMIN` et `RECEPTION`, clé `Idempotency-Key` UUID obligatoire)
- `GET /admin/bookings/:id`
- `POST /admin/bookings/:id/quote`
- `PATCH /admin/bookings/:id`
- `POST /admin/bookings/:id/confirm`
- `PATCH /admin/bookings/:id/status`
- `GET /admin/bookings/:id/available-rooms`
- `PATCH /admin/bookings/:id/room`
- `POST /admin/bookings/:id/payments/manual`
- `POST /admin/bookings/:id/refunds`
- `GET /admin/bookings/:id/invoices`
- `GET /admin/invoices/:id/pdf`
- `GET /admin/rooms?from=2026-08-24&to=2026-08-27&sortOrder=asc`
- `GET /admin/room-types`
- `POST /admin/media/room-type-cover` (`ADMIN` uniquement, JPEG/PNG/WebP, 5 Mo maximum)
- `POST /admin/room-types` (`ADMIN` uniquement)
- `PATCH /admin/room-types/:id` (`ADMIN` uniquement)
- `DELETE /admin/room-types/:id` (`ADMIN` uniquement)
- `POST /admin/rooms` (`ADMIN` uniquement)
- `PATCH /admin/rooms/:id` (`ADMIN` uniquement)
- `DELETE /admin/rooms/:id` (`ADMIN` uniquement)

Toutes les routes `/admin/*`, sauf la connexion, exigent un jeton Supabase Auth et une appartenance `AdminMembership` active pour l'etablissement. `ADMIN` et `RECEPTION` pilotent les sejours et voient les coordonnees clients. `ACCOUNTING` dispose d'une vue financiere des reservations, paiements, factures et avoirs, sans coordonnees clients, demandes particulieres ni actions operationnelles. Les identites d'occupation restent masquees dans la vue des chambres pour `ACCOUNTING` et `HOUSEKEEPING`.

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

La création depuis l'administration est disponible aux rôles `ADMIN` et `RECEPTION`. Les disponibilités, options et devis sont toujours recalculés pour l'établissement de l'utilisateur connecté. `POST /admin/bookings` crée la réservation de façon idempotente, attribue une chambre physique libre, confirme immédiatement le séjour et enregistre la source (`PHONE`, `EMAIL`, `WALK_IN` ou `ADMIN`) ainsi que l'acceptation des CGV. Le téléphone est obligatoire pour le canal `PHONE`, l'e-mail pour `EMAIL`; ils restent facultatifs pour une arrivée sur place ou une saisie interne. L'interface conserve la même clé lors d'une relance réseau afin d'éviter tout doublon.

Le planning `/admin/planning` affiche quatorze jours d'allocations par chambre. Les rôles opérationnels peuvent ouvrir un dossier depuis une occupation ; `HOUSEKEEPING` voit uniquement les mouvements anonymisés. Une réservation confirmée passe à `CHECKED_IN` uniquement pendant sa période de séjour, puis à `COMPLETED` à partir du jour de départ. Le statut `NO_SHOW` n'est disponible qu'à partir de l'arrivée. Ces transitions libèrent les allocations seulement lorsqu'elles deviennent terminales et sont toutes inscrites dans `AuditLog`.

Chaque nouvelle reservation conserve maintenant une ventilation fiscale immuable (`BookingTaxLine`) et une copie des conditions acceptees. Le taux d'une option peut differer de celui de la chambre; lorsqu'il n'est pas renseigne, le taux du plan tarifaire reste utilise pour conserver le comportement historique. Une taxe de sejour n'entre dans le prix que si une `TaxRule` active et valide pour toute la periode a ete configuree. Les pages client, l'API et l'admin utilisent alors la meme ventilation et le meme arrondi par ligne.

Le modele de facturation accepte plusieurs documents par reservation, les avoirs rattaches a leur facture d'origine et une sequence annuelle par etablissement. Une facture immuable est emise lorsque le solde est enregistre; un remboursement total ou partiel cree un avoir distinct et conserve l'original. Les PDF sont generes cote serveur depuis ces instantanes et telecharges par une route admin protegee. `StoredFile` reste disponible pour une future copie d'archivage privee. `PaymentProviderEvent` conserve l'identifiant fournisseur et une empreinte de payload, jamais le contenu bancaire brut.

La modification d'une reservation est reservee aux roles `ADMIN` et `RECEPTION` et aux statuts `PENDING_PAYMENT` ou `CONFIRMED`. Le client envoie le `updatedAt` courant comme verrou optimiste. Le serveur recalcule toujours la disponibilite, le tarif, les options et les taxes; il conserve la chambre physique actuelle lorsqu'elle reste compatible. Une reservation possedant deja un paiement ou une facture ne peut plus etre retarifee, mais ses coordonnees et demandes particulieres restent modifiables. La mise a jour est transactionnelle : allocation ou hold, instantanes tarifaires, lignes fiscales, journal d'audit et notification client sont valides ensemble.

## Paiements et notifications optionnels

Le mode manuel fonctionne sans service externe. Stripe n'est propose au client que lorsque les deux variables suivantes sont presentes :

```dotenv
STRIPE_SECRET_KEY="sk_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
BOOKING_ACCESS_TOKEN_SECRET="une-valeur-aleatoire-longue-et-dediee"
```

Le webhook Stripe doit pointer vers `POST /payments/stripe/webhook` et ecouter les evenements Checkout, Payment Intent et Refund (`refund.created`, `refund.updated`, `refund.failed`). La signature porte sur le corps brut et chaque evenement est traite de facon idempotente. Les metadonnees Stripe ne contiennent que les identifiants techniques de la reservation et du paiement. Ne jamais placer ces cles dans une variable `VITE_*`.

`BOOKING_ACCESS_TOKEN_SECRET` signe les jetons opaques permettant au client de reprendre sa reservation apres une actualisation ou un retour Stripe. Cette valeur est obligatoire en production et sa rotation invalide les anciens jetons publics.

Après Checkout, Stripe renvoie le navigateur avec son identifiant de session. La page de confirmation interroge `GET /payments/stripe/status` pendant quelques secondes et affiche uniquement l'état persistant produit par le webhook. L'identifiant Checkout et la référence fournisseur du paiement sont conservés séparément afin que cette vérification reste possible après confirmation.

Les e-mails passent par la table transactionnelle `notifications`. Une panne d'envoi n'annule donc jamais une reservation ou un paiement. Trois modes sont disponibles :

```dotenv
NOTIFICATION_DELIVERY="disabled" # defaut, les messages restent en attente
NOTIFICATION_DELIVERY="log"      # marque les messages comme envoyes sans contacter un client
NOTIFICATION_DELIVERY="resend"   # envoi reel, exige RESEND_API_KEY et EMAIL_FROM
```

Le worker traite les messages par petits lots, reprend les envois interrompus et applique un delai progressif apres un echec. Tester d'abord `log`, puis le domaine d'expedition Resend, avant d'activer `resend`.

En local et sur une API unique, `BACKGROUND_WORKER_MODE=embedded` conserve ce worker dans le processus Fastify. Pour plusieurs instances, utiliser `BACKGROUND_WORKER_MODE=standalone` sur l'API et lancer un seul processus dedie avec `npm run worker:notifications` en developpement ou `npm run start:notifications` apres compilation.

Le formulaire public enregistre chaque demande dans `contact_requests` avant de créer la notification destinée à l'établissement. Il exige une clé `Idempotency-Key` UUID, applique une limite de cinq demandes par heure et utilise `PUBLIC_PROPERTY_SLUG` pour sélectionner l'établissement destinataire.

## Images du catalogue

Les couvertures téléversées depuis l'administration sont validées d'après leur signature réelle, limitées à 5 Mo puis envoyées dans le bucket Supabase Storage public défini par `SUPABASE_STORAGE_BUCKET`. Seule l'URL publique est conservée dans `RoomType`; les métadonnées et l'empreinte SHA-256 sont enregistrées dans `StoredFile`.

Le worker d'arriere-plan purge aussi les anciennes couvertures remplacees et les fichiers televerses qui ne sont rattaches a aucun type de chambre apres 24 heures. L'horodatage `purgedAt` rend cette operation observable et idempotente.

Pour vérifier les anciennes images encore intégrées en base64, puis les migrer explicitement :

```powershell
npm run media:migrate
npm run media:migrate -- --apply
```

## Conservation des données personnelles

Chaque réservation reçoit une échéance de conservation de dix ans après le départ. L'émission ultérieure d'une facture ou d'un avoir repousse cette échéance à dix ans après le document. Le traitement d'anonymisation retire les coordonnées client, les demandes particulières, les destinataires de notifications et les instantanés client des factures, sans supprimer l'historique financier ou les journaux d'audit.

Les demandes de contact ont une échéance distincte de trois ans. La même commande anonymise leur identité, leurs coordonnées, leur message et la notification associée lorsqu'elles arrivent à échéance.

La commande est toujours en aperçu par défaut :

```powershell
npm run privacy:anonymize
npm run privacy:anonymize -- --apply
```

Planifier l'exécution avec `--apply` seulement après validation de la politique définitive par l'exploitant.

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

Compléter l'identité juridique, la médiation, les conditions tarifaires et la politique de confidentialité avant toute ouverture commerciale. La commande d'anonymisation doit ensuite être planifiée et supervisée ; elle ne s'exécute jamais implicitement au démarrage de l'API.

## Verifications

```powershell
npm run typecheck
npm test
```

À la racine du projet, `npm run verify` ajoute le build frontend et les tests de rendu. La procédure Docker et la liste des variables de production sont dans `../docs/deployment.md`.

`prisma/manual/room_allocation_constraints.sql` conserve une copie lisible des regles natives a reporter dans toute migration initiale regeneree. Prisma ne les exprime pas dans `schema.prisma`.

La conception detaillee se trouve dans `docs/architecture.md`.
