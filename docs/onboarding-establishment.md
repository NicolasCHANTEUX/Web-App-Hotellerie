# Onboarding d'un établissement

Cette fiche sépare les données réelles à obtenir du client des fixtures et exemples techniques du dépôt. Elle doit être complétée avant toute mise en production.

## Identité et contact

- [ ] Nom commercial, raison sociale et slug technique
- [ ] Email, téléphone et adresse postale complète
- [ ] Pays, fuseau horaire et devise
- [ ] Horaires de réception, d'arrivée et de départ
- [ ] Préfixe des références de réservation, de 2 à 8 lettres majuscules ou chiffres
- [ ] Logo, favicon, couleurs et typographies validés

## Catalogue et exploitation

- [ ] Catégories de chambres, descriptions, capacités, lits et surfaces
- [ ] Inventaire des chambres physiques, numéros, étages et états initiaux
- [ ] Équipements réellement disponibles
- [ ] Photos de l'hôtel et des chambres avec droits d'utilisation
- [ ] Tarifs, devise, TVA, minimum de séjour et politiques de remboursement
- [ ] Options, prix, TVA et unités de facturation
- [ ] Taxe de séjour, exemptions, dates d'application et priorités
- [ ] Durée des options de réservation et durée d'accès public après le séjour
- [ ] Politique de confirmation, annulation, no-show, acompte et remboursement

## Contenu public

- [ ] Hero, présentation, services et expérience proposés
- [ ] Alentours et temps de trajet vérifiés
- [ ] FAQ validée par l'établissement
- [ ] Promesse commerciale de réservation directe validée
- [ ] Description SEO, domaine canonique et image sociale

## Juridique et comptabilité

- [ ] Forme juridique, immatriculation, TVA et capital social
- [ ] Directeur de publication
- [ ] Hébergeur et coordonnées légales
- [ ] Médiateur de la consommation et droit applicable
- [ ] CGV et politique de confidentialité validées
- [ ] Durées de conservation validées juridiquement
- [ ] Mentions obligatoires des factures et convention de numérotation validées

## Services et infrastructure

- [ ] Projet Supabase, connexion PostgreSQL, Auth et bucket Storage
- [ ] Domaine frontend, URL API, CORS et reverse proxy
- [ ] Secret de jeton public généré spécifiquement pour la production
- [ ] Compte Stripe, clés live et webhook vérifiés si le paiement est activé
- [ ] Domaine Resend, SPF/DKIM, clé API et expéditeur vérifiés si l'email est activé
- [ ] Comptes administrateurs réels, rôles et MFA
- [ ] Sauvegardes, restauration, supervision et worker planifiés

## Préparation des données

1. Adapter `server/prisma/seed.ts` avec les données réelles de l'établissement.
2. Ne pas utiliser `server/supabase/seed.sql`, conservé uniquement comme historique.
3. Ne pas exécuter `server/prisma/seed-demo.ts` sur une base commerciale.
4. Conserver les adresses `example.com`, `invalid.example` et les URLs `.example` dans les tests et la CI.
5. Remplacer les images Unsplash avant commercialisation, puis retirer leur domaine de la CSP si elles ne sont plus utilisées.

## Validation avant ouverture

- [ ] Migrations appliquées et sauvegarde effectuée
- [ ] Recherche de disponibilité et réservation testées de bout en bout
- [ ] Paiement, webhook, remboursement et facture testés si activés
- [ ] Emails et liens publics testés sur le domaine réel
- [ ] Accès et permissions de chaque rôle administrateur vérifiés
- [ ] Mentions légales, CGV, confidentialité et consentements relus
- [ ] `npm run verify`, `npm run test:e2e` et `npm run seo:verify` réussis
