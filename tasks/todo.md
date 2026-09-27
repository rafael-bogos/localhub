# Tasks: Gerenciamento de Containers e Imagens Docker

<!-- plan: tasks/plan.md · spec: specs/docker-management.md -->

## Phase 1: Fundação

- [x] **Task 1: Dependência e conexão com o Docker**
  - Description: Adicionar o SDK oficial do Docker ao projeto e criar um
    helper de conexão com o daemon (`internal/docker/docker.go`), com erro
    em português quando o daemon não responde.
  - Acceptance:
    - [x] `go get github.com/docker/docker/client` executado e `go.mod`/`go.sum`
          atualizados
    - [x] `newClient(ctx) (*client.Client, error)` conecta via `client.FromEnv`
          + negociação de versão da API
    - [x] Erro de conexão retorna mensagem em português (ex.: "não foi
          possível conectar ao Docker: <causa>"), nunca o erro bruto do SDK
  - Verify:
    - [x] `go build ./...` passa limpo
    - [x] Manual: com Docker rodando, `newClient` conecta sem erro; com
          Docker parado, retorna o erro em português (testar via um `main`
          temporário ou teste manual em `wails dev` depois da Task 4)
  - Dependencies: None
  - Files: `go.mod`, `go.sum`, `internal/docker/docker.go`
  - Estimated scope: XS (1 arquivo novo + deps)

- [x] **Task 2: Tipos compartilhados**
  - Description: Definir `ContainerInfo` e `ImageInfo`, os structs que
    atravessam o binding Wails até o frontend (mesmo papel de `PortInfo` em
    `internal/ports/ports.go`).
  - Acceptance:
    - [x] `ContainerInfo{ID, Name, Image, Status, State, Ports string}` com
          json tags camelCase
    - [x] `ImageInfo{ID, Repository, Tag, Size string, Created string}` com
          json tags camelCase
  - Verify:
    - [x] `go build ./...` passa limpo
  - Dependencies: None (pode ser feito em paralelo com Task 1)
  - Files: `internal/docker/types.go`
  - Estimated scope: XS (1 arquivo)

### Checkpoint: Fundação
- [x] `go build ./...` limpo
- [x] `go.mod`/`go.sum` revisados (nenhuma dependência inesperada)
- [x] Nenhum arquivo de `app.go` ou do frontend tocado ainda

## Phase 2: Fatia vertical — Containers

- [x] **Task 3: `internal/docker/containers.go`**
  - Description: Implementar `ListContainers` (todos, rodando primeiro),
    `StartContainer`, `StopContainer`, `RestartContainer`, `RemoveContainer`
    (retorna erro em português se o container estiver rodando).
  - Acceptance:
    - [x] `ListContainers(ctx) ([]ContainerInfo, error)` retorna containers
          rodando + parados, ordenados com os rodando primeiro
    - [x] `StartContainer`/`StopContainer`/`RestartContainer(ctx, id string) error`
    - [x] `RemoveContainer(ctx, id string) error` retorna erro em português
          ("pare o container antes de removê-lo") se o container estiver
          rodando, sem tentar forçar a remoção
    - [x] Erros do daemon traduzidos para mensagens em português
  - Verify:
    - [x] `go build ./...` passa limpo
    - [x] Manual (depois da Task 4): ações refletem no `docker ps -a` real
  - Dependencies: Task 1, Task 2
  - Files: `internal/docker/containers.go`
  - Estimated scope: S (1 arquivo)

- [x] **Task 4: Bind dos métodos de container em `app.go`**
  - Description: Expor os métodos de `internal/docker/containers.go` como
    métodos de `App`, seguindo o padrão de `ListPorts`/`KillProcess`.
  - Acceptance:
    - [x] `App.ListContainers`, `App.StartContainer`, `App.StopContainer`,
          `App.RestartContainer`, `App.RemoveContainer` implementados,
          delegando para `internal/docker`
  - Verify:
    - [x] `go build ./...` passa limpo
    - [x] `wails dev` regenera `frontend/wailsjs/go/main/App.{js,d.ts}` com os
          novos métodos
  - Dependencies: Task 3
  - Files: `app.go`
  - Estimated scope: XS (1 arquivo)

- [x] **Task 5: Navegação por abas em `App.tsx`**
  - Description: Adicionar estado de aba ativa (`'portas' | 'containers' |
    'imagens'`) e os controles de aba na fascia, ao lado do wordmark. O
    `instrument-panel` passa a renderizar a tabela da aba ativa; a aba
    Containers pode ficar com um placeholder até a Task 6.
  - Acceptance:
    - [x] Três abas visíveis na fascia: "Portas", "Containers", "Imagens"
    - [x] Trocar de aba troca o conteúdo do `instrument-panel` sem recarregar
          a janela
    - [x] Aba "Portas" continua funcionando exatamente como antes (sem
          regressão)
    - [x] Visual das abas segue os tokens do `DESIGN.md` (sem cor nova)
  - Verify:
    - [x] `npm run build` (frontend) passa limpo
    - [x] Manual: alternar entre as três abas no `wails dev`
  - Dependencies: None no backend; pode ser feito em paralelo com Tasks 1-4
  - Files: `frontend/src/App.tsx`, `frontend/src/App.css`
  - Estimated scope: S (2 arquivos)

- [x] **Task 6: `ContainersTable.tsx`**
  - Description: Componente de tabela para containers, mesma linguagem
    visual de `PortsTable.tsx` (fileira-tecla). Ações: iniciar, parar,
    reiniciar, remover — todas com confirmação nativa antes de agir. Remover
    fica desabilitado (hachura) enquanto o container estiver rodando. Estado
    de erro em português quando `ListContainers` falhar (Docker indisponível).
  - Acceptance:
    - [x] Lista nome, imagem, status e portas de cada container
    - [x] Botões iniciar/parar/reiniciar chamam o binding correspondente,
          com confirmação antes de parar/reiniciar (iniciar não precisa,
          igual ao "Atualizar" em Portas — ação não-destrutiva)
    - [x] Botão remover: desabilitado + hachura enquanto rodando; habilitado
          e com confirmação quando parado
    - [x] Erro de conexão com o Docker mostra mensagem em português, não a
          tabela vazia silenciosa
  - Verify:
    - [x] `npm run build` passa limpo
    - [x] Manual: todas as ações testadas contra um container real de teste
          (`docker run -d --name teste nginx`, por exemplo)
  - Dependencies: Task 4, Task 5
  - Files: `frontend/src/components/ContainersTable.tsx`, `frontend/src/App.css`
  - Estimated scope: M (1-2 arquivos, mas replica bastante lógica de PortsTable)

### Checkpoint: Containers funcionando ponta a ponta
- [x] `go build ./...` e `npm run build` limpos
- [x] `wails dev`: aba Containers lista, inicia, para, reinicia e remove
      containers reais, com confirmação em cada ação destrutiva
- [x] Aba Portas sem regressão
- [x] **Revisar com o usuário antes de seguir para a Phase 3**

## Phase 3: Fatia vertical — Imagens

- [x] **Task 7: `internal/docker/images.go`**
  - Description: Implementar `ListImages`, `RemoveImage`, `PruneImages`
    (apenas imagens dangling `<none>:<none>`).
  - Acceptance:
    - [x] `ListImages(ctx) ([]ImageInfo, error)` retorna repositório:tag,
          tamanho formatado (ex. "120MB") e data de criação
    - [x] `RemoveImage(ctx, id string) error`
    - [x] `PruneImages(ctx) (count int, spaceMB int64, err error)` remove só
          dangling e retorna quantas/quanto espaço, para a UI mostrar
    - [x] Erros do daemon traduzidos para mensagens em português
  - Verify:
    - [x] `go build ./...` passa limpo
  - Dependencies: Task 1, Task 2
  - Files: `internal/docker/images.go`
  - Estimated scope: S (1 arquivo)

- [x] **Task 8: Bind dos métodos de imagem em `app.go`**
  - Description: Expor `ListImages`, `RemoveImage`, `PruneImages` como
    métodos de `App`.
  - Acceptance:
    - [x] `App.ListImages`, `App.RemoveImage`, `App.PruneImages`
          implementados, delegando para `internal/docker`
  - Verify:
    - [x] `go build ./...` passa limpo
    - [x] `wails dev` regenera os bindings com os novos métodos
  - Dependencies: Task 7
  - Files: `app.go`
  - Estimated scope: XS (1 arquivo)

- [x] **Task 9: `ImagesTable.tsx`**
  - Description: Componente de tabela para imagens, mesma linguagem visual.
    Ações: remover uma imagem (confirmação) e "limpar não usadas" / prune de
    dangling (confirmação, mostrando quantas foram removidas e o espaço
    liberado depois). Estado de erro em português quando o Docker estiver
    indisponível.
  - Acceptance:
    - [x] Lista repositório:tag, tamanho e data de criação
    - [x] Botão remover por imagem, com confirmação
    - [x] Botão de prune, com confirmação, mostra resultado (quantas
          removidas + espaço liberado) após a ação
    - [x] Erro de conexão com o Docker mostra mensagem em português
  - Verify:
    - [x] `npm run build` passa limpo
    - [x] Manual: remover uma imagem de teste e rodar o prune contra imagens
          dangling reais
  - Dependencies: Task 8, Task 5 (reaproveita a navegação por abas)
  - Files: `frontend/src/components/ImagesTable.tsx`, `frontend/src/App.css`
  - Estimated scope: M (1-2 arquivos)

### Checkpoint: Imagens funcionando ponta a ponta
- [x] `go build ./...` e `npm run build` limpos
- [x] `wails dev`: aba Imagens lista, remove e faz prune de imagens reais
- [x] As três abas convivem sem regressão nas outras duas

## Phase 4: Estado "Docker indisponível" + polish + docs

- [x] **Task 10: Estado de erro consistente quando o Docker não responde**
  - Description: Garantir que Containers e Imagens mostrem o mesmo padrão de
    estado de erro (reaproveitando `.alert` do design system) quando
    `ListContainers`/`ListImages` falharem por o Docker não estar
    instalado/rodando — nunca uma tela em branco ou crash.
  - Acceptance:
    - [x] Mensagem em português, específica ("Docker não encontrado" /
          "não foi possível conectar ao Docker"), não um erro genérico
    - [x] Aba Portas não é afetada por esse estado
  - Verify:
    - [x] Manual: testar com o Docker Desktop/daemon parado
  - Dependencies: Task 6, Task 9
  - Files: `frontend/src/components/ContainersTable.tsx`,
    `frontend/src/components/ImagesTable.tsx`
  - Estimated scope: XS

- [x] **Task 11: Conferência visual contra `DESIGN.md`**
  - Description: Revisar as duas novas tabelas contra os tokens e regras
    nomeadas do `DESIGN.md` (paleta de 3 papéis, mono-para-dados,
    fileira-erguida, etc.) — nenhuma cor/fonte/padrão novo sem atualizar o
    DESIGN.md primeiro.
  - Acceptance:
    - [x] Nenhuma cor fora de `--orange`/`--amber`/neutros já definidos
    - [x] `impeccable detect --json` sem achados novos nos arquivos tocados
  - Verify:
    - [x] `.claude/skills/impeccable/scripts/impeccable detect --json` nos
          arquivos novos/alterados
  - Dependencies: Task 6, Task 9
  - Files: (revisão, sem arquivo fixo)
  - Estimated scope: XS

- [x] **Task 12: Atualizar `PRODUCT.md`**
  - Description: Mover "Docker container and image management" de
    "planejado" para capacidade existente em `## Capabilities and
    Constraints`, com o escopo real entregue (start/stop/restart/remove
    container; list/remove/prune imagens dangling).
  - Acceptance:
    - [x] `PRODUCT.md` reflete o que foi de fato construído, não a intenção
          original
  - Verify:
    - [x] Leitura humana
  - Dependencies: Checkpoint da Phase 3 completo
  - Files: `PRODUCT.md`
  - Estimated scope: XS

### Checkpoint: Completo
- [x] Todos os critérios de sucesso de `specs/docker-management.md` atendidos
- [x] `go build ./...` e `npm run build` limpos
- [x] Teste manual completo: Docker rodando E Docker parado/desinstalado
- [x] Pronto para revisão do usuário
