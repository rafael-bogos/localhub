# Tasks: Acesso remoto via SSH

<!-- spec: specs/ssh-remote-access.md · sem testes automatizados (decisão do projeto); cada tarefa termina com build + verificação manual -->

Ordem por dependência: conexão → terminal → lista de servidores → dados remotos
(processos → containers/imagens) → agrupamento → extras. Cada tarefa deixa o app
compilando e funcionando.

> Status: **Fases 1 e 2 (T1–T8) concluídas.** Verificadas no app real (`wails dev`,
> página aberta no Chrome via CDP, backend Go ligado por websocket) contra um
> `sshd` OpenSSH de verdade em `127.0.0.1:2222`, com `HOME` isolado: lista e
> formulário, pedido de confiança do fingerprint, conexão por chave, passphrase
> (errada e certa), terminal (eco, PTY, resize, 30 mil linhas, `Esc` chega ao
> shell, `exit`, reabrir), troca de aba mantém o terminal, desconectar com
> confirmação, falha de conexão, busca, persistência e layout estreito;
> importação do `~/.ssh/config` (duplicados, mesmo destino, ignorados) e conexão
> com o servidor importado. Os roteiros de teste não estão no repositório.
>
> Bugs achados pelo teste e corrigidos: o evento de fim de um terminal antigo
> chegava ao terminal novo do mesmo servidor, e o fim do antigo podia liberar a
> vaga do novo. Agora os eventos do terminal são por sessão
> (`ssh:data|end:<session>`, escolhida pelo frontend) e `SSHCloseTerminal` exige a
> sessão. Conexão e chave do servidor continuam por ID (`ssh:state|hostkey:<id>`).
>
> **Ainda não testado:** ssh-agent real (só um agente em processo, na T2), Windows
> e macOS (só compilam), recarregar a janela com conexões abertas (o backend as
> mantém; no app empacotado não há recarga).
>
> Servidor de teste para as verificações:
> `docker run -d --name sshtest -p 2222:2222 -e USER_NAME=dev -e PASSWORD_ACCESS=false -e PUBLIC_KEY="$(cat ~/.ssh/id_ed25519.pub)" lscr.io/linuxserver/openssh-server`
> (Docker disponível dentro dele só se montar o socket; para as tarefas de
> containers use uma VM/servidor real ou monte `/var/run/docker.sock`).

## Fase 1: Conexão e terminal

- [x] **T1: Conexão por servidor** — `internal/ssh/conn.go`, `hostkey.go`, `go.mod`
  - Registro de conexões por `hostID` (um `*ssh.Client` por servidor), dial com
    timeout de 10 s, keepalive, detecção de queda. `known_hosts` com TOFU
    (callback que pede confirmação) e bloqueio se a chave mudou.
  - `x/crypto` passa a dependência direta (`go mod tidy`).
  - Verify: `go build ./... && go vet ./...`; programa temporário conecta ao
    servidor de teste, aceita TOFU, reconecta (aceita sem perguntar) e falha ao
    trocar a chave do servidor.
- [x] **T2: Autenticação** — `internal/ssh/auth.go`, `agent.go`, `app.go` (`PickFile`)
  - Chave privada (com passphrase via parâmetro, zerada após o uso) e ssh-agent
    (`SSH_AUTH_SOCK`; named pipe no Windows via arquivo com build tag).
    `PickFile()` com `OpenFileDialog`.
  - Verify: `go build` (também `GOOS=windows go build ./...`); programa
    temporário autentica com chave sem passphrase, com passphrase (certa e
    errada) e via agent.
- [x] **T3: Terminal no backend** — `internal/ssh/session.go`, `app.go`
  - `SSHConnect`, `SSHDisconnect`, `SSHConfirmHostKey`, `SSHOpenTerminal`,
    `SSHWrite`, `SSHResize`. Eventos `ssh:state|data|hostkey|end:<id>`; saída em
    lotes (~16 ms) em base64; PTY `xterm-256color`. O **frontend** assina os
    eventos antes de chamar.
  - Verify: `go build`; programa temporário abre shell, envia `echo ok`, redimensiona
    e confere `stty size`.
- [x] **T4: Bindings** — `wails generate module` (reverter `wailsjs/runtime`).

## Fase 2: Aba SSH (lista e terminal)

- [x] **T5: Persistência de servidores** — `frontend/src/useSshHosts.ts`
  - `localStorage` `localhub.ssh.v1`, validação por campo, debounce, sem segredos.
  - Verify: `tsc`; recarregar a página mantém a lista; JSON adulterado não quebra.
- [x] **T6: Lista e formulário** — `SshTab.tsx`, `SshHostDialog.tsx`, `App.tsx`, `App.css`
  - Nova aba "SSH" (`Tab`, `TAB_LABELS`, `counts`), cadastro/edição/exclusão
    com `useConfirm`, busca, seletor de arquivo da chave.
  - Verify: `tsc && vite build`; captura no Chrome com Wails simulado.
- [x] **T7: Terminal embutido** — `SshTerminal.tsx`, `package.json` (`@xterm/xterm`,
  `@xterm/addon-fit`), `App.css`
  - Conectar/Abrir terminal/Desconectar, barra de estado, diálogo de passphrase e
    de confiança do fingerprint, resize, tema pelos tokens, `Esc` vai ao shell,
    atalhos globais suspensos com foco, mensagens de erro em PT-BR.
  - Verify: `tsc && vite build`; `wails dev -tags webkit2_41` contra o servidor de
    teste: `vim`, `htop`, resize, `cat` de arquivo grande.
- [x] **T8: Importar `~/.ssh/config`** — `internal/ssh/config.go`, `app.go`,
  `SshTab.tsx`
  - Parser básico (Host/HostName/User/Port/IdentityFile; ignora curingas,
    Include, ProxyJump e conta os ignorados), prévia com seleção, dedupe.
  - Verify: `go build`; programa temporário com um config de exemplo; conferir a
    prévia na UI.

## Fase 3: Dados remotos

- [ ] **T9: Execução remota segura** — `internal/ssh/exec.go`, `validate.go`
  - `Run(ctx, hostID, cmd)` com timeout e `Stream` (canal próprio); validadores
    (`pid` numérico, `id` por regex, `action` de lista fixa) e quoting POSIX.
  - Verify: `go build`; programa temporário rejeita `x; rm -rf ~` e `$(id)` antes
    de executar.
- [ ] **T10: Processos remotos** — `internal/ssh/remote_ports.go`, `app.go`
  - `RemoteListPorts(hostID)` (`ss -H -tulnp`, parse em Go, "visibilidade
    limitada" sem root) e `RemoteKillProcess(hostID, pid)`; reaproveita
    `ports.PortInfo`.
  - Verify: `go build`; programa temporário lista portas do servidor de teste e
    encerra um `sleep`.
- [ ] **T11: Containers e imagens remotos** — `internal/ssh/remote_docker.go`, `app.go`
  - `RemoteListContainers`, `RemoteContainerAction` (start/stop/restart/rm),
    `RemoteListImages`, `RemoteRemoveImage` (`docker … --format json`); detecção de
    "docker ausente/sem permissão"; reaproveita os tipos de `internal/docker`.
  - Verify: `go build`; programa temporário contra um servidor com Docker.
- [ ] **T12: Logs remotos** — `internal/ssh/remote_logs.go`, `app.go`
  - `RemoteStartLogs(hostID, id, sessionID)` sobre `docker logs -f --tail N
    --timestamps`, no mesmo formato de eventos `logs:batch|end:<id>`, reaproveitando
    a montagem de linhas (`logs_lines.go`); `Stop` encerra o canal.
  - Verify: `go build`; programa temporário recebe linhas ao vivo e para limpo.
- [ ] **T13: Bindings** — `wails generate module` (reverter `wailsjs/runtime`).

## Fase 4: Agrupamento por servidor nas abas

- [ ] **T14: Estado de conexões e grupo** — `useSshConnections.ts`,
  `components/HostGroup.tsx`, `App.tsx`, `App.css`
  - Servidores conectados/estado compartilhados com o `App`; seção recolhível com
    chip REMOTO, nome, `usuário@host`, estado, contador, "Reconectar".
  - Verify: `tsc && vite build`; captura com 2 servidores simulados.
- [ ] **T15: Processos agrupados** — `PortsTable.tsx`, `App.tsx`
  - Grupos "Esta máquina" + um por servidor; busca/atualizar valem para todos; falha
    de um servidor não afeta os outros; confirmação de encerrar cita o servidor.
  - Verify: `tsc && vite build`; `wails dev` com o servidor de teste.
- [ ] **T16: Containers e imagens agrupados** — `ContainersTable.tsx`,
  `ImagesTable.tsx`, `LogsDrawer.tsx`, `useContainerLogs.ts`
  - Mesmos grupos; ações remotas com confirmação citando o servidor; `LogsDrawer`
    recebe `hostID` opcional (vazio = local); "docker ausente" por seção.
  - Verify: `tsc && vite build`; logs ao vivo de um container remoto.
- [ ] **T17: Contador do header** — `App.tsx`: soma local + servidores conectados;
  desconectar remove o grupo.

## Fase 5: Fechamento

- [ ] **T18: Ciclo de vida** — fechar o app encerra conexões (`OnBeforeClose`/
  `shutdown`); trocar de aba não derruba terminal nem dados.
  - Verify: `ss -tn` sem conexões pendentes após fechar.
- [ ] **T19: Docs e checagem final** — `README.md` ("Funcionalidades"),
  `specs/ssh-remote-access.md` (status), esta lista.
  - Verify: roteiro 1–8 da seção "Verificação" da spec; `wails build -tags
    webkit2_41`.

## Pontos de atenção

- Não alterar assinaturas dos métodos locais de `app.go`; só adicionar `SSH*`/`Remote*`.
- `frontend/wailsjs/` é versionado: regenerar e reverter `wailsjs/runtime` (T4, T13).
- Nada sensível em `localStorage`; passphrase nunca em log.
- Fora da v1: login por senha, Limpeza remota, múltiplos terminais, port forwarding, SFTP.
