---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: []
---

# Surface: application de caisse (toutes les pages)

Scope: l'application entière servie par `public/index.html` (connexion, caisse, ventes, produits, stock, clients, dépenses, rapports, paramètres). Mode: Operate.

Audience et tâche : vendeurs au comptoir (téléphone, tablette, PC) qui encaissent vite en gros ou au détail ; gérant qui suit ventes, marges, dettes et stock. Contraintes : hors ligne sur le réseau local (polices système, aucune ressource externe), magasin lumineux, FCFA sans centimes, codes-barres sur une partie des produits seulement.

Moment mémorable : la caisse change de couleur selon le mode de vente.

## Direction contract

THESIS: Une caisse dont la couleur dit le régime de prix : tout le panier porte la teinte Détail (safran) ou la teinte Gros (indigo). Refuse le défaut de la catégorie : écran gris, un accent bleu, mode caché dans un menu déroulant.

OWN-WORLD: Les coloris du pagne wax en aplats, sans motif : rail de navigation indigo profond, fond clair légèrement teinté d'indigo, safran = Détail, indigo vif = Gros, vermillon = crédit / danger, émeraude = payé. Une seule famille sans-serif système, chiffres lourds et tabulaires.
RAISE (carte d'orientation) : les teintes de mode sont réservées au mode, jamais décoratives ailleurs.
RAISE (plan de zoo) : ce sont les aplats de couleur qui séparent les zones, pas les filets ni les ombres.
RAISE (Datamatics) : tous les montants et quantités en chiffres tabulaires alignés à droite.
RAISE (flux vidéo vertical) : sur téléphone, l'étape d'encaissement occupe tout l'écran.
RAISE (manuel à onglets) : une seule échelle d'élévation : rail, fond, panneau, feuille.

STORY: Le vendeur trouve un produit par son nom ou au lecteur, voit prix détail et prix gros, l'ajoute dans le mode courant, encaisse espèces / Mobile Money / crédit, imprime ou envoie le reçu par WhatsApp. Le gérant lit la recette du jour, la marge, les dettes et les ruptures.

FIRST VIEWPORT: Caisse. Ordinateur : rail indigo à gauche ; au centre recherche, puces de rayons, grille de produits (nom, prix détail / prix gros, stock) ; à droite le panier dont la bande d'en-tête, les badges de ligne et le bouton Encaisser portent la teinte du mode ; total en grands chiffres tabulaires. Téléphone : barre haute avec bascule Détail / Gros, liste de produits, barre panier collante à la teinte du mode au-dessus des onglets.

FORM: Coloris du pagne wax, candidat 5 sur 7 de la liste ordonnée (assigné par le tirage, choisi par l'utilisateur). seed:0718fd1602b6c44a

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
