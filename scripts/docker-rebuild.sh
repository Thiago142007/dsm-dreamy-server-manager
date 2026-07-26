#!/bin/bash
# Script para reconstruir imagem Docker do zero

echo "================================================"
echo "Reconstruindo Dreamy Server Manager (sem cache)"
echo "================================================"

docker compose build --no-cache

echo ""
echo "✓ Imagem reconstruída com sucesso"
echo ""
echo "Iniciando containers..."
docker compose up -d

echo ""
docker compose ps

echo ""
echo "✓ Containers reiniciados"
