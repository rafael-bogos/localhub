# Implementation Plan: Gerenciamento de Containers e Imagens Docker

<!-- spec: specs/docker-management.md -->

## Overview

Adiciona duas novas abas ao localhub — "Containers" e "Imagens" — seguindo o
mesmo padrão arquitetural do recurso de portas já existente (`internal/ports`
→ `app.go` → tabela React com o design system de "fileira-tecla"). O backend
fala com o daemon Docker via SDK oficial (`github.com/docker/docker/client`).
Fatiado verticalmente: containers primeiro (slice completo, ponta a ponta),
depois imagens (reaproveitando a navegação por abas já construída).

## Architecture Decisions

- **SDK oficial do Docker, não shell-out** — decisão confirmada na spec.
  `client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())`
  para funcionar em Linux/macOS/Windows sem hardcodar socket path.
- **Navegação por abas na fascia** (não uma tela nova, não empilhado) —
  decisão confirmada na spec. `App.tsx` ganha um estado `activeTab: 'portas' |
  'containers' | 'imagens'`, e o `instrument-panel` renderiza a tabela da aba
  ativa.
- **Sem testes automatizados** — decisão confirmada na spec, mesmo padrão do
  restante do projeto.
- **Remoção de container bloqueada enquanto rodando** — decisão confirmada na
  spec; o backend retorna erro se `RemoveContainer` for chamado com o
  container ativo, e o frontend já desabilita o botão preventivamente (mesmo
  padrão visual do PID inválido: hachura + botão desabilitado).
- **Containers ordenados com "rodando" primeiro** — decisão confirmada na
  spec; ordenação feita no backend (`ListContainers`), não no frontend, para
  manter a mesma responsabilidade que `ports.go` já tem (`sort.Slice` lá).
- **Reuso do design system existente** — nenhuma cor, fonte ou padrão visual
  novo; `ContainersTable`/`ImagesTable` seguem a mesma estrutura de
  `PortsTable.tsx` e os tokens do `DESIGN.md`.

## Dependency Graph

```
go.mod (SDK Docker)
    │
    └── internal/docker/docker.go (newClient, conexão com o daemon)
            │
            ├── internal/docker/types.go (ContainerInfo, ImageInfo)
            │       │
            │       ├── internal/docker/containers.go
            │       │       │
            │       │       └── app.go (bind: List/Start/Stop/Restart/RemoveContainer)
            │       │               │
            │       │               └── frontend: abas (App.tsx) + ContainersTable.tsx
            │       │
            │       └── internal/docker/images.go
            │               │
            │               └── app.go (bind: ListImages/RemoveImage/PruneImages)
            │                       │
            │                       └── frontend: ImagesTable.tsx (reaproveita as abas)
```

## Task List

### Phase 1: Fundação (cliente Docker)

- [x] Task 1: Dependência e conexão com o Docker
- [x] Task 2: Tipos compartilhados (ContainerInfo, ImageInfo)

### Checkpoint: Fundação
- [x] `go build ./...` passa limpo
- [x] `go.mod`/`go.sum` atualizados e commitáveis
- [x] Nenhum código de `app.go` ou do frontend tocado ainda

### Phase 2: Fatia vertical — Containers

- [x] Task 3: `internal/docker/containers.go` (list/start/stop/restart/remove)
- [x] Task 4: Bind dos métodos de container em `app.go`
- [x] Task 5: Navegação por abas em `App.tsx` (Portas | Containers | Imagens)
- [x] Task 6: `ContainersTable.tsx` (tabela + ações + confirmação + estados)

### Checkpoint: Containers funcionando ponta a ponta
- [x] `go build ./...` e `cd frontend && npm run build` passam limpos
- [x] `wails dev`: aba Containers lista containers reais da máquina
- [x] Iniciar/parar/reiniciar/remover um container de teste funciona com
      confirmação antes de cada ação
- [x] Container rodando: botão "Remover" desabilitado (hachura, mesmo padrão
      do PID inválido)
- [x] Aba Portas continua funcionando sem regressão
- [x] Revisão com o usuário antes de seguir para Imagens

### Phase 3: Fatia vertical — Imagens

- [x] Task 7: `internal/docker/images.go` (list/remove/prune dangling)
- [x] Task 8: Bind dos métodos de imagem em `app.go`
- [x] Task 9: `ImagesTable.tsx` (tabela + remover + prune + confirmação)

### Checkpoint: Imagens funcionando ponta a ponta
- [x] `go build ./...` e `npm run build` passam limpos
- [x] `wails dev`: aba Imagens lista imagens reais da máquina
- [x] Remover uma imagem e rodar prune de dangling funcionam com confirmação
- [x] As três abas convivem sem regressão nas outras duas

### Phase 4: Estado "Docker indisponível" + polish + docs

- [x] Task 10: Estado de erro em português quando o daemon não responde
      (abas Containers/Imagens; Portas não é afetada)
- [x] Task 11: Conferência visual contra `DESIGN.md` (nenhum token novo)
- [x] Task 12: Atualizar `PRODUCT.md` — mover Docker de "planejado" para
      "capacidade existente"

### Checkpoint: Completo
- [x] Todos os critérios de sucesso da spec atendidos
- [x] `go build ./...` e `npm run build` limpos
- [x] Teste manual com Docker rodando E com Docker parado/desinstalado
- [x] Pronto para revisão do usuário

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| SDK do Docker é uma dependência grande; pode conflitar com versões já usadas (Wails, gopsutil) | Médio | Adicionar em task isolada (Task 1) e rodar `go build ./...` imediatamente antes de escrever qualquer lógica; se conflitar, resolver antes de prosseguir |
| Socket do Docker varia por SO (Linux `/var/run/docker.sock`, macOS Docker Desktop, Windows named pipe) | Médio | Usar `client.FromEnv` (auto-detecção) em vez de path fixo; documentar no erro que o Docker precisa estar rodando |
| Build empacotado (`wails build`) pode precisar de entitlements extras para acessar o socket (especialmente macOS) | Baixo (só aparece na hora de empacotar) | Já marcado como "perguntar antes" na spec; validar só quando chegarmos no build empacotado, não antes |
| Listas grandes de containers/imagens (centenas) podem pesar na UI | Baixo | Marcado como "perguntar antes" na spec; não otimizar sem medir primeiro |
| Padrão de confirmação ficar inconsistente entre as 3 abas | Baixo | Reusar literalmente a mesma função/estilo de `window.confirm` e mesma classe `.kill-key` para os botões de ação destrutiva |

## Open Questions

Nenhuma — todas resolvidas na spec (`specs/docker-management.md`).
