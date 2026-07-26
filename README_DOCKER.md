# DSM - Dreamy Server Manager

`DSM` é uma aplicação Windows-first inspirada nos conceitos do Blueprint para gerenciar servidores Minecraft.

## ⚡ Quick Start com Docker (RECOMENDADO)

### 1. Instalar Docker
Baixe [Docker Desktop](https://www.docker.com/products/docker-desktop)

### 2. Iniciar
```powershell
# Windows PowerShell/CMD
cd "C:\Users\seu_user\Desktop\Dreamy Server Manager"
docker compose up -d

# Ou usando script
.\dsm-docker.bat start
```

### 3. Acessar
Abra no navegador: **http://localhost:3000**

**Credenciais:** admin / 85113005

### 4. Ver Logs
```powershell
docker compose logs -f dsm-app
# Ou
.\dsm-docker.bat logs
```

### 5. Parar
```powershell
docker compose stop
# Ou
.\dsm-docker.bat stop
```

## 📚 Documentação Docker Completa

Para configuração avançada, troubleshooting e mais detalhes:
👉 **[DOCKER.md](./DOCKER.md)**

## 🚀 Executar Sem Docker (Desenvolvimento Local)

### Requisitos
- Node.js ≥ 24
- (Opcional) OpenJDK 21 para servidores Minecraft

### Instalação
```bash
npm install
```

### Iniciar
```bash
node src/server.js
```

Abra: **http://127.0.0.1:3000**

### Testes
```bash
npm test
```

## 📦 O que Já Existe

- ✅ Painel local web com tema verde escuro + preto
- ✅ Sidebar estilo Pterodactyl com páginas:
  - Console
  - Files
  - Versions
  - Properties
  - Extensions
  - Settings
  - Home (seleção de servidor ativo)
- ✅ Animações e efeitos visuais
- ✅ Login com usuário/senha e sessão
- ✅ Controle de servidor (ligar, desligar, reiniciar)
- ✅ Envio de comandos e leitura de logs do console
- ✅ Status da máquina (CPU, RAM, tamanho da pasta)
- ✅ Contador de jogadores online com lista expandível
- ✅ Gerenciador de arquivos (upload, download, edição)
- ✅ Catálogo de versões Paper
- ✅ Editor de properties com autosave
- ✅ Painel admin para usuários
- ✅ Filesystems por extensão
- ✅ Parser de flags
- ✅ Render de placeholders
- ✅ CLI Windows com comandos iniciais
- ✅ Suporte a BungeeCord
- ✅ Gerenciamento de sub-servidores

## 🏗️ Estrutura

```
src/
├── server.js              # Servidor HTTP + API
├── cli.js                 # CLI local do DSM
└── lib/
    ├── storage-manager.js # Camada de storage
    ├── registry.js        # Cadastro de extensões
    ├── flags.js           # Parser de flags
    ├── placeholders.js    # Render de placeholders
    ├── server-runtime.js  # Controle de servidor Minecraft
    └── paper-versions.js  # Catálogo de versões Paper
public/                    # Frontend (HTML/CSS/JS)
├── index.html
├── app.js
└── styles.css
tests/                     # Testes em node:test
electron/                  # Integração Electron (opcional)
data/                      # Dados persistentes
├── accounts.json
├── runtime/
├── servers/
└── storage/
docker/                    # Arquivos Docker
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
└── scripts/               # Scripts auxiliares
```

## 🔧 Scripts Docker

### Windows (PowerShell/CMD)
```powershell
.\dsm-docker.bat start      # Iniciar
.\dsm-docker.bat stop       # Parar
.\dsm-docker.bat logs       # Ver logs
.\dsm-docker.bat rebuild    # Reconstruir
```

### Linux/Mac (Bash)
```bash
bash scripts/docker-start.sh      # Iniciar
bash scripts/docker-stop.sh       # Parar
bash scripts/docker-logs.sh       # Ver logs
bash scripts/docker-rebuild.sh    # Reconstruir
```

## 📊 Docker Setup

### Imagem
- **Name:** dreamyservermanager-dsm-app
- **Base:** node:24-alpine
- **Size:** ~2.5 GB
- **User:** dsm (não-root)

### Portas
- **3000** → Aplicação DSM
- **25565** → Minecraft (opcional)
- **25577** → BungeeCord (opcional)

### Volumes
- `dsm-data` → Contas, servidores, dados
- `dsm-logs` → Logs
- `dsm-backups` → Backups
- `dsm-config` → Configurações
- `dsm-server` → Servidor Minecraft

### Rede
- `dsm-network` (bridge, local)

## 🔥 Recursos

- ✅ Hot reload em desenvolvimento
- ✅ Health checks automáticos
- ✅ Volumes persistentes
- ✅ Multi-stage build
- ✅ Usuário não-root
- ✅ Layer caching
- ✅ Documentação completa

## 🎮 Usando com Minecraft

### Instalar servidor Paper

1. Acesse o painel: http://localhost:3000
2. Vá para **Versions**
3. Selecione uma versão Paper
4. Clique em **Download**
5. Vá para **Console** e clique **Start**

O servidor iniciará em http://localhost:25565

### Conectar com Cliente Minecraft

1. Abra Minecraft Java Edition
2. Multiplayer → Add Server
3. Server Address: `localhost:25565` (ou IP da máquina)
4. Done

## 🌐 Android (Termux)

O DSM também funciona em tablets Android via Termux:

```bash
pkg update && pkg upgrade
pkg install git nodejs openjdk-21
git clone https://github.com/seu_user/dsm.git
cd dsm
npm install
sh scripts/start-termux.sh
```

Para detalhes: [README-termux.md](./README-termux.md)

## 🐛 Solucionar Problemas

### Porta 3000 em uso?
```bash
# Mude em .env
APP_PORT=3001
docker compose restart
```

### Container não inicia?
```bash
docker compose logs dsm-app
```

### Limpar tudo?
```bash
docker compose down -v        # APAGA DADOS!
docker system prune -a
docker volume prune
```

## 📖 Mapeamento com Blueprint

- `conf.yml → info.flags` Refletido pelo parser de flags
- Placeholders: `{key}`, `{key!}`, `{key^}`, escape `!{key}`
- Filesystems `{fs}` e `{fs/private}`: mapeados para `public`/`private`
- Rotas custom: base API para extensões
- Scripts e comandos: base via CLI

## 🚀 Próximos Passos

1. ✅ Importar e validar `conf.yml` real (parser YAML completo)
2. ✅ Adicionar workflow de scripts Windows
3. ✅ Implementar mapeamento completo de routers
4. ✅ Empacotar como app desktop (Electron/Tauri)
5. ✅ Suporte a GitHub Codespaces

## 📝 CLI

```powershell
.\dsm.cmd -version
.\dsm.cmd -info
.\dsm.cmd -query extensão
.\dsm.cmd -install extensão "Descrição"
```

## 📚 Recursos

- [Docker.md](./DOCKER.md) - Guia Docker completo
- [README-termux.md](./README-termux.md) - Guia Android/Termux
- [Dockerfile](./Dockerfile) - Configuração Docker
- [docker-compose.yml](./docker-compose.yml) - Serviços Docker

## 👥 Contribuições

Sugestões e melhorias são bem-vindas!

## 📄 Licença

Este projeto é fornecido como é, para fins educacionais e pessoais.

---

**Status:** ✅ Pronto para Produção (com Docker)

**Versão:** 0.1.0

**Última Atualização:** 2024

**Acesso:** http://localhost:3000
