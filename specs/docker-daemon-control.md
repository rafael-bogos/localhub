# Spec: Ligar e desligar o Docker (daemon) pelo localhub

<!-- status: rascunho — adiado pelo usuário; revisar as Open Questions antes de virar tasks/plan.md -->

## Objective

Hoje, quando o Docker está desligado, as abas Containers/Imagens/Limpeza só
mostram o erro "não foi possível conectar ao Docker" e o usuário precisa abrir
um terminal (`sudo systemctl start docker`). Esta feature deixa o localhub
**iniciar e desligar o próprio Docker**, sem sair do app.

**Usuário:** o mesmo de sempre — o desenvolvedor solo, na própria máquina.

**Sucesso:** com o Docker parado, um clique em "Iniciar Docker" leva o app ao
estado "conectado" e a lista de containers aparece sozinha. Com o Docker
rodando, um clique + confirmação em "Desligar Docker" para o serviço e o app
mostra o estado "desligado" — sem terminal e sem o Docker "ressuscitar".

**Fora de escopo nesta versão** (registrar para não expandir sem querer):
- Pausar/retomar containers individuais (`ContainerPause`/`ContainerUnpause`) —
  spec própria, mais simples e independente desta.
- Docker remoto, contextos Docker (`docker context`) ou `DOCKER_HOST` customizado.
- Instalar o Docker, configurar o serviço ou habilitá-lo no boot.
- "Pausar" o daemon: não existe no Linux; só o Docker Desktop tem pause.

## Contexto verificado (máquina do usuário, 2026-09-29)

- Linux (Fedora), daemon **do sistema**: `docker.service` habilitado e ativo.
- `docker.socket` está **ativo**, mas não habilitado. Isso importa: com a
  ativação por socket, parar só o `docker.service` **não desliga o Docker de
  verdade** — o próximo acesso ao `/var/run/docker.sock` (inclusive o `Ping` do
  próprio app) religa o serviço. Para desligar é preciso parar o **socket e o
  serviço**.
- Sem `DOCKER_HOST`; socket em `/var/run/docker.sock` (`root:docker`); o
  usuário está no grupo `docker`, então a **API funciona sem root**, mas
  `systemctl start/stop` **exige privilégio** (polkit). `pkexec` está presente.

## Tech Stack

- Backend: Go (Wails v2), como hoje. Pacote novo `internal/docker/daemon.go`
  (mesmo pacote de `containers.go`/`images.go`).
- O controle do daemon **não passa pela API do Docker** (com o daemon parado
  não há API): é um comando do sistema executado com `os/exec`. Nada de shell
  (`sh -c`) — argumentos passados como lista, sem interpolar entrada do usuário.
- Frontend: React + TypeScript, `useState`/`useEffect` como nas outras abas.
- Design: tokens do `DESIGN.md`, sem cor nova.

## Comportamento por plataforma

| Plataforma | Iniciar | Desligar | Privilégio |
|---|---|---|---|
| Linux (daemon do sistema) | `systemctl start docker.socket docker.service` | `systemctl stop docker.socket docker.service` | `pkexec` (pede senha na UI do sistema) |
| Linux (rootless) | `systemctl --user start docker` | `systemctl --user stop docker` | nenhum |
| macOS (Docker Desktop) | `open -a Docker` | `osascript -e 'quit app "Docker"'` | nenhum |
| Windows (Docker Desktop) | iniciar `Docker Desktop.exe` | `taskkill` do Docker Desktop (a definir) | nenhum |

Detecção do modo Linux: se `docker.service` existir no systemd do sistema
(`systemctl cat docker.service`), usa o modo sistema; senão, tenta o rootless
(`systemctl --user cat docker.service`). Na primeira versão, **priorizar
Linux (daemon do sistema)** e deixar macOS/Windows como "não suportado
ainda", com mensagem clara, em vez de entregar comandos não testados.

## Project Structure

```
internal/docker/
  daemon.go        → DaemonStatus(ctx), StartDaemon(ctx), StopDaemon(ctx)
  daemon_linux.go  → comandos systemctl/pkexec (build tag linux)
  daemon_other.go  → retorna "não suportado nesta plataforma" (demais SOs)
app.go             → App.DaemonStatus / StartDaemon / StopDaemon
frontend/src/components/
  DockerDaemonBar.tsx  → estado + botões Iniciar/Desligar (novo)
```

`DaemonStatus` deve responder rápido e **sem religar o serviço**: usar
`systemctl is-active` (ou um `Ping` com timeout curto) — nunca algo que
acorde o socket sem o usuário ter pedido.

## Fluxo

**Iniciar**
1. Usuário clica "Iniciar Docker" → estado "Iniciando…" (botão desabilitado).
2. Backend roda o comando (com `pkexec` no Linux) com timeout.
3. Backend faz `Ping` a cada ~500 ms até o daemon responder ou estourar o
   timeout (~30 s).
4. Sucesso → estado "Conectado" e as abas recarregam sozinhas. Falha/timeout →
   erro em português; se o usuário cancelou a senha (`pkexec` exit 126/127),
   mensagem específica ("autenticação cancelada"), não erro genérico.

**Desligar**
1. Confirmação (`confirm`), avisando quantos containers estão rodando —
   desligar o daemon para todos eles (a menos que `live-restore` esteja ativo).
2. Backend para **socket e serviço**, depois confirma que o `Ping` falha.
3. Estado "Desligado"; a UI para o polling de métricas e limpa a lista.

## Success Criteria

- [ ] Com o Docker desligado, as abas Docker mostram estado "Desligado" com um
      botão "Iniciar Docker", em vez de só o erro cru.
- [ ] "Iniciar Docker" pede a senha via polkit, mostra "Iniciando…" e, quando o
      daemon responde, a lista de containers carrega sozinha.
- [ ] "Desligar Docker" pede confirmação (com a contagem de containers rodando),
      pede a senha, e o Docker **permanece desligado** — o polling do app não o
      religa via socket activation.
- [ ] Cancelar a senha do polkit não deixa a UI travada em "Iniciando…" e mostra
      mensagem clara.
- [ ] Em macOS/Windows, os botões ficam ocultos ou mostram "não suportado
      ainda" — sem executar nada às cegas.
- [ ] Nenhum comando é montado a partir de entrada do usuário; sem `sh -c`.
- [ ] `go build ./...`, `go vet ./...` e `tsc --noEmit` passam; copy 100% PT-BR.

## Boundaries

- **Sempre fazer:** confirmar antes de desligar; traduzir erros para português;
  timeout em todo comando externo; parar `docker.socket` junto com o serviço.
- **Perguntar antes:** suportar macOS/Windows (exige testar em cada SO); usar
  `systemctl enable/disable` (mudaria o boot da máquina); qualquer regra de
  polkit instalada em `/etc` para evitar a senha.
- **Nunca fazer:** rodar como root o app inteiro; usar `sudo` com senha
  digitada dentro do localhub; interpolar strings em comando de shell; religar
  o Docker automaticamente sem ação do usuário.

## Open Questions

1. **Senha a cada ação é aceitável?** `pkexec` pede autenticação toda vez. A
   alternativa é uma regra polkit para o grupo `docker` (fora do app,
   configuração manual do usuário) — decidir se vale documentar no README.
2. **Docker Desktop / rootless:** o usuário usa só o daemon do sistema? Se sim,
   macOS/Windows/rootless podem ficar fora indefinidamente.
3. **Desligar com containers rodando:** apenas avisar (proposto) ou bloquear
   até pararem? `live-restore` muda o efeito — vale detectar?
4. **Onde mora o botão:** faixa fixa no topo das abas Docker (proposto) ou
   dentro do estado de erro atual?
5. **Aba Portas:** ligar/desligar Docker afeta portas publicadas — precisa
   refletir na lista de portas após a mudança?
