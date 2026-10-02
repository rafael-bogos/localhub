// Package ssh manages SSH connections to remote servers: one connection per
// server, shared by the terminal and by the commands that feed the Processos,
// Containers and Imagens tabs.
package ssh

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strconv"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// Connection states reported through Config.OnState.
const (
	StateConnecting   = "connecting"
	StateConnected    = "connected"
	StateDisconnected = "disconnected"
)

const (
	dialTimeout       = 10 * time.Second
	keepAliveInterval = 15 * time.Second
	keepAliveMisses   = 3
)

// Config describes one connection. ID identifies the server in the Manager.
type Config struct {
	ID      string
	Address string
	Port    int
	User    string
	Auth    []gossh.AuthMethod
	// Trust is asked about servers not yet in known_hosts.
	Trust TrustFunc
	// OnState is called on every state change. err is set when the connection
	// dropped or failed; it is nil for a user-requested disconnect.
	OnState func(id, state string, err error)
	// Cleanup runs once when the connection ends, or right away if Connect
	// fails (e.g. to close an ssh-agent socket).
	Cleanup func()
}

// Conn is a live connection to one server.
type Conn struct {
	ID     string
	Client *gossh.Client

	done     chan struct{}
	closeOne sync.Once
	onClose  func(err error)
}

// Done is closed when the connection ends, for any reason.
func (c *Conn) Done() <-chan struct{} { return c.done }

func (c *Conn) close(err error) {
	c.closeOne.Do(func() {
		close(c.done)
		c.Client.Close()
		c.onClose(err)
	})
}

// Manager keeps at most one connection per server ID.
type Manager struct {
	mu    sync.Mutex
	conns map[string]*Conn
	// pending guards against two Connect calls racing on the same ID.
	pending map[string]bool
}

func NewManager() *Manager {
	return &Manager{conns: map[string]*Conn{}, pending: map[string]bool{}}
}

// Get returns the live connection for id, if any.
func (m *Manager) Get(id string) (*Conn, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.conns[id]
	return c, ok
}

// Connect dials the server and registers the connection. It fails if id is
// already connected or connecting.
func (m *Manager) Connect(ctx context.Context, cfg Config) (*Conn, error) {
	if cfg.ID == "" {
		return nil, errors.New("servidor sem identificador")
	}
	if cfg.Port == 0 {
		cfg.Port = 22
	}

	m.mu.Lock()
	if _, ok := m.conns[cfg.ID]; ok || m.pending[cfg.ID] {
		m.mu.Unlock()
		return nil, errors.New("este servidor já está conectado")
	}
	m.pending[cfg.ID] = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.pending, cfg.ID)
		m.mu.Unlock()
	}()

	notify := func(state string, err error) {
		if cfg.OnState != nil {
			cfg.OnState(cfg.ID, state, err)
		}
	}
	cleanup := func() {
		if cfg.Cleanup != nil {
			cfg.Cleanup()
		}
	}
	notify(StateConnecting, nil)

	client, err := dial(ctx, cfg)
	if err != nil {
		cleanup()
		notify(StateDisconnected, err)
		return nil, err
	}

	c := &Conn{ID: cfg.ID, Client: client, done: make(chan struct{})}
	c.onClose = func(err error) {
		cleanup()
		m.mu.Lock()
		if m.conns[cfg.ID] == c {
			delete(m.conns, cfg.ID)
		}
		m.mu.Unlock()
		notify(StateDisconnected, err)
	}

	m.mu.Lock()
	m.conns[cfg.ID] = c
	m.mu.Unlock()
	notify(StateConnected, nil)

	go func() { c.close(client.Wait()) }()
	go keepAlive(c)
	return c, nil
}

// Disconnect closes the connection for id. It is a no-op if not connected.
func (m *Manager) Disconnect(id string) {
	if c, ok := m.Get(id); ok {
		c.close(nil)
	}
}

// CloseAll closes every connection; called when the app shuts down.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	conns := make([]*Conn, 0, len(m.conns))
	for _, c := range m.conns {
		conns = append(conns, c)
	}
	m.mu.Unlock()
	for _, c := range conns {
		c.close(nil)
	}
}

func dial(ctx context.Context, cfg Config) (*gossh.Client, error) {
	addr := net.JoinHostPort(cfg.Address, strconv.Itoa(cfg.Port))
	d := net.Dialer{Timeout: dialTimeout}
	nc, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("não foi possível conectar a %s: %w", addr, err)
	}

	// The handshake has no timeout of its own; bound it and abort on ctx.
	_ = nc.SetDeadline(time.Now().Add(dialTimeout))
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		select {
		case <-ctx.Done():
			nc.Close()
		case <-stop:
		}
	}()

	sc, chans, reqs, err := gossh.NewClientConn(nc, addr, &gossh.ClientConfig{
		User:            cfg.User,
		Auth:            cfg.Auth,
		HostKeyCallback: hostKeyCallback(cfg.Trust),
		Timeout:         dialTimeout,
	})
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("falha ao conectar a %s: %w", addr, err)
	}
	_ = nc.SetDeadline(time.Time{})
	return gossh.NewClient(sc, chans, reqs), nil
}

// keepAlive pings the server so a silently dead link is noticed within
// roughly keepAliveInterval*keepAliveMisses.
func keepAlive(c *Conn) {
	t := time.NewTicker(keepAliveInterval)
	defer t.Stop()
	misses := 0
	for {
		select {
		case <-c.done:
			return
		case <-t.C:
			errc := make(chan error, 1)
			go func() {
				_, _, err := c.Client.SendRequest("keepalive@openssh.com", true, nil)
				errc <- err
			}()
			select {
			case err := <-errc:
				if err != nil {
					misses++
				} else {
					misses = 0
				}
			case <-time.After(keepAliveInterval):
				misses++
			case <-c.done:
				return
			}
			if misses >= keepAliveMisses {
				c.close(errors.New("conexão perdida: o servidor parou de responder"))
				return
			}
		}
	}
}
