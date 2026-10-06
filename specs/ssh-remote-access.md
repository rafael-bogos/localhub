# Spec: Acesso remoto via SSH (aba Servidores, terminal embutido e gestão de máquinas remotas)

<!-- status: implementada (v1) — tarefas e verificações em tasks/ssh-todo.md; o que ficou de fora está em "Fora de escopo" -->

## Objective

Permitir que o usuário cadastre máquinas remotas, abra um terminal SSH dentro
do localhub e **gerencie processos, containers e imagens dessas máquinas nas
mesmas abas que já usa para a máquina local**, com tudo **agrupado por
máquina** para nunca confundir o que é local e o que é remoto. Mesma
identidade visual do app (monocromática escura, copy em PT-BR).

**Usuário:** o desenvolvedor solo, que já usa o localhub para ver portas,
containers e logs, e quer cuidar de servidores/VMs sem trocar de janela.

**Sucesso:** conectar um servidor e, nas abas Processos/Containers/Imagens, ver e
agir sobre os itens dele ao lado dos locais, com clareza de qual é de qual
máquina; ou abrir o shell em poucos cliques, com `vim`, `htop` e resize
funcionando.

**Fora de escopo nesta versão** (registrar para não expandir sem querer):
- Login por senha, `ProxyJump`/bastion, `Include` e curingas do `ssh_config`,
  Pageant (Windows).
- Mais de um terminal aberto ao mesmo tempo (os dados, sim, podem vir de
  vários servidores).
- Aba **Limpeza** em servidores remotos (prune do Docker e `node_modules`): fica
  só local na v1.
- Remoto que não seja Linux; `sudo` interativo para ver/encerrar processos de
  outros usuários.
- Port forwarding reverso e dinâmico (`-R`, `-D`), túnel que aceite conexões de
  outras máquinas (só `127.0.0.1`), SFTP, X11, agent forwarding. (Túnel local
  livre e túnel para container existem: ver abaixo.)
- Guardar segredos (senha/passphrase) em keychain.
- Testes automatizados (o projeto não tem; verificação por build + teste
  manual, como em `tasks/plan.md`).

## Comportamento

### Lista de servidores
- A aba **Servidores** lista os servidores como "teclas" (mesmo estilo das outras tabelas):
  nome, `usuário@host:porta` e método de login.
- Cadastro/edição por formulário: nome, endereço, porta (padrão 22), usuário,
  método (`chave` ou `agent`) e, para `chave`, o caminho do arquivo (seletor
  via `OpenFileDialog`).
- Excluir servidor pede confirmação (`useConfirm()`).
- Busca por nome/endereço, como na aba de processos.
- O contador âmbar do header mostra o total de servidores salvos.

### Importar `~/.ssh/config` (básico)
- Botão **Importar de ~/.ssh/config** lê `Host`, `HostName`, `User`, `Port` e
  `IdentityFile`.
- Ignora curingas (`Host *`, `Host a*`), `Include` e `ProxyJump`; informa
  quantas entradas foram ignoradas.
- Mostra uma prévia com seleção antes de gravar. Nunca sobrescreve em
  silêncio: servidor existente (mesmo servidor+porta+usuário) é pulado.
- Com `IdentityFile`, o método vira `chave`; sem ele, `agent`.

### Conexão e terminal
- Cada servidor tem **uma conexão SSH**, e **vários servidores podem estar conectados
  ao mesmo tempo**. Sobre ela correm canais independentes: o terminal e os
  comandos que alimentam as abas de dados.
- **Conectar** (na lista) estabelece a conexão e o servidor passa a aparecer nas
  abas Processos/Containers/Imagens. **Abrir terminal** abre o shell (xterm.js)
  sobre a conexão do servidor, com barra superior: servidor, estado (conectando /
  conectada / encerrada) e **Desconectar**.
- Só **um terminal** aberto por vez; abrir outro com um já ativo pede
  confirmação. Fechar o terminal não derruba a conexão de dados.
- **Desconectar** o servidor encerra a conexão, o terminal e remove o grupo dele
  das abas de dados.
- Conexão caída: o grupo do servidor fica marcado como "desconectado", com ação
  **Reconectar**; os dados antigos não são exibidos como atuais.
- Método `chave`: usa o arquivo; se estiver cifrado, abre diálogo de
  passphrase (só em memória, descartada após o handshake).
- Método `agent`: `SSH_AUTH_SOCK` (Linux/macOS); no Windows, named pipe do
  OpenSSH Agent (`\\.\pipe\openssh-ssh-agent`).
- PTY remoto `xterm-256color`; resize do painel é repassado ao servidor.
- Fechar o app encerra todas as conexões.

### Máquinas remotas nas abas Processos, Containers e Imagens
- **Agrupamento por máquina, na mesma lista.** Cada aba mostra seções
  recolhíveis: **Esta máquina** (sempre primeiro) e uma seção por servidor
  conectado. O cabeçalho da seção mostra o nome do servidor, `usuário@host`, estado
  e contador de itens. Remoto nunca aparece misturado nas linhas locais.
- Distinção monocromática (sem depender de cor): chip **REMOTO** + nome no
  cabeçalho; laranja continua só para ações destrutivas.
- Busca, ordenação e o botão de atualizar valem para todas as seções. O
  contador âmbar do header soma todas as máquinas.
- Falha em um servidor (timeout, comando ausente, permissão) aparece no cabeçalho
  dessa seção e **não afeta** as demais.
- **Processos:** portas em escuta no remoto (`ss`). Encerrar processo
  (`kill`). Processos de outros usuários podem não aparecer ou não poder ser
  encerrados sem root; a seção avisa "visibilidade limitada" em vez de falhar.
- **Containers:** listar (com o serviço e o projeto do Docker Compose, quando
  houver), iniciar, parar, reiniciar, remover e **Logs ao vivo**
  (o mesmo painel lateral, alimentado por `docker logs -f` remoto).
- **Imagens:** listar e remover.
- Se o `docker` não existir ou o usuário não tiver permissão, as seções
  Containers/Imagens daquele servidor mostram o motivo; Processos segue funcionando.
- **Ações destrutivas no remoto** (encerrar, parar, remover) pedem confirmação
  que **cita o nome da máquina** ("Remover container X em `prod-01`?").
- O atalho "Logs" na aba Processos (porta publicada por container) só vale para
  itens locais na v1.

### Túneis salvos (local port forward livre)
- Na aba Servidores, uma seção **Túneis** lista, por servidor conectado (ou com
  túneis salvos), as definições: **nome**, **porta neste computador**, **IP ou
  host de destino** e **porta de destino**. É o `ssh -fN -L local:destino:porta
  usuário@servidor`, mostrado no formulário como "Equivale a".
- Cada túnel tem **Abrir/Fechar**, **Editar** (só fechado) e **Excluir**. O destino
  é resolvido e alcançado pelo servidor (pode ser um IP da rede privada dele ou
  um nome de host). Só escuta em `127.0.0.1`. Porta local em uso ou privilegiada,
  e destino inválido, dão erro claro na linha do túnel.
- **Abrir sozinho quando o servidor conectar** (opcional, por túnel), inclusive ao
  reconectar depois de uma queda. Servidor desconectado: "Abrir" fica desabilitado.
- Os túneis abertos pela aba Containers aparecem na mesma lista, com Fechar.
- As definições ficam em `localStorage` (`localhub.tunnels.v1`), sem segredos, e
  são apagadas junto com o servidor. Desconectar avisa quantos túneis fecha.
- Backend: `OpenForward` (`internal/ssh/tunnel.go`); evento `tunnels:changed`.

### Terminal dentro de um container
- Em cada container **rodando** de um servidor, o botão **Terminal** abre, na aba
  Servidores, um shell dentro dele pela conexão já aberta:
  `docker exec -it -e TERM=xterm-256color <id>` com `bash` se existir e `sh` caso
  contrário. Container parado ou inexistente dá erro claro antes de abrir.
- Usa o mesmo terminal embutido e a mesma vaga única: abrir outro (de outro
  container ou o shell do servidor) com um aberto pede confirmação citando os
  dois; clicar de novo no mesmo só o mostra. A barra mostra o container e o
  servidor, e "Reabrir" volta ao mesmo container.
- Backend: `OpenContainerTerminal` (`internal/ssh/service.go`), que valida o ID
  e consulta o estado do container antes de montar o comando.

### Nome de exibição dos containers
- Plataformas como Coolify e Dokku dão ao container um nome gerado e guardam o
  nome legível do app numa etiqueta. O botão ⓘ de cada container abre os
  detalhes com todas as etiquetas (`docker inspect`, local e remoto); "Usar como
  nome" escolhe a etiqueta cujo valor passa a ser o nome mostrado, para todos os
  containers que a tiverem (guardado em `localStorage`, `localhub.names.v1`).
  O nome do Docker continua visível abaixo e é o que identifica o container nas
  ações; confirmações, painel de logs e túnel mostram o nome de exibição.

### Túnel para um container (local port forward)
- Em cada container **rodando** de um servidor, na aba Containers, o botão
  **Túnel** abre um diálogo: rede/IP do container (`docker inspect`), porta do
  container (as declaradas, ou uma digitada), porta neste computador (sugestão
  livre; vazio = automática) e o comando `ssh -fN -L …` equivalente.
- **Abrir túnel** passa a escutar em `127.0.0.1:<porta local>` e leva cada
  conexão, pela conexão SSH já aberta do servidor, até `<IP do container>:<porta>`.
  Nenhum processo `ssh` extra é iniciado.
- O IP vem sempre do servidor (nunca da tela) e é consultado de novo se a conexão
  falhar (container reiniciado com outro IP). Container em `network_mode: host`
  usa `127.0.0.1` do servidor.
- Só escuta em loopback. Porta local ocupada ou privilegiada dá erro claro.
- O túnel aparece como chip `127.0.0.1:<local> → <porta>` na linha do container,
  com **×** para fechar, e acaba com a conexão. **Desconectar** o servidor avisa
  quantos túneis fecha.
- Backend: `ContainerNetworks`, `SuggestLocalPort`, `OpenTunnel`, `CloseTunnel`,
  `ListTunnels` (`internal/ssh/tunnel.go`); evento `tunnels:changed`.

### Verificação da chave do servidor
- Usa `~/.ssh/known_hosts`. Servidor desconhecido: diálogo mostra o fingerprint
  SHA256 e pergunta se confia (TOFU); se aceitar, grava no `known_hosts`.
- Chave diferente da registrada: conexão bloqueada com erro explícito, sem
  opção de continuar.

### Erros (PT-BR)
- Mensagens distintas para: rede/timeout (10 s), autenticação recusada,
  passphrase incorreta, arquivo de chave ilegível, agente indisponível e chave do
  servidor alterada. O histórico já exibido no terminal é preservado.

## Arquitetura

**Backend (Go)** — novo pacote `internal/ssh/`:
- `conn.go`: registro de conexões por `hostID` (um `*ssh.Client` por servidor),
  dial com `golang.org/x/crypto/ssh` (hoje indireta no `go.mod`; passa a
  direta), keepalive e detecção de queda.
- `session.go`: terminal sobre a conexão do servidor (PTY, shell, `Write`,
  `Resize`, `Close`).
- `exec.go`: `Run(ctx, hostID, cmd)` (saída completa, com timeout) e
  `Stream(ctx, hostID, cmd, emit)` (para logs), cada um num canal próprio.
- `remote.go`: leitura e ações remotas, reaproveitando os tipos já usados no
  local (`ports.PortInfo`, tipos de container/imagem de `internal/docker`):
  - Processos: `ss -H -tulnp` (parse em Go); encerrar com `kill -TERM <pid>`.
  - Containers: `docker ps -a --format '{{json .}}'`; `docker start|stop|restart|rm <id>`;
    logs com `docker logs -f --tail N --timestamps <id>`.
  - Imagens: `docker images --format '{{json .}}'`; `docker rmi <id>`.
- `hostkey.go`: `known_hosts` via `x/crypto/ssh/knownhosts` + fluxo TOFU.
- `config.go`: parser básico de `~/.ssh/config`.
- `agent.go`: conexão ao agente via `x/crypto/ssh/agent` (por SO).
- Métodos em `app.go` (novos; **as assinaturas locais não mudam**, para não
  quebrar os bindings atuais): `SSHConnect`, `SSHDisconnect`, `SSHOpenTerminal`,
  `SSHWrite`, `SSHResize`, `SSHConfirmHostKey`, `SSHImportConfig`, `PickFile`
  (análogo ao `PickDirectory`, com `OpenFileDialog`) e a família remota:
  `RemoteListPorts(hostID)`, `RemoteKillProcess(hostID, pid)`,
  `RemoteListContainers(hostID)`, `RemoteContainerAction(hostID, id, action)`,
  `RemoteStartLogs(hostID, id, sessionID)`, `RemoteListImages(hostID)`,
  `RemoteRemoveImage(hostID, id)`.
- **Anti-injeção:** nenhum valor vindo da UI ou da saída remota entra no
  comando sem validação (`pid` numérico; `id` de container/imagem por regex
  `^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$`; `action` de uma lista fixa) e todo
  argumento é passado com quoting para shell POSIX.
- Streaming no padrão de `internal/docker/logs.go`: eventos de conexão por
  servidor (`ssh:state:<id>`, `ssh:hostkey:<id>`) e de terminal por sessão
  (`ssh:data:<session>`, `ssh:end:<session>`), com a sessão escolhida pelo
  frontend para que o fim de um terminal antigo nunca atinja o novo; o frontend
  assina **antes** de chamar `SSHConnect`/`SSHOpenTerminal`.
  Saída em lotes pequenos e em base64 (o terminal precisa de bytes crus).

**Frontend (React/TS):**
- `App.tsx`: `Tab` ganha `'ssh'`; `TAB_LABELS`, `counts` e render.
- `components/SshTab.tsx`, `SshTerminal.tsx`, `SshHostDialog.tsx`.
- `useSshHosts.ts`: persistência no padrão de `useLogsPrefs.ts` (chave
  `localhub.ssh.v1`, validação por campo, debounce).
- `useSshConnections.ts`: estado das conexões (servidores conectados, estado,
  erro) compartilhado por `App.tsx` com as abas de dados.
- `components/HostGroup.tsx`: seção recolhível com cabeçalho do servidor, reutilizada
  por `PortsTable`, `ContainersTable` e `ImagesTable`. Cada tabela passa a
  receber uma lista de grupos (`local` + remotos) em vez de uma lista plana.
- `LogsDrawer`/`useContainerLogs` ganham um parâmetro opcional `hostID`
  (vazio = local) para escolher entre `StartContainerLogs` e `RemoteStartLogs`.
- `ConfirmDialog` recebe o nome da máquina nas ações destrutivas remotas.
- Dependências: `@xterm/xterm`, `@xterm/addon-fit`.
- Estilo: tokens de `style.css`; laranja só em ações destrutivas, âmbar para
  "conectada"; tema do xterm derivado de `--chassis-bg`/`--ink-*`, fonte
  `--font-mono`.
- `Esc` dentro do terminal vai para o shell remoto; atalhos globais ficam
  suspensos enquanto o terminal tem foco.

**Segurança:**
- `localStorage` só com metadados (nome, endereço, porta, usuário, método, caminho
  da chave). Nunca passphrase nem conteúdo de chave.
- Passphrase só em memória, zerada após o uso, nunca logada.
- Sem `InsecureIgnoreHostKey`.

## Decisões

| Decisão | Motivo |
|---|---|
| SSH nativo em Go, sem shell-out ao `ssh` | Igual em Linux/Windows/macOS (o release gera os três); evita PTY local. |
| Servidores em `localStorage` | Segue `useLogsPrefs`; evita o primeiro arquivo de config no backend. Risco: limpar dados do webview apaga a lista (futuro: exportar/importar JSON). |
| Uma conexão por servidor, vários servidores; um terminal por vez | Dados de vários servidores agregam valor; várias abas de terminal não, na v1. Canais SSH separam terminal e comandos na mesma conexão. |
| Dados remotos por comandos via SSH (`ss`, `docker … --format json`) | Só exige SSH e o CLI docker no remoto; sem túnel de socket nem agente. Assume remoto Linux. |
| Seções por máquina na mesma lista | Dá visão conjunta e deixa explícito de qual máquina é cada item. |
| Métodos `Remote*` novos em vez de mudar os locais | Mantém os bindings e o fluxo local intactos. |
| Limpeza fica só local na v1 | Prune em máquina remota é de alto risco e não foi pedido. |
| ssh-agent no Windows via named pipe | Cobre o OpenSSH Agent nativo; Pageant adiado. |
| Sem login por senha na v1 | Muitos servidores já o desativam; pode entrar depois sem mudar o modelo. |

**Riscos:** parse de `ss`/`docker` varia entre versões (preferir formatos
estruturados e testar com 2 distros); latência ao atualizar vários servidores (rodar
em paralelo, com timeout por servidor); ações destrutivas no servidor errado (nome da
máquina sempre na confirmação); throughput do terminal pela ponte de eventos
(mitigar com batching + base64; validar com `cat` de arquivo grande); bindings do Wails em
`frontend/wailsjs/` são versionados e regenerados — incluir no commit.

## Verificação

1. `go build ./... && go vet ./...` e `cd frontend && npm run build`.
2. `wails dev -tags webkit2_41`: cadastrar servidor, importar `~/.ssh/config`,
   conectar com chave sem passphrase, com passphrase e via agent.
3. Servidor de teste (ex.: container `linuxserver/openssh-server`): TOFU de
   servidor novo, chave do servidor alterada (bloqueio), passphrase errada, timeout, resize
   (`stty size`), `vim`/`htop`, `cat` de arquivo grande.
4. Fechar o app com sessão ativa não deixa conexão pendurada.
5. `localStorage` sem passphrase nem conteúdo de chave.
6. Conectar 2 servidores: as 3 abas mostram "Esta máquina" + 2 grupos; derrubar um
   servidor (parar o sshd) marca só o grupo dele; reconectar restaura.
7. Remoto sem docker: Processos funciona e Containers/Imagens mostram o motivo.
8. Ações remotas (encerrar, parar/remover container, remover imagem, logs ao
   vivo) funcionam e a confirmação cita o servidor; ID malicioso (`x; rm -rf ~`) é
   rejeitado antes de executar.
6. `wails build -tags webkit2_41` gera o binário Linux.
