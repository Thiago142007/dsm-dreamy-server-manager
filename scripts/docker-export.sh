#!/bin/bash
# Script para exportar dados

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="dsm_backup_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

echo "=========================================="
echo "Exportando Dados do DSM"
echo "=========================================="
echo ""
echo "Backup: $BACKUP_FILE"
echo ""

# Parar containers sem remover volumes
echo "Parando containers..."
docker compose stop

echo "Compactando dados..."
tar -czf "$BACKUP_DIR/$BACKUP_FILE" ./data ./config ./server

echo "Reiniciando containers..."
docker compose start

echo ""
echo "✓ Backup concluído em: $BACKUP_DIR/$BACKUP_FILE"
echo ""
