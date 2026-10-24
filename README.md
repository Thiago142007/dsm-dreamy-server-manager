# DSM — Painel de Servidor de Minecraft (Linux)

App desktop para quem quer hospedar o próprio servidor de Minecraft sem saber
linha de comando. A interface copia a do Minecraft Java: mesma fonte bitmap,
mesmos botões, mesmos texturas e sons.

> **Estado atual:** Fase 1 entregue (núcleo funcional). Veja “O que já
> funciona” abaixo.

---

## O que já funciona

**Tela inicial**
- Lista de servidores em cards, com o botão **“+”** sempre em primeiro lugar.
- Cada card mostra software, versão, RAM, porta e o status (Online/Offline).

**Criar servidor**
- Logo opcional: escolhe a imagem e o app corta/redimensiona para **64×64**
  (o tamanho máximo do `server-icon.png` do Minecraft).
- Nome, software e versão — a versão só aparece depois de escolher o software, e
  a lista vem da API oficial de cada um.
- 16 softwares: Vanilla, Paper, Purpur, Spigot, Quilt, Mohist, BungeeCord,
  PocketMine-MP, Vanilla Bedrock, Velocity, Fabric, Magma, NeoForge, ArchLight,
  Forge e Modpacks.
- Aceite do EULA da Mojang (obrigatório para servidores oficiais).
- Descrição em duas linhas e RAM inicial.

**Painel (clique no servidor)**
| Aba | O que faz |
|---|---|
| **Server** | IP/porta no centro, status, e **Iniciar** → **Parar / Reiniciar / Forçar Desligamento** |
| **Opções** | Prévia de como o servidor aparece na lista do jogo, troca de ícone, editor de MOTD completo (cores, emojis, alinhamento) e o `server.properties` |
| **Console** | “Offline” quando parado; ao vivo quando ligado, com campo de comando e Enter |
| **Log** | Lista dos logs com abrir, copiar e deletar |
| **Players** | Online, Whitelist, OPs, Banidos e IPs banidos; clicando em um jogador abre inventário, ender chest, vida, fome, kits, matar e banir |
| **Software** | Troca software/versão, com confirmação e a opção “Apagar todo o servidor” (que faz backup automático antes) |
| **Arquivos** | Gerenciador completo: menus de contexto, renomear, comprimir em `.tar.gz`, extrair, copiar/colar/cortar, multisseleção, criar pasta/arquivo, baixar |
| **Plugins / Mods / Datapacks** | Busca no Modrinth (padrão), Hangar, Spiget e CurseForge, já filtrada pelo loader e versão; marca “Já instalado”; 100 por página |
| **Mundos** | Cards com nome e tamanho, upload, arquivos e regenerar |
| **Backups** | Criar, restaurar, copiar, cortar e deletar |
| **Inicialização** | Comando de boot gerado automaticamente, versão do Java, jar e RAM |
| **Agendamento** | Tarefas com cron (reiniciar, backup, comando) |

**Infra**
- Baixa o Java (Temurin) sozinho, a versão certa para cada Minecraft.
- Thread que roda as tarefas agendadas.
- Sons e texturas reais do jogo, copiados do `.minecraft` do usuário.

---

## Como rodar (desenvolvimento)

```bash
# 1. dependências do sistema (Ubuntu/Debian)
sudo apt install libgtk-3-dev libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev patchelf build-essential

# 2. dependências do Node
npm install

# 3. (opcional) recopiar os assets do seu Minecraft
node tools/copy-assets.mjs     # fonte, texturas, sons, ícones de item/bloco

# 4. rodar
npm run tauri dev
```

## Como instalar no sistema

```bash
./install.sh          # instala o .deb (pede a senha do sudo)
# ou manualmente:
sudo dpkg -i src-tauri/target/release/bundle/deb/DSM_*.deb
```

Depois é só procurar **DSM** no menu de aplicativos ou rodar `dsm` no terminal.
Para remover: `sudo apt remove dsm`.

## Verificações automáticas

```bash
cd src-tauri && cargo test --test smoke -- --nocapture
```

O teste de fumaça faz o caminho completo, de verdade:

1. consulta as APIs oficiais e confirma que **todos** os softwares têm versões;
2. confere o mapeamento versão → Java (1.7.10→8, 1.17→16, 1.20.5→21, 26.3→25);
3. **cria um servidor Paper real**: baixa o jar, baixa o Java 21, escreve
   `eula.txt` e `server.properties`, inicia o processo, espera o `Done (Xs)!`,
   manda comandos pelo console, para com `stop` e confirma que o mundo foi gerado.

Resultado atual neste Ubuntu 26.04 (4 núcleos, 7 GB RAM):

```
test catalogo_tem_versoes_para_todos_os_softwares ... ok   (13 famílias)
test cria_e_inicia_um_servidor_paper ... ok                (Done em 45s)
test java_major_correta_por_versao ... ok
```

> Esses testes pegaram dois bugs de verdade: o mapeamento de Java dizia que
> 1.21.4 usava Java 17 (o servidor não subia) e a API do Forge mudou de formato.

## Diagnóstico quando algo dá errado

O app grava sozinho em `~/.dsm/crash.log`:

- qualquer erro de JavaScript não tratado (com stack);
- uma linha por boot (`boot: interface montada 1280x820...`).

Se o app abrir e ficar em branco, mande esse arquivo — ele diz se a interface
chegou a montar ou se quebrou antes. Útil também quando o app funciona na sua
máquina e não na de um amigo.

### A janela abre mas fica sem conteúdo (WebKit)

Em alguns Linux o conteúdo não aparece e o processo `WebKitWebProcess` fica a
100% de CPU. A causa quase sempre é o WebKit não conseguir abrir a GPU:

```text
libEGL: failed to open /dev/dri/renderD128: Permission denied
```

**Correção permanente** (o usuário não está no grupo `render`):

```bash
sudo usermod -aG render $USER
# depois SAIA e ENTRE de novo na sessão
```

O DSM detecta esse caso sozinho e força a renderização por software.

### A janela abre mas fica sem conteúdo (cache de fontes corrompido)

**Esta foi a causa real em um Ubuntu 26.04.** O processo `WebKitWebProcess`
ficava a 99% de CPU para sempre, travado dentro de `FcPatternGetString` — o
fontconfig rodando em loop por causa do cache em `~/.cache/fontconfig`.

Como confirmar:

```bash
# CPU do processo que deveria renderizar a página:
ps -eo pcpu,args | grep WebKitWebProcess | grep -v grep
# se der ~99%, é ele.
```

**Correção:**

```bash
rm -rf ~/.cache/fontconfig      # o fontconfig recria o cache sozinho
```

Reinicie o app depois. (Rodar `fc-cache -f` sozinho **não** resolveu — foi
preciso apagar o diretório.)

> Em último caso, isole a causa com uma config mínima:
> `FONTCONFIG_FILE=/dev/null dsm` — se aí funcionar, é o fontconfig.

### Como confirmar na mão

```bash
# 1. o app está de pé?
pgrep -x dsm

# 2. a janela existe e tem o tamanho certo?
xdotool search --pid $(pgrep -x dsm | head -1) | \
  while read w; do xwininfo -id $w | grep -E "Width|Height|Map State"; done

# 3. forçar renderização por software manualmente
LIBGL_ALWAYS_SOFTWARE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 dsm
```

## Como gerar o instalador

```bash
npm run tauri build
```

Gera o `.deb` em `src-tauri/target/release/bundle/deb/` (o que instalamos) e
tenta gerar um `.AppImage`. O AppImage depende do `linuxdeploy`, que precisa do
`libfuse2` instalado; se ele falhar, o `.deb` já está pronto do lado — e no
Ubuntu/Debian o `.deb` é o formato natural.

## Onde ficam os dados

```
~/.dsm/
├── servers/<id>/        # pasta de cada servidor (igual a um servidor normal)
├── java/jdk-21/         # JREs baixados
├── backups/<id>/        # backups .tar.gz
└── cache/               # cache das listas de versão (6h)
```

Apagar `~/.dsm` apaga os servidores. Faça backup antes.

## Estrutura

```
DSM/
├── src/                       # frontend (React + TypeScript)
│   ├── assets/minecraft/      # assets copiados do jogo (~2.100 arquivos, 12 MB)
│   ├── styles/                # design system estilo Minecraft
│   ├── theme/                 # fonte bitmap, sons, ícones, emojis
│   ├── components/            # botões, modais, campos, editor de MOTD
│   ├── screens/               # lista de servidores + criação
│   └── panel/tabs/            # as 14 abas do painel
├── src-tauri/src/             # backend Rust
│   ├── catalog.rs             # versões dos 16 softwares (APIs oficiais)
│   ├── java_mgr.rs            # download de JRE (Adoptium)
│   ├── installer.rs           # baixa jars, roda instaladores, BuildTools
│   ├── process_mgr.rs         # inicia/para servidores, console ao vivo
│   └── commands/              # arquivos, players (NBT), conteúdo, backups...
└── tools/                     # copy-assets.mjs, make-icons.mjs
```

## Limitações conhecidas (honestidade > marketing)

- **Spigot** exige compilar o BuildTools: a primeira criação leva 5–15 min.
- **Mohist** está sem canal público de builds; a lista aparece mas a instalação
  avisa e sugere alternativa.
- **CurseForge** precisa de uma chave de API (botão “⚙ API” nas abas de
  conteúdo). Modrinth, Hangar e Spiget funcionam sem cadastro.
- **Bukkit (dev.bukkit.org)** está praticamente morto; usamos **Spiget**, que
  indexa os plugins do SpigotMC.
- **Inventário em tempo real**: o servidor só salva `playerdata` no save. O
  painel manda `save-all flush` antes de ler, e mudanças por NBT são 100%
  confiáveis com o servidor **offline**; quando online usamos comandos. A
  interface avisa.
- **Forçar desligamento** é `SIGKILL`: use só se travar — o mundo pode não salvar.
- **Agendamento** roda enquanto o painel está aberto.
- **Bedrock** só oferece a versão estável mais recente (é o que a Mojang publica).
- **PocketMine-MP** precisa de `php-cli` instalado no sistema.

## Fase 2 (ainda por fazer)

- Aba **Modpacks** com busca e instalação de `.mrpack` (Modrinth) e CurseForge.
- Auto-update do app.
- Tema claro/alternância de escala da interface.
- Testes automatizados.

## Aviso sobre os assets

As texturas, sons e fontes do Minecraft são protegidos por direitos autorais da
Mojang. Os arquivos em `src/assets/minecraft/` foram copiados do `.minecraft` do
usuário que desenvolve o app, para uso **pessoal/local**. Se você for
distribuir o DSM publicamente, recomendo fortemente regerar apenas as
recriações próprias (o `tools/copy-assets.mjs` documenta exatamente o que é
copiado) ou remover essa pasta — o app continua funcionando com os fallbacks.
