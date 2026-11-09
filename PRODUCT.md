# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated (choix proposé et confirmé : un ordinateur du magasin sert de serveur, les autres appareils s'y connectent par le Wi-Fi via le navigateur, sans installation). Implémentation : Node.js ≥ 22.13 (Express + SQLite intégré `node:sqlite`), interface Vue 3 sans étape de compilation, servie en local. Aucune ressource externe (pas de CDN, pas de polices en ligne) : le magasin peut fonctionner sans Internet. Système du serveur pas encore décidé : lancement fourni pour Windows et Mac.

## Users

- **Vendeurs / caissiers** : encaissent les clients au comptoir, souvent debout, sur téléphone, tablette ou ordinateur, dans un magasin lumineux et bruyant, avec une file d'attente. Ils doivent trouver un produit, choisir gros ou détail, encaisser (espèces, Mobile Money, crédit) et rendre la monnaie vite et sans erreur.
- **Gérant / propriétaire (administrateur)** : suit les ventes, les bénéfices, les dettes clients et le stock ; fixe les prix ; gère les employés.
- **Gestionnaire / magasinier** : réceptionne les marchandises, fait l'inventaire, gère le catalogue.

## Product Purpose

Logiciel de caisse local pour un grand magasin qui vend à la fois **en gros** (cartons, sacs, balles, bottes…) et **au détail** (pièce, kg, bouteille…). Plusieurs employés travaillent en même temps sur des appareils différents ; le stock est commun et se met à jour en temps réel. Succès : chaque vente est enregistrée juste (prix, stock, crédit), la caisse du soir tombe juste, et le propriétaire sait ce qu'il gagne et qui lui doit de l'argent.

## Operating Context

- Réseau Wi-Fi du magasin ; le serveur est un ordinateur laissé allumé pendant la journée.
- Devise : **FCFA** (pas de centimes). Paiements courants : espèces, Mobile Money, crédit client (« carnet »), plus rarement carte ou virement.
- Les grossistes et revendeurs achètent souvent à crédit et règlent par versements ; certains prix se négocient.
- **Codes-barres : seulement sur une partie des produits.** La recherche par nom reste le chemin principal ; un lecteur (douchette) doit aussi fonctionner dans le champ de recherche.
- Impression : tickets thermiques 58/80 mm depuis l'ordinateur, factures A4 pour les clients en gros ; partage du reçu par WhatsApp depuis les téléphones.

## Capabilities and Constraints

- Prix de détail par unité ; prix de gros par colis (ou par unité si pas de colis) ; contenance du colis ; stock suivi en unités de base et affiché en « colis + unités ».
- Rôles : Administrateur, Gestionnaire, Vendeur/Caissier (prix d'achat et marges cachés aux vendeurs ; modification des prix et vente à crédit réglables).
- Crédit client avec plafond, solde initial, versements ; annulation de vente avec remise en stock ; approvisionnements fournisseurs ; inventaire ; dépenses ; clôture de caisse ; rapports ; import/export CSV (Excel) ; sauvegardes automatiques.
- Pas de caméra pour scanner (le navigateur l'interdit hors HTTPS sur le réseau local) : non prévu pour l'instant.
- Non décidé : TVA sur factures, gestion des dettes fournisseurs, retours partiels.

## Brand Commitments

Aucune identité imposée. Le nom du magasin est saisi à l'installation et apparaît sur l'écran de connexion, les tickets et les factures. Langue : français.

## Evidence on Hand

Aucune donnée réelle du magasin. Des données de démonstration (produits alimentaires, boissons, hygiène, quincaillerie ; clients fictifs) sont proposées à l'installation et doivent être présentées comme telles.

## Product Principles

1. **La vente d'abord** : l'écran de caisse doit permettre d'encaisser en quelques touches, au pouce sur téléphone comme à la souris.
2. **Gros et détail sont égaux** : le choix est toujours visible, jamais caché dans un menu, et le prix affiché correspond toujours à l'unité vendue.
3. **Les chiffres ne mentent pas** : montants, stocks et dettes sont calculés par le serveur et identiques sur tous les appareils.
4. **Simple pour un nouvel employé** : vocabulaire du commerce (carton, sac, versement, crédit), pas de jargon informatique.
5. **Rien ne se perd** : sauvegardes automatiques, annulation tracée, historique des mouvements.

## Accessibility & Inclusion

Lisibilité en plein jour sur des écrans bas de gamme : contrastes forts, chiffres grands et tabulaires, cibles tactiles généreuses (≥ 44 px). Utilisateurs pas forcément à l'aise avec l'informatique ou la lecture rapide : libellés courts et explicites, icônes toujours accompagnées de texte.
