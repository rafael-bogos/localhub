<div align="center">
  <img src="build/appicon.svg" width="112" alt="Logo do localhub" />

  # localhub

  Hub de ferramentas locais para desenvolvedores
</div>

## Sobre

**localhub** é um hub de ferramentas locais para desenvolvedores: um app de
desktop (Go + Wails + React/TypeScript) para reunir num só lugar as tarefas
repetitivas de manter um ambiente de desenvolvimento local em ordem — mais
rápido que o terminal, sempre, sem sair de uma única janela.

### Funcionalidades

- **Portas** — lista em tempo real todas as portas TCP/UDP ativas na máquina
  (porta, protocolo, PID, processo, estado), com busca por número da porta, e
  encerra o processo responsável com um clique e confirmação. Substitui o
  ritual de `lsof -i` / `netstat` + `kill -9`.
- **Containers** — lista, inicia, para, reinicia e remove containers Docker
  (rodando e parados), substituindo `docker ps` / `docker stop` / `docker rm`.
  Containers criados pelo Docker Compose mostram também o serviço e o projeto
  (por exemplo, `serviço: mariadb · projeto: acessorias`). O botão ⓘ ao lado do
  nome abre os detalhes e **todas as etiquetas** do container; em plataformas
  como Coolify ou Dokku, que dão ao container um nome gerado e guardam o nome
  do app numa etiqueta, você escolhe qual etiqueta mostrar como nome ("Usar
  como nome") e a escolha vale para todos os containers que a tiverem.
- **Imagens** — lista, remove e limpa imagens Docker não usadas, substituindo
  `docker images` / `docker rmi` / `docker image prune`. Containers e imagens têm
  busca no cabeçalho: containers por nome, ID, imagem ou serviço do Compose;
  imagens por nome, tag ou ID (várias palavras valem juntas, e a busca também
  filtra as seções dos servidores).
- **Limpeza** — um `docker system prune` seletivo: você escolhe por checkbox
  quais categorias limpar (containers parados, imagens não usadas, redes não
  usadas, cache de build) em vez do tudo-ou-nada da CLI. Volumes nunca são
  tocados, por guardarem dados persistentes.
- **Servidores** — cadastra servidores e abre um terminal SSH dentro do app, sem
  terminal externo. Login por chave privada (a passphrase é pedida na hora e
  nunca é salva) ou pelo `ssh-agent`; importa os servidores do seu
  `~/.ssh/config` (só o básico: `Host`, `HostName`, `User`, `Port` e
  `IdentityFile`). Na primeira conexão mostra a impressão digital do servidor e
  só segue se você confiar (grava no `~/.ssh/known_hosts`); se a chave de um
  servidor conhecido mudar, a conexão é bloqueada.
  - **Processos, Containers e Imagens dos servidores** — com um servidor
    conectado, essas três abas mostram uma seção por máquina ("Esta máquina" e
    cada servidor, marcado como **Remoto**), com as mesmas ações do local
    (encerrar processo, iniciar/parar/reiniciar/remover container, remover
    imagem, logs ao vivo). Toda ação destrutiva em um servidor pede confirmação
    citando o nome dele. Vários servidores podem ficar conectados ao mesmo
    tempo; o terminal é um por vez.
  - **Terminal dentro do container** — o botão **Terminal**, em cada container
    rodando de um servidor, abre um shell dentro dele (`docker exec -it`, com
    `bash` quando o container tem e `sh` quando não), na aba Servidores. É o
    mesmo terminal embutido: um por vez, com Reabrir depois de `exit`.
  - **Túneis** — na aba Servidores, cada servidor tem seus túneis salvos: nome,
    porta neste computador, IP (ou nome) e porta de destino, como em
    `ssh -fN -L 33062:172.18.3.125:3306 ubuntu@201.23.69.55`, mas com um clique
    para abrir e fechar. O destino é alcançado pelo servidor (então pode ser um
    endereço da rede privada dele), o túnel só aceita conexões de `127.0.0.1`, e
    há a opção de abrir sozinho quando o servidor conectar. As definições ficam
    salvas; os túneis fecham quando o servidor desconecta.
  - **Túnel para containers** — o botão **Túnel**, em cada container rodando de
    um servidor, abre uma porta neste computador que leva a uma porta do
    container (o equivalente a `ssh -fN -L 33061:172.18.3.23:3306 usuario@servidor`,
    sem sair do app). O app descobre o IP e as portas do container, sugere uma
    porta local livre e mostra o comando equivalente. O túnel só aceita conexões
    de `127.0.0.1`, aparece como um chip na linha do container (com × para
    fechar) e acaba sozinho ao desconectar o servidor. O servidor remoto precisa ser Linux, com
    `ss` e, para Containers e Imagens, o CLI `docker`.

**Onde ficam os seus dados.** Servidores, túneis salvos, o nome de exibição dos
containers e as preferências ficam num arquivo JSON na pasta de configuração do
sistema, não no armazenamento do navegador embutido:
`~/.config/localhub/config.json` (Linux), `%AppData%\localhub\config.json`
(Windows) ou `~/Library/Application Support/localhub/config.json` (macOS). O
arquivo tem permissão só do usuário, é gravado de forma atômica e não contém
senhas, passphrases nem chaves privadas (só o caminho da chave). Por isso
atualizar o app, renomear o binário ou usar o `wails dev` não faz os dados
sumirem. Se o arquivo não puder ser lido, o app avisa e **não grava nada** por
cima; se estiver corrompido, ele é guardado como `config.json.bad-<data>` e o app
começa limpo.

Containers e imagens locais falam direto com o Docker Engine API via SDK
oficial (sem shell-out para o binário `docker`); o SSH é nativo em Go (sem
chamar o `ssh` do sistema). Toda a interface é em português — não é um
placeholder pra traduzir depois.

## Instalação

### Binário pronto

A forma mais rápida: baixe o binário do seu sistema direto na página de
[Releases](https://github.com/rafael-bogos/localhub/releases) — cada release
traz builds para Linux, Windows e macOS. Como não são assinados
digitalmente, o Windows pode avisar via SmartScreen e o macOS vai bloquear a
primeira abertura pelo Gatekeeper (veja a seção do macOS abaixo para
contornar isso).

No **Linux**, o arquivo vem como `localhub-linux-amd64.tar.gz`. Extraia (duplo
clique no gerenciador de arquivos, ou `tar -xzf localhub-linux-amd64.tar.gz`);
a permissão de execução já vem preservada, sem precisar de `chmod`. A pasta
extraída traz o binário, o ícone e um instalador:

```
cd localhub-linux-amd64
./localhub          # abrir direto, sem instalar
./install.sh        # ou instalar: binário + ícone + atalho no menu de aplicativos
./install.sh --uninstall   # remover
```

O instalador roda sem root: copia o binário para `~/.local/bin`, o ícone para
`~/.local/share/icons` e cria o atalho "Localhub" em
`~/.local/share/applications`. Ele depende do WebKitGTK 4.1 e do GTK3
instalados (Fedora: `webkit2gtk4.1`; Ubuntu/Debian: `libwebkit2gtk-4.1-0`) e
avisa se não encontrar a biblioteca.

### Build a partir do código-fonte

Se preferir compilar você mesmo (ou seu sistema não for compatível com o
binário publicado — ex. Linux com `webkit2gtk-4.0`), siga os passos abaixo
para qualquer um dos três sistemas.

### Pré-requisitos (todos os sistemas)

- [Go](https://go.dev/dl/) 1.25 ou superior
- [Node.js](https://nodejs.org/) 20 ou superior (com `npm`)
- A CLI do Wails:
  ```
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
  ```
  O binário vai para `$(go env GOPATH)/bin` — se `wails` não for
  reconhecido no terminal, adicione ao seu shell rc (`~/.zshrc` /
  `~/.bashrc`):
  ```
  export PATH="$PATH:$(go env GOPATH)/bin"
  ```

Depois, clone o repositório:

```
git clone https://github.com/rafael-bogos/localhub.git
cd localhub
```

### Linux

Instale as dependências de sistema do WebKitGTK + GTK3 (nomes variam por
distro). Debian/Ubuntu ainda têm `webkit2gtk-4.0`; distros mais recentes
(Fedora 40+, Arch) só têm `webkit2gtk-4.1` e precisam de uma build tag extra.

```
# Debian/Ubuntu
sudo apt install build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.0-dev

# Fedora
sudo dnf install gcc gtk3-devel webkit2gtk4.1-devel
```

Build:

```
# Debian/Ubuntu (webkit2gtk-4.0)
wails build

# Fedora/Arch e outras distros só com webkit2gtk-4.1
wails build -tags webkit2_41
```

O binário fica em `build/bin/localhub`. Para instalar de vez (binário + ícone +
atalho no menu de aplicativos), use o script do projeto — ele compila com
`-tags webkit2_41` (ajuste em `scripts/install.sh` se o seu sistema usar
`webkit2gtk-4.0`) e chama o mesmo instalador que vai na release:

```
./scripts/install.sh
```

Para remover: `./packaging/linux/install.sh --uninstall`.

### Windows

Precisa ser buildado numa máquina Windows (não há cross-compile a partir de
Linux/macOS sem toolchain extra). O WebView2 Runtime já vem instalado por
padrão no Windows 10/11.

```
wails build
```

O executável fica em `build\bin\localhub.exe` — é portátil, não precisa
instalar nada, é só rodar. Para fixar na Área de Trabalho ou na Barra de
Tarefas, clique com o botão direito no `.exe` e escolha "Fixar em Iniciar" /
"Criar atalho". Se tiver o [NSIS](https://nsis.sourceforge.io/) instalado, o
`wails build` também gera um instalador em
`build\bin\localhub-amd64-installer.exe`.

### macOS

Precisa ser buildado num Mac, com as Command Line Tools instaladas:

```
xcode-select --install
wails build -platform darwin/universal
```

O app fica em `build/bin/localhub.app`. Arraste para `/Applications`. Como
não é assinado/notarizado, o Gatekeeper vai bloquear a primeira abertura —
clique com o botão direito no app e escolha "Abrir" (em vez de dar duplo
clique), ou rode:

```
xattr -cr build/bin/localhub.app
```

## Desenvolvimento

Modo live (hot reload do frontend via Vite):

```
wails dev
```

No Linux, se seu sistema só tiver `webkit2gtk-4.1`, use
`wails dev -tags webkit2_41`.

Há também um servidor de dev em `http://localhost:34115` — conecte o
navegador nele para chamar o código Go direto do devtools.

Mais sobre configuração do projeto (`wails.json`):
https://wails.io/docs/reference/project-config

## Licença

[MIT](LICENSE) © Rafael Bogos
