package ports

import (
	"fmt"
	"sort"
	"syscall"

	psnet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

type PortInfo struct {
	Port        uint32 `json:"port"`
	Protocol    string `json:"protocol"`
	PID         int32  `json:"pid"`
	ProcessName string `json:"processName"`
	Status      string `json:"status"`
}

// ListPorts returns the local TCP ports being listened on and UDP ports bound
// on this machine, along with the process using each one.
func ListPorts() ([]PortInfo, error) {
	conns, err := psnet.Connections("inet")
	if err != nil {
		return nil, err
	}

	names := map[int32]string{}
	seen := map[string]bool{}
	result := []PortInfo{}

	for _, c := range conns {
		if c.Laddr.Port == 0 {
			continue
		}

		protocol := connectionProtocol(c.Type)
		if protocol == "" {
			continue
		}
		// Only listening TCP sockets are relevant for "what's occupying this
		// port" — established connections would flood the list.
		if protocol == "tcp" && c.Status != "LISTEN" {
			continue
		}

		key := fmt.Sprintf("%s:%d:%d", protocol, c.Laddr.Port, c.Pid)
		if seen[key] {
			continue
		}
		seen[key] = true

		name, ok := names[c.Pid]
		if !ok {
			name = processName(c.Pid)
			names[c.Pid] = name
		}

		result = append(result, PortInfo{
			Port:        c.Laddr.Port,
			Protocol:    protocol,
			PID:         c.Pid,
			ProcessName: name,
			Status:      c.Status,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Port < result[j].Port
	})

	return result, nil
}

func connectionProtocol(socketType uint32) string {
	switch socketType {
	case syscall.SOCK_STREAM:
		return "tcp"
	case syscall.SOCK_DGRAM:
		return "udp"
	default:
		return ""
	}
}

// KillProcess terminates the process holding the given PID.
func KillProcess(pid int32) error {
	if pid <= 0 {
		return fmt.Errorf("pid inválido: %d", pid)
	}

	p, err := process.NewProcess(pid)
	if err != nil {
		return fmt.Errorf("processo %d não encontrado: %w", pid, err)
	}

	if err := p.Kill(); err != nil {
		return fmt.Errorf("falha ao matar processo %d: %w", pid, err)
	}

	return nil
}

func processName(pid int32) string {
	if pid <= 0 {
		return ""
	}
	p, err := process.NewProcess(pid)
	if err != nil {
		return ""
	}
	name, err := p.Name()
	if err != nil {
		return ""
	}
	return name
}
