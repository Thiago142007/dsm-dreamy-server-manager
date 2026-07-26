#!/bin/bash
# Script auxiliar para descarregar dados do Docker volume

VOLUME_NAME="dreamyservermanager_dsm-data"
BACKUP_NAME="dsm_volume_backup_$(date +%Y%m%d_%H%M%S)"

echo "=========================================="
echo "Exportando Volume Docker"
echo "=========================================="
echo ""
echo "Volume: $VOLUME_NAME"
echo "Backup: $BACKUP_NAME.tar.gz"
echo ""

mkdir -p ./backups

docker run --rm \
  -v "${VOLUME_NAME}:/volume_data" \
  -v "$(pwd)/backups:/backup" \
  alpine tar -czf "/backup/${BACKUP_NAME}.tar.gz" -C /volume_data .

echo ""
echo "✓ Backup concluído em: ./backups/${BACKUP_NAME}.tar.gz"
echo ""
echo "Para restaurar:"
echo "  docker volume create ${VOLUME_NAME}_restore"
echo "  docker run --rm -v ${VOLUME_NAME}_restore:/volume_data -v \$(pwd)/backups:/backup alpine tar -xzf /backup/${BACKUP_NAME}.tar.gz -C /volume_data"
