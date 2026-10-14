# Spec: ORM nativo do localhub (aba Bancos: studio, schema e migrations)

<!-- status: em andamento — Fase 1 (conexões + introspecção) e navegação de dados (Fase 2, parte leitura) implementadas; edição de linhas e fases 3–5 pendentes -->

## Objective

Dar ao localhub uma camada de banco de dados **nativa, no estilo Prisma**: o
usuário conecta num PostgreSQL ou MySQL/MariaDB, **vê e edita os dados**, **descreve o
schema de forma declarativa** e **gera/aplica migrations** a partir das diferenças
— tudo dentro do app, sem instalar Node nem o CLI do Prisma.

**Usuário:** o desenvolvedor solo que já usa o localhub para portas e containers
e hoje abre `psql`/DBeaver/Prisma Studio para olhar o banco do container que
acabou de subir.

**Sucesso:** subir um Postgres em container, abrir a aba **Bancos**, ver o
banco já detectado, navegar/editar linhas, alterar o schema e aplicar a
migration em poucos cliques, com o SQL visível antes de executar.

### Fora de escopo da v1
- MongoDB e outros NoSQL; SQLite, SQL Server, Oracle.
- Gerar client tipado (TS/Go) para uso em outros projetos (fica para v2; o
  `internal/orm` é desenhado para permitir).
- Editor de SQL livre com autocomplete, ER diagram, import/export de dados.
- Guardar senhas em keychain (v1 segue o padrão do SSH: config local; ver
  "Decisões abertas").
- Testes automatizados de UI (o projeto não tem). **Exceção:** o pacote
  `internal/orm` tem testes unitários (diff, geração de SQL, escape), porque
  erro ali destrói dados.

## Arquitetura

Novo pacote Go `internal/orm`, sem dependência de Wails, espelhando como
`internal/docker` e `internal/ssh` já são isolados de `app.go`.

```
internal/orm/
  driver.go       interface Driver: Open, Introspect, Query, Exec, Dialect
  postgres.go     driver pgx/v5 (stdlib)
  mysql.go        driver go-sql-driver/mysql
  schema.go       modelo neutro: Schema{Tables, Columns, Indexes, FKs, Enums}
  introspect.go   banco -> Schema (information_schema / pg_catalog)
  dsl.go          parser do arquivo de schema declarativo -> Schema
  diff.go         Schema(desejado) vs Schema(atual) -> []Change
  sqlgen.go       []Change -> SQL por dialeto (com marca de "destrutivo")
  migrate.go      pasta de migrations, tabela _localhub_migrations, checksum
  data.go         browse com paginação/filtro/ordenação e CRUD por PK
  discover.go     acha bancos em containers Docker (e via túnel SSH)
  conn.go         perfis de conexão salvos, pool, ciclo de vida
```

`app.go` ganha só os bindings finos (`DBListConnections`, `DBConnect`,
`DBIntrospect`, `DBBrowse`, `DBPlanMigration`, `DBApplyMigration`…), como já é
feito para Docker/SSH. Frontend: aba `bancos` em `App.tsx` + componentes
`DatabasesTab`, `DataGrid`, `SchemaView`, `MigrationDialog`.

### Schema declarativo
Arquivo `schema.localhub` (texto, versionável no git do projeto do usuário),
sintaxe inspirada no Prisma:

```
model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id       Int  @id @default(autoincrement())
  authorId Int
  author   User @relation(fields: [authorId], references: [id], onDelete: Cascade)
  @@index([authorId])
}
```

Tipos da v1: `String, Int, BigInt, Float, Decimal, Boolean, DateTime, Json,
Bytes` + `enum`. Mapeamento por dialeto numa tabela única em `sqlgen.go`.
O usuário pode editar o arquivo à mão **ou** pela UI (a UI reescreve o arquivo).

### Migrations
- Fluxo: **editar schema → "Planejar" → ver diff e SQL → "Aplicar"**.
- Cada migration é uma pasta `migrations/<timestamp>_<nome>/migration.sql`
  ao lado do `schema.localhub`; o aplicado fica em `_localhub_migrations`
  (id, nome, checksum, aplicada_em).
- Alterar uma migration já aplicada (checksum diferente) **bloqueia** e avisa.
- `Introspect` permite também **baseline/pull**: gerar o `schema.localhub` a
  partir de um banco existente.
- Mudanças destrutivas (drop table/column, estreitar tipo, NOT NULL em coluna
  com nulos) aparecem em destaque e exigem confirmação explícita
  (`useConfirm()`), no mesmo espírito do kill de processo. Nunca roda em
  silêncio.
- Cada migration roda em transação onde o dialeto permite (Postgres sim;
  MySQL tem DDL com commit implícito — a UI avisa e aplica statement a
  statement, parando no primeiro erro e mostrando em qual).

### Studio (dados)
- Lista de tabelas/views; grade com paginação (padrão 50), ordenação, filtro
  por coluna e busca.
- Editar célula, inserir e excluir linha **somente em tabelas com PK**;
  tabela sem PK fica somente leitura.
- Todo valor vai por **parâmetros preparados**; identificadores (tabela/coluna)
  são validados contra o schema introspectado e citados pelo dialeto — nunca
  concatenados a partir de texto do usuário.
- Excluir/editar pede confirmação mostrando o SQL equivalente.

### Conexões
- Perfil: nome, tipo (`postgres|mysql`), host, porta, banco, usuário, senha,
  SSL (`off|require`). Salvo em `config.json` via `internal/config`
  (chave `databases`).
- **Detecção automática:** containers locais com imagem `postgres`/`mysql`/
  `mariadb` e porta publicada viram sugestões prontas (credenciais lidas de
  `POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB`, `MYSQL_*` do env do container
  — o usuário vê e confirma antes de salvar).
- **Via SSH:** reaproveita os túneis existentes (`RemoteOpenTunnel`): bancos em
  containers de servidores remotos conectam por `127.0.0.1:<porta local>`.
- Conexão manual por formulário, com botão **Testar conexão**.
- Erros em PT-BR, nunca a mensagem crua do driver (como já é no Docker).

## Segurança
- Senha só em `config.json` com permissão `0600` na v1; nunca em logs,
  eventos ou mensagens de erro.
- Conexão remota nunca sem confirmação do usuário; sem SSL o app avisa quando o
  host não é `127.0.0.1`/`localhost`.
- Modo **somente leitura** por conexão (padrão ligado para conexões vindas de
  servidores remotos) que bloqueia `Exec`/migrations/edição na camada Go, não
  só na UI.

## Fases (cada uma deixa o app compilando e útil)

1. **Conexões + introspecção:** `orm/driver`, `postgres`, `mysql`, `schema`,
   `introspect`, `conn`, aba Bancos com lista de conexões, formulário, testar
   conexão, árvore de tabelas/colunas (somente leitura).
2. **Studio:** `data.go`, grade paginada, filtro/ordenação, CRUD por PK.
3. **Detecção em containers e via SSH:** `discover.go`.
4. **Schema DSL + diff + sqlgen:** parser, `dsl.go`, `diff.go`, `sqlgen.go`,
   com testes; "Planejar" mostra SQL sem aplicar.
5. **Migrations:** `migrate.go`, aplicar, checksum, baseline/pull, avisos
   destrutivos.

Cada fase vira uma lista em `tasks/database-orm-todo.md` quando a spec for aprovada.

## Decisões tomadas

1. **`schema.localhub` por projeto** (pasta escolhida com `PickDirectory`), para versionar no git do projeto. Vale a partir da Fase 4.
2. **Senhas em `config.json`** (texto, sem keychain) na v1; o formulário avisa isso. Revisitar com keychain depois.
3. **Sintaxe "inspirada no Prisma"**, declarada como subconjunto.
4. **Dependências:** `github.com/jackc/pgx/v5` (via `database/sql`) e `github.com/go-sql-driver/mysql`, ambas puro Go.

## Status das fases

- **Fase 1 — feita.** `internal/orm` (`schema`, `profile`, `errors`, `introspect_pg`, `introspect_mysql`, `conn`), bindings `DBTest/DBConnect/DBDisconnect/DBConnected/DBIntrospect`, aba **Bancos** (lista de conexões, formulário com "Testar conexão", árvore de tabelas com colunas, índices e chaves estrangeiras). Testes em `internal/orm/orm_test.go`; os de integração rodam com `ORM_TEST_PG` e `ORM_TEST_MYSQL` (`host:porta:usuario:senha:banco`) e foram verificados em PostgreSQL 16 e MySQL 8.
- **Limites da Fase 1:** só tabelas (views ficam de fora); `ReadOnly` só vale no Postgres (parâmetro da sessão) e ainda não há escrita para bloquear no MySQL; MariaDB não foi testado de fato.
- **Fase 2 — parte leitura feita.** `internal/orm/data.go` (`Manager.Browse`), binding `DBBrowse`, componente `DataGrid` na aba **Bancos** (abas "Dados"/"Estrutura" por tabela): paginação de 50 linhas, ordenação por coluna, busca em todas as colunas, NULL destacado. Roda sempre em transação somente leitura; tabela e coluna vêm validadas contra a estrutura lida e citadas pelo dialeto; valores da busca vão por parâmetro. Sem `COUNT(*)`: a paginação lê uma linha a mais para saber se há próxima página. Testes unitários (`TestBuildBrowse`) e de integração em PostgreSQL 16 e MySQL 8. **Edição de células feita:** clicar numa célula edita o valor (Enter confirma, Esc cancela, botão NULL grava NULL); as alterações ficam pendentes (marca lateral) e são gravadas juntas em **uma transação** por "Salvar alterações" (com confirmação); qualquer linha não encontrada ou erro desfaz tudo. `internal/orm/write.go` (`Manager.Update`, `buildUpdate`), binding `DBUpdate`. Valores vão por parâmetro; no PostgreSQL com `CAST($n::text AS <tipo da coluna>)` (o tipo vem do catálogo e é validado); a chave primária identifica a linha e não pode ser editada; recusado em conexão `ReadOnly` (na camada Go) e em tabela sem PK; colunas binárias e valores truncados (>2000 caracteres) não são editáveis. Erros em PT-BR sem eco do valor (único, FK, NOT NULL, tipo inválido, CHECK, permissão). **Colunas redimensionáveis** arrastando a borda do cabeçalho (duplo clique restaura; mín. 60 px, máx. 900 px), lembradas por tabela durante a sessão. **Pendente na Fase 2:** inserir e excluir linha, filtro por coluna, e a confirmação mostrar o SQL (hoje mostra um resumo).
- **Fase 3 — feita (sob demanda, sem varredura automática).** Botão **Acessar banco** nas linhas de containers em execução cuja imagem é PostgreSQL/MySQL/MariaDB, local e remoto. `internal/orm/discover.go` (`KindFromImage`, `Detect`: usuário, senha e banco vêm das variáveis do container: `POSTGRES_*`, `MYSQL_*`, `MARIADB_*` e Bitnami), `docker.InspectForDB`, `ssh.ContainerImageEnv`, binding `DBOpenContainer`. Local: porta publicada em `127.0.0.1`, ou IP do container na rede Docker se não houver porta publicada. Remoto: túnel SSH existente (reaproveitado se já houver um para a mesma porta) ou novo, e a conexão nasce **somente leitura**. A conexão é salva na aba Bancos com `origin` (servidor + nome do container); ao clicar **Acessar** nela, o endereço é relido (a porta do túnel muda entre sessões), preservando o que o usuário editou. Verificado no app com containers locais e com um servidor SSH de teste. Limites: não há lista automática de "bancos detectados" na aba Bancos, só o botão no container; imagens com nome fora do padrão (ex.: build próprio) não ganham o botão.
- Fases 4 (DSL + diff + SQL) e 5 (migrations): pendentes.
