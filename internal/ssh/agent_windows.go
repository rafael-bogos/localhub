//go:build windows

package ssh

import (
	"net"

	"github.com/Microsoft/go-winio"
)

// dialAgent connects to the Windows OpenSSH Agent named pipe. Pageant is not
// supported.
func dialAgent() (net.Conn, error) {
	return winio.DialPipe(`\\.\pipe\openssh-ssh-agent`, nil)
}
