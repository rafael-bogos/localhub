package ssh

import (
	"regexp"
	"sort"
	"strconv"
	"strings"

	"localhub/internal/ports"
)

// Statuses of the remote listings. "ok" is the normal case; the others are
// expected situations the UI explains per server (not Go errors, so one
// server's missing Docker never looks like a failure of the app).
const (
	StatusOK         = "ok"
	StatusNoDocker   = "no_docker"
	StatusDenied     = "denied"
	StatusDaemonDown = "daemon_down"
	StatusNoSS       = "no_ss"
)

// RemotePorts is the listening sockets of one server.
type RemotePorts struct {
	Status  string           `json:"status"`
	Message string           `json:"message"`
	Ports   []ports.PortInfo `json:"ports"`
	// Limited is true when some sockets belong to processes the login user
	// can't see (other users'); they are listed without a name or PID.
	Limited bool `json:"limited"`
}

// ssUsers extracts the first process of `users:(("name",pid=1,fd=3),...)`.
var ssUsers = regexp.MustCompile(`\("((?:[^"\\]|\\.)*)",pid=(\d+),fd=\d+\)`)

// parseSS reads `ss -H -tulnp` output. Rows are deduplicated by protocol,
// port and process (a service listening on IPv4 and IPv6 is one row).
func parseSS(out string) (list []ports.PortInfo, limited bool) {
	type key struct {
		proto string
		port  uint32
		pid   int32
	}
	seen := map[key]bool{}

	for _, line := range strings.Split(out, "\n") {
		f := strings.Fields(line)
		if len(f) < 6 || f[0] == "Netid" {
			continue
		}
		proto := f[0]
		if proto != "tcp" && proto != "udp" {
			continue
		}
		i := strings.LastIndexByte(f[4], ':')
		if i < 0 {
			continue
		}
		n, err := strconv.ParseUint(f[4][i+1:], 10, 32)
		if err != nil || n == 0 {
			continue
		}

		info := ports.PortInfo{Port: uint32(n), Protocol: proto, Status: "LISTEN"}
		if f[1] != "LISTEN" {
			info.Status = "NONE" // bound UDP sockets, as the local listing reports them
		}
		if m := ssUsers.FindStringSubmatch(strings.Join(f[6:], " ")); m != nil {
			if pid, err := strconv.ParseInt(m[2], 10, 32); err == nil {
				info.PID = int32(pid)
				info.ProcessName = strings.ReplaceAll(m[1], `\"`, `"`)
			}
		} else {
			limited = true
		}

		k := key{proto, info.Port, info.PID}
		if seen[k] {
			continue
		}
		seen[k] = true
		list = append(list, info)
	}

	sort.SliceStable(list, func(i, j int) bool {
		if list[i].Port != list[j].Port {
			return list[i].Port < list[j].Port
		}
		return list[i].Protocol < list[j].Protocol
	})
	return list, limited
}

// killMessage turns kill's stderr into something the user can act on.
func killMessage(stderr string) string {
	s := strings.ToLower(stderr)
	switch {
	case strings.Contains(s, "not permitted"):
		return "sem permissão para encerrar este processo (ele pertence a outro usuário)"
	case strings.Contains(s, "no such process"):
		return "o processo já não existe"
	default:
		return "falha ao encerrar o processo"
	}
}
