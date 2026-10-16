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
  - **Qual Docker ele usa** — o mesmo que o comando `docker` do seu terminal:
    `DOCKER_HOST` se estiver definido, senão o contexto ativo (`docker context
    show`, por exemplo o do Docker Desktop), senão o socket padrão. Contextos
    `ssh://` não são suportados e caem no padrão.
  - **Reconstruir container** — o botão **Reconstruir**, nos containers criados
    pelo Docker Compose (local ou de um servidor), refaz a imagem do serviço e
    recria o container (`docker compose up -d --build --force-recreate
    --no-deps <serviço>`, na pasta do projeto). É diferente de **Reiniciar**,
    que só para e inicia o mesmo container com a mesma imagem. O botão só
    aparece nos serviços que têm `build` no Compose: um serviço que só usa uma
    imagem pronta (como um `postgres`) e os containers criados com `docker run`
    não têm o que reconstruir. Se o app não conseguir ler o Compose do projeto
    (por exemplo, o servidor não tem o `docker compose` v2, falta uma variável
    obrigatória ou a pasta mudou de lugar), o botão aparece desabilitado e o
    motivo está no texto ao passar o mouse. Containers gerenciados por uma
    plataforma de deploy (Coolify, Dokku, CapRover, Portainer, Swarm) também
    ficam desabilitados: o build deles roda numa pasta temporária, então a
    reconstrução é feita pelo painel da própria plataforma. Enquanto roda, a linha do container mostra uma pilha de
    camadas que se preenche a cada passo do Dockerfile, o passo atual e um
    cronômetro. Se o build falhar, o container antigo continua no ar e o fim do
    log do build aparece no aviso.
  - **Redeploy pelo Coolify** — os containers de apps do Coolify (local ou de
    um servidor) ganham o botão **Redeploy**, que pede ao Coolify um novo
    deploy pela API dele (`POST /api/v1/deploy`) e acompanha até o fim,
    mostrando na linha do container "na fila", "em andamento" e o resultado; se
    falhar, o fim do log do deploy aparece no aviso. Na primeira vez o app pede
    o endereço do Coolify e um token da API (Keys & Tokens, com as permissões
    **read** e **deploy**, e a API habilitada em Settings → Advanced); o
    endereço é testado antes de salvar. O token fica salvo em texto em
    `~/.config/localhub/config.json`, como as senhas dos bancos. O app acha o
    app do Coolify pelo UUID que está no nome do container; serviços e bancos
    do Coolify não são suportados. Antes de disparar, o app mostra uma confirmação
    com o nome do app e a branch, e avisa se o app está **fixado num commit** no
    Coolify (aí o deploy não pega commits novos). O deploy sempre começa pela
    busca do código mais recente da branch no repositório remoto, feita pelo
    próprio Coolify. A chamada sai do seu computador direto para o endereço do
    Coolify (não passa pelo túnel SSH).
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
