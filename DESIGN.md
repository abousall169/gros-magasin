---
name: Caisse gros & détail
description: Logiciel de caisse local pour magasin de gros et de détail, sur téléphone, tablette et ordinateur.
colors:
  rail-indigo: "#161d52"
  rail-indigo-hover: "#232c70"
  rail-ink: "#eceefb"
  rail-muted: "#a8aed8"
  primary-hover: "#0f1540"
  ground: "#f2f3f8"
  panel: "#ffffff"
  sunk: "#e8eaf2"
  line: "#d9dce8"
  line-strong: "#b9bed2"
  ink: "#141832"
  ink-2: "#464c6b"
  ink-3: "#5f6587"
  saffron: "#f0a30a"
  saffron-soft: "#fff1d3"
  saffron-ink: "#845600"
  saffron-data: "#d48b00"
  gros-indigo: "#3040c4"
  gros-soft: "#e6e9fc"
  gros-ink: "#2b39b2"
  vermilion: "#d2391b"
  vermilion-soft: "#fde7e2"
  vermilion-ink: "#ad2e13"
  emerald: "#0d7a52"
  emerald-soft: "#ddf3e9"
  emerald-ink: "#0a6544"
  chart-bar: "#7f8ae0"
  chart-today: "#3f4aa3"
typography:
  hero:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "3rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  total:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "2.125rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.4375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  heading:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.3
  caption:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', 'Helvetica Neue', Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.35
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.rail-indigo}"
    textColor: "{colors.panel}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-mode-retail:
    backgroundColor: "{colors.saffron}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "56px"
  button-mode-wholesale:
    backgroundColor: "{colors.gros-indigo}"
    textColor: "{colors.panel}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "56px"
  cart-band-retail:
    backgroundColor: "{colors.saffron}"
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
    padding: "12px 16px"
  cart-band-wholesale:
    backgroundColor: "{colors.gros-indigo}"
    textColor: "{colors.panel}"
    typography: "{typography.heading}"
    padding: "12px 16px"
  chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 14px"
    height: "36px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
    height: "44px"
  tile:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 16px"
    height: "136px"
  badge-credit:
    backgroundColor: "{colors.vermilion-soft}"
    textColor: "{colors.vermilion-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    height: "24px"
  badge-paid:
    backgroundColor: "{colors.emerald-soft}"
    textColor: "{colors.emerald-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    height: "24px"
---

# Design System: Caisse gros & détail

## Overview

**Creative North Star: "Les coloris du pagne"**

Une caisse de magasin qui parle par aplats de couleur, comme un pagne wax : un rail indigo profond, un fond très pâle, des panneaux blancs, et deux teintes réservées au régime de prix. Quand le vendeur passe en gros, toute la caisse prend l'indigo vif ; au détail, le safran. Le mode de vente ne se cache jamais dans un menu : il se voit de loin, sur le panier, le bouton Encaisser et la barre panier du téléphone.

C'est un outil de travail utilisé debout, au comptoir, dans un magasin lumineux. Polices système (aucune ressource en ligne : tout marche sur le réseau local), composants familiers, densité confortable, cibles tactiles généreuses, chiffres lourds et alignés. La personnalité tient dans la couleur et dans ce seul geste, pas dans l'ornement : aucun motif wax, aucune texture, aucun dégradé.

**Key Characteristics:**
- Rail indigo profond, fond indigo très pâle, panneaux blancs séparés par la couleur plutôt que par des bordures.
- Safran = Détail, indigo vif = Gros : bande du panier, bouton Encaisser, barre panier, pastilles de ligne.
- Vermillon pour crédit, dettes, ruptures ; émeraude pour payé et caisse juste.
- Police système, chiffres tabulaires dans les colonnes, grand chiffre proportionnel pour le chiffre phare.
- Cibles tactiles de 44 px et plus ; panier et encaissement en plein écran sur téléphone.

## Colors

Une coquille indigo, des aplats clairs, et une paire de teintes qui ne sert qu'à dire « détail » ou « gros ».

### Primary
- **Indigo du rail** (#161d52): rail de navigation, barre haute du téléphone, écran de connexion, boutons d'action hors caisse (Enregistrer, Valider). Survol : #0f1540 ; lien actif du rail : fond #eceefb, texte indigo.

### Secondary
- **Safran — Détail** (#f0a30a): bande du panier et bouton Encaisser en mode détail, segment actif « Détail », marqueur carré des prix de détail. Texte posé dessus : encre #141832. Fond pâle #fff1d3 / encre #845600 pour les pastilles « Détail ». Dans les graphiques : #d48b00 (le safran pur est trop clair pour une donnée).

### Tertiary
- **Indigo vif — Gros** (#3040c4): mêmes rôles en mode gros ; texte blanc dessus. Fond pâle #e6e9fc / encre #2b39b2 pour les pastilles « Gros ».

### Neutral
- **Fond** (#f2f3f8): fond de toutes les pages ; légèrement teinté d'indigo, jamais crème.
- **Panneau** (#ffffff): panneaux, tuiles produits, listes, feuilles.
- **Creux** (#e8eaf2): pistes des contrôles segmentés, touches du pavé PIN, compteurs de quantité.
- **Filets** (#d9dce8 / #b9bed2): séparation des lignes de listes et tableaux ; contour des champs et boutons secondaires.
- **Encre** (#141832 / #464c6b / #5f6587): texte principal, secondaire, tertiaire (≥ 4,5:1 sur fond et panneau).
- **États** : vermillon #d2391b (fond #fde7e2, encre #ad2e13) pour crédit, dettes, ruptures, erreurs, annulation ; émeraude #0d7a52 (fond #ddf3e9, encre #0a6544) pour payé, bénéfice, caisse juste.
- **Graphiques** : jours passés #7f8ae0, aujourd'hui #3f4aa3, survol #2f3a8f (palette validée daltonisme et contraste).

### Named Rules
**The Colorway Rule.** Le safran et l'indigo vif appartiennent au mode de vente : bande du panier, bouton Encaisser, barre panier, pastilles Détail / Gros, marqueurs de prix et données gros / détail. Jamais en décoration ailleurs.

**The Field Rule.** Les zones se séparent par des aplats (rail, fond, panneau blanc, bande de mode), pas par des bordures ni des ombres. Les filets restent à l'intérieur des listes et des tableaux.

## Typography

**Display Font:** police système (system-ui, -apple-system, Segoe UI, Roboto, Noto Sans) — une seule famille pour tout.
**Body Font:** la même.

### Hierarchy
- **Chiffre phare** (800, 3rem, interligne 1,05, -0,025em) : une fois par vue (recette du jour, chiffre d'affaires de la période). Chiffres proportionnels.
- **Total** (800, 2,125rem) : total du panier, monnaie à rendre, solde client.
- **Titre de page** (700, 1,4375rem) : masqué sur téléphone, où la barre haute porte le nom de la page.
- **Titre de panneau** (700, 1,1875rem) : panneaux, feuilles, bande du panier (« Vente en gros · 3 articles »).
- **Texte** (400, 1rem, interligne 1,45) : texte courant ; champs à 16 px (pas de zoom automatique sur iPhone).
- **Libellé** (600, 0,875rem) : libellés de champs, boutons, puces, cellules.
- **Légende** (600–700, 0,75rem) : sous-lignes, unités, en-têtes de tableau, pastilles.

### Named Rules
**The Ledger Numerals Rule.** Montants et quantités en colonnes : chiffres tabulaires alignés à droite. Le chiffre phare, seul, garde des chiffres proportionnels.

## Layout

Échelle d'espacement 4 · 8 · 12 · 16 · 24 · 32 · 48 px. Pages : marge 32 px (24 sur tablette, 16 sur téléphone), largeur max 1440 px, deux colonnes de panneaux qui passent à une sur téléphone.

- **Ordinateur (> 1180 px)** : rail de 228 px à gauche ; caisse en deux zones : produits (grille de tuiles ≥ 196 px) et panier de 392 px à droite, hauteur de l'écran.
- **Tablette (761–1180 px)** : rail réduit à 84 px (icône + libellé court), panier de 344 px.
- **Téléphone (≤ 760 px)** : barre haute indigo + 4 onglets en bas + « Plus » ; produits en liste ; barre panier collante à la teinte du mode ; panier et encaissement en plein écran.

## Elevation & Depth

Profondeur par aplats, pas par ombres. Une seule échelle : rail → fond → panneau → feuille.

### Shadow Vocabulary
- **Feuille** (`0 18px 48px rgba(20,24,50,.22), 0 2px 6px rgba(20,24,50,.12)`) : dialogues et feuilles.
- **Flottant** (`0 10px 28px rgba(14,17,40,.28)`) : barre panier du téléphone, notifications.
- **Segment actif** (`0 1px 2px rgba(20,24,50,.16)`) : segment choisi d'un contrôle segmenté.

### Named Rules
**The One Ladder Rule.** Seuls les feuilles, notifications et la barre panier du téléphone portent une ombre. Panneaux et tuiles restent à plat sur le fond.

**The Phone Owns the Screen Rule.** Sur téléphone, panier et encaissement occupent tout l'écran ; rien ne rivalise avec le montant à payer.

## Shapes

Coins de 8 px pour les contrôles (boutons, champs), 12 px pour les panneaux, tuiles et grands boutons, 16 px pour les feuilles ; pilules (999 px) pour puces, pastilles, bascule Détail / Gros et compteurs. Marqueurs de prix : carrés de 8 px à coins de 2 px. Barres de graphique : extrémité arrondie de 4 px, base carrée, 24 px de large au plus.

## Components

### Buttons
- **Principal** : indigo du rail, texte blanc, 44 px, coins 8 px. Pour enregistrer et valider hors caisse.
- **Encaisser (teinte du mode)** : 56 px, coins 12 px, safran (texte encre) ou indigo vif (texte blanc) ; transition de teinte 200 ms.
- **Secondaire** : blanc, contour #b9bed2. **Danger** : contour rosé, texte vermillon ; plein vermillon pour la confirmation finale.
- États : survol (fond creux ou plus sombre), appui (décalage de 1 px), focus (double anneau blanc + encre), désactivé (45 % d'opacité), chargement (spinner, texte masqué).

### Chips
Pilules de 36 px, contour #b9bed2, texte encre secondaire ; actives en encre pleine. Rayons en caisse, périodes des rapports, filtres de listes.

### Cards / Containers
Panneaux blancs à coins 12 px, padding 24 px (16 sur téléphone), posés à plat sur le fond. Pas de cartes imbriquées. Les listes sont des panneaux à lignes séparées par des filets.

### Inputs / Fields
44 px (52 px pour la recherche en caisse), contour #b9bed2, coins 8 px ; focus : contour encre + halo 3 px. Montants alignés à droite. Libellé au-dessus, aide en légende en dessous, erreur en vermillon avec le moyen de corriger.

### Navigation
Rail indigo : liens 44 px, actif en fond clair et texte indigo. Téléphone : barre haute indigo (titre, changement d'utilisateur) et barre d'onglets blanche avec indicateur de 3 px en haut de l'onglet actif.

### Caisse : bande du panier et bascule Détail / Gros
La bande d'en-tête du panier est un aplat à la teinte du mode, titrée « Vente au détail » ou « Vente en gros · n articles ». La bascule y prend un segment actif blanc ; hors de la bande (téléphone), le segment actif prend la teinte du mode. Chaque ligne porte une pastille Détail / Gros cliquable, le prix unitaire « 14 400 / carton » sous le nom, le compteur de quantité et la corbeille.

## Do's and Don'ts

### Do:
- **Do** donner la teinte du mode à tout ce qui dépend du prix (bande, bouton Encaisser, barre panier, pastille de ligne).
- **Do** écrire les montants avec le séparateur de milliers et la devise : « 43 150 FCFA ».
- **Do** accompagner chaque couleur d'état d'un mot (Doit, Payée, Rupture).
- **Do** garder les libellés du commerce : carton, sac, versement, crédit, réception.

### Don't:
- **Don't** utiliser le safran ou l'indigo vif pour décorer un titre, une icône ou un graphique sans rapport avec gros / détail.
- **Don't** poser de sur-titre en petites capitales au-dessus d'un titre.
- **Don't** ajouter de motif wax, de texture ou de dégradé : le monde tient dans les aplats.
- **Don't** afficher un prix d'achat ou une marge à un vendeur.
