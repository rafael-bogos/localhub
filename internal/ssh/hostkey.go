package ssh

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

var (
	// ErrHostKeyChanged is returned when a server presents a key different
	// from the one recorded in known_hosts. The connection is never allowed
	// to continue: this is either a reinstalled server or a man-in-the-middle.
	ErrHostKeyChanged = errors.New("a chave do servidor mudou desde a última conexão")
	// ErrHostKeyRejected is returned when the user declines to trust an
	// unknown server.
	ErrHostKeyRejected = errors.New("servidor não confiável: conexão cancelada")
)

// TrustFunc asks the user whether to trust a server seen for the first time.
// It receives the address as dialed, the key type and its SHA256 fingerprint,
// and reports whether the user accepted.
type TrustFunc func(address, keyType, fingerprint string) bool

// knownHostsPath returns ~/.ssh/known_hosts, creating the directory (0700)
// and the file (0600) when missing, as OpenSSH would.
func knownHostsPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("pasta do usuário indisponível: %w", err)
	}
	dir := filepath.Join(home, ".ssh")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "known_hosts")
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDONLY, 0o600)
	if err != nil {
		return "", err
	}
	f.Close()
	return path, nil
}

// hostKeyCallback verifies server keys against known_hosts. Unknown servers
// go through trust (TOFU) and are recorded on acceptance; a changed key is
// always refused. known_hosts is re-read on every call so entries added by a
// previous connection take effect immediately.
func hostKeyCallback(trust TrustFunc) gossh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key gossh.PublicKey) error {
		path, err := knownHostsPath()
		if err != nil {
			return err
		}
		check, err := knownhosts.New(path)
		if err != nil {
			return err
		}
		err = check(hostname, remote, key)
		if err == nil {
			return nil
		}

		var keyErr *knownhosts.KeyError
		if !errors.As(err, &keyErr) {
			return err
		}
		if len(keyErr.Want) > 0 {
			return fmt.Errorf("%w (%s, %s)", ErrHostKeyChanged, hostname, gossh.FingerprintSHA256(key))
		}

		if trust == nil || !trust(hostname, key.Type(), gossh.FingerprintSHA256(key)) {
			return ErrHostKeyRejected
		}
		return appendKnownHost(path, hostname, key)
	}
}

func appendKnownHost(path, hostname string, key gossh.PublicKey) error {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = fmt.Fprintln(f, knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key))
	return err
}
