// Package config keeps the user's settings (saved servers, tunnels, display
// names, preferences) in one JSON file in the system's config directory. Unlike
// the webview's localStorage, that file doesn't depend on the binary's name,
// the dev server's port or the browser data being cleared, so it survives
// updates and moving between the installed app and `wails dev`.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const (
	dirName  = "localhub"
	fileName = "config.json"
	// maxValue bounds one stored value; settings are small, so anything larger
	// is a bug rather than data to keep.
	maxValue = 1 << 20
)

// keyPattern limits keys to short, plain names.
var keyPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,39}$`)

// Store reads and writes the settings file. It is safe for concurrent use.
type Store struct {
	path string
	mu   sync.Mutex
}

// New returns a store for the file in the user's config directory
// (~/.config/localhub/config.json on Linux).
func New() (*Store, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("pasta de configuração indisponível: %w", err)
	}
	return &Store{path: filepath.Join(dir, dirName, fileName)}, nil
}

// NewAt returns a store for an explicit file path.
func NewAt(path string) *Store { return &Store{path: path} }

// Path is where the settings live.
func (s *Store) Path() string { return s.path }

// Load returns every stored key with its decoded value. A missing file is an
// empty configuration. A file that can't be parsed is set aside as
// config.json.bad-<time> and treated as empty, so it is never silently
// overwritten and the app still starts.
func (s *Store) Load() (map[string]any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := s.readLocked()
	if err != nil {
		return nil, err
	}
	out := make(map[string]any, len(raw))
	for k, v := range raw {
		var val any
		if err := json.Unmarshal(v, &val); err == nil {
			out[k] = val
		}
	}
	return out, nil
}

// Set stores one key (value is JSON), keeping every other key as it was.
func (s *Store) Set(key, value string) error {
	if !keyPattern.MatchString(key) {
		return errors.New("nome de configuração inválido")
	}
	if len(value) > maxValue {
		return errors.New("valor de configuração grande demais")
	}
	if !json.Valid([]byte(value)) {
		return errors.New("o valor da configuração não é um JSON válido")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := s.readLocked()
	if err != nil {
		return err
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, []byte(value)); err != nil {
		return err
	}
	raw[key] = json.RawMessage(compact.Bytes())
	return s.writeLocked(raw)
}

var errNoPath = errors.New("pasta de configuração indisponível: as configurações não podem ser salvas")

func (s *Store) readLocked() (map[string]json.RawMessage, error) {
	if s.path == "" {
		return nil, errNoPath
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return map[string]json.RawMessage{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("não foi possível ler %s: %w", s.path, err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]json.RawMessage{}, nil
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil || raw == nil {
		// Keep the unreadable file for the user and start clean.
		bad := fmt.Sprintf("%s.bad-%s", s.path, time.Now().Format("20060102-150405"))
		_ = os.Rename(s.path, bad)
		return map[string]json.RawMessage{}, nil
	}
	return raw, nil
}

// writeLocked replaces the file atomically: the new content goes to a temp
// file in the same directory, is flushed, and is renamed over the old one, so
// a crash never leaves a half-written configuration.
func (s *Store) writeLocked(raw map[string]json.RawMessage) error {
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("não foi possível criar %s: %w", dir, err)
	}
	data, err := json.MarshalIndent(raw, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, fileName+".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if _, err := tmp.Write(append(data, '\n')); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		cleanup()
		return err
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return err
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		cleanup()
		return err
	}
	return nil
}
