# Rodando o DSM no Termux

Este guia mostra como rodar o Dreamy Server Manager em um tablet Android usando Termux para hospedar um servidor Minecraft Java/Paper.

## Requisitos

- Termux instalado pelo F-Droid ou GitHub.
- Tablet Android ARM64.
- Pelo menos 4 GB de RAM, com 6 GB ou mais recomendado.
- Espaco livre para o mundo, plugins e o arquivo `.jar` do servidor.
- Uma rede Wi-Fi onde outros jogadores consigam acessar o IP local do tablet.

## Instalacao

No Termux, atualize os pacotes e instale as dependencias:

```sh
pkg update && pkg upgrade
pkg install git nodejs openjdk-21
```

Clone o projeto:

```sh
git clone https://github.com/Thiago142007/dsm-dreamy-server-manager.git
cd dsm-dreamy-server-manager
npm install
```

## Iniciar o painel

Use o script pronto:

```sh
sh scripts/start-termux.sh
```

Por padrao o painel abre em:

```txt
http://127.0.0.1:3000
```

Para acessar de outro aparelho na mesma rede, descubra o IP do tablet:

```sh
ip addr show wlan0
```

Depois abra:

```txt
http://IP_DO_TABLET:3000
```

## Manter ligado com a tela apagada

O Android pode suspender processos em segundo plano. Antes de iniciar o servidor, rode:

```sh
termux-wake-lock
```

Tambem coloque o Termux como app sem restricao de bateria nas configuracoes do Android. Para desligar o wake lock depois:

```sh
termux-wake-unlock
```

## Minecraft

O servidor Minecraft usa normalmente a porta:

```txt
25565
```

Jogadores na mesma rede entram pelo IP local do tablet. Acesso pela internet nao e automatico; pode precisar de port forwarding, VPN ou tunel.

## Dicas de desempenho

- Use `nogui`, que ja e o modo usado pelo DSM.
- Comece com poucos plugins.
- Use um limite de memoria conservador, como 1 GB ou 2 GB.
- Mantenha o tablet carregando durante o servidor.
- Se o Java 21 der erro no seu aparelho, teste uma versao de Minecraft/Paper que aceite Java 17 ou use uma distro em `proot-distro`.

## Variaveis uteis

Voce pode mudar porta, host e pasta do servidor:

```sh
HOST=0.0.0.0 PORT=3000 SERVER_DIR=server sh scripts/start-termux.sh
```
