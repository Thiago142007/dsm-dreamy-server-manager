#!/data/data/com.termux/files/usr/bin/sh
set -eu

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-3000}"
SERVER_DIR="${SERVER_DIR:-server}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js nao encontrado. Instale com: pkg install nodejs"
  exit 1
fi

if ! command -v pkg >/dev/null 2>&1; then
  echo "Gerenciador pkg nao encontrado. Execute este script dentro do Termux."
  exit 1
fi

if ! command -v java >/dev/null 2>&1; then
  echo "Java nao encontrado. O DSM tentara instalar automaticamente pelo Termux quando o servidor iniciar."
fi

echo "Iniciando DSM no Termux..."
echo "Painel local: http://127.0.0.1:${PORT}"
echo "Painel na rede: http://IP_DO_TABLET:${PORT}"
echo "Pasta do servidor: ${SERVER_DIR}"
echo

HOST="$HOST" PORT="$PORT" SERVER_DIR="$SERVER_DIR" node src/server.js
