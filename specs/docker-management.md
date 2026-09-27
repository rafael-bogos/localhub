# Spec: Gerenciamento de Containers e Imagens Docker

<!-- status: confirmado com o usuário — pronto para virar tasks/plan.md -->

## Objective

localhub está deixando de ser só um "mata-porta" para virar um hub de ferramentas
locais (ver `PRODUCT.md`). Esta é a segunda frente: gerenciar containers e imagens
Docker direto do app, sem abrir terminal.

**Usuário:** o mesmo de sempre — o desenvolvedor solo, na própria máquina, durante
o desenvolvimento local. Mesmo modo de uso: aberto rapidamente, ação de segundos,
fechado de novo.

**Sucesso:** substituir o ritual de `docker ps` / `docker stop` / `docker rm` /
`docker images` / `docker rmi` / `docker image prune` por uma lista visual com
ações de um clique — mais rápido que o terminal, sempre, para as duas frentes
(portas e Docker) dentro do mesmo instrumento.

**Fora de escopo nesta primeira versão** (registrar para não expandir sem querer):
- Logs de container, `exec` interativo, `docker run` de uma imagem nova, `pull`,
  `build`, volumes, redes, compose.
- Hosts Docker remotos — só o daemon local.

## Tech Stack

- Backend: Go (Wails v2), como hoje.
- Acesso ao Docker: **SDK oficial do Docker** — `github.com/docker/docker/client`
  (Docker Engine API), não shell-out para o binário `docker`. Decisão confirmada
  com o usuário: mais robusto e com dados estruturados, aceitando a dependência
  Go adicional e a exigência de o daemon estar acessível via socket
  (`/var/run/docker.sock` no Linux/macOS, named pipe no Windows).
- Frontend: React + TypeScript + Vite, como hoje. Sem novas libs de estado —
  `useState`/`useEffect` como no `App.tsx` atual.
- Design: tokens e regras de `DESIGN.md` (paleta de 3 papéis, IBM Plex Sans/Mono,
  fileiras estilo tecla). Nenhuma cor nova.

## Commands

Iguais aos já usados no projeto — nenhum comando novo introduzido por esta feature:

```
Dev (app completo):     wails dev
Dev (só frontend):      cd frontend && npm run dev
Build frontend:         cd frontend && npm run build   (tsc && vite build)
Build app completo:     wails build
Build backend Go:       go build ./...
Baixar dependência SDK: go get github.com/docker/docker/client
```

Não existe lint/test configurado no projeto hoje (nem Go, nem frontend) — ver
"Testing Strategy" abaixo.

## Project Structure

Segue o padrão já estabelecido pelo recurso de portas (`internal/ports/`):

```
internal/
  ports/                    → (existente, sem mudanças)
  docker/
    docker.go               → cliente Docker (conecta ao daemon), lifecycle
    containers.go            → ListContainers, StartContainer, StopContainer,
                                RestartContainer, RemoveContainer
    images.go                → ListImages, RemoveImage, PruneImages
    types.go                  → ContainerInfo, ImageInfo (structs com json tags)

app.go                       → novos métodos bind expostos ao frontend:
                                ListContainers, StartContainer, StopContainer,
                                RestartContainer, RemoveContainer,
                                ListImages, RemoveImage, PruneImages

frontend/src/
  App.tsx                    → ganha estado de "aba ativa" (portas | containers
                                | imagens) e renderiza a tabela da aba ativa
  components/
    PortsTable.tsx            → (existente, sem mudanças de lógica)
    ContainersTable.tsx        → nova, mesma linguagem visual (fileira-tecla)
    ImagesTable.tsx             → nova, idem
  wailsjs/go/main/App.{js,d.ts} → regenerado automaticamente pelo `wails dev`/
                                  `wails build` a partir dos novos métodos do App
```

## Code Style

Backend Go — mesmo estilo de `internal/ports/ports.go`: funções simples que
retornam `([]T, error)` ou `error`, structs com `json` tags em camelCase, erros
envolvidos com `fmt.Errorf("... %w", err)`, mensagens de erro em português
(igual ao `KillProcess` atual: `"processo %d não encontrado: %w"`).

```go
// internal/docker/containers.go
package docker

type ContainerInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Image   string `json:"image"`
	Status  string `json:"status"`  // texto bruto do daemon, ex. "Up 2 hours"
	State   string `json:"state"`   // "running" | "exited" | "paused" | ...
	Ports   string `json:"ports"`   // já formatado, ex. "8080->80/tcp"
}

func ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	cli, err := newClient()
	if err != nil {
		return nil, fmt.Errorf("não foi possível conectar ao Docker: %w", err)
	}
	defer cli.Close()

	containers, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("falha ao listar containers: %w", err)
	}
	// map para ContainerInfo...
}
```

Frontend — mesmo estilo de `PortsTable.tsx`: componente funcional, props
tipadas via interface, sem libs de state management, classes CSS existentes do
design system (`.ports-table` → generalizar para `.data-table` reutilizável, ou
duplicar a mesma estrutura de classes para `.containers-table`/`.images-table`
— decisão de implementação, não de spec).

## Testing Strategy

**Decidido com o usuário: sem testes automatizados por enquanto**, mesmo padrão
do resto do projeto (nem Go nem frontend têm testes hoje). `internal/docker`
segue sem suíte de testes, apesar de ser a primeira parte do código a falar com
um serviço externo — reavaliar no futuro se o pacote crescer.

## Boundaries

- **Sempre fazer:**
  - Confirmação nativa (`window.confirm`) antes de parar, reiniciar ou remover
    um container, e antes de remover uma imagem ou rodar prune — mesmo padrão
    do "Matar processo".
  - Copy 100% em português.
  - Seguir os tokens do `DESIGN.md` (paleta de 3 papéis, tipografia, raios,
    regras nomeadas) — nenhuma cor/fonte nova sem atualizar o DESIGN.md primeiro.
  - Mensagens de erro do Docker traduzidas/reescritas em português antes de
    chegar na UI (nunca mostrar stack trace ou erro bruto do SDK).

- **Perguntar antes:**
  - Adicionar a dependência `github.com/docker/docker` (e suas transitivas) ao
    `go.mod` — é uma lib grande; confirmar antes de rodar `go get`.
  - Qualquer mudança em `wails.json` ou nas permissões/entitlements do build
    (o acesso ao socket Docker pode exigir ajuste em builds empacotados,
    especialmente no macOS).
  - Se a lista de containers/imagens ficar muito grande (centenas), se vale a
    pena paginar/virtualizar — não assumir performance sem medir.

- **Nunca fazer:**
  - Remover container ou imagem sem confirmação explícita do usuário.
  - Rodar `docker system prune` genérico (remove volumes/redes/build cache
    sem distinção) — só o prune específico de imagens dangling, que é o
    escopo combinado.
  - Falar com um daemon Docker remoto ou aceitar um host customizado nesta
    versão.
  - Commitar qualquer socket path ou credencial específica de máquina.

## Success Criteria

- [ ] Nova aba "Containers" lista todos os containers (rodando + parados) com
      nome, imagem, status e portas mapeadas, **ordenados com os containers
      em execução primeiro** (containers parados aparecem depois, mesma lista).
- [ ] Um clique + confirmação inicia/para/reinicia um container; a lista
      atualiza sozinha depois da ação (mesmo padrão de `loadPorts()` após
      `KillProcess`).
- [ ] Um clique + confirmação remove um container parado. **Container em
      execução tem o botão "Remover" desabilitado** (mesmo tratamento visual
      do PID inválido na tabela de portas: hachura + botão desabilitado) até o
      usuário pará-lo primeiro — nunca remove um container ativo em um só
      clique.
- [ ] Nova aba "Imagens" lista todas as imagens locais com repositório:tag,
      tamanho e data de criação.
- [ ] Um clique + confirmação remove uma imagem; um botão separado faz prune
      de imagens dangling (`<none>:<none>`) com confirmação e mostra quantas
      foram removidas e o espaço liberado.
- [ ] As três abas (Portas/Containers/Imagens) vivem na mesma fascia, trocando
      só o conteúdo do `instrument-panel` abaixo — janela única preservada.
- [ ] Se o Docker não estiver instalado ou o daemon não estiver rodando, as
      abas Containers/Imagens mostram um estado de erro claro em português
      (não um crash, não uma tela em branco) — a aba Portas continua
      funcionando normalmente.
- [ ] Visual das novas tabelas usa a mesma linguagem de "fileira-tecla" já
      documentada no DESIGN.md — sem introduzir um componente visual novo do
      zero.
- [ ] `go build ./...` e `npm run build` (frontend) continuam passando limpos.

## Open Questions

Nenhuma pendente — as três decisões (testes, remoção de container rodando,
ordenação) foram confirmadas com o usuário e já estão refletidas acima.
