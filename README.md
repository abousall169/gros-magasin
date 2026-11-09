# Caisse gros & détail — logiciel de vente local

Logiciel de caisse pour un grand magasin qui vend **en gros** (cartons, sacs, balles…) et **au détail** (pièce, kg, bouteille…).
Il fonctionne **en local** : un ordinateur du magasin sert de serveur, et les employés travaillent depuis leur
**téléphone, tablette ou ordinateur** connectés au même Wi-Fi. Pas besoin d'Internet pour vendre.

## Ce que fait le logiciel

- **Caisse** : recherche par nom ou code-barres (douchette USB/Bluetooth acceptée), bascule **Détail / Gros**
  (la caisse change de couleur : jaune safran = détail, indigo = gros), quantités décimales (kg, litres),
  remises et prix négociés (si autorisé), paniers en attente, facture proforma.
- **Encaissement** : espèces avec calcul de la monnaie, Mobile Money (Orange Money, Wave…), carte, virement,
  paiements mélangés, **vente à crédit** sur le compte du client (avec plafond de crédit).
- **Reçus** : ticket 58 ou 80 mm, facture A4 avec le montant en lettres, envoi par **WhatsApp**.
- **Produits** : prix de détail, prix de gros, contenance du colis (ex. 1 carton = 12 bouteilles),
  prix d'achat, seuil d'alerte. Le stock est compté à l'unité et affiché en « 20 cartons + 4 bouteilles ».
  Import / export Excel (CSV).
- **Stock** : réceptions fournisseurs, inventaire et ajustements (pertes, casse…), historique de chaque mouvement,
  alertes de stock bas.
- **Clients & crédits** : dette de chaque client, versements, relevé de compte imprimable, rappel WhatsApp,
  reprise des dettes du cahier (dette antérieure).
- **Dépenses** : transport, loyer, manutention… déduites de la caisse du jour.
- **Rapports** : chiffre d'affaires, bénéfice brut et net, part gros / détail, produits les plus vendus,
  ventes par vendeur et par rayon, **clôture de caisse** (espèces attendues / comptées / écart).
- **Plusieurs employés en même temps** : le stock se met à jour en direct sur tous les appareils.
- **Rôles** : Administrateur (tout), Gestionnaire (produits, stock, rapports), Vendeur (caisse ;
  ne voit pas les prix d'achat ni les bénéfices).
- **Sauvegardes automatiques** au démarrage puis toutes les 6 heures.

## Installation

1. Sur l'ordinateur qui servira de serveur, installez **Node.js** (version « LTS », 22.13 ou plus récente) :
   <https://nodejs.org/fr/download>
2. Copiez ce dossier sur l'ordinateur (par exemple sur le Bureau).
3. Lancez le logiciel :
   - **Windows** : double-cliquez sur `demarrer.bat`
   - **Mac** : double-cliquez sur `demarrer.command`
     (la première fois : clic droit › Ouvrir, si le Mac demande une confirmation)

   La première fois, le logiciel télécharge ses composants (Internet nécessaire une seule fois).
   Une fenêtre noire reste ouverte : **ne la fermez pas** pendant la journée. Le navigateur s'ouvre tout seul.

   Vous pouvez aussi lancer depuis un terminal : `npm install` puis `npm start`.

4. **Première ouverture** : indiquez le nom du magasin, votre nom et un code PIN (4 à 8 chiffres).
   Cochez « données de démonstration » pour essayer avec des produits et des clients fictifs.

> **Windows** : au premier démarrage, Windows demande d'autoriser « Node.js » sur le réseau.
> Cochez **Réseaux privés** et validez, sinon les téléphones ne pourront pas se connecter.

## Connecter les téléphones et tablettes

1. Le téléphone doit être connecté au **même Wi-Fi** que l'ordinateur serveur.
2. Dans le logiciel : **Paramètres › Connecter un appareil**. Scannez le **QR code** avec l'appareil photo,
   ou tapez l'adresse affichée (par exemple `http://192.168.1.15:3000`) dans Chrome ou Safari.
   Cette adresse est aussi affichée dans la fenêtre noire au démarrage.
3. Dans le menu du navigateur, choisissez **« Ajouter à l'écran d'accueil »** : la caisse s'ouvre comme une application.
4. Chaque employé se connecte avec **son nom et son code PIN**.

Conseil : demandez à votre fournisseur Internet de « réserver » l'adresse IP de l'ordinateur serveur dans la box,
pour que l'adresse ne change pas d'un jour à l'autre.

## Utilisation au quotidien

- **Vente au détail** : touchez les produits, ajustez les quantités, touchez **Encaisser**, saisissez le montant reçu :
  la monnaie à rendre s'affiche en grand.
- **Vente en gros** : touchez **Gros** (la caisse passe en indigo) : les prix et les quantités sont par colis.
  Chaque ligne peut aussi être basculée seule entre « Détail » et « Gros ».
- **Vente à crédit** : choisissez le client, encaissez seulement une partie (ou « Tout à crédit ») :
  le reste est ajouté à sa dette.
- **Versement d'un client** : Clients › le client › **Encaisser un versement** (reçu imprimable).
- **Arrivée de marchandises** : Stock › **Nouvelle réception** (le stock et le prix d'achat sont mis à jour).
- **Fin de journée** : Rapports › **Clôture de caisse** (les vendeurs : « Ma caisse du jour »),
  comptez les espèces : le logiciel indique s'il manque de l'argent.
- **Annuler une vente** (gérant) : Ventes › la vente › **Annuler la vente** : les produits reviennent en stock.

Raccourcis clavier en caisse (ordinateur) : `F2` ou `/` pour chercher, `F4` pour encaisser,
`Entrée` dans la recherche pour ajouter le produit trouvé (ou scanné).

## Imprimantes

- **Ticket** : installez votre imprimante thermique 58 ou 80 mm sur l'ordinateur comme imprimante normale,
  puis choisissez la largeur dans **Paramètres › Magasin & ventes**. Dans la fenêtre d'impression du navigateur,
  choisissez l'imprimante et mettez les marges à « Aucune ».
- **Facture A4** : n'importe quelle imprimante, ou « Enregistrer en PDF ».
- Sur téléphone, le plus simple est d'envoyer le reçu par **WhatsApp**
  (renseignez l'indicatif du pays dans les Paramètres, ex. 221, 225, 223, 224).

## Importer vos produits depuis Excel

Produits › **Importer** › téléchargez le modèle. Une ligne par produit avec les colonnes :
`nom ; code ; categorie ; unite ; prix_detail ; unite_gros ; contenance ; prix_gros ; prix_achat ; stock ; seuil_alerte`.
Enregistrez depuis Excel en **CSV (séparateur : point-virgule)**. Un produit déjà existant (même nom ou même code)
est mis à jour ; une case vide garde la valeur actuelle.

## Sauvegardes

- Automatiques dans le dossier `backups` (au démarrage puis toutes les 6 heures, les 60 dernières sont gardées).
- **Paramètres › Sauvegardes** : sauvegarde immédiate et téléchargement.
  Copiez régulièrement une sauvegarde sur une clé USB.
- **Restaurer** : arrêtez le logiciel, remplacez `data/grand-magasin.db` par la sauvegarde
  (renommée `grand-magasin.db`), puis relancez.

## Dépannage

| Problème | Solution |
|---|---|
| Le téléphone n'arrive pas à ouvrir l'adresse | Même Wi-Fi ? Pare-feu Windows autorisé (Réseaux privés) ? L'adresse IP de l'ordinateur a peut-être changé : regardez la fenêtre noire ou Paramètres › Connecter un appareil. |
| « Le port 3000 est déjà utilisé » | Le logiciel est déjà ouvert dans une autre fenêtre. Ou lancez-le sur un autre port : `PORT=3001 npm start` (Mac) / `set PORT=3001` puis `demarrer.bat` (Windows). |
| « Serveur injoignable » en rouge | L'ordinateur serveur est éteint, en veille ou la fenêtre noire a été fermée. Désactivez la mise en veille de l'ordinateur serveur. |
| Code PIN oublié | Un administrateur peut le changer dans Paramètres › Employés. |
| Vente refusée pour « stock insuffisant » | Faites une réception ou un inventaire du produit, ou autorisez la vente sans stock dans les Paramètres. |

## Pour un développeur

- Serveur : Node.js ≥ 22.13, Express, base **SQLite** intégrée (`node:sqlite`, aucune compilation native).
  Fichier de données : `data/grand-magasin.db`. Variables : `PORT`, `GM_DATA_DIR`, `GM_BACKUP_DIR`.
- Interface : Vue 3 sans étape de compilation (copie locale dans `public/vendor`), modules ES dans `public/js`.
  Temps réel entre appareils par Server-Sent Events (`/api/events`).
- Code : `server/services.js` (logique de vente gros / détail, stock, crédit), `server/routes/*` (API),
  `public/js/pages/*` (écrans), `public/css/app.css` (styles).
