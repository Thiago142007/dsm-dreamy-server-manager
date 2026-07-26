#!/bin/bash
# Script para visualizar logs

LINES=${1:-50}

echo "=========================================="
echo "Logs - Dreamy Server Manager"
echo "=========================================="
echo ""

docker compose logs -f dsm-app --tail=$LINES
