# Spec: Logs de containers (ao vivo, com busca e filtros)

<!-- status: implementado (tasks/container-logs-todo.md) — detecção de nível será refinada com os logs reais; ver "Ajustes feitos na implementação" -->

## Objective

Ver os logs de um container sem abrir o terminal (`docker logs -f`). O usuário
clica em "Logs" na linha do container e abre um **painel lateral** com os logs
**ao vivo**, com **busca** e **filtros**. O painel pode ser **expandido** para
ocupar a área toda quando o usuário precisa ler com calma.

**Usuário:** o mesmo de sempre — o desenvolvedor solo, na própria máquina,
depurando algo que acabou de subir (ou de cair).

**Sucesso:** achar a linha que explica o erro mais rápido do que com
`docker logs -f | grep`, sem perder o contexto da lista de containers ao lado.

**Também funciona em container parado:** mostra o que foi gravado antes de ele
cair — o caso mais comum de "por que isso morreu?".

**Fora de escopo nesta versão** (registrar para não expandir sem querer):
- `exec` interativo / terminal dentro do container (só leitura).
- Logs de vários containers ao mesmo tempo, na mesma visão (um por vez).
- Exportar/baixar o log para arquivo; alertas; persistência entre sessões.
- Logs de serviços Compose/Swarm agrupados; logs do daemon do Docker.
- Interpretar cores ANSI (ver Decisões).

## Comportamento

### Abrir e fechar
- Botão **Logs** em cada linha da aba Containers (também para containers
  parados). Abre o painel lateral à direita, sobre a tabela; a linha do
  container ativo fica marcada.
- **Atalho na aba Portas:** se a porta de uma linha é publicada por um
  container Docker em execução (ex.: `33067` → `mariadb-acessorias`), a linha
  ganha o nome do container e um botão **Logs** que abre o **mesmo painel**
  já naquele container — **sem trocar de aba** (o painel abre sobre a tabela
  de Portas). Ver "Atalho nas Portas" abaixo.
- Clicar em "Logs" de **outro** container troca o painel para ele (o stream
  anterior é encerrado). `Esc` ou o botão de fechar encerra o stream.
- **Expandir:** um botão no cabeçalho do painel alterna entre "lateral" (largura
  fixa, ~420 px, tabela continua visível) e "expandido" (ocupa toda a área do
  `instrument-panel`). Em janelas estreitas (≤ 720 px) o painel já abre
  expandido.

### Ao vivo
- Ao abrir: carrega as últimas **500 linhas** (`Tail`) e continua acompanhando
  (`Follow`). Novas linhas entram no fim.
- **Rolagem automática** ligada por padrão. Se o usuário rolar para cima, a
  rolagem automática **pausa sozinha** e aparece um indicador "N novas linhas ↓"
  que retoma ao clicar. Botão explícito de pausar/retomar o acompanhamento
  (o stream continua, só a exibição congela — ao retomar, mostra o que chegou).
- Container parado: mostra o histórico, sem "ao vivo", com aviso "container
  parado". Se ele for iniciado com o painel aberto, o painel **reconecta**
  sozinho ao stream.
- Container que para/é removido com o painel aberto: o stream termina, o painel
  avisa "container encerrado" e mantém as linhas já carregadas.

### Carregar logs antigos
- Botão **"Carregar mais antigas"** no topo da lista. Cada clique traz mais
  **500 linhas** anteriores à mais antiga já carregada e as insere no início,
  sem mexer na posição de leitura (a linha que estava no topo continua no topo).
- O Docker não pagina por deslocamento: usa-se `ContainerLogs` **sem `Follow`**,
  com `Until` = timestamp da linha mais antiga carregada e `Tail: 500`. Como
  várias linhas podem ter o mesmo timestamp, o backend descarta as linhas já
  conhecidas na fronteira (dedupe por timestamp + texto) para não duplicar
  nem perder nenhuma.
- Quando não houver mais nada, o botão vira "início dos logs" (desabilitado).
- Respeita o teto de 5000 linhas: ao atingi-lo o botão é desabilitado com a
  dica "limite do buffer — limpe ou filtre para continuar". O descarte
  automático das mais antigas vale só para o acompanhamento ao vivo com
  rolagem automática ligada.

### Atalho nas Portas

- **Ligação porta → container** pelo par `(protocolo, porta pública)` contra
  as portas publicadas dos containers **em execução** (`PublicPort`/`Type` da
  API do Docker). Não depende do nome do processo, que varia por sistema
  (`docker-proxy` no Linux, processos do Docker Desktop no macOS/Windows, ou
  nenhum PID quando o proxy está desligado).
- Linha ligada a um container mostra, na coluna do processo, o nome do
  container (rótulo discreto) e o botão **Logs** ao lado de **Matar**.
- **Docker desligado ou inacessível não gera erro na aba Portas:** a consulta
  falha em silêncio e as linhas ficam como hoje, sem o atalho.
- A consulta roda junto com o carregamento/atualização das portas (não em
  polling próprio) e não pode atrasar a lista: a lista de portas aparece
  primeiro e o atalho entra quando a consulta terminar.
- Uma porta publicada em IPv4 e IPv6 aponta para o mesmo container (sem
  duplicar), como já tratado no `formatPorts`.
- **Anotado, fora de escopo:** "Matar" numa porta de container mata o
  `docker-proxy`, não o container — a porta publicada deixa de responder mas o
  container segue vivo. Vale um aviso ou trocar para "Parar container" numa
  spec futura.

### Preferências (persistidas)
- Tudo é lembrado entre aberturas do app, em `localStorage` (um objeto único,
  chave versionada `localhub.logs.v1`): largura do painel, lateral/expandido,
  modo da busca (Filtrar/Destacar), regex ligada/desligada, texto da busca,
  filtros de origem, nível e período, rolagem automática, e **qual container
  estava aberto** (guardado pelo **nome**, já que o ID muda ao recriar).
- Ao abrir o app, se o container lembrado ainda existir, o painel reabre nele;
  se não existir mais, abre fechado, sem erro.
- Leitura/escrita sempre em `try/catch`; valor ausente, corrompido ou de outra
  versão cai nos padrões, nunca quebra a tela.
- Como filtros persistidos podem "esconder" logs sem o usuário lembrar (ex.:
  período "últimos 5 min" num container quieto), o painel mostra um selo
  **"filtros ativos"** com botão **"Limpar filtros"** sempre que qualquer
  filtro ou busca estiver diferente do padrão.

### Detecção de nível

O Docker entrega texto puro, sem campo de nível; o app deduz o nível de cada
linha por formato. **Ponto de partida** (a ser refinado com os logs reais):

| Ordem | Formato | Exemplo | Como reconhece |
|---|---|---|---|
| 1 | JSON | `{"level":"error","msg":"falha"}` | chave `level`, `severity` ou `lvl` (texto; ou número pino: 60/50 erro, 40 aviso, 30 info, 20/10 debug) |
| 2 | logfmt | `level=error msg="falha"` | `level=` / `lvl=` / `severity=` |
| 3 | Colchetes | `[Warning] Aborted connection`, `[error] ...` | `[...]` nos primeiros ~40 caracteres (MariaDB/MySQL, nginx) |
| 4 | Monolog/Laravel | `production.ERROR: falha` | `<canal>.<NÍVEL>:` |
| 5 | Redis | `1:M 29 Sep 12:00:00.123 * Ready` | símbolo após o horário: `.` e `-` debug, `*` info, `#` aviso |
| 6 | Palavra solta | `2026-09-29 ERROR falha` | palavra do nível, **em maiúsculas** e isolada, nos primeiros ~80 caracteres |

Mapa de nomes (sem diferenciar maiúsculas nas formas 1–4):
- **erro:** `fatal`, `panic`, `emerg`, `alert`, `crit`, `critical`, `severe`,
  `error`, `err`
- **aviso:** `warn`, `warning`
- **info:** `info`, `notice`, `note`, `system`, `log`
- **debug:** `debug`, `trace`, `verbose`

Regras:
- **Primeira regra que casar vence**, na ordem da tabela. Palavra solta só
  vale em maiúsculas e no começo da linha, para não marcar como erro a frase
  "no error found" no meio do texto.
- **Continuação herda o nível:** linha que começa com espaço/tab, `at `,
  `Caused by:`, `...` ou `Traceback` (stack trace) herda o nível da linha
  anterior da mesma origem, para o filtro não separar o erro do seu stack.
- Sem casar nenhuma regra → `outros`. Isso é esperado, não erro.
- Todas as regras ficam **numa tabela única** em `logLevel.ts` (formato,
  regex, mapeamento), para refinar acrescentando/ajustando uma linha, sem
  mexer na lógica.

**Como refinar:** com o painel pronto, o alternador `outros` mostra exatamente
as linhas que a detecção não entendeu; olhamos juntos os logs dos seus
containers reais (ex.: MariaDB, Redis e a sua API) e ajustamos a tabela.

### Busca
- Campo de busca no topo do painel; `Ctrl+F` (com o painel focado) foca nele.
- Substring, **sem diferenciar maiúsculas**, sobre o texto da linha.
- Alternância **"Regex"** (padrão: desligada). Regex inválida não quebra: o
  campo mostra estado de erro e a lista não muda.
- Ocorrências **destacadas** nas linhas. Dois modos, alternáveis: **"Filtrar"**
  (só as linhas que casam, padrão) e **"Destacar"** (todas as linhas visíveis,
  ocorrências em destaque, com navegação próxima/anterior — `Enter` /
  `Shift+Enter`).
- Contador "X de Y linhas" (linhas visíveis / linhas no buffer).

### Filtros
- **Origem:** alternadores `stdout` e `stderr` (ambos ligados por padrão).
- **Nível:** `erro`, `aviso`, `info`, `debug` e `outros` (linha sem nível
  reconhecido, com alternador próprio). Detectado no cliente por heurística —
  ver "Detecção de nível" abaixo. Filtro é por **exibição**; não altera o que
  foi lido.
- **Período:** "tudo carregado" (padrão), "últimos 5 min", "última hora".
  Aplica-se por timestamp da linha, no cliente; alterar o período **não**
  refaz o stream. É relativo ao **agora** e reavaliado enquanto o painel está
  aberto, então linhas antigas saem da janela sozinhas com o passar do tempo.
- Filtros e busca **combinam** (E lógico) e valem também para linhas novas
  que chegam ao vivo.
- Botão **"Limpar"** esvazia o buffer exibido (não apaga nada no Docker).
- Botão **"Copiar"** copia as linhas **visíveis** (já filtradas).

## Tech Stack

- Backend: Go (Wails v2). Acesso ao Docker pelo SDK já usado
  (`github.com/moby/moby/client`): `ContainerLogs` com `ContainerLogsOptions`
  `{ShowStdout, ShowStderr, Follow, Tail, Timestamps}` — sem shell-out para
  `docker logs`.
- **Transporte para a UI: eventos do Wails** (`runtime.EventsEmit` no Go,
  `EventsOn` no frontend, já disponíveis no runtime instalado). Sem polling.
- Separação stdout/stderr: `stdcopy.StdCopy` (pacote `moby/moby/api/pkg/stdcopy`)
  para containers **sem TTY**; com TTY o stream vem cru (só stdout) — detectar
  via `ContainerInspect` (`Config.Tty`).
- Frontend: React + TypeScript, `useState`/`useEffect`/`useRef`, como nas
  outras abas. Nenhuma lib nova (sem virtualização de terceiros na primeira
  versão — ver Performance).
- Design: tokens do `DESIGN.md`, monocromático escuro. **Nenhuma cor nova**;
  stderr e níveis se distinguem por peso/tom dos tokens existentes e por
  rótulo/ícone, nunca só por cor.

## Project Structure

```
internal/docker/
  logs.go              → StartLogs / StopLogs (sessões), leitura do stream
  logs_lines.go        → montagem de linhas a partir de chunks (funções puras)
  port_owners.go       → ListPortOwners: (protocolo, porta) → container
app.go                 → App.StartContainerLogs(id, opts) (sessionId, erro)
                         App.StopContainerLogs(sessionId)
                         App.ListPortOwners()
frontend/src/components/
  LogsDrawer.tsx       → painel lateral/expandido (cabeçalho, lista, rodapé)
  LogsToolbar.tsx      → busca, regex, modo, filtros, ações
frontend/src/
  useContainerLogs.ts  → hook: assina eventos, buffer, pausa, reconexão
  useLogsPrefs.ts      → preferências persistidas (localStorage, versionadas)
  logLevel.ts          → detecção de nível e filtro (funções puras)
```

O painel (`LogsDrawer`) vive em **`App.tsx`**, não dentro de uma tabela, para
poder ser aberto tanto pela aba Containers quanto pela aba Portas: `App.tsx`
guarda o container aberto e passa `onOpenLogs` para `ContainersTable` e
`PortsTable`. `PortsTable.tsx` recebe o mapa porta → container e mostra o
atalho; `App.css` ganha as regras do painel e do rótulo de container.

## Contrato backend ↔ frontend

- `StartContainerLogs(id string, tail int) (sessionID string, err error)`
  - abre o stream, devolve um `sessionID` e começa a emitir eventos
  - **uma sessão ativa por vez**: iniciar outra encerra a anterior
- Evento `logs:batch:<sessionID>` → `[{ ts, stream, text }]`
  - `ts`: timestamp RFC3339 do Docker (`Timestamps: true`), `stream`: `"stdout"`
    ou `"stderr"`, `text`: a linha **sem** o prefixo de timestamp
- Evento `logs:end:<sessionID>` → `{ reason: "stopped" | "removed" | "error", message }`
- `LoadOlderContainerLogs(id string, beforeTs string, count int) (lines, hasMore, err)`
  - chamada pontual (sem stream), para o botão "Carregar mais antigas"
- `ListPortOwners() ([]{ protocol, port, containerId, containerName }, err)`
  - só containers em execução, portas **publicadas**; sem Docker → erro que a
    UI ignora (a aba Portas segue sem o atalho)
- `StopContainerLogs(sessionID)` cancela o `context` da sessão (o SDK fecha o
  stream sozinho) e libera os recursos.

Regras do backend:
- **Linhas completas:** o stream chega em pedaços arbitrários. Acumular em
  buffer por origem e só emitir ao encontrar `\n` (linha parcial no fim do
  chunk espera o próximo). Linha gigante tem teto (ex.: 64 KiB, truncada com
  aviso) para não estourar memória.
- **Lotes:** agrupar linhas e emitir a cada ~100 ms (ou 200 linhas, o que vier
  primeiro), nunca um evento por linha — a ponte do Wails satura.
- **Encerramento:** ao fim do stream (container parou) ou erro, emitir
  `logs:end` e limpar a sessão. Fechar a janela cancela tudo (o `ctx` do app).
- Erros em português, sem erro cru do SDK (mesmo padrão do pacote).

## Performance

Lições do app (scroll travado na aba de processos por sombras/blur por célula):

- **Buffer limitado:** o frontend guarda no máximo **5000 linhas**; ao passar,
  descarta as mais antigas (e mostra "logs antigos descartados").
- **DOM enxuto:** cada linha é um `div` simples — sem `box-shadow`, sem
  transição, sem gradiente por linha. `content-visibility: auto` nas linhas ou
  janelamento manual se 5000 linhas travarem o scroll.
- **Atualização em lote:** a UI aplica um lote por quadro (`requestAnimationFrame`),
  não uma renderização por evento.
- Filtrar/buscar sobre 5000 linhas deve ser instantâneo; se não for, adiar o
  filtro com `useDeferredValue`.
- Medir antes de otimizar mais: 5000 linhas, container gerando ~500 linhas/s,
  scroll e digitação na busca sem travar.

## Code Style

- Comentários no padrão do projeto (explicam o "porquê", em inglês nos pacotes
  Go/TS existentes; copy da UI em português).
- Funções de montagem de linha e de nível são **puras** e separadas do I/O, para
  serem testáveis.
- Estados de UI (`carregando`, `ao vivo`, `pausado`, `encerrado`, `erro`)
  explícitos numa união de strings, não vários booleanos.

## Testing Strategy

**Sem testes automatizados por enquanto** (decisão do usuário, coerente com as
specs anteriores). A montagem de linhas e a detecção de nível ficam em funções
puras para que testes possam ser adicionados depois sem refatorar.

Verificação manual mínima: container falante
(`while true; do date; echo err >&2; sleep 0.2; done`), container que cai,
container parado, container com TTY, container sem saída, "carregar mais
antigas" até o início dos logs, e fechar/reabrir o app com filtros ativos.

## Boundaries

- **Sempre fazer:** encerrar o stream ao fechar o painel, trocar de container ou
  fechar o app; limitar buffer (backend por linha, frontend por total); copy em
  português; respeitar o `DESIGN.md`; tratar `localStorage` como opcional
  (`try/catch`, padrões se falhar).
- **Perguntar antes:** interpretar cores ANSI; adicionar biblioteca de
  virtualização; qualquer mudança em `wails.json`.
- **Nunca fazer:** shell-out para `docker logs`; manter streams abertos com o
  painel fechado; renderizar logs como HTML (usar sempre texto — log é entrada
  não confiável, `dangerouslySetInnerHTML` proibido); enviar um evento por linha.

## Decisões

- **ANSI:** na primeira versão, **remover** os códigos de escape
  (`\x1b[...m`) do texto, sem converter em cor — mantém o visual monocromático
  e evita a regra de "cor nova". Reavaliar depois.
- **Painel lateral primeiro, expansível** (decisão do usuário), em vez de tela
  cheia por padrão ou modal.
- **Uma sessão por vez** — simplifica streams, eventos e UI.
- **Detecção de nível por formatos conhecidos, refinada depois** (decisão do
  usuário): começar com JSON, logfmt, colchetes, Monolog, Redis e palavra solta.
- **Atalho nas Portas incluído na v1** (decisão do usuário).

## Success Criteria

- [ ] Na aba Portas, a linha de uma porta publicada por container em execução
      mostra o nome do container e um botão "Logs" que abre o mesmo painel
      naquele container, sem trocar de aba; com o Docker desligado a aba Portas
      funciona como hoje, sem erro.
- [ ] A detecção reconhece os formatos da tabela (JSON, logfmt, colchetes,
      Monolog, Redis, palavra solta); linhas de stack trace herdam o nível da
      linha anterior; linhas não reconhecidas ficam em `outros`.
- [ ] Botão "Logs" em todo container (rodando ou parado) abre o painel lateral
      com as últimas 500 linhas.
- [ ] Container rodando: linhas novas aparecem ao vivo, com rolagem automática
      que pausa ao rolar para cima e retoma pelo indicador "N novas linhas".
- [ ] Botão de expandir alterna entre lateral e área toda, sem perder o buffer,
      a busca nem os filtros.
- [ ] Busca por substring (e regex opcional, sem quebrar com regex inválida),
      nos modos "Filtrar" e "Destacar", com contador "X de Y".
- [ ] Filtros de origem (stdout/stderr), nível e período funcionam combinados
      entre si e com a busca, inclusive para linhas que chegam depois.
- [ ] "Carregar mais antigas" insere 500 linhas no início sem pular a posição
      de leitura, sem duplicar nem perder linhas na fronteira, e chega a
      "início dos logs".
- [ ] Largura, modo expandido, busca, filtros, rolagem automática e o container
      aberto sobrevivem a fechar e reabrir o app; se o `localStorage` falhar
      ou estiver corrompido, o painel abre com os padrões.
- [ ] Com qualquer filtro/busca fora do padrão, aparece o selo "filtros ativos"
      com "Limpar filtros".
- [ ] Container parado mostra o histórico com aviso; container que cai durante
      a visualização mostra "container encerrado" e mantém as linhas.
- [ ] Fechar o painel, trocar de container ou fechar o app encerra o stream
      (sem goroutine/stream pendurado).
- [ ] Container que gera ~500 linhas/s não trava a UI nem o scroll; buffer
      nunca passa de 5000 linhas.
- [ ] stderr distinguível de stdout sem depender só de cor; texto do log nunca
      é renderizado como HTML.
- [ ] `go build ./...`, `go vet ./...` e `tsc --noEmit` passam; copy 100% PT-BR.

## Ajustes feitos na implementação

Onde a implementação divergiu da spec original, e por quê:

- **`sessionID` escolhido pelo frontend:** `StartContainerLogs(sessionID, id, tail)`
  não devolve o ID. Se o backend o gerasse, as primeiras linhas poderiam ser
  emitidas antes de o frontend assinar o evento (corrida). O frontend gera o ID,
  assina `logs:batch:<id>` / `logs:end:<id>` e só então chama.
- **Painel ao lado, não por cima:** o painel lateral divide o espaço com a tabela
  (a tabela encolhe) em vez de cobri-la, para os botões das linhas continuarem
  clicáveis. Com o painel aberto e a área da tabela estreita, a tabela de
  containers esconde as colunas Imagem e Portas e quebra os botões de ação em
  duas linhas (container query) — senão "Logs" e "Parar" saíam da tela.
- **Carregar antigas sem `Tail`:** o Docker aplica `Tail` ao fim do log inteiro
  *antes* de `Until`, então `Tail + Until` não pagina (a 2ª página vinha vazia,
  encontrado em teste). Lê-se com `Until` sozinho e mantêm-se as últimas N linhas
  antes da fronteira; linhas de mesmo timestamp da fronteira são descartadas.
- **Regras de nível:** "colchetes" olha os primeiros **60** caracteres (não 40),
  porque o timestamp do MariaDB/nginx empurra o `[Warning]` para depois da
  posição 20. Regra nova **"exception"** (`Error:`, `TypeError:`,
  `java.lang.XException`, `panic:`, `Traceback`, `Unhandled` no início da linha):
  sem ela o stack de um erro do Node (`Error: boom`, só inicial maiúscula) ficava
  todo em "outros".
- **Listagens responsivas pela largura da área da tabela (container query), não da
  janela:** com o painel aberto a tabela fica estreita mesmo numa janela larga.
  Em vez de esconder colunas, Containers, Imagens e Portas viram **cartões com
  todos os campos e rótulos** (containers/imagens abaixo de 720px de largura da
  área; portas abaixo de 560px). Substitui a solução anterior, que escondia
  Imagem e Portas.
- **Limite da tabela de containers corrigido por medição:** o limite de 720px estava
  errado. Com dados reais (CPU/memória preenchidas, portas longas) a tabela só cabe
  com ~1270px de largura útil: abaixo disso estourava para fora da tela, **mesmo sem o
  painel de logs** (a janela padrão de 1024px já quebrava). Agora: tabela só acima de
  ~1100px; entre 620 e 1100px, cartão compacto de 4 colunas; abaixo de 620px, cartão de
  2 colunas. Na tabela, nome/imagem/portas quebram em qualquer ponto e os botões de ação
  quebram em duas linhas. Varredura de 700 a 1900px de janela, com e sem painel, nas abas
  Containers, Imagens e Processos: nenhuma largura com rolagem horizontal ou célula
  cortada.
- **Arrastar a borda do painel não seleciona texto:** `preventDefault` no início do
  arrasto, `user-select: none` no `body` enquanto dura (classe `is-resizing`) e
  limpeza também em `pointercancel` e ao fechar o painel.
- **Botões de alternância com estado óbvio:** todo toggle (`aria-pressed`) mostra um
  ponto (cheio = ligado, vazado = desligado) além do tom âmbar; ações (Limpar,
  Copiar) são teclas em relevo sem ponto; `.*` ligado vira tecla âmbar sólida;
  o seletor de período fica âmbar quando difere de "tudo". Estado nunca depende
  só de cor.
- **Botões de filtro usam atualização funcional das preferências:** dois cliques
  no mesmo quadro (antes do re-render) se sobrescreviam.
- **Limpar** esvazia a tela e desliga "Carregar mais antigas" (recomeçar "de
  agora"); reabrir o painel recarrega o histórico.
- **Container parado que volta a rodar** com o painel aberto: o painel consulta a
  lista a cada 4 s e reconecta sozinho (recarrega as últimas 500 linhas).

## Open Questions

Nenhuma bloqueante. Decididas pelo usuário: botão de carregar antigas, persistir
tudo, filtro por período, sem testes por enquanto, detecção de nível começando
pelos formatos da tabela e refinada com os logs reais, e atalho nas Portas na
primeira versão.

Para a fase de refino (depois de o painel existir):
1. Ajustar a tabela de detecção com os logs reais dos seus containers.
2. Reavaliar cores ANSI (hoje removidas) e um aviso/atalho "Parar container" na
   linha de porta de container (hoje "Matar" mata só o proxy).
