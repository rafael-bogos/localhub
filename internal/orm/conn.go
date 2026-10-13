package orm

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const (
	connectTimeout   = 8 * time.Second
	introspectTimout = 30 * time.Second
)

var errNotConnected = errors.New("Esta conexão não está aberta. Conecte primeiro.")

// session is one open database.
type session struct {
	profile Profile
	db      *sql.DB
	// schema is the last introspected structure; Browse validates table and
	// column names against it. Guarded by Manager.mu.
	schema *Schema
}

// Manager keeps the open connections, by profile ID. It is safe for concurrent use.
type Manager struct {
	mu       sync.Mutex
	sessions map[string]*session
}

func NewManager() *Manager { return &Manager{sessions: map[string]*session{}} }

// open dials and pings; the caller owns the returned handle.
func open(ctx context.Context, p Profile) (*sql.DB, error) {
	if err := p.Validate(); err != nil {
		return nil, err
	}
	db, err := sql.Open(p.driverName(), p.dsn())
	if err != nil {
		return nil, friendly(err, p)
	}
	db.SetMaxOpenConns(4)
	db.SetConnMaxIdleTime(5 * time.Minute)
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, friendly(err, p)
	}
	return db, nil
}

// Test checks that the profile can connect, without keeping the connection.
func (m *Manager) Test(ctx context.Context, p Profile) error {
	db, err := open(ctx, p)
	if err != nil {
		return err
	}
	return db.Close()
}

// Connect opens the profile and keeps it. A second Connect with the same ID
// replaces the first, so editing a profile and reconnecting just works.
func (m *Manager) Connect(ctx context.Context, p Profile) error {
	if p.ID == "" {
		return errors.New("Conexão sem identificador.")
	}
	db, err := open(ctx, p)
	if err != nil {
		return err
	}
	m.mu.Lock()
	old := m.sessions[p.ID]
	m.sessions[p.ID] = &session{profile: p, db: db}
	m.mu.Unlock()
	if old != nil {
		old.db.Close()
	}
	return nil
}

// Disconnect closes one connection; a no-op if it isn't open.
func (m *Manager) Disconnect(id string) {
	m.mu.Lock()
	s := m.sessions[id]
	delete(m.sessions, id)
	m.mu.Unlock()
	if s != nil {
		s.db.Close()
	}
}

// Connected lists the IDs of the open connections.
func (m *Manager) Connected() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := make([]string, 0, len(m.sessions))
	for id := range m.sessions {
		ids = append(ids, id)
	}
	return ids
}

// CloseAll closes everything; called when the app shuts down.
func (m *Manager) CloseAll() {
	for _, id := range m.Connected() {
		m.Disconnect(id)
	}
}

func (m *Manager) get(id string) (*session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[id]
	if !ok {
		return nil, errNotConnected
	}
	return s, nil
}

// Introspect reads the structure of an open connection.
func (m *Manager) Introspect(ctx context.Context, id string) (*Schema, error) {
	s, err := m.get(id)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, introspectTimout)
	defer cancel()
	var out *Schema
	if s.profile.Kind == MySQL {
		out, err = introspectMySQL(ctx, s.db)
	} else {
		out, err = introspectPostgres(ctx, s.db)
	}
	if err != nil {
		return nil, errors.New("Não foi possível ler a estrutura do banco. O usuário tem permissão de leitura?")
	}
	m.mu.Lock()
	s.schema = out
	m.mu.Unlock()
	return out, nil
}
