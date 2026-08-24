# Architecture Hotel Rivage

## Principes

- PostgreSQL est la source de verite pour les chambres, disponibilites, reservations, paiements et documents comptables.
- Les controles critiques sont appliques deux fois : validation applicative pour les messages utilisateur, contrainte PostgreSQL pour l'integrite concurrente.
- Les donnees historiques sont figees dans des snapshots. Modifier un tarif, une taxe ou des conditions ne reecrit jamais une reservation ou une facture existante.
- Toute requete administrateur est rattachee a un `Property` par `AdminMembership`.
- Les tables exposees par Supabase ont RLS activee sans politique publique.

## Reservation et disponibilite

Une demande publique est creee dans une transaction `SERIALIZABLE`. Le backend recalcule le prix, choisit une chambre physique libre et cree un `ReservationHold`, puis un `RoomAllocation`. La contrainte d'exclusion PostgreSQL interdit deux allocations actives qui se chevauchent sur une meme chambre.

Les intervalles hoteliers utilisent la convention `[arrivee, depart)` : le jour d'arrivee occupe la chambre, le jour de depart est reutilisable.

## Prix, taxes et conditions

`RatePlan.taxRate` reste le taux de l'hebergement. `Extra.taxRate` permet un taux propre a une option et utilise le taux du plan tarifaire lorsqu'il est absent. `TaxRule` porte les taxes additionnelles versionnees dans le temps, notamment la taxe de sejour.

Lors de la creation :

1. chaque montant est calcule et arrondi par ligne ;
2. la ventilation est ecrite dans `BookingTaxLine` ;
3. les montants sont recopies dans `BookingRoom` et `BookingExtra` ;
4. le detail complet est conserve dans `Booking.pricingSnapshot` version 2 ;
5. les conditions applicables sont copiees dans `Booking.termsSnapshot` et, si disponible, rattachees a `ContractTermsVersion`.

Une ancienne reservation conserve ses totaux. La migration v2 cree seulement une ventilation de reprise a partir de ses snapshots existants.

## Paiement

`Payment` est rattache directement a l'etablissement et a la reservation. Il peut conserver le type de moyen de paiement, la marque et les quatre derniers chiffres, mais jamais le numero complet ni le cryptogramme.

`PaymentProviderEvent` assure l'idempotence des futurs webhooks par `(provider, providerEventId)`. Seuls le type, l'etat de traitement et le hash du payload sont conserves. Le payload bancaire brut n'est pas archive dans la base applicative.

## Facturation et fichiers

Une reservation peut avoir plusieurs `Invoice` : factures et avoirs. Un avoir reference sa facture d'origine. `InvoiceSequence` reserve une sequence par etablissement, type de document et annee afin que la numerotation puisse etre attribuee transactionnellement.

Les coordonnees emetteur et client sont figees sur le document. `StoredFile` reference un objet de stockage par bucket et cle. Les images publiques peuvent avoir une URL publique; les factures et documents administratifs restent prives et devront etre telecharges par URL signee temporaire.

## Vie privee et exploitation

`archivedAt`, `anonymizedAt` et `personalDataRetainUntil` preparent une politique de cycle de vie explicite sans supprimer automatiquement des donnees tant que cette politique n'est pas approuvee et testee. Les en-tetes d'authentification, cookies et secrets de connexion sont masques dans les logs Fastify.

Les actions de gestion sensibles doivent produire un `AuditLog`. La prochaine tranche doit ajouter les services d'exploitation (blocages de chambre, annulation/no-show, encaissements et remboursements) avant d'ouvrir les mutations correspondantes dans l'admin.

## Deploiement de la migration v2

La migration est preparee dans :

- `server/prisma/migrations/20260824120000_business_foundation_v2/migration.sql` ;
- `server/supabase/migrations/20260824120000_business_foundation_v2.sql`.

Elle doit d'abord etre testee sur une branche ou une copie de la base, avec sauvegarde et verification de `server/supabase/verify.sql`. Elle n'est pas appliquee automatiquement par le lancement local du projet.
