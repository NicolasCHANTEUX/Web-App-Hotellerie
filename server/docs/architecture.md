# Architecture backend V1

## Direction

Le backend est un monolithe modulaire Node.js/TypeScript. Le site public et la future administration utilisent le meme domaine, la meme base PostgreSQL et les memes regles de disponibilite et de prix.

Modules prevus :

- `catalog`: etablissements, categories, chambres, equipements et options;
- `availability`: recherche, allocations, blocages et holds;
- `pricing`: plans tarifaires et calcul serveur;
- `booking`: tunnel, voyageurs et cycle de vie de la reservation;
- `payment`: paiements, remboursements et webhooks;
- `billing`: factures et lignes comptables;
- `identity`: comptes et roles administrateur;
- `audit`: historique des actions sensibles.

## Inventaire

`RoomType` est la categorie vendue au client. `Room` est une unite physique. La V1 affecte une chambre physique lorsqu'un hold est cree, puis transfere cette allocation a la reservation. Une future administration pourra reaffecter la chambre dans une transaction sans changer la categorie achetee.

## Periodes

Toutes les occupations utilisent l'intervalle semi-ouvert `[checkIn, checkOut)`. Une sortie le 12 et une entree le 12 sont donc compatibles.

`RoomAllocation` est la source unique d'occupation d'une chambre physique. Elle pointe exactement vers l'un de ces objets :

- `BookingRoom` pour une reservation;
- `ReservationHold` pour une retenue temporaire;
- `AvailabilityBlock` pour une fermeture interne.

La contrainte PostgreSQL `room_allocations_no_active_overlap` interdit deux allocations `ACTIVE` qui se chevauchent pour une meme chambre. Les contraintes SQL natives sont conservees dans `prisma/manual/room_allocation_constraints.sql` et doivent etre ajoutees a la migration initiale generee.

## Disponibilite

La recherche recoit `property`, `arrival`, `departure`, `adults` et `children`. Elle :

1. valide les dates et la capacite;
2. ignore les holds expires;
3. calcule les chambres physiques sans allocation active chevauchante;
4. regroupe le resultat par `RoomType`;
5. demande au module `pricing` le prix serveur;
6. retourne le nombre d'unites disponibles et un detail tarifaire.

Le navigateur ne calcule jamais la disponibilite finale ni le montant contractuel.

## Creation de reservation

Le passage au paiement s'effectuera dans une transaction `Serializable` avec retry borne :

1. recalcul du tarif;
2. selection d'une chambre physique encore libre;
3. creation du hold et de son allocation active;
4. creation de la reservation `PENDING_PAYMENT` et des snapshots de prix;
5. conversion atomique de l'allocation du hold vers `BookingRoom` apres confirmation du paiement.

Une violation de la contrainte d'exclusion signifie que la chambre vient d'etre prise. Le service recommence avec une autre unite ou renvoie une indisponibilite propre.

## Snapshots

Les noms, tarifs unitaires, taxes et totaux utilises sont recopies dans les lignes de reservation et dans `Booking.pricingSnapshot`. Modifier le catalogue ou les tarifs plus tard ne change jamais une reservation historique.

## Cycle de vie V1

```text
DRAFT -> PENDING_PAYMENT -> CONFIRMED -> COMPLETED
                       |-> EXPIRED
                       |-> CANCELLED
```

Le navigateur ne confirme pas une reservation. A terme, seul un evenement serveur de paiement valide pourra faire passer `PENDING_PAYMENT` a `CONFIRMED`.

## Ordre d'implementation

1. Migration initiale et seed Hotel Rivage.
2. `GET /room-types` et contrats de reponse.
3. `GET /availability` et tests des bornes de dates.
4. Pricing et snapshots.
5. Holds, creation de reservation et tests concurrents.
6. Paiement, webhook, confirmation et email.
7. Authentification et administration sur les memes services metier.
