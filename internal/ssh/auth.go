package ssh

import (
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	gossh "golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

var (
	// ErrPassphraseRequired means the key is encrypted and no passphrase was
	// given; the UI should ask for one and retry.
	ErrPassphraseRequired = errors.New("a chave está protegida por passphrase")
	// ErrBadPassphrase means the given passphrase did not decrypt the key.
	ErrBadPassphrase = errors.New("passphrase incorreta")
)

// KeyAuth builds an auth method from a private key file. passphrase may be
// nil for unencrypted keys. The passphrase bytes are zeroed before returning.
func KeyAuth(path string, passphrase []byte) (gossh.AuthMethod, error) {
	defer clear(passphrase)

	path = expandHome(path)
	pemBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("não foi possível ler a chave %s: %w", path, err)
	}

	var signer gossh.Signer
	if len(passphrase) == 0 {
		signer, err = gossh.ParsePrivateKey(pemBytes)
	} else {
		signer, err = gossh.ParsePrivateKeyWithPassphrase(pemBytes, passphrase)
	}
	if err != nil {
		var missing *gossh.PassphraseMissingError
		switch {
		case errors.As(err, &missing):
			return nil, ErrPassphraseRequired
		case errors.Is(err, x509.IncorrectPasswordError):
			return nil, ErrBadPassphrase
		}
		return nil, fmt.Errorf("chave inválida ou formato não suportado (%s): %w", path, err)
	}
	return gossh.PublicKeys(signer), nil
}

// AgentAuth builds an auth method backed by the system ssh-agent. The
// returned cleanup closes the agent socket and must be called once the
// connection ends (or immediately if the connection is never made).
func AgentAuth() (gossh.AuthMethod, func(), error) {
	conn, err := dialAgent()
	if err != nil {
		return nil, nil, fmt.Errorf("ssh-agent indisponível: %w", err)
	}
	return gossh.PublicKeysCallback(agent.NewClient(conn).Signers), func() { conn.Close() }, nil
}

func expandHome(p string) string {
	if p == "~" || strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[1:])
		}
	}
	return p
}
