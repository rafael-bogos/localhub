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
- **Imagens** — lista, remove e limpa imagens Docker não usadas, substituindo
  `docker images` / `docker rmi` / `docker image prune`.
- **Limpeza** — um `docker system prune` seletivo: você escolhe por checkbox
  quais categorias limpar (containers parados, imagens não usadas, redes não
  usadas, cache de build) em vez do tudo-ou-nada da CLI. Volumes nunca são
  tocados, por guardarem dados persistentes.

Fala direto com o Docker Engine API via SDK oficial (não faz shell-out para o
binário `docker`), e toda a interface é em português — não é um placeholder
pra traduzir depois.

## Instalação

Não há binários prontos publicados — o app é buildado localmente a partir do
código-fonte, para qualquer um dos três sistemas.

### Pré-requisitos (todos os sistemas)

- [Go](https://go.dev/dl/) 1.25 ou superior
- [Node.js](https://nodejs.org/) 20 ou superior (com `npm`)
- A CLI do Wails:
  ```
  go install github.com/wailsapp/wails/v2/cmd/wails@latest
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

O binário fica em `build/bin/localhub`. Para instalar de vez (ícone +
launcher do desktop), use o script do projeto (ajuste a tag de build acima se
necessário):

```
./scripts/install.sh
```

Ou, manualmente:

```
install -Dm755 build/bin/localhub ~/.local/bin/localhub
install -Dm644 build/appicon.png ~/.local/share/icons/localhub.png
cat > ~/.local/share/applications/localhub.desktop <<EOF
[Desktop Entry]
Name=Localhub
Comment=Hub de ferramentas locais para desenvolvedores
Exec=$HOME/.local/bin/localhub
Icon=$HOME/.local/share/icons/localhub.png
Type=Application
Terminal=false
Categories=Utility;
EOF
update-desktop-database ~/.local/share/applications/
```

O app passa a aparecer no launcher do desktop normalmente.

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
