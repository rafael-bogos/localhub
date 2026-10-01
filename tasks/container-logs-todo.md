# Tasks: Logs de containers

<!-- spec: specs/container-logs.md · sem testes automatizados (decisão da spec); cada tarefa termina com build + verificação manual -->

Ordem por dependência: backend → painel mínimo → busca/filtros → persistência →
atalho nas Portas → carregar antigas. Cada tarefa deixa o app funcionando.

> Status: **T1–T13 concluídas.** Verificado com testes temporários no Go contra o
> Docker real (removidos, sem testes automatizados por decisão da spec) e com um
> roteiro de 49 verificações no Chrome headless com o Wails simulado (também
> descartado). **Ainda não testado:** o app Wails real (`wails dev`) — em
> especial a ponte de eventos Go → frontend no WebKitGTK.

## Phase 1: Backend

- [x] **T1: Montagem de linhas (funções puras)** — `internal/docker/logs_lines.go`
  - Acumula chunks por origem, emite só linhas completas (`\n`/`\r\n`), teto de
    64 KiB por linha (truncada), separa o prefixo de timestamp, remove ANSI.
  - Verify: `go build`, `go vet`; verificação com programa temporário (linha
    partida entre chunks, `\r\n`, linha gigante).
- [x] **T2: Stream ao vivo** — `internal/docker/logs.go`, `app.go`
  - `StartContainerLogs(sessionID, id, tail)` (o **frontend** escolhe o `sessionID` e assina os eventos antes de chamar); eventos `logs:batch:<id>` em
    lotes de ~100 ms/200 linhas e `logs:end:<id>`; `StopContainerLogs`; uma
    sessão por vez; `stdcopy` sem TTY, cru com TTY (via `ContainerInspect`).
  - Verify: `go build`; programa temporário lê logs reais de um container.
- [x] **T3: Carregar antigas** — `internal/docker/logs.go`, `app.go`
  - `LoadOlderContainerLogs(id, beforeTs, count)` → linhas + `hasMore`, com
    dedupe na fronteira do timestamp.
  - Verify: `go build`; programa temporário pagina até o início.
- [x] **T4: Donos de porta** — `internal/docker/port_owners.go`, `app.go`
  - `ListPortOwners()` → `(protocolo, porta) → container`, só rodando/publicadas.
  - Verify: `go build`; confere com `docker ps`.
- [x] **T5: Bindings** — `wails generate module` (reverter `wailsjs/runtime`).

## Phase 2: Painel mínimo (ao vivo)

- [x] **T6: Hook e painel** — `useContainerLogs.ts`, `LogsDrawer.tsx`, `App.tsx`,
  `ContainersTable.tsx`, `App.css`
  - Botão "Logs" na tabela; painel lateral ao lado da tabela; buffer de 5000 linhas;
    lotes por `requestAnimationFrame`; rolagem automática com pausa ao rolar e
    "N novas linhas ↓"; estados (carregando/ao vivo/pausado/encerrado/erro);
    expandir/recolher; `Esc` fecha; reconecta se o container voltar; sem HTML.
  - Verify: `tsc`, `vite build`; captura no Chrome com dados simulados.

## Phase 3: Busca e filtros

- [x] **T7: Detecção de nível** — `frontend/src/logLevel.ts` (tabela única de regras).
- [x] **T8: Busca** — `LogsToolbar.tsx`: substring/regex, Filtrar/Destacar,
  navegação Enter/Shift+Enter, contador "X de Y".
- [x] **T9: Filtros** — origem, nível (+ outros), período; Limpar; Copiar visíveis.

## Phase 4: Persistência e atalhos

- [x] **T10: Preferências** — `useLogsPrefs.ts` (`localStorage` `localhub.logs.v1`),
  selo "filtros ativos" + "Limpar filtros", reabrir container pelo nome.
- [x] **T11: Atalho nas Portas** — `PortsTable.tsx`, `App.tsx`: nome do container
  e botão "Logs" nas portas publicadas; falha silenciosa sem Docker.
- [x] **T12: "Carregar mais antigas"** — botão no topo do painel, sem pular a
  posição de leitura, "início dos logs", respeita o teto de 5000.

## Final
- [x] **T13: Verificação geral** — `go build/vet`, `gofmt`, `tsc`, `vite build`,
  backend testado contra o Docker real, frontend contra o Wails simulado (não houve teste ponta a ponta no app real), checagem contra os critérios da spec.
