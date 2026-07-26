# Docker Setup - Dreamy Server Manager

Este documento descreve como usar o Docker para executar o **Dreamy Server Manager (DSM)** em desenvolvimento.

## 📋 Requisitos

- **Docker Desktop** (Windows/Mac) ou **Docker Engine** (Linux)
- **Docker Compose** (geralmente incluído no Docker Desktop)
- Windows com WSL2 habilitado (para melhor performance)

### Instalar Docker

#### Windows
Baixe e instale [Docker Desktop para Windows](https://www.docker.com/products/docker-desktop)

Após instalar, abra PowerShell e verifique:
```powershell
docker --version
docker compose version
```

#### Ubuntu / Debian
```bash
sudo apt-get update
sudo apt-get install docker.io docker-compose
sudo usermod -aG docker $USER
newgrp docker
```

#### Verificar Instalação
```bash
docker ps
docker compose ps
```

---

## 🚀 Iniciar o Ambiente

### 1. Clonar ou Acessar o Projeto
```bash
cd "C:\Users\seu_user\Desktop\Dreamy Server Manager"
```

### 2. Copiar Arquivo de Configuração
```bash
# Se usar .env.example
cp .env.example .env
```

O arquivo `.env` contém as configurações padrão. Edite-o se necessário.

### 3. Iniciar os Containers

**Opção A - Usando Docker Compose (Recomendado)**
```bash
docker compose up -d
```

**Opção B - Usando Script**
```bash
# Windows
.\scripts\docker-start.sh

# Linux/Mac
bash scripts/docker-start.sh
```

### 4. Verificar Status
```bash
docker compose ps
```

Você deverá ver:
```
NAME      IMAGE                         COMMAND      SERVICE   STATUS
dsm-app   dreamyservermanager-dsm-app   node src/... dsm-app   Up (healthy)
```

### 5. Acessar o Painel

Abra no navegador:
```
http://localhost:3000
```

**Credenciais Padrão:**
- Usuário: `admin`
- Senha: `85113005`

---

## 🛑 Parar o Ambiente

### Parar Containers (Mantém Dados)
```bash
docker compose stop
```

### Remover Containers (Mantém Volumes)
```bash
docker compose down
```

### Remover Tudo (Apaga Volumes e Dados!)
```bash
docker compose down -v
```

---

## 🔄 Reconstruir/Reiniciar

### Reconstruir Imagem
```bash
docker compose build --no-cache
```

### Reconstruir e Iniciar
```bash
docker compose build --no-cache
docker compose up -d
```

---

## 📊 Monitorar Logs

### Ver Logs em Tempo Real
```bash
docker compose logs -f dsm-app
```

### Ver Últimas 50 Linhas
```bash
docker compose logs dsm-app --tail=50
```

### Usando Script
```bash
bash scripts/docker-logs.sh 50
```

---

## 💾 Dados Persistentes

Os volumes Docker garantem que seus dados sejam preservados mesmo ao remover containers:

| Volume           | Dados                              | Local Host                    |
|------------------|-----------------------------------|-------------------------------|
| `dsm-data`       | Contas, servidores, storage       | Docker volume interno         |
| `dsm-logs`       | Logs da aplicação                 | Docker volume interno         |
| `dsm-backups`    | Backups exportados                | Docker volume interno         |
| `dsm-config`     | Configurações                     | Docker volume interno         |
| `dsm-server`     | Servidor Minecraft (opcional)     | Docker volume interno         |

### Acessar Volumes
```bash
docker volume ls
docker volume inspect dreamyservermanager_dsm-data
```

---

## 📦 Exportar Dados

### Criar Backup
```bash
bash scripts/docker-export.sh
```

Isso cria um arquivo `dsm_backup_YYYYMMDD_HHMMSS.tar.gz` na pasta `./backups`.

### Copiar Dados de um Volume
```bash
docker run --rm -v dreamyservermanager_dsm-data:/data -v ./backup:/backup alpine tar -czf /backup/dsm-data.tar.gz -C /data .
```

---

## 🧪 Executar Testes

```bash
docker compose exec -T dsm-app npm test
```

Ou usando script:
```bash
bash scripts/docker-test.sh
```

---

## 🔥 Hot Reload (Desenvolvimento)

O ambiente está configurado com **hot reload** automático:

- Edite arquivos em `./src` e `./public`
- Alterações são refletidas automaticamente no container
- Não é necessário reconstruir a imagem

Se o hot reload não funcionar, reinicie:
```bash
docker compose restart dsm-app
```

---

## 🐛 Solucionar Problemas

### Container Não Inicia
```bash
docker compose logs dsm-app
```

### Porta 3000 Já em Uso
Altere em `.env`:
```
APP_PORT=3001
```

Depois acesse: `http://localhost:3001`

### Limpar Cache Docker
```bash
docker system prune -a
docker builder prune
```

### Remover Volume Específico
```bash
docker volume rm dreamyservermanager_dsm-data
```

---

## 📁 Estrutura de Arquivos Docker

```
Dreamy Server Manager/
├── Dockerfile              # Imagem multi-stage (dev + prod)
├── docker-compose.yml      # Configuração dos serviços
├── .dockerignore           # Arquivos ignorados no build
├── .env.example            # Template de variáveis
├── .env                    # Configurações (crie a partir do .example)
└── scripts/
    ├── docker-start.sh     # Iniciar ambiente
    ├── docker-stop.sh      # Parar containers
    ├── docker-rebuild.sh   # Reconstruir imagem
    ├── docker-logs.sh      # Ver logs
    ├── docker-export.sh    # Exportar dados
    └── docker-test.sh      # Executar testes
```

---

## 🎯 Fluxo de Trabalho Típico

```bash
# 1. Clonar/Acessar projeto
cd "C:\Users\seu_user\Desktop\Dreamy Server Manager"

# 2. Iniciar
docker compose up -d

# 3. Abrir no navegador
# http://localhost:3000

# 4. Fazer edições em ./src e ./public
# Hot reload aplica automaticamente

# 5. Ver logs se necessário
docker compose logs -f dsm-app

# 6. Parar ao terminar
docker compose down
```

---

## 🌐 Acessar de Outro Computador

Se o Docker está rodando em um servidor/VM e você quer acessar de outro PC:

**No container:**
```bash
docker compose logs dsm-app | grep "running at"
```

Se ver `http://0.0.0.0:3000` ou `http://127.0.0.1:3000`, acesse de outro PC usando o IP da máquina:
```
http://IP_DA_MAQUINA:3000
```

Para facilitar, altere `.env`:
```
HOST=0.0.0.0
```

---

## 📝 Variáveis de Ambiente

Edite `.env` para customizar:

```bash
# Porta da aplicação
APP_PORT=3000

# Nível de log
LOG_LEVEL=info

# Ambiente
NODE_ENV=development

# Credenciais padrão (MUDE EM PRODUÇÃO!)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=85113005

# Limites
MAX_SERVERS_PER_USER=5
```

---

## ✅ Checklist de Configuração

- [ ] Docker e Docker Compose instalados
- [ ] Projeto clonado ou baixado
- [ ] Arquivo `.env` criado
- [ ] Containers iniciados: `docker compose up -d`
- [ ] Painel acessível em `http://localhost:3000`
- [ ] Login funciona com admin / 85113005
- [ ] Dados são salvos em volumes

---

## 📚 Recursos Adicionais

- [Docker Docs](https://docs.docker.com)
- [Docker Compose Docs](https://docs.docker.com/compose)
- [Dreamy Server Manager - README](./README.md)
- [Termux/Android Guide](./README-termux.md)

---

## 💬 Suporte

Para problemas ou dúvidas:

1. Consulte os logs: `docker compose logs dsm-app`
2. Verifique `.env` está correto
3. Reinicie containers: `docker compose restart`
4. Limpe e reconstrua: `docker compose down -v && docker compose up -d --build`

---

**Última atualização:** 2024
**Versão DSM:** 0.1.0
