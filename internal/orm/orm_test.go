package orm

import (
	"context"
	"errors"
	"net"
	"os"
	"strconv"
	"strings"
	"syscall"
	"testing"
)

func TestValidate(t *testing.T) {
	ok := Profile{Kind: Postgres, Host: "localhost", Port: 5432, User: "u", Database: "d"}
	if err := ok.Validate(); err != nil {
		t.Fatalf("perfil válido recusado: %v", err)
	}
	for name, mut := range map[string]func(*Profile){
		"tipo":  func(p *Profile) { p.Kind = "oracle" },
		"host":  func(p *Profile) { p.Host = " " },
		"porta": func(p *Profile) { p.Port = 70000 },
		"user":  func(p *Profile) { p.User = "" },
		"banco": func(p *Profile) { p.Database = "" },
	} {
		p := ok
		mut(&p)
		if p.Validate() == nil {
			t.Errorf("%s inválido foi aceito", name)
		}
	}
}

func TestPostgresDSNEscapesAndFlags(t *testing.T) {
	p := Profile{Kind: Postgres, Host: "db.local", Port: 5433, User: "us er", Password: "p@ss:/w?rd#", Database: "my db", SSL: SSLRequire, ReadOnly: true}
	dsn := p.dsn()
	for _, want := range []string{"sslmode=require", "default_transaction_read_only=on", "db.local:5433"} {
		if !strings.Contains(dsn, want) {
			t.Errorf("DSN sem %q: %s", want, dsn)
		}
	}
	if strings.Contains(dsn, "p@ss:/w?rd#") {
		t.Errorf("senha sem escape no DSN: %s", dsn)
	}
}

func TestMySQLDSN(t *testing.T) {
	p := Profile{Kind: MySQL, Host: "127.0.0.1", Port: 3307, User: "root", Password: "a@b/c", Database: "app"}
	dsn := p.dsn()
	if !strings.Contains(dsn, "tcp(127.0.0.1:3307)/app") || !strings.Contains(dsn, "tls=false") {
		t.Errorf("DSN inesperado: %s", dsn)
	}
}

func TestIsLocal(t *testing.T) {
	for host, want := range map[string]bool{"localhost": true, "127.0.0.1": true, "::1": true, "10.0.0.5": false, "db.prod.com": false} {
		if got := (Profile{Host: host}).IsLocal(); got != want {
			t.Errorf("IsLocal(%q) = %v", host, got)
		}
	}
}

func TestFriendlyNeverLeaksRawError(t *testing.T) {
	p := Profile{Host: "h", Database: "d"}
	cases := map[string]error{
		"recusada":  &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED},
		"senha":     errors.New(`failed to connect to postgres://u:SECRET@h/d: password authentication failed`),
		"banco":     errors.New(`database "d" does not exist (SQLSTATE 3D000)`),
		"mysqlnodb": errors.New(`Error 1049 (42000): Unknown database 'd'`),
		"outro":     errors.New("postgres://u:SECRET@h/d boom"),
	}
	for name, in := range cases {
		out := friendly(in, p)
		if out == nil || strings.Contains(out.Error(), "SECRET") || strings.Contains(out.Error(), "postgres://") {
			t.Errorf("%s: mensagem vazou ou nula: %v", name, out)
		}
	}
	if !strings.Contains(friendly(cases["senha"], p).Error(), "senha") {
		t.Error("falha de senha não foi reconhecida")
	}
}

// Integration: set ORM_TEST_PG / ORM_TEST_MYSQL to "host:port:user:password:database"
// pointing at a disposable database. Skipped otherwise.
func integrationProfile(t *testing.T, env, kind string) Profile {
	t.Helper()
	v := os.Getenv(env)
	if v == "" {
		t.Skipf("%s não definido", env)
	}
	f := strings.SplitN(v, ":", 5)
	if len(f) != 5 {
		t.Fatalf("%s deve ser host:porta:usuario:senha:banco", env)
	}
	port, _ := strconv.Atoi(f[1])
	return Profile{ID: "t", Kind: kind, Host: f[0], Port: port, User: f[2], Password: f[3], Database: f[4]}
}

const pgSetup = `
DROP TABLE IF EXISTS posts; DROP TABLE IF EXISTS users;
CREATE TABLE users (id serial PRIMARY KEY, email text NOT NULL UNIQUE, name varchar(80), created_at timestamptz DEFAULT now());
CREATE TABLE posts (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, author_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE, title text);
CREATE INDEX posts_author_idx ON posts (author_id);`

const mysqlSetup = `
DROP TABLE IF EXISTS posts; DROP TABLE IF EXISTS users;
CREATE TABLE users (id int AUTO_INCREMENT PRIMARY KEY, email varchar(190) NOT NULL UNIQUE, name varchar(80) NULL, created_at datetime DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE posts (id bigint AUTO_INCREMENT PRIMARY KEY, author_id int NOT NULL, title text, KEY posts_author_idx (author_id), CONSTRAINT posts_author_fk FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE);`

func runIntegration(t *testing.T, p Profile, setup string) {
	ctx := context.Background()
	m := NewManager()
	defer m.CloseAll()
	if err := m.Connect(ctx, p); err != nil {
		t.Fatalf("conectar: %v", err)
	}
	s, _ := m.get(p.ID)
	for _, stmt := range strings.Split(setup, ";") {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := s.db.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("preparar %q: %v", stmt, err)
		}
	}
	sch, err := m.Introspect(ctx, p.ID)
	if err != nil {
		t.Fatalf("introspecção: %v", err)
	}
	by := map[string]Table{}
	for _, tb := range sch.Tables {
		by[tb.Name] = tb
	}
	users, posts := by["users"], by["posts"]
	if len(users.Columns) != 4 || len(posts.Columns) != 3 {
		t.Fatalf("colunas: users=%d posts=%d", len(users.Columns), len(posts.Columns))
	}
	if len(users.PrimaryKey) != 1 || users.PrimaryKey[0] != "id" || !users.Columns[0].PrimaryKey || !users.Columns[0].AutoIncrement {
		t.Errorf("PK/auto de users errada: %+v", users)
	}
	if users.Columns[1].Nullable || !users.Columns[2].Nullable {
		t.Errorf("nulabilidade errada: %+v", users.Columns)
	}
	if !users.Columns[3].HasDefault {
		t.Errorf("default de created_at não detectado")
	}
	if !posts.Columns[0].AutoIncrement {
		t.Errorf("identity/auto_increment de posts.id não detectado")
	}
	var uniq, idx bool
	for _, ix := range users.Indexes {
		uniq = uniq || (ix.Unique && len(ix.Columns) == 1 && ix.Columns[0] == "email")
	}
	for _, ix := range posts.Indexes {
		idx = idx || (!ix.Unique && ix.Name == "posts_author_idx" && ix.Columns[0] == "author_id")
	}
	if !uniq || !idx {
		t.Errorf("índices: unique(email)=%v posts_author_idx=%v", uniq, idx)
	}
	if len(posts.ForeignKeys) != 1 {
		t.Fatalf("FKs de posts: %+v", posts.ForeignKeys)
	}
	fk := posts.ForeignKeys[0]
	if fk.RefTable != "users" || fk.Columns[0] != "author_id" || fk.RefColumns[0] != "id" || fk.OnDelete != "CASCADE" {
		t.Errorf("FK errada: %+v", fk)
	}
	if err := m.Test(ctx, Profile{Kind: p.Kind, Host: p.Host, Port: p.Port, User: p.User, Password: "errada", Database: p.Database}); err == nil ||
		!strings.Contains(err.Error(), "senha") {
		t.Errorf("senha errada deveria dizer 'senha', veio: %v", err)
	}
	if _, err := m.Introspect(ctx, "nope"); err == nil {
		t.Error("introspecção sem conexão deveria falhar")
	}

	// Browse: real rows, paging, search, sort, and rejection of unknown names.
	for i := 1; i <= 120; i++ {
		q := "INSERT INTO users (email, name) VALUES ('u" + strconv.Itoa(i) + "@x.dev', "
		if i%2 == 0 {
			q += "'Nome " + strconv.Itoa(i) + "')"
		} else {
			q += "NULL)"
		}
		if _, err := s.db.ExecContext(ctx, q); err != nil {
			t.Fatalf("inserir: %v", err)
		}
	}
	pg, err := m.Browse(ctx, p.ID, BrowseRequest{Table: "users", Schema: users.Schema, Limit: 50})
	if err != nil || len(pg.Rows) != 50 || !pg.HasMore || len(pg.Columns) != 4 {
		t.Fatalf("página 1: err=%v page=%+v", err, pg)
	}
	if pg.Rows[0][1] == nil || *pg.Rows[0][1] != "u1@x.dev" || pg.Rows[0][2] != nil {
		t.Errorf("primeira linha errada (NULL deve ser nil): %v %v", pg.Rows[0][1], pg.Rows[0][2])
	}
	last, _ := m.Browse(ctx, p.ID, BrowseRequest{Table: "users", Schema: users.Schema, Limit: 50, Offset: 100})
	if len(last.Rows) != 20 || last.HasMore {
		t.Errorf("última página: %d linhas, hasMore=%v", len(last.Rows), last.HasMore)
	}
	found, _ := m.Browse(ctx, p.ID, BrowseRequest{Table: "users", Schema: users.Schema, Search: "NOME 120"})
	if len(found.Rows) != 1 {
		t.Errorf("busca 'NOME 120' (sem diferenciar caixa): %d linhas", len(found.Rows))
	}
	pct, _ := m.Browse(ctx, p.ID, BrowseRequest{Table: "users", Schema: users.Schema, Search: "%"})
	if len(pct.Rows) != 0 {
		t.Errorf("'%%' deve ser literal, veio %d linhas", len(pct.Rows))
	}
	desc, _ := m.Browse(ctx, p.ID, BrowseRequest{Table: "users", Schema: users.Schema, OrderBy: "id", Desc: true, Limit: 1})
	if len(desc.Rows) != 1 || *desc.Rows[0][1] != "u120@x.dev" {
		t.Errorf("ordem decrescente errada")
	}
	if _, err := m.Browse(ctx, p.ID, BrowseRequest{Table: "users", Schema: users.Schema, OrderBy: "id; DROP TABLE users"}); err == nil {
		t.Error("coluna de ordenação inexistente deveria falhar")
	}
	if _, err := m.Browse(ctx, p.ID, BrowseRequest{Table: "users\"; DROP TABLE users; --"}); err == nil {
		t.Error("tabela inexistente deveria falhar")
	}
}

func TestBuildBrowse(t *testing.T) {
	tb := &Table{Schema: "public", Name: `we"ird`, PrimaryKey: []string{"id"},
		Columns: []Column{{Name: "id"}, {Name: "na`me"}}}
	q, args, err := buildBrowse(Postgres, tb, BrowseRequest{Search: "50%", OrderBy: "na`me", Desc: true, Limit: 10, Offset: 20})
	if err != nil {
		t.Fatal(err)
	}
	want := `SELECT "id", "na` + "`" + `me" FROM "public"."we""ird" WHERE "id"::text ILIKE $1 OR "na` + "`" + `me"::text ILIKE $2 ORDER BY "na` + "`" + `me" DESC, "id" DESC LIMIT $3 OFFSET $4`
	if q != want {
		t.Errorf("pg:\n got %s\nwant %s", q, want)
	}
	if len(args) != 4 || args[0] != `%50\%%` || args[2] != 11 || args[3] != 20 {
		t.Errorf("args pg: %v", args)
	}
	q, args, _ = buildBrowse(MySQL, tb, BrowseRequest{Search: "a"})
	if !strings.Contains(q, "CAST(`id` AS CHAR) LIKE ?") || !strings.HasSuffix(q, "LIMIT ? OFFSET ?") || len(args) != 4 || args[2] != 51 {
		t.Errorf("mysql: %s %v", q, args)
	}
	if _, _, err := buildBrowse(Postgres, tb, BrowseRequest{OrderBy: "nope"}); err == nil {
		t.Error("ordenação por coluna desconhecida deve falhar")
	}
}

func TestIntegrationPostgres(t *testing.T) {
	runIntegration(t, integrationProfile(t, "ORM_TEST_PG", Postgres), pgSetup)
}
func TestIntegrationMySQL(t *testing.T) {
	runIntegration(t, integrationProfile(t, "ORM_TEST_MYSQL", MySQL), mysqlSetup)
}

func TestKindFromImage(t *testing.T) {
	cases := map[string]string{
		"postgres:16":                        Postgres,
		"docker.io/library/postgres":         Postgres,
		"bitnami/postgresql:15.2":            Postgres,
		"postgis/postgis:16-3.4":             Postgres,
		"registry.local:5000/team/mysql:8.0": MySQL,
		"mariadb:11":                         MySQL,
		"redis:7":                            "",
		"nginx@sha256:abc":                   "",
		"myorg/postgres-exporter":            Postgres, // name match is deliberately loose; Detect + connect decide
	}
	for img, want := range cases {
		if got := KindFromImage(img); got != want {
			t.Errorf("KindFromImage(%q)=%q, quero %q", img, got, want)
		}
	}
}

func TestDetect(t *testing.T) {
	f, err := Detect(ContainerSpec{Image: "postgres:16", Env: []string{"POSTGRES_PASSWORD=s3", "POSTGRES_USER=app"}})
	if err != nil || f.User != "app" || f.Password != "s3" || f.Database != "app" || f.Port != 5432 {
		t.Errorf("pg: %+v %v", f, err)
	}
	f, _ = Detect(ContainerSpec{Image: "mysql:8", Env: []string{"MYSQL_ROOT_PASSWORD=r", "MYSQL_DATABASE=shop"}})
	if f.User != "root" || f.Password != "r" || f.Database != "shop" || f.Port != 3306 {
		t.Errorf("mysql root: %+v", f)
	}
	f, _ = Detect(ContainerSpec{Image: "mariadb", Env: []string{"MARIADB_USER=u", "MARIADB_PASSWORD=p", "MARIADB_ROOT_PASSWORD=r"}})
	if f.User != "u" || f.Password != "p" || f.Database != "mysql" {
		t.Errorf("mariadb user: %+v", f)
	}
	if _, err := Detect(ContainerSpec{Image: "redis:7"}); err == nil {
		t.Error("redis não deve ser aceito")
	}
}
