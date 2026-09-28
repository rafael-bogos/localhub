package ports

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"syscall"

	psnet "github.com/shirou/gopsutil/v3/net"
	"github.com/shirou/gopsutil/v3/process"
)

// resolveConcurrency caps how many process lookups run at once. On macOS,
// resolving the name of a process with a long name (common for Electron
// helper processes like "Apidog Helper (Renderer)") falls back to shelling
// out to `ps`, which is slow one at a time on a machine with many open
// ports — running lookups concurrently keeps startup fast regardless.
const resolveConcurrency = 16

// systemSupervisors are OS process-launcher/init processes that are the
// immediate parent of essentially every top-level app. Grouping by one of
// these would lump every unrelated app on the machine into one giant
// "parent" — so they're treated as if there's no meaningful parent at all.
var systemSupervisors = map[string]bool{
	"launchd":      true, // macOS
	"systemd":      true, // Linux
	"init":         true, // Linux (older/other init systems)
	"explorer.exe": true, // Windows desktop shell
	"services.exe": true, // Windows service control manager
	// Desktop shells that directly launch GUI apps — grouping by these would
	// lump every unrelated app the user opened into one giant "parent".
	"gnome-shell":     true,
	"plasmashell":     true,
	"xfce4-session":   true,
	"cinnamon-sessio": true,
	"mate-session":    true,
	"lxsession":       true,
	"budgie-wm":       true,
}

type PortInfo struct {
	Port        uint32 `json:"port"`
	Protocol    string `json:"protocol"`
	PID         int32  `json:"pid"`
	ProcessName string `json:"processName"`
	Status      string `json:"status"`
	ParentPID   int32  `json:"parentPid"`
	ChildCount  int    `json:"childCount"`
}

// resolvePpids looks up just the parent PID for every pid in the set,
// concurrently. This is cheap everywhere (a single syscall/proc read), unlike
// resolving a process's own name, which falls back to shelling out to `ps`
// on macOS for long names — so grouping never has to pay for a name lookup
// it doesn't need yet.
func resolvePpids(pids map[int32]bool) map[int32]int32 {
	result := make(map[int32]int32, len(pids))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, resolveConcurrency)

	for pid := range pids {
		wg.Add(1)
		sem <- struct{}{}
		go func(pid int32) {
			defer wg.Done()
			defer func() { <-sem }()
			ppid := parentPID(pid)
			mu.Lock()
			result[pid] = ppid
			mu.Unlock()
		}(pid)
	}
	wg.Wait()

	return result
}

// resolveNames looks up just the display name for every pid in the set,
// concurrently.
func resolveNames(pids map[int32]bool) map[int32]string {
	result := make(map[int32]string, len(pids))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, resolveConcurrency)

	for pid := range pids {
		wg.Add(1)
		sem <- struct{}{}
		go func(pid int32) {
			defer wg.Done()
			defer func() { <-sem }()
			name := processName(pid)
			mu.Lock()
			result[pid] = name
			mu.Unlock()
		}(pid)
	}
	wg.Wait()

	return result
}

// visibleConn is one port entry that actually qualifies to be shown — same
// visibility rule (a real protocol, and only LISTEN for TCP) used both to
// count a process's children and to list them, so ChildCount always matches
// exactly how many rows ListChildProcesses returns for it.
type visibleConn struct {
	port     uint32
	protocol string
	pid      int32
	status   string
}

func visibleConnections(conns []psnet.ConnectionStat) []visibleConn {
	seen := map[string]bool{}
	result := []visibleConn{}
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
		result = append(result, visibleConn{port: c.Laddr.Port, protocol: protocol, pid: c.Pid, status: c.Status})
	}
	return result
}

// effectiveParents resolves, for every pid in pids, which immediate parent
// PID (if any) it should be grouped under — 0 if there is none, or if the
// parent is a system supervisor/desktop shell that would otherwise lump
// unrelated apps together. Only the parent PIDs themselves need a name
// resolved here (to check against systemSupervisors and, for callers that
// want it, to display); the child pids' own names are the caller's concern.
func effectiveParents(pids map[int32]bool) (parents map[int32]int32, parentNames map[int32]string) {
	ppids := resolvePpids(pids)

	candidates := map[int32]bool{}
	for _, ppid := range ppids {
		if ppid > 1 {
			candidates[ppid] = true
		}
	}
	names := resolveNames(candidates)

	parents = make(map[int32]int32, len(pids))
	for pid, ppid := range ppids {
		if ppid <= 1 || systemSupervisors[strings.ToLower(names[ppid])] {
			parents[pid] = 0
		} else {
			parents[pid] = ppid
		}
	}

	return parents, names
}

// ListPorts returns the local TCP ports being listened on and UDP ports
// bound on this machine, along with the process using each one. Processes
// that share a parent (e.g. an Electron app's helper/renderer processes)
// are collapsed into a single row reporting how many ports its children
// hold — resolving each child's own name (potentially slow: on macOS, a
// long process name falls back to shelling out to `ps`) is deferred to
// ListChildProcesses, called only once the user expands that row.
func ListPorts() ([]PortInfo, error) {
	conns, err := psnet.Connections("inet")
	if err != nil {
		return nil, err
	}
	visible := visibleConnections(conns)

	pids := map[int32]bool{}
	for _, v := range visible {
		pids[v.pid] = true
	}
	parents, _ := effectiveParents(pids)

	// Counted per visible port row (not per child process) so it always
	// matches exactly how many rows ListChildProcesses returns — a process
	// holding two ports counts as two here, not one.
	childCount := map[int32]int{}
	for _, v := range visible {
		if ppid := parents[v.pid]; ppid > 0 {
			childCount[ppid]++
		}
	}

	needsName := map[int32]bool{}
	for pid, ppid := range parents {
		if ppid == 0 {
			needsName[pid] = true
		}
	}
	for ppid := range childCount {
		needsName[ppid] = true
	}
	names := resolveNames(needsName)

	result := []PortInfo{}

	for _, v := range visible {
		// Grouped children are not listed individually here — fetched on
		// demand by ListChildProcesses once their parent row is expanded.
		if parents[v.pid] != 0 {
			continue
		}

		result = append(result, PortInfo{
			Port:        v.port,
			Protocol:    v.protocol,
			PID:         v.pid,
			ProcessName: names[v.pid],
			Status:      v.status,
		})
	}

	addedParent := map[int32]bool{}
	for ppid, count := range childCount {
		if addedParent[ppid] {
			continue
		}
		addedParent[ppid] = true
		result = append(result, PortInfo{
			PID:         ppid,
			ProcessName: names[ppid],
			ChildCount:  count,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Port < result[j].Port
	})

	return result, nil
}

// ListChildProcesses returns the ports held by every process whose immediate
// (post-filtering) parent is parentPID — called only when the user expands
// that group in the UI, so the name resolution for each child (potentially
// slow on macOS) happens only when actually needed.
func ListChildProcesses(parentPID int32) ([]PortInfo, error) {
	conns, err := psnet.Connections("inet")
	if err != nil {
		return nil, err
	}
	visible := visibleConnections(conns)

	pids := map[int32]bool{}
	for _, v := range visible {
		pids[v.pid] = true
	}
	parents, _ := effectiveParents(pids)

	childPids := map[int32]bool{}
	for pid, ppid := range parents {
		if ppid == parentPID {
			childPids[pid] = true
		}
	}
	names := resolveNames(childPids)

	result := []PortInfo{}

	for _, v := range visible {
		if parents[v.pid] != parentPID {
			continue
		}

		result = append(result, PortInfo{
			Port:        v.port,
			Protocol:    v.protocol,
			PID:         v.pid,
			ProcessName: names[v.pid],
			Status:      v.status,
			ParentPID:   parentPID,
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

// parentPID returns the PID of pid's parent process, or 0 if it can't be
// determined (process already exited, permission denied, or no parent).
func parentPID(pid int32) int32 {
	if pid <= 0 {
		return 0
	}
	p, err := process.NewProcess(pid)
	if err != nil {
		return 0
	}
	ppid, err := p.Ppid()
	if err != nil {
		return 0
	}
	return ppid
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
