@echo off
setlocal

set "REPO=Thiago142007/dsm-dreamy-server-manager"
set "BRANCH=main"
set "CODESPACE_URL=https://codespaces.new/%REPO%?quickstart=1^&ref=%BRANCH%"

echo Abrindo o Dreamy Server Manager no GitHub Codespaces...
echo Repositorio: %REPO%
echo.

where gh >nul 2>nul
if errorlevel 1 (
  echo GitHub CLI nao encontrado. Abrindo a pagina de criacao do Codespace no navegador.
  start "" "%CODESPACE_URL%"
  echo.
  echo URL: %CODESPACE_URL%
  exit /b 0
)

gh auth status -h github.com >nul 2>nul
if errorlevel 1 (
  echo Voce precisa entrar no GitHub CLI antes de usar Codespaces.
  gh auth login -h github.com -w
  if errorlevel 1 (
    echo Nao foi possivel autenticar pelo GitHub CLI. Abrindo a pagina no navegador.
    start "" "%CODESPACE_URL%"
    echo.
    echo URL: %CODESPACE_URL%
    exit /b 0
  )
)

echo Tentando abrir um Codespace existente no VS Code Web...
gh codespace code -R "%REPO%" --web
if not errorlevel 1 (
  echo Codespace aberto no navegador.
  exit /b 0
)

echo.
echo Nenhum Codespace existente foi aberto. Abrindo a criacao de um novo Codespace.
echo Se o GitHub CLI pedir permissao de Codespaces, execute:
echo gh auth refresh -h github.com -s codespace
echo.

gh codespace create -R "%REPO%" -b "%BRANCH%" --web
if errorlevel 1 (
  start "" "%CODESPACE_URL%"
)

echo URL: %CODESPACE_URL%
