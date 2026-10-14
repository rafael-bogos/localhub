package orm

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-sql-driver/mysql"
)

// Engine kinds.
const (
	Postgres = "postgres"
	MySQL    = "mysql"
)

// SSL modes. "require" encrypts without verifying the certificate, which is
// what a dev database behind a self-signed certificate needs.
const (
	SSLOff     = "off"
	SSLRequire = "require"
)

// Profile is everything needed to reach one database. The frontend keeps the
// saved list (like the SSH servers); the backend only receives it per call.
type Profile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Database string `json:"database"`
	User     string `json:"user"`
	Password string `json:"password"`
	SSL      string `json:"ssl"`
	// ReadOnly blocks every write at this layer, not only in the UI.
	ReadOnly bool `json:"readOnly"`
}

// DefaultPort is the engine's usual port.
func DefaultPort(kind string) int {
	if kind == MySQL {
		return 3306
	}
	return 5432
}

// Validate reports what is missing, in Portuguese for the form.
func (p Profile) Validate() error {
	if p.Kind != Postgres && p.Kind != MySQL {
		return errors.New("Escolha o tipo do banco: PostgreSQL ou MySQL.")
	}
	if strings.TrimSpace(p.Host) == "" {
		return errors.New("Informe o endereço (host) do banco.")
	}
	if p.Port < 1 || p.Port > 65535 {
		return errors.New("A porta deve estar entre 1 e 65535.")
	}
	if strings.TrimSpace(p.User) == "" {
		return errors.New("Informe o usuário.")
	}
	if strings.TrimSpace(p.Database) == "" {
		return errors.New("Informe o nome do banco.")
	}
	return nil
}

// IsLocal says whether the host is this machine, for the "no SSL" warning.
func (p Profile) IsLocal() bool {
	h := strings.ToLower(p.Host)
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

// driverName and dsn pick the database/sql driver and build its connection string.
func (p Profile) driverName() string {
	if p.Kind == MySQL {
		return "mysql"
	}
	return "pgx"
}

func (p Profile) dsn() string {
	addr := net.JoinHostPort(p.Host, strconv.Itoa(p.Port))
	if p.Kind == MySQL {
		cfg := mysql.NewConfig()
		cfg.User, cfg.Passwd = p.User, p.Password
		cfg.Net, cfg.Addr, cfg.DBName = "tcp", addr, p.Database
		cfg.ParseTime = true
		// UPDATE reports matched rows, not changed ones: setting a value to what it
		// already is must not look like "row not found".
		cfg.ClientFoundRows = true
		cfg.Timeout = connectTimeout
		cfg.TLSConfig = "false"
		if p.SSL == SSLRequire {
			cfg.TLSConfig = "skip-verify"
		}
		return cfg.FormatDSN()
	}
	q := url.Values{}
	q.Set("sslmode", "disable")
	if p.SSL == SSLRequire {
		q.Set("sslmode", "require")
	}
	q.Set("connect_timeout", strconv.Itoa(int(connectTimeout.Seconds())))
	if p.ReadOnly {
		q.Set("default_transaction_read_only", "on")
	}
	u := url.URL{
		Scheme:   "postgres",
		User:     url.UserPassword(p.User, p.Password),
		Host:     addr,
		Path:     "/" + p.Database,
		RawQuery: q.Encode(),
	}
	return u.String()
}

func (p Profile) String() string {
	return fmt.Sprintf("%s@%s:%d/%s", p.User, p.Host, p.Port, p.Database)
}
