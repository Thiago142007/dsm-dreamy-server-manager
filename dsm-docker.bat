@echo off
REM Script auxiliar para gerenciar Docker - DSM
REM Use: dsm-docker.bat [comando]

setlocal enabledelayedexpansion

if "%1"=="" goto :show_menu
if /i "%1"=="start" goto :start
if /i "%1"=="stop" goto :stop
if /i "%1"=="restart" goto :restart
if /i "%1"=="logs" goto :logs
if /i "%1"=="build" goto :build
if /i "%1"=="rebuild" goto :rebuild
if /i "%1"=="status" goto :status
if /i "%1"=="shell" goto :shell
if /i "%1"=="test" goto :test
if /i "%1"=="export" goto :export
if /i "%1"=="help" goto :show_help

echo Comando desconhecido: %1
goto :show_menu

:show_menu
cls
echo.
echo ===============================================
echo   Dreamy Server Manager - Docker Control
echo ===============================================
echo.
echo Comandos disponíveis:
echo.
echo   dsm-docker start       - Iniciar containers
echo   dsm-docker stop        - Parar containers
echo   dsm-docker restart     - Reiniciar containers
echo   dsm-docker rebuild     - Reconstruir imagem
echo   dsm-docker status      - Ver status
echo   dsm-docker logs        - Ver logs
echo   dsm-docker shell       - Entrar no container
echo   dsm-docker test        - Executar testes
echo   dsm-docker export      - Exportar dados (backup)
echo   dsm-docker help        - Mostrar ajuda
echo.
echo.
echo Acesso rápido:
echo   http://localhost:3000
echo.
goto :end

:show_help
cls
echo.
echo ===============================================
echo   AJUDA - Dreamy Server Manager Docker
echo ===============================================
echo.
echo USO: dsm-docker [comando]
echo.
echo COMANDOS:
echo.
echo   start
echo     Inicia os containers Docker
echo     Equivalente: docker compose up -d
echo.
echo   stop
echo     Para os containers (mantém dados)
echo     Equivalente: docker compose stop
echo.
echo   restart
echo     Para e inicia os containers
echo     Equivalente: docker compose restart
echo.
echo   rebuild
echo     Reconstrói a imagem Docker sem cache
echo     Equivalente: docker compose build --no-cache
echo.
echo   status
echo     Mostra o status dos containers
echo     Equivalente: docker compose ps
echo.
echo   logs
echo     Mostra logs em tempo real
echo     Equivalente: docker compose logs -f dsm-app
echo.
echo   shell
echo     Entra no terminal do container
echo     Equivalente: docker compose exec -it dsm-app sh
echo.
echo   test
echo     Executa os testes automatizados
echo     Equivalente: docker compose exec -T dsm-app npm test
echo.
echo   export
echo     Cria backup dos dados
echo     Arquivo: ./backups/dsm_backup_YYYYMMDD_HHMMSS.tar.gz
echo.
echo EXEMPLOS:
echo.
echo   dsm-docker start
echo   dsm-docker logs
echo   dsm-docker stop
echo.
goto :end

:start
echo Iniciando Dreamy Server Manager...
docker compose up -d
echo.
echo Status dos containers:
docker compose ps
echo.
echo Acesse: http://localhost:3000
goto :end

:stop
echo Parando containers...
docker compose stop
echo.
echo Para remover containers (mantém volumes):
echo   docker compose down
echo.
echo Para remover tudo (APAGA DADOS!):
echo   docker compose down -v
goto :end

:restart
echo Reiniciando containers...
docker compose restart
echo.
docker compose ps
goto :end

:rebuild
echo Reconstruindo imagem Docker (sem cache)...
docker compose build --no-cache
echo.
echo Iniciando containers...
docker compose up -d
echo.
docker compose ps
goto :end

:status
echo Status dos containers:
docker compose ps
echo.
echo Volumes:
docker volume ls | find "dreamy"
echo.
echo Rede:
docker network ls | find "dreamy"
goto :end

:logs
echo Logs - Dreamy Server Manager (CTRL+C para sair)
docker compose logs -f dsm-app
goto :end

:shell
echo Entrando no container (digite 'exit' para sair)
docker compose exec -it dsm-app sh
goto :end

:test
echo Executando testes...
docker compose exec -T dsm-app npm test
goto :end

:export
echo Exportando dados do DSM...
bash scripts/docker-export.sh
goto :end

:end
endlocal
