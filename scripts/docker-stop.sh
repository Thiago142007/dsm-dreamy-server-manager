#!/bin/bash
# Script para parar containers Docker

echo "Parando Dreamy Server Manager..."
docker compose down

echo ""
echo "✓ Containers parados"
echo ""
echo "Para remover volumes de dados permanentemente, execute:"
echo "  docker compose down -v"
echo ""
