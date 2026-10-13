# Spec: ORM nativo do localhub (aba Bancos: studio, schema e migrations)

<!-- status: rascunho — aguardando revisão antes de qualquer código -->

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

## Decisões abertas (preciso da sua opinião)

1. **Onde mora o `schema.localhub`?** Opção recomendada: por **projeto** (o
   usuário escolhe a pasta com `PickDirectory`, como no `node_modules`), para
   versionar no git do projeto dele. Alternativa: dentro do `config` do
   localhub, por conexão.
2. **Senhas:** manter em `config.json` (0600) na v1, ou já usar o keychain do
   sistema (`go-keyring`)? Recomendo config na v1 por consistência com o SSH.
3. **Nome/sintaxe:** seguir a sintaxe do Prisma (familiar, mas pode gerar
   expectativa de compatibilidade total) ou uma sintaxe própria mais enxuta?
   Recomendo "inspirada no Prisma", declarando a v1 como subconjunto.
4. **Dependências novas:** `github.com/jackc/pgx/v5` e
   `github.com/go-sql-driver/mysql` (ambos puro Go, sem CGO).
