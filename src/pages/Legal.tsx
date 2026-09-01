import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { formatHotelTime, propertyAddress, useProperty } from "../context/PropertyContext";

export function Legal() {
  const { hash } = useLocation();
  const property = useProperty();

  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);

  return (
    <section className="section prose-page">
      <p className="eyebrow">Informations</p>
      <h1 className="page-title">Mentions légales, confidentialité et CGV</h1>

      <article id="mentions">
        <h2>Mentions légales</h2>
        <p>
          Le site est édité par {property.name}, {propertyAddress(property)}.
          Contact : {property.email}{property.phone ? ` · ${property.phone}` : ""}.
        </p>
        <p>
          Les informations d'immatriculation, la forme juridique, le capital social, le numéro
          de TVA intracommunautaire, le directeur de publication et les coordonnées définitives
          de l'hébergeur doivent être complétés par l'exploitant avant l'ouverture commerciale.
        </p>
      </article>

      <article id="confidentialite">
        <h2>Confidentialité</h2>
        <p>
          Les dates du séjour, les voyageurs, les options, les coordonnées du client et la demande
          particulière éventuelle sont traités pour établir le devis, enregistrer et administrer
          la réservation, recevoir les paiements, établir les factures et répondre aux demandes.
          Les bases utilisées sont les mesures précontractuelles, l'exécution du contrat, les
          obligations comptables et l'intérêt légitime de sécuriser et piloter l'établissement.
        </p>
        <p>
          Les données sont accessibles uniquement aux membres habilités de l'hôtel selon leur rôle.
          Elles peuvent être confiées aux prestataires techniques nécessaires : hébergement et base
          de données Supabase, Stripe lorsque le paiement en ligne est activé, et le prestataire
          d'envoi d'e-mails lorsqu'il est configuré. Elles ne sont pas vendues.
        </p>
        <p>
          Les données nécessaires à la réservation et à la facturation sont conservées jusqu'à dix
          ans après la fin du séjour ou l'émission du dernier document comptable. Une échéance est
          enregistrée pour chaque réservation ; une procédure d'exploitation permet alors
          d'anonymiser les coordonnées et contenus libres, tandis que les données comptables non
          directement identifiantes restent disponibles pour l'intégrité de l'historique.
        </p>
        <p>
          Les messages envoyés depuis le formulaire de contact sont conservés pendant trois ans à
          compter de leur réception, puis leur identité, leurs coordonnées et leur contenu sont
          anonymisés par la procédure de conservation de l'établissement.
        </p>
        <p>
          Vous pouvez demander l'accès, la rectification, la limitation ou, lorsque la loi le permet,
          l'effacement et la portabilité de vos données en écrivant à {property.email}. Vous
          pouvez également saisir la CNIL. N'indiquez aucune donnée sensible dans la demande
          particulière.
        </p>
        <p>
          Le site ne dépose actuellement aucun traceur publicitaire. Les éléments techniques
          strictement nécessaires à la navigation, à la sécurité et à la session administrateur ne
          sont pas utilisés à des fins de prospection.
        </p>
      </article>

      <article id="cgv">
        <h2>Conditions générales de vente</h2>
        <p>
          Les prix des chambres et options sont affichés toutes taxes comprises. La taxe de séjour,
          lorsqu'elle s'applique, est détaillée séparément puis incluse dans le total présenté avant
          validation. Le montant contractuel est recalculé par le serveur au moment de la demande.
        </p>
        <p>
          L'enregistrement en ligne place temporairement la chambre en option pendant la durée
          indiquée. La réservation devient ferme après confirmation de l'hôtel et, lorsqu'un paiement
          est requis, après son encaissement. Les conditions d'annulation et de remboursement du tarif
          choisi sont figées avec la réservation afin de pouvoir restituer la version acceptée.
        </p>
        <p>
          L'heure d'arrivée est fixée à {formatHotelTime(property.checkInTime)} et l'heure de départ à {formatHotelTime(property.checkOutTime)}, sauf accord particulier.
          Toute modification, annulation, arrivée tardive ou demande d'accessibilité doit être adressée
          à l'hôtel avec la référence de réservation.
        </p>
        <p>
          Cette trame doit être relue et complétée par l'exploitant — notamment pour la médiation de la
          consommation, le droit applicable, les garanties, les conditions tarifaires et les moyens de
          paiement acceptés — avant toute mise en production commerciale.
        </p>
      </article>
    </section>
  );
}
