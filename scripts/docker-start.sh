#!/bin/bash
# Script de inicialização para Docker - Desenvolvimento

set -e

echo "=========================================="
echo "Dreamy Server Manager - Inicialização Docker"
echo "=========================================="

# Criar diretórios se não existirem
mkdir -p ./data/runtime ./data/servers ./data/storage ./logs ./backups ./config ./server

echo "✓ Diretórios criados"

# Criar arquivo .env se não existir
if [ ! -f .env ]; then
    echo "Criando .env do .env.example..."
    cp .env.example .env
    echo "✓ .env criado - Edite-o se necessário"
else
    echo "✓ .env já existe"
fi

echo ""
echo "Construindo imagem Docker..."
docker compose build

echo ""
echo "=========================================="
echo "Iniciando containers..."
echo "=========================================="

docker compose up -d

sleep 3

echo ""
echo "=========================================="
echo "Status dos Containers:"
echo "=========================================="
docker compose ps

echo ""
echo "=========================================="
echo "Logs da Aplicação:"
echo "=========================================="
docker compose logs dsm-app --tail=20

echo ""
echo "=========================================="
echo "✓ Dreamy Server Manager está rodando!"
echo "=========================================="
echo ""
echo "Acesse em: http://localhost:3000"
echo ""
echo "Credenciais padrão:"
echo "  Usuário: admin"
echo "  Senha: 85113005"
echo ""
echo "Comandos úteis:"
echo "  Ver logs:        docker compose logs -f dsm-app"
echo "  Parar:           docker compose down"
echo "  Reconstruir:     docker compose build --no-cache && docker compose up -d"
echo "  Remover volumes: docker compose down -v"
echo ""
