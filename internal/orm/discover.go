package orm

import (
	"errors"
	"strings"
)

// Discovery turns what a database container tells about itself (its image and
// environment) into a connection profile. It is pure: the Docker and SSH
// plumbing that reads the container lives elsewhere.

// ContainerSpec is what is needed from a container to guess how to reach it.
type ContainerSpec struct {
	Name  string
	Image string
	// Env is the container's environment, as "KEY=value".
	Env []string
}

// Found is a guessed connection to a database inside a container.
type Found struct {
	Kind string `json:"kind"`
	// Port is the engine's port inside the container.
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
}

// KindFromImage says which engine an image runs, "" when it is not a database
// the ORM speaks. It looks at the repository name only (tag and registry are
// ignored), so "bitnami/postgresql:16" and "postgis/postgis" both count.
func KindFromImage(image string) string {
	repo := image
	if i := strings.IndexAny(repo, "@"); i >= 0 {
		repo = repo[:i]
	}
	if i := strings.LastIndex(repo, ":"); i > strings.LastIndex(repo, "/") {
		repo = repo[:i]
	}
	base := strings.ToLower(repo[strings.LastIndex(repo, "/")+1:])
	switch {
	case strings.Contains(base, "postgres"), base == "postgis", base == "timescaledb", base == "supabase":
		return Postgres
	case strings.Contains(base, "mysql"), strings.Contains(base, "mariadb"), base == "percona":
		return MySQL
	}
	return ""
}

func envMap(env []string) map[string]string {
	m := make(map[string]string, len(env))
	for _, kv := range env {
		if k, v, ok := strings.Cut(kv, "="); ok {
			m[k] = v
		}
	}
	return m
}

func first(m map[string]string, keys ...string) string {
	for _, k := range keys {
		if v := m[k]; v != "" {
			return v
		}
	}
	return ""
}

// Detect reads the credentials the official (and Bitnami) images are
// configured with. Nothing is invented: a missing password stays empty, which
// is what a trust-auth or password-less container really is.
func Detect(c ContainerSpec) (Found, error) {
	kind := KindFromImage(c.Image)
	if kind == "" {
		return Found{}, errors.New("Este container não parece ser um banco PostgreSQL ou MySQL/MariaDB.")
	}
	e := envMap(c.Env)
	f := Found{Kind: kind, Port: DefaultPort(kind)}

	if kind == Postgres {
		f.User = first(e, "POSTGRES_USER", "POSTGRESQL_USERNAME", "PGUSER")
		if f.User == "" {
			f.User = "postgres"
		}
		f.Password = first(e, "POSTGRES_PASSWORD", "POSTGRESQL_PASSWORD", "PGPASSWORD")
		f.Database = first(e, "POSTGRES_DB", "POSTGRESQL_DATABASE", "PGDATABASE")
		if f.Database == "" {
			f.Database = f.User // the image's own default
		}
		return f, nil
	}

	// MySQL / MariaDB: the app user if the container created one, else root.
	user := first(e, "MYSQL_USER", "MARIADB_USER", "MYSQL_USERNAME")
	pass := first(e, "MYSQL_PASSWORD", "MARIADB_PASSWORD")
	if user != "" && pass != "" {
		f.User, f.Password = user, pass
	} else {
		f.User = "root"
		f.Password = first(e, "MYSQL_ROOT_PASSWORD", "MARIADB_ROOT_PASSWORD")
	}
	f.Database = first(e, "MYSQL_DATABASE", "MARIADB_DATABASE")
	if f.Database == "" {
		f.Database = "mysql"
	}
	return f, nil
}
