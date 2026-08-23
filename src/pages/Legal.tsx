export function Legal() {
  return (
    <section className="section prose-page">
      <p className="eyebrow">Informations</p>
      <h1 className="page-title">Mentions légales et confidentialité</h1>
      <p>
        Site de demonstration front-end cree pour reproduire une maquette Figma
        Make hoteliere. Les contenus, tarifs, coordonnees et disponibilites sont
        fictifs.
      </p>
      <h2>Éditeur</h2>
      <p>Hôtel Rivage, projet de démonstration. Aucun service commercial réel n'est branché.</p>
      <h2>Données de réservation</h2>
      <p>
        Le formulaire de réservation transmet au serveur les dates du séjour, le nombre de
        voyageurs, les options choisies, le nom, l'adresse e-mail, le téléphone, le pays et,
        si elle est renseignée, la demande particulière. Aucune donnée bancaire n'est collectée.
      </p>
      <p>
        Ces informations servent uniquement à vérifier la disponibilité, enregistrer la demande
        et permettre son suivi par les comptes Administrateur ou Réception autorisés de l'hôtel.
        Elles sont hébergées dans la base Supabase reliée à ce projet et ne sont pas vendues.
      </p>
      <h2>Durée et droits</h2>
      <p>
        Cette version de démonstration ne dispose pas encore d'une purge automatisée ni d'une
        politique de conservation de production. Elle ne doit donc pas recevoir de données
        personnelles réelles en production avant la définition de ces durées et du processus
        d'effacement. Pour demander l'accès, la rectification ou la suppression d'une donnée de
        test, écrivez à contact@hotel-rivage.fr.
      </p>
      <p>
        N'indiquez aucune donnée sensible dans le champ de demande particulière. La confirmation
        reste manuelle et l'option sur la chambre expire au terme indiqué après l'enregistrement.
      </p>
    </section>
  );
}
