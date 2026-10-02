package ssh

import (
	"context"
	"errors"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

// Emit publishes an event to the UI (the app wires it to the Wails runtime).
type Emit func(event string, data any)

// Login methods of a saved server.
const (
	MethodKey   = "key"
	MethodAgent = "agent"
)

// Codes of ConnectResult.
const (
	ResultOK                 = "ok"
	ResultPassphraseRequired = "passphrase_required"
	ResultBadPassphrase      = "bad_passphrase"
	ResultError              = "error"
)

const trustTimeout = 2 * time.Minute

// HostSpec is what the UI sends to connect: a saved server's metadata. It
// never carries secrets; the passphrase travels separately.
type HostSpec struct {
	ID      string `json:"id"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	Method  string `json:"method"`
	KeyPath string `json:"keyPath"`
}

// ConnectResult is the outcome of Service.Connect. Expected situations the UI
// reacts to (asking for a passphrase) are codes, not Go errors.
type ConnectResult struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// StateEvent is the payload of "ssh:state:<id>".
type StateEvent struct {
	State   string `json:"state"`
	Message string `json:"message"`
}

// HostKeyPrompt is the payload of "ssh:hostkey:<id>": the UI shows the
// fingerprint and answers with ConfirmHostKey.
type HostKeyPrompt struct {
	Address     string `json:"address"`
	KeyType     string `json:"keyType"`
	Fingerprint string `json:"fingerprint"`
}

// Service ties connections, host-key confirmation and the terminal together.
// Connection events are keyed by the server ID ("ssh:state:<id>",
// "ssh:hostkey:<id>"); terminal events by a session ID the frontend picks
// ("ssh:data:<session>", "ssh:end:<session>"). The frontend subscribes
// before calling.
type Service struct {
	mgr  *Manager
	emit Emit

	mu     sync.Mutex
	trust  map[string]chan bool
	termID string
	term   *terminal
}

func NewService(emit Emit) *Service {
	return &Service{mgr: NewManager(), emit: emit, trust: map[string]chan bool{}}
}

// Manager exposes the connections to the code that runs remote commands.
func (s *Service) Manager() *Manager { return s.mgr }

// Connect authenticates and connects to one server, blocking until it is
// established or fails. passphrase is only used for encrypted keys and is
// zeroed.
func (s *Service) Connect(ctx context.Context, spec HostSpec, passphrase []byte) ConnectResult {
	var auth gossh.AuthMethod
	var cleanup func()
	switch spec.Method {
	case MethodKey:
		m, err := KeyAuth(spec.KeyPath, passphrase)
		switch {
		case errors.Is(err, ErrPassphraseRequired):
			return ConnectResult{Code: ResultPassphraseRequired, Message: err.Error()}
		case errors.Is(err, ErrBadPassphrase):
			return ConnectResult{Code: ResultBadPassphrase, Message: err.Error()}
		case err != nil:
			return ConnectResult{Code: ResultError, Message: err.Error()}
		}
		auth = m
	case MethodAgent:
		clear(passphrase)
		m, cl, err := AgentAuth()
		if err != nil {
			return ConnectResult{Code: ResultError, Message: err.Error()}
		}
		auth, cleanup = m, cl
	default:
		clear(passphrase)
		return ConnectResult{Code: ResultError, Message: "método de login desconhecido"}
	}

	_, err := s.mgr.Connect(ctx, Config{
		ID:      spec.ID,
		Address: spec.Address,
		Port:    spec.Port,
		User:    spec.User,
		Auth:    []gossh.AuthMethod{auth},
		Trust:   func(address, keyType, fp string) bool { return s.askTrust(ctx, spec.ID, address, keyType, fp) },
		Cleanup: cleanup,
		OnState: func(id, state string, err error) {
			ev := StateEvent{State: state}
			if err != nil {
				ev.Message = err.Error()
			}
			s.emit("ssh:state:"+id, ev)
		},
	})
	if err != nil {
		return ConnectResult{Code: ResultError, Message: err.Error()}
	}
	return ConnectResult{Code: ResultOK}
}

func (s *Service) askTrust(ctx context.Context, id, address, keyType, fp string) bool {
	ch := make(chan bool, 1)
	s.mu.Lock()
	s.trust[id] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.trust, id)
		s.mu.Unlock()
	}()

	s.emit("ssh:hostkey:"+id, HostKeyPrompt{Address: address, KeyType: keyType, Fingerprint: fp})
	select {
	case ok := <-ch:
		return ok
	case <-time.After(trustTimeout):
		return false
	case <-ctx.Done():
		return false
	}
}

// ConfirmHostKey answers a pending "ssh:hostkey:<id>" prompt.
func (s *Service) ConfirmHostKey(id string, accept bool) {
	s.mu.Lock()
	ch := s.trust[id]
	s.mu.Unlock()
	if ch != nil {
		select {
		case ch <- accept:
		default:
		}
	}
}

// Disconnect closes the server's connection (and its terminal, if any).
func (s *Service) Disconnect(id string) { s.mgr.Disconnect(id) }

// OpenTerminal starts a shell on the server's connection. Only one terminal
// can be open at a time; the caller closes the previous one first. Output
// goes to "ssh:data:<session>" and the end to "ssh:end:<session>".
func (s *Service) OpenTerminal(id, session string, cols, rows int) error {
	conn, ok := s.mgr.Get(id)
	if !ok {
		return errors.New("este servidor não está conectado")
	}
	if session == "" {
		return errors.New("sessão do terminal sem identificador")
	}

	s.mu.Lock()
	if s.term != nil && !s.term.ended.Load() {
		s.mu.Unlock()
		return errors.New("já existe um terminal aberto")
	}
	placeholder := &terminal{} // reserve the slot while the shell starts
	s.termID, s.term = id, placeholder
	s.mu.Unlock()

	t, err := openTerminal(conn, s.emit, session, cols, rows, s.releaseTerminal)
	if err != nil {
		s.releaseTerminal(placeholder)
		return err
	}
	s.mu.Lock()
	if s.term == placeholder {
		s.term = t
	}
	s.mu.Unlock()
	return nil
}

// releaseTerminal frees the slot, but only if t still owns it: the end of an
// old terminal must not release the one that replaced it.
func (s *Service) releaseTerminal(t *terminal) {
	s.mu.Lock()
	if s.term == t {
		s.term, s.termID = nil, ""
	}
	s.mu.Unlock()
}

func (s *Service) activeTerminal(id string) (*terminal, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.term == nil || s.termID != id || s.term.sess == nil {
		return nil, errors.New("nenhum terminal aberto neste servidor")
	}
	return s.term, nil
}

// WriteTerminal sends keystrokes to the shell.
func (s *Service) WriteTerminal(id, data string) error {
	t, err := s.activeTerminal(id)
	if err != nil {
		return err
	}
	return t.write(data)
}

// ResizeTerminal propagates the UI size to the remote PTY.
func (s *Service) ResizeTerminal(id string, cols, rows int) error {
	t, err := s.activeTerminal(id)
	if err != nil {
		return err
	}
	return t.resize(cols, rows)
}

// CloseTerminal ends the shell but keeps the connection (and its data) alive.
// It only acts on the given session: a late close of an old terminal must not
// end the one that replaced it.
func (s *Service) CloseTerminal(id, session string) {
	if t, err := s.activeTerminal(id); err == nil && t.session == session {
		t.close()
	}
}

// Shutdown closes every connection; called when the app exits.
func (s *Service) Shutdown() { s.mgr.CloseAll() }
