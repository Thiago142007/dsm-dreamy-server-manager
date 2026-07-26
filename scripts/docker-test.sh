#!/bin/bash
# Script para executar testes no container Docker

echo "=========================================="
echo "Executando Testes - DSM"
echo "=========================================="
echo ""

docker compose exec -T dsm-app npm test

echo ""
echo "✓ Testes concluídos"
