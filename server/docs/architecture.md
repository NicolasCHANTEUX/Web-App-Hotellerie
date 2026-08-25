# Architecture backend

Le document de référence à jour se trouve dans [`../../docs/architecture.md`](../../docs/architecture.md). Cette page conserve les invariants propres au backend.

## Invariants métier

- PostgreSQL est la source de vérité pour l'inventaire, les disponibilités, les réservations, les paiements et les documents.
- Une occupation utilise l'intervalle `[checkIn, checkOut)` et une `RoomAllocation` active.
- La contrainte `room_allocations_no_active_overlap` interdit les conflits concurrents sur une chambre physique.
- Le prix contractuel est recalculé côté serveur et figé avec sa ventilation fiscale et ses conditions.
- Une réservation, une facture et un avoir historiques ne sont pas réécrits lors d'une modification du catalogue.
- Les événements Stripe, créations publiques et opérations de remboursement doivent être idempotents.
- Les notifications passent par l'outbox et sont livrées hors de la transaction métier.
- Toute route administrateur contrôle l'établissement et le rôle côté serveur. Le rôle `ACCOUNTING` peut lire et gérer les éléments financiers d'une réservation, mais ne reçoit pas les coordonnées clients et ne peut ni confirmer un séjour, ni affecter une chambre, ni modifier son cycle de vie.
- Toute action sensible produit un `AuditLog`.

## Cycle de vie actuel

```text
DRAFT -> PENDING_PAYMENT -> CONFIRMED -> COMPLETED
                       |-> EXPIRED
                       |-> CANCELLED
                       |-> NO_SHOW
```

Le paiement Stripe est confirmé exclusivement par webhook signé. La réception peut confirmer une option manuellement lorsque le règlement est traité hors ligne.

## Migrations

Les migrations versionnées sont dans `prisma/migrations`. `npm run dev` ne les applique jamais implicitement : utiliser `npm run db:migrate:status`, sauvegarder la base, puis lancer `npm run db:migrate:deploy` avant de démarrer une version qui dépend d'un nouveau schéma.
