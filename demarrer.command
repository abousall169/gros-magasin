#!/bin/bash
# Démarre le logiciel de caisse (Mac). Double-cliquez sur ce fichier.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-3000}"

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js n'est pas installé sur cet ordinateur."
  echo "  Téléchargez la version « LTS » sur https://nodejs.org puis relancez ce fichier."
  open "https://nodejs.org/fr/download" 2>/dev/null
  read -r -p "  Appuyez sur Entrée pour fermer…"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "  Première installation (une connexion Internet est nécessaire une seule fois)…"
  if ! npm install --omit=dev --no-audit --no-fund; then
    echo "  L'installation a échoué. Vérifiez la connexion Internet puis relancez."
    read -r -p "  Appuyez sur Entrée pour fermer…"
    exit 1
  fi
fi

( sleep 2 && open "http://localhost:${PORT}" ) &
PORT="$PORT" node --disable-warning=ExperimentalWarning server/index.js
echo ""
read -r -p "  Le logiciel est arrêté. Appuyez sur Entrée pour fermer cette fenêtre…"
