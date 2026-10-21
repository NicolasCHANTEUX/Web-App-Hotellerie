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

Chaque réservation reçoit une référence courte générée par le serveur, par exemple `BKG-7K3F9Q`, lisible au téléphone. Elle n'est pas secrète. La clé d'idempotence du client est conservée séparément et identifie les demandes rejouées.

La création depuis l'administration réutilise exactement ce moteur de disponibilité et de tarification, avec une clé d'idempotence distincte par saisie. Elle convertit ensuite l'option en allocation confirmée, enregistre le canal (`PHONE`, `EMAIL`, `WALK_IN` ou `ADMIN`), fige l'acceptation des conditions et journalise l'administrateur à l'origine de l'opération.

Les noms, tarifs, taxes, conditions et options sont figés dans des instantanés. Une modification ultérieure du catalogue ne réécrit jamais une réservation historique.

## Prix, taxes et promotions

Le navigateur affiche le devis retourné par le serveur et ne calcule pas le montant contractuel. Les chambres et options sont configurées en prix TTC. La TVA incluse est ventilée par ligne ; les taxes additionnelles, notamment la taxe de séjour, sont détaillées puis incluses dans le total avant validation.

La taxe de séjour est calculée nuit par nuit. Les dates d'une règle désignent sa première et sa dernière nuit, toutes deux incluses : un séjour à cheval sur un changement de tarif paie chaque nuit au tarif alors en vigueur, avec une ligne par règle. Un montant forfaitaire par séjour suit la règle en vigueur la nuit d'arrivée. Plusieurs règles actives sur les mêmes nuits s'additionnent, par exemple une taxe additionnelle. L'administration signale ces chevauchements, car ils viennent souvent d'un ancien tarif qu'on a oublié de terminer.

Les promotions sont rattachées aux types de chambres, bornées dans le temps et évaluées pour toute la période du séjour. Les réservations conservent le prix de référence, la réduction et le prix effectivement accepté.

## Paiements et facturation

Le mode manuel fonctionne sans prestataire externe. Lorsque Stripe est configuré, l'API crée une session Checkout et le webhook signé devient la source de vérité du paiement. `PaymentProviderEvent` garantit l'idempotence des événements et ne conserve qu'une empreinte du payload bancaire.

Un paiement traité après l'expiration de l'option, par exemple après une panne de l'API ou une relance de Stripe, confirme quand même le séjour si une chambre de la catégorie réservée est encore libre. Sinon, ou si la réservation avait été annulée, le paiement est enregistré comme reçu, sans facture, et l'établissement est alerté pour proposer une solution ou rembourser. L'événement est alors traité normalement, et Stripe ne le relance plus.

Les paiements réussis peuvent émettre une facture numérotée. Les remboursements créent un paiement inverse et un avoir distinct rattaché à la facture originale. Les documents sont générés côté serveur depuis leurs instantanés immuables.

## Messages et notifications

Les notifications sont écrites dans la même transaction que l'événement métier. Un worker les livre ensuite via le fournisseur configuré ; une panne d'e-mail ne peut donc pas annuler une réservation, un paiement ou une demande de contact.

L'adresse de l'établissement reçoit chaque nouvelle demande de réservation du site, avec un lien vers le dossier dans l'administration ; les réservations saisies par la réception n'en génèrent pas. Elle reçoit aussi les paiements à traiter manuellement. Une réponse à ces messages part directement au client.

Les e-mails adressés au client contiennent un lien personnel vers sa réservation. Le jeton d'accès figure après le `#` de l'URL, que le navigateur ne transmet jamais aux serveurs. Ce lien est calculé au moment de l'envoi et n'est pas stocké. Il permet notamment de payer en ligne plus tard, depuis un autre appareil.

Le formulaire public `POST /contact-requests` valide strictement les champs, exige le consentement, limite les tentatives, protège les reprises par clé d'idempotence et conserve chaque demande en base avant de notifier l'adresse de l'établissement.

## Administration et sécurité

Les routes `/admin/*` exigent un jeton Supabase Auth et une `AdminMembership` active. Le jeton d'accès est renouvelé de façon transparente avec le jeton de rafraîchissement Supabase, qui vérifie à chaque fois que le compte est toujours actif. La déconnexion révoque la session côté Supabase. Les deux jetons restent dans le `sessionStorage` de l'onglet. Les autorisations sont contrôlées côté serveur ; l'interface ne constitue jamais la barrière de sécurité. Les mutations sensibles utilisent un verrou optimiste lorsque nécessaire et écrivent un `AuditLog`.

Le planning croise les allocations de chambres sur quatorze jours avec les dossiers de réservation. `ADMIN` et `RECEPTION` peuvent ouvrir les séjours et exécuter les opérations quotidiennes. `HOUSEKEEPING` voit les occupations et blocages sans identité client. Le cycle opérationnel est explicite : `CONFIRMED` → `CHECKED_IN` le jour du séjour, puis `COMPLETED` à partir du départ ; les absences et annulations suivent des transitions contrôlées côté serveur.

`ADMIN` gère le catalogue : types de chambres, chambres et options du séjour. Une option modifiée ne s'applique qu'aux nouvelles demandes, car chaque réservation garde le nom et le prix acceptés. Une option déjà réservée peut seulement être désactivée : elle disparaît alors du site et de la saisie à la réception.

`ADMIN` gère aussi les paramètres de l'établissement : nom, coordonnées, horaires et mentions légales. L'API publique `/property` les expose, mise en cache une minute. La page Mentions légales liste ce qui manque encore. Les nouvelles factures recopient les mentions de l'émetteur, tandis que les factures déjà émises gardent leur en-tête figé. Le slug, le fuseau horaire et la devise ne se modifient pas depuis l'administration.

Les tables applicatives ont RLS activée sans politique publique. Les secrets, jetons et mots de passe sont masqués dans les logs. Une erreur inattendue est journalisée côté serveur, mais le client ne reçoit qu'un message générique `INTERNAL_ERROR`, sans détail technique. Les requêtes venant d'une origine absente de `CORS_ORIGIN` sont refusées en 403. Le rate limiting protège les créations de réservation, les connexions et les demandes de contact ; une limite atteinte renvoie 429 `RATE_LIMITED`.

## Conservation des données

Les données de réservation suivent l'échéance comptable configurée, actuellement dix ans. Les demandes de contact sont conservées trois ans. La commande d'anonymisation reste en aperçu par défaut et ne modifie la base qu'avec `--apply`.

## Déploiement

Les migrations et le démarrage de l'API sont séparés. Une livraison applique d'abord `npm --prefix server run db:migrate:deploy`, puis démarre l'image construite depuis `server/Dockerfile`. Les validations locales et CI utilisent `npm run verify`.

La procédure complète, les variables d'environnement et le retour arrière sont documentés dans [deployment.md](./deployment.md).
