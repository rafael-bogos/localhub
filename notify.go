package main

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"localhub/internal/docker"
	lssh "localhub/internal/ssh"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// muteFor is how long a stop requested from the app stays silent; `docker stop`
// can take its whole grace period before the container dies.
const muteFor = 2 * time.Minute

// stopNotifier turns "container stopped" events, local and remote, into native
// notifications. Stops the user asked for in the app (stop, restart, remove)
// are muted: the notification is for containers that stopped on their own.
type stopNotifier struct {
	mu    sync.Mutex
	muted map[string]time.Time // host ("" = local) + "/" + container ID -> until
	ctx   context.Context
	ready bool
}

func newStopNotifier() *stopNotifier {
	return &stopNotifier{muted: map[string]time.Time{}}
}

// start prepares the platform notification service. Without it (no D-Bus
// notification daemon, for instance) the app keeps working, just silently.
func (n *stopNotifier) start(ctx context.Context) {
	n.ctx = ctx
	if err := wruntime.InitializeNotifications(ctx); err != nil {
		wruntime.LogWarningf(ctx, "notificações do sistema indisponíveis: %v", err)
		return
	}
	n.ready = wruntime.IsNotificationAvailable(ctx)
}

func (n *stopNotifier) stop() {
	if n.ready {
		wruntime.CleanupNotifications(n.ctx)
	}
}

// mute silences the next stop of a container the app is about to stop. id may
// be a short ID: events carry the full one, so matching is by prefix.
func (n *stopNotifier) mute(hostID, id string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	now := time.Now()
	for k, until := range n.muted {
		if now.After(until) {
			delete(n.muted, k)
		}
	}
	n.muted[hostID+"/"+id] = now.Add(muteFor)
}

func (n *stopNotifier) isMuted(hostID, id string) bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	for k, until := range n.muted {
		host, muted, _ := strings.Cut(k, "/")
		if host == hostID && strings.HasPrefix(id, muted) && time.Now().Before(until) {
			return true
		}
	}
	return false
}

// local is the callback for the local Docker daemon's events.
func (n *stopNotifier) local(ev docker.StopEvent) {
	n.notify("", "", ev)
}

// remote is the callback for the events of a connected SSH server.
func (n *stopNotifier) remote(ev lssh.StopEvent) {
	n.notify(ev.HostID, ev.HostName, ev.StopEvent)
}

// stopNotice is what both the system notification and the in-app panel show.
// Kind drives the look: "stopped" (clean exit), "killed" (ended by a signal,
// which is what `docker stop`/`compose down` do) and "failed" (exit with error).
type stopNotice struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Detail      string `json:"detail"`
	HostID      string `json:"hostId"`
	HostName    string `json:"hostName"`
	ContainerID string `json:"containerId"`
	Name        string `json:"name"`
	Image       string `json:"image"`
	ExitCode    int    `json:"exitCode"`
	At          int64  `json:"at"` // unix milliseconds
}

// describeStop classifies an exit code. 137 (SIGKILL) and 143 (SIGTERM) mean
// the container was ended from outside, not that the program failed; the text
// avoids signal jargon, since what matters is what the user can do next.
func describeStop(code int) (kind, detail string) {
	switch code {
	case 0:
		return "stopped", "Terminou sem erros."
	case 137, 143:
		return "killed", "Foi parado por um comando (stop, compose down, kill) ou por falta de memória."
	}
	return "failed", fmt.Sprintf("Terminou com erro (código %d). Veja os logs.", code)
}

// location says where the container ran, in words.
func location(hostName string) string {
	if hostName == "" {
		return "Neste computador"
	}
	return "Servidor " + hostName
}

func (n *stopNotifier) notify(hostID, hostName string, ev docker.StopEvent) {
	if n.isMuted(hostID, ev.ID) {
		return
	}
	name := ev.Name
	if name == "" {
		name = ev.ID[:min(12, len(ev.ID))]
	}
	kind, detail := describeStop(ev.ExitCode)
	title := name + " parou"
	switch kind {
	case "killed":
		title = name + " foi desligado"
	case "failed":
		title = name + " falhou"
	}
	now := time.Now()
	notice := stopNotice{
		ID:          fmt.Sprintf("stop-%s-%s-%d", hostID, ev.ID, now.UnixNano()),
		Kind:        kind,
		Title:       title,
		Detail:      detail,
		HostID:      hostID,
		HostName:    hostName,
		ContainerID: ev.ID,
		Name:        name,
		Image:       ev.Image,
		ExitCode:    ev.ExitCode,
		At:          now.UnixMilli(),
	}
	wruntime.EventsEmit(n.ctx, "container:stopped", notice)

	if !n.ready {
		return
	}
	where := location(hostName)
	if ev.Image != "" {
		where += " · imagem " + ev.Image
	}
	if err := wruntime.SendNotification(n.ctx, wruntime.NotificationOptions{
		ID:    notice.ID,
		Title: title,
		Body:  where + "\n" + detail,
	}); err != nil {
		wruntime.LogWarningf(n.ctx, "notificação do sistema não enviada: %v", err)
	}
}
