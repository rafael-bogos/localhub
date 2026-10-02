//go:build !windows

package ssh

import (
	"errors"
	"net"
	"os"
)

// dialAgent connects to the agent socket named by SSH_AUTH_SOCK.
func dialAgent() (net.Conn, error) {
	sock := os.Getenv("SSH_AUTH_SOCK")
	if sock == "" {
		return nil, errors.New("SSH_AUTH_SOCK não está definido (nenhum agente em execução)")
	}
	return net.Dial("unix", sock)
}
