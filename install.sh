#!/bin/bash
# Instala o DSM no sistema (Ubuntu/Debian/Fedora com .deb).
set -e
cd "$(dirname "$0")"

DEB=$(ls -t src-tauri/target/release/bundle/deb/*.deb 2>/dev/null | head -1)
if [ -z "$DEB" ]; then
  echo "Nenhum .deb encontrado. Rode primeiro:  npm run tauri build"
  exit 1
fi

echo "Instalando $DEB ..."
sudo dpkg -i "$DEB" || sudo apt-get install -f -y
echo
echo "Pronto! Procure por \"DSM\" no menu de aplicativos,"
echo "ou rode o comando:  dsm"
echo
echo "Para remover:  sudo apt remove dsm"
