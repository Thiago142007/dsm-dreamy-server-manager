# DSM - Dreamy Server Manager

`DSM` e uma base Windows-first inspirada nos conceitos do Blueprint para criadores de servidores Minecraft.

## O que ja existe

- Painel local web com tema verde escuro + preto
- Sidebar estilo Pterodactyl com paginas: `Console`, `Files`, `Versions`, `Properties`, `Extensions`, `Settings`
- Sidebar com pagina extra `Home` (selecao de servidor ativo)
- Animacoes e efeitos visuais (transicoes de pagina, hover glow e fundo animado)
- Login com usuario/senha e sessao
- Conta admin padrao: `admin` / `85113005`
- Registro de extensoes
- Controle de servidor na aba `Console`:
- botoes `Ligar`, `Desligar`, `Reiniciar`
- envio de comandos
- leitura de logs do console
- status da maquina (CPU, RAM, tamanho da pasta do servidor)
- contador de jogadores online e lista expansivel com head + link NameMC
- Aba `Files` ligada aos arquivos reais da pasta do servidor (`/api/server/files`)
- upload de arquivos
- download simples e multiplo
- selecao multipla para excluir/copiar/recortar + colar
- editor de arquivos com salvamento
- Aba `Versoes` com catalogo Paper e download automatico de `.jar` para a pasta do servidor
- Aba `Properties` para editar `server.properties`
- `difficulty` com seletor (`easy`, `normal`, `hard`)
- `gamemode` com seletor (`survival`, `creative`, `adventure`, `spectator`)
- propriedades booleanas com selecao clicavel entre `true` e `false`
- autosave de propriedades ao editar
- tooltip em cada propriedade com descricao da configuracao
- Aba `Settings` para troca de tema (`Green`, `Dark`, `Light`)
- Painel admin para criar/excluir contas e definir maximo de servidores por usuario
- Filesystems por extensao:
- `public`: arquivos publicos (`/fs/...` no modelo Blueprint)
- `private`: arquivos privados
- Operacoes de arquivo:
- `put`, `get`, `json`, `exists`, `copy`, `move`
- `append`, `prepend`, `delete`
- `files`, `directories`, `makeDirectory`, `deleteDirectory`
- Parser de flags (`info.flags`) com lista separada por virgula
- Render basico de placeholders com suporte a escape `!{name}`
- CLI Windows (`dsm.cmd`) com comandos iniciais:
- `-version`, `-info`, `-query`, `-install`

## Estrutura

- `src/server.js`: servidor HTTP + API
- `src/cli.js`: CLI local do DSM
- `src/lib/storage-manager.js`: camada de storage
- `src/lib/registry.js`: cadastro e metadados de extensoes
- `src/lib/flags.js`: parser de flags
- `src/lib/placeholders.js`: render de placeholders
- `src/lib/server-runtime.js`: controle de processo do servidor Minecraft
- `src/lib/paper-versions.js`: catalogo de versoes Paper
- `public/*`: frontend do painel
- `tests/*`: testes em `node:test`

## Executar

```powershell
node src/server.js
```

Abra:

- [http://127.0.0.1:3000](http://127.0.0.1:3000)

## Testes

```powershell
node --test --test-isolation=none
```

## CLI

```powershell
.\dsm.cmd -info
.\dsm.cmd -version
.\dsm.cmd -install dreamycore "Dreamy Core"
.\dsm.cmd -query dreamycore
```

## Mapeamento com Blueprint

- `conf.yml > info.flags`: refletido pelo parser de flags
- Placeholders: suporte inicial para `{key}`, `{key!}`, `{key^}` e escape `!{key}`
- Filesystems `{fs}` e `{fs/private}`: mapeados para `public`/`private` por extensao
- Rotas custom: base API para evoluir (`/api/extensions/...`)
- Scripts e comandos: base via CLI para expandir fluxos tipo Blueprint

## Proximos passos sugeridos

1. Importar e validar `conf.yml` real (parser YAML completo)
2. Adicionar workflow de scripts Windows (`install.ps1`, `update.ps1`, `remove.ps1`)
3. Implementar mapeamento completo de routers (`application`, `client`, `web`)
4. Empacotar como app desktop (Electron/Tauri) mantendo o backend local
