# Caisse gros & détail — logiciel de vente local

Logiciel de caisse pour un grand magasin qui vend **en gros** (cartons, sacs, balles…) et **au détail** (pièce, kg, bouteille…).
Il fonctionne **en local** : un ordinateur du magasin sert de serveur, et les employés travaillent depuis leur
**téléphone, tablette ou ordinateur** connectés au même Wi-Fi. Pas besoin d'Internet pour vendre.

## Ce que fait le logiciel

- **Caisse** : recherche par nom ou code-barres (douchette USB/Bluetooth acceptée), **scan avec la caméra**
  du téléphone, **reconnaissance d'un produit par photo**, bascule **Détail / Gros**
  (la caisse change de couleur : jaune safran = détail, indigo = gros), quantités décimales (kg, litres),
  prix négociés (un vendeur peut vendre plus cher que le prix fixé par le gérant, jamais moins cher ; seul le gérant
  peut baisser un prix ou faire une remise), paniers en attente, facture proforma.
- **Encaissement** : espèces avec calcul de la monnaie, Mobile Money (Orange Money, Wave…) avec le **n° de transaction**,
  carte, virement, paiements mélangés, **vente à crédit** sur le compte du client (avec plafond de crédit).
- **Hors ligne** : si le Wi-Fi ou l'ordinateur serveur tombe, les téléphones continuent à vendre. Les ventes sont gardées
  sur l'appareil puis envoyées au retour du réseau, avec leur vraie date, sans doublon. Une vente qui ne respectait pas
  une règle (stock, prix, remise, crédit) est enregistrée quand même et signalée au gérant (**Ventes › À vérifier**).
- **Reçus** : ticket 58 ou 80 mm (navigateur, ou **imprimante thermique ESC/POS** USB ou réseau, avec coupe du papier
  et **ouverture du tiroir-caisse**), facture A4 avec le montant en lettres, envoi par **WhatsApp** ou **SMS**.
- **Produits** : prix de détail, prix de gros, contenance du colis (ex. 1 carton = 12 bouteilles),
  prix d'achat, seuil d'alerte, nom en arabe, taux de TVA, date de péremption, photos de référence.
  Le stock est compté à l'unité et affiché en « 20 cartons + 4 bouteilles ». Import / export Excel (CSV).
- **Codes-barres et étiquettes** : code interne EAN-13 pour les produits qui n'en ont pas,
  étiquettes en feuilles A4 (3×8, 4×10, 5×13) ou sur l'imprimante de tickets.
- **Stock** : réceptions immédiates ou **commandes fournisseurs** reçues plus tard, **lots avec date de péremption**
  (le lot qui périme le plus tôt part en premier), inventaire et ajustements (pertes, casse…),
  historique de chaque mouvement, alertes de stock bas et de péremption proche.
- **Fournisseurs** : paiements partiels, **dettes envers les fournisseurs**, achats non payés.
- **Clients & crédits** : dette de chaque client, versements, relevé de compte imprimable, rappel WhatsApp ou SMS,
  reprise des dettes du cahier (dette antérieure).
- **Retours d'articles** : retour partiel d'une vente, remboursé en espèces, par un autre moyen ou déduit de la dette
  du client, avec ou sans remise en stock. Annulation complète d'une vente (gérant).
- **Dépenses** : transport, loyer, manutention… déduites de la caisse du jour.
- **Caisse** : **ouverture avec un fond de caisse et clôture** avec les espèces comptées (par vendeur ou pour tout
  le magasin), écart calculé, historique des clôtures, ticket de clôture.
- **Rapports** : chiffre d'affaires, retours, **TVA collectée** (prix TTC), bénéfice brut et net, part gros / détail,
  produits les plus vendus, ventes par vendeur et par rayon, dettes clients et fournisseurs.
- **Plusieurs employés en même temps** : le stock se met à jour en direct sur tous les appareils.
- **Rôles** : Administrateur (tout), Gestionnaire (produits, stock, rapports), **Vendeur** (prépare le panier et
  l'envoie à la caisse, n'encaisse pas) et **Caissier** (ne vend pas : il voit la liste des ventes envoyées par
  tous les vendeurs, en temps réel, en choisit une et l'encaisse **sans pouvoir la modifier**).
  Vendeur et caissier ne voient que la caisse et ne voient pas les prix d'achat ni les bénéfices ; le vendeur
  peut vendre plus cher que le prix fixé mais jamais moins cher, et le prix annoncé au client est figé à l'envoi.
- **Langues** : français, **arabe** (de droite à gauche) et anglais, au choix de chaque employé ; les tickets
  sortent dans sa langue.
- **Sauvegardes automatiques** au démarrage puis toutes les 6 heures, copie vers une clé USB ou un dossier
  synchronisé, **restauration** depuis l'application.

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

### Démarrage automatique avec Windows (recommandé pour l'ordinateur du magasin)

Double-cliquez sur **`installer-demarrage-auto.bat`** (acceptez la demande d'administrateur). Il :
- crée une tâche planifiée qui lance la caisse **au démarrage du PC**, avant même l'ouverture de session
  (reprise automatique après une coupure de courant), et la relance toute seule si elle s'arrête ;
- ouvre les ports 3000 et 3443 dans le pare-feu **pour le réseau local uniquement**
  (un Wi-Fi classé « Public » bloque sinon les téléphones) ;
- propose d'empêcher la mise en veille du PC sur secteur (un PC en veille = caisse inaccessible).

Ensuite, plus besoin de `demarrer.bat`. Journaux : `data\logs\`. Pour tout retirer : **`desinstaller-demarrage-auto.bat`**
(les données sont conservées). Sous le compte système, une imprimante installée seulement pour *votre* utilisateur
peut ne pas être vue : installez alors avec `powershell -File scripts\install-autostart.ps1 -Mode Logon`.

**Code PIN administrateur oublié** : sur l'ordinateur serveur, double-cliquez sur `reinitialiser-pin-admin.bat`.

## Connecter les téléphones et tablettes

1. Le téléphone doit être connecté au **même Wi-Fi** que l'ordinateur serveur.
2. Dans le logiciel : **Paramètres › Connecter un appareil**. Scannez le **QR code** avec l'appareil photo :
   il ouvre la page **d'installation** (`http://<ip-du-pc>:3000/install`), qui explique comment installer
   le certificat du magasin (Android, iPhone), **une seule fois par appareil**.
3. Ouvrez ensuite l'adresse **sécurisée** `https://<ip-du-pc>:3443` et choisissez **« Ajouter à l'écran d'accueil »**
   dans le menu du navigateur : la caisse s'ouvre comme une application.
4. Chaque employé se connecte avec **son nom et son code PIN**.

La connexion sécurisée (HTTPS) est nécessaire pour **la caméra** (scan, photos) et **la vente hors ligne** :
le serveur crée sa propre autorité de certification dans `data/certs/` (**ne partagez jamais `ca-key.pem`**).
Le certificat du serveur se renouvelle tout seul si l'adresse IP change ; les téléphones n'ont rien à refaire.
L'adresse `http://<ip>:3000` reste utilisable, sans caméra ni hors ligne. Variables : `HTTPS_PORT` (3443 par défaut),
`NO_HTTPS=1` pour désactiver, `TLS_NAMES=nom,ip` pour ajouter des noms ou adresses au certificat.

Conseil : demandez à votre fournisseur Internet de « réserver » l'adresse IP de l'ordinateur serveur dans la box,
pour que l'adresse ne change pas d'un jour à l'autre.

## Utilisation au quotidien

- **Vente au détail** : touchez les produits, ajustez les quantités, touchez **Encaisser**, saisissez le montant reçu :
  la monnaie à rendre s'affiche en grand.
- **Vendeur et caissier** : le vendeur prépare le panier du client puis touche **Envoyer à la caisse** : un numéro
  de commande s'affiche, le client le donne au caissier. Plusieurs vendeurs peuvent envoyer en même temps.
  Le caissier a un écran à part, **« Ventes à encaisser »** : la liste se remplit toute seule (avec une notification),
  chaque vente occupe une ligne sur toute la largeur (numéro, vendeur, client, articles, total) et se touche
  n'importe où. Il saisit le paiement et valide : il ne peut ni modifier les articles, les prix ou le client,
  ni vendre lui-même.
  Le stock ne baisse qu'à l'encaissement. Tant qu'elle n'est pas encaissée, le vendeur peut **reprendre** sa commande
  (le client ajoute un article) ou l'annuler. La vente garde les deux noms : les rapports « par vendeur » comptent
  le vendeur, la fin de journée compte le caissier.
- **Journée du caissier** : rien à ouvrir le matin. Dans le menu de gauche, sous le nom du magasin, le
  **Total caisse** = total des ventes encaissées − dépenses, depuis la dernière fin de journée (il se met à jour
  à chaque encaissement et à chaque dépense ; sur téléphone, il est dans un bandeau sous la barre du haut).
  Les dépenses se notent dans **Dépenses › Nouvelle dépense** (montant, motif, détail). En bas du menu, juste
  au-dessus de « Connecté au serveur », **Terminer la journée** montre le récapitulatif (total caisse, ventes par
  moyen de paiement, liste des dépenses ; les espèces comptées sont facultatives), imprime le ticket de fin de
  journée et **remet les totaux à zéro** : la journée suivante commence aussitôt. Une dépense saisie par erreur
  peut être supprimée pendant la journée, ensuite seul le gérant peut. Le gérant retrouve chaque fin de journée
  dans Rapports › Caisse.
- **Vente en gros** : touchez **Gros** (la caisse passe en indigo) : les prix et les quantités sont par colis.
  Chaque ligne peut aussi être basculée seule entre « Détail » et « Gros ».
- **Demi-gros** : sur la fiche d'un produit, cochez « Ce produit se vend aussi en demi-gros » et indiquez le prix :
  soit par **paquet** (pack de 6, demi-carton… avec sa contenance, plus petite que le colis de gros), soit par
  unité (prix intermédiaire, ex. la bouteille à 375 au lieu de 400). La caisse affiche alors trois choix
  **Détail / Demi-gros / Gros** (le demi-gros est bleu-vert) ; un produit sans prix demi-gros ajouté en mode
  demi-gros part au détail, avec un message. Le bouton de chaque ligne passe de détail à demi-gros puis à gros.
  Le stock baisse de la contenance du paquet ; rapports, tickets, factures et export Excel distinguent le demi-gros.
- **Gros et détail dans la même vente** : le choix Gros / Détail ne change que les **prochains** articles, jamais
  ceux déjà dans le panier. Exemple : en **Gros**, touchez « Boisson » deux fois (2 cartons au prix de gros), passez
  en **Détail** et touchez-la cinq fois (5 bouteilles au prix de détail) : le panier garde les deux lignes et le
  stock baisse de 2 cartons + 5 bouteilles. Sur la fiche du produit, une pastille indigo compte les colis et une
  pastille orange les unités.
- **Vente à crédit** : choisissez le client, encaissez seulement une partie (ou « Tout à crédit ») :
  le reste est ajouté à sa dette.
- **Versement d'un client** : Clients › le client › **Encaisser un versement** (reçu imprimable).
- **Arrivée de marchandises** : Stock › **Nouvelle réception** (le stock et le prix d'achat sont mis à jour).
- **Fin de journée** (gérant) : Rapports › **Caisse : ouverture et clôture**,
  comptez les espèces : le logiciel indique s'il manque de l'argent.
- **Annuler une vente** (gérant) : Ventes › la vente › **Annuler la vente** : les produits reviennent en stock.

Raccourcis clavier en caisse (ordinateur) : `F2` ou `/` pour chercher, `F4` pour encaisser,
`Entrée` dans la recherche pour ajouter le produit trouvé (ou scanné).

## Imprimantes

- **Imprimante de tickets (ESC/POS, 58 ou 80 mm)** : **Paramètres › Imprimante & tiroir**.
  - **USB** : installez l'imprimante dans Windows (pilote du fabricant ou « Generic / Text Only ») puis choisissez-la.
  - **Réseau** (Ethernet / Wi-Fi) : choisissez « Imprimante réseau » et saisissez son adresse IP (port 9100 par défaut).
  - Le ticket est dessiné par l'appareil qui vend (français et arabe corrects) puis envoyé directement à l'imprimante,
    **même depuis un téléphone**, sans fenêtre d'impression. Options : impression automatique après chaque vente,
    coupe du papier, **ouverture du tiroir-caisse** (branché sur l'imprimante) à chaque vente en espèces.
  - Sans imprimante réglée, le bouton « Ticket » ouvre la fenêtre d'impression du navigateur (marges : « Aucune »).
- **Facture A4** : n'importe quelle imprimante, ou « Enregistrer en PDF ».
- **Étiquettes** : **Produits › Étiquettes** : feuilles A4 (échelle 100 %, sans en-têtes ni pieds de page)
  ou imprimante de tickets (une étiquette par ticket, coupée).
- Sur téléphone, le reçu peut aussi partir par **WhatsApp** ou **SMS**
  (renseignez l'indicatif du pays dans les Paramètres, ex. 221, 225, 223, 224).

## Reconnaissance par photo

100 % locale : le modèle DINOv2-small (24 Mo) tourne dans le navigateur de l'appareil, aucune photo ne sort du magasin.
- **Enregistrer** : *Produits › un produit › Photos de référence* : 3 à 5 photos du produit seul, sous des angles
  différents, avec une bonne lumière (12 au maximum).
- **Utiliser** : en caisse, bouton appareil photo à côté de la recherche → photo de l'article → les 3 produits les plus
  proches s'affichent avec un niveau de confiance ; **le vendeur confirme toujours**.
- Le code-barres reste plus fiable pour les produits emballés ; la photo sert surtout aux produits sans code
  (fruits, légumes, vrac).
- Le modèle et son moteur (dossiers `public/models` et `public/vendor/ort`, ~80 Mo) sont téléchargés **une seule fois**
  par `npm install` (Internet nécessaire ce jour-là). Pour les télécharger plus tard : `npm run setup-vision`.

## Importer vos produits depuis Excel

Produits › **Importer** › téléchargez le modèle. Une ligne par produit avec les colonnes :
`nom ; code ; categorie ; unite ; prix_detail ; unite_gros ; contenance ; prix_gros ; prix_achat ; stock ; seuil_alerte`.
Enregistrez depuis Excel en **CSV (séparateur : point-virgule)**. Un produit déjà existant (même nom ou même code)
est mis à jour ; une case vide garde la valeur actuelle.

## Sauvegardes

- Automatiques dans le dossier `backups` (au démarrage puis toutes les 6 heures, les 60 dernières sont gardées).
- **Paramètres › Sauvegardes** : sauvegarde immédiate, téléchargement, et **dossier de copie** (clé USB, Google Drive
  pour ordinateur…) où chaque sauvegarde est aussi copiée. **Sans ce dossier, les sauvegardes restent sur le même
  disque que les données.**
- **Restaurer** : *Paramètres › Sauvegardes* › « Restaurer » sur une sauvegarde de la liste, ou « Restaurer depuis
  un fichier ». Le logiciel n'a pas besoin d'être arrêté ; une copie « avant-restauration » est faite juste avant
  et tous les appareils doivent se reconnecter.
- Avant chaque mise à jour de la structure de la base, une copie est faite dans `data/avant-mise-a-jour/`.

## Dépannage

| Problème | Solution |
|---|---|
| Le téléphone n'arrive pas à ouvrir l'adresse | Même Wi-Fi ? Pare-feu Windows autorisé (Réseaux privés) ? L'adresse IP de l'ordinateur a peut-être changé : regardez la fenêtre noire ou Paramètres › Connecter un appareil. |
| « Le port 3000 est déjà utilisé » | Le logiciel est déjà ouvert dans une autre fenêtre. Ou lancez-le sur un autre port : `PORT=3001 npm start` (Mac) / `set PORT=3001` puis `demarrer.bat` (Windows). |
| « Serveur injoignable » en rouge | L'ordinateur serveur est éteint, en veille ou la fenêtre noire a été fermée. Désactivez la mise en veille de l'ordinateur serveur. |
| Code PIN oublié | Un administrateur peut le changer dans Paramètres › Employés. Administrateur : `reinitialiser-pin-admin.bat` sur l'ordinateur serveur. |
| La caméra ou le mode hors ligne ne marchent pas sur le téléphone | Utilisez l'adresse `https://…:3443` après avoir installé le certificat (`http://<ip>:3000/install`). |
| Ventes « en attente d'envoi » sur un téléphone | Elles partent seules au retour du réseau. Si le serveur en refuse une, elle reste « à traiter » sur l'appareil : réessayer ou supprimer. |
| Vente refusée pour « stock insuffisant » | Faites une réception ou un inventaire du produit, ou autorisez la vente sans stock dans les Paramètres. |

## Pour un développeur

- Serveur : Node.js ≥ 22.13, Express, base **SQLite** intégrée (`node:sqlite`, aucune compilation native),
  HTTPS local avec `node-forge` (`server/tls.js`, page `server/install.js`).
  Fichier de données : `data/grand-magasin.db`. Variables : `PORT`, `HTTPS_PORT`, `NO_HTTPS`, `TLS_NAMES`,
  `GM_DATA_DIR`, `GM_BACKUP_DIR`.
- Interface : Vue 3 sans étape de compilation (copies locales dans `public/vendor` : Vue, ZXing pour le scan,
  transformers.js pour la reconnaissance par photo), modules ES dans `public/js`, service worker `public/sw.js`.
  Temps réel entre appareils par Server-Sent Events (`/api/events`).
- Code : `server/services.js` (logique de vente gros / détail, stock et lots, crédit, retours, achats),
  `server/routes/*` (API), `server/print/` (ESC/POS), `public/js/pages/*` (écrans), `public/js/i18n*.js` (langues),
  `public/css/app.css` (styles).
- Hors ligne : `public/js/api.js` (file d'attente des ventes, identifiant unique par vente : pas de doublon au renvoi).
