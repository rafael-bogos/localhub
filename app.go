package main

import (
	"context"
	"os"
	"path/filepath"

	"localhub/internal/docker"
	"localhub/internal/nodemodules"
	"localhub/internal/ports"
	lssh "localhub/internal/ssh"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
	ssh *lssh.Service
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.ssh = lssh.NewService(func(event string, data any) {
		wruntime.EventsEmit(ctx, event, data)
	})
}

// shutdown is called when the app exits; it closes every SSH connection.
func (a *App) shutdown(ctx context.Context) {
	if a.ssh != nil {
		a.ssh.Shutdown()
	}
}

// ListPorts returns the local ports currently in use, along with the
// process using each one.
func (a *App) ListPorts() ([]ports.PortInfo, error) {
	return ports.ListPorts()
}

// KillProcess terminates the process holding the given PID.
func (a *App) KillProcess(pid int32) error {
	return ports.KillProcess(pid)
}

// ListChildProcesses returns the ports held by processes whose immediate
// parent is parentPID. Called only when the user expands a parent-process
// row in the Portas tab, so child name resolution stays lazy.
func (a *App) ListChildProcesses(parentPID int32) ([]ports.PortInfo, error) {
	return ports.ListChildProcesses(parentPID)
}

// ListContainers returns every Docker container on the local daemon, running
// containers first.
func (a *App) ListContainers() ([]docker.ContainerInfo, error) {
	return docker.ListContainers(a.ctx)
}

// ListContainerStats returns a CPU/memory sample for every running
// container. Kept separate from ListContainers because sampling takes about
// a second, and the list should never wait on it.
func (a *App) ListContainerStats() ([]docker.ContainerStats, error) {
	return docker.ListContainerStats(a.ctx)
}

// StartContainerLogs streams a container's logs to the UI as events
// ("logs:batch:<sessionID>", "logs:end:<sessionID>"). The frontend picks the
// sessionID and subscribes before calling, so no early batch is lost.
func (a *App) StartContainerLogs(sessionID, containerID string, tail int) error {
	return docker.StartLogs(a.ctx, sessionID, containerID, tail, func(event string, data any) {
		wruntime.EventsEmit(a.ctx, event, data)
	})
}

// StopContainerLogs closes the log stream of the given session.
func (a *App) StopContainerLogs(sessionID string) {
	docker.StopLogs(sessionID)
}

// LoadOlderContainerLogs returns up to count lines older than beforeTs, for
// the "load older" button, and whether more exist before them.
func (a *App) LoadOlderContainerLogs(containerID, beforeTs string, count int) (docker.OlderLogs, error) {
	lines, hasMore, err := docker.LoadOlderLogs(a.ctx, containerID, beforeTs, count)
	if err != nil {
		return docker.OlderLogs{}, err
	}
	return docker.OlderLogs{Lines: lines, HasMore: hasMore}, nil
}

// ListPortOwners returns which running container publishes each host port.
func (a *App) ListPortOwners() ([]docker.PortOwner, error) {
	return docker.ListPortOwners(a.ctx)
}

// StartContainer starts a stopped container.
func (a *App) StartContainer(id string) error {
	return docker.StartContainer(a.ctx, id)
}

// StopContainer stops a running container.
func (a *App) StopContainer(id string) error {
	return docker.StopContainer(a.ctx, id)
}

// RestartContainer stops and starts a container again.
func (a *App) RestartContainer(id string) error {
	return docker.RestartContainer(a.ctx, id)
}

// RemoveContainer removes a stopped container.
func (a *App) RemoveContainer(id string) error {
	return docker.RemoveContainer(a.ctx, id)
}

// ListImages returns every local Docker image.
func (a *App) ListImages() ([]docker.ImageInfo, error) {
	return docker.ListImages(a.ctx)
}

// RemoveImage removes a local Docker image.
func (a *App) RemoveImage(id string) error {
	return docker.RemoveImage(a.ctx, id)
}

// PruneImages removes dangling (untagged) images and reports how many were
// removed and how much space was reclaimed.
func (a *App) PruneImages() (docker.PruneResult, error) {
	return docker.PruneImages(a.ctx)
}

// Cleanup runs a selective Docker system prune: only the categories set to
// true in opts are touched, and the user picks them per run.
func (a *App) Cleanup(opts docker.CleanupOptions) (docker.CleanupResult, error) {
	return docker.Cleanup(a.ctx, opts)
}

// PickDirectory opens the native folder chooser and returns the chosen path,
// or "" if the user cancelled.
func (a *App) PickDirectory() (string, error) {
	return wruntime.OpenDirectoryDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Escolha o diretório raiz",
	})
}

// PickFile opens the native file chooser, starting in ~/.ssh, and returns
// the chosen path, or "" if the user cancelled. Used to select SSH keys.
func (a *App) PickFile() (string, error) {
	opts := wruntime.OpenDialogOptions{
		Title:                "Escolha o arquivo da chave privada",
		ShowHiddenFiles:      true,
		CanCreateDirectories: false,
	}
	if home, err := os.UserHomeDir(); err == nil {
		opts.DefaultDirectory = filepath.Join(home, ".ssh")
	}
	return wruntime.OpenFileDialog(a.ctx, opts)
}

// ScanNodeModules lists every project's node_modules under the given root.
func (a *App) ScanNodeModules(root string) (nodemodules.ScanResult, error) {
	return nodemodules.Scan(a.ctx, root)
}

// CancelNodeModulesScan stops the scan in progress.
func (a *App) CancelNodeModulesScan() {
	nodemodules.CancelScan()
}

// NodeModulesSize returns the size in bytes of a node_modules found by the
// last scan.
func (a *App) NodeModulesSize(path string) (int64, error) {
	return nodemodules.Size(a.ctx, path)
}

// RemoveNodeModules deletes the given node_modules directories (each must come
// from the last scan). Progress arrives as "nodemodules:removed" events.
func (a *App) RemoveNodeModules(paths []string) []nodemodules.RemoveResult {
	return nodemodules.Remove(paths, func(event string, data any) {
		wruntime.EventsEmit(a.ctx, event, data)
	})
}

// SSHConnect connects to a saved server and blocks until it is established.
// Events ("ssh:state|hostkey:<id>") must be subscribed to before calling. The
// passphrase is only needed for encrypted keys; the result code tells the UI
// when to ask for one.
func (a *App) SSHConnect(spec lssh.HostSpec, passphrase string) lssh.ConnectResult {
	return a.ssh.Connect(a.ctx, spec, []byte(passphrase))
}

// SSHConfirmHostKey answers the "ssh:hostkey:<id>" prompt for a server seen
// for the first time.
func (a *App) SSHConfirmHostKey(id string, accept bool) {
	a.ssh.ConfirmHostKey(id, accept)
}

// SSHDisconnect closes the connection to a server, and its terminal.
func (a *App) SSHDisconnect(id string) {
	a.ssh.Disconnect(id)
}

// SSHOpenTerminal starts a shell on a connected server. The frontend picks
// the session; output arrives as "ssh:data:<session>" (base64) and the end as
// "ssh:end:<session>", so subscribe before calling.
func (a *App) SSHOpenTerminal(id, session string, cols, rows int) error {
	return a.ssh.OpenTerminal(id, session, cols, rows)
}

// SSHOpenContainerTerminal opens a terminal inside a running container of a
// connected server (docker exec -it). Same events and single slot as
// SSHOpenTerminal.
func (a *App) SSHOpenContainerTerminal(id, session, containerID string, cols, rows int) error {
	return a.ssh.OpenContainerTerminal(a.ctx, id, session, containerID, cols, rows)
}

// SSHWrite sends keystrokes to the server's terminal.
func (a *App) SSHWrite(id, data string) error {
	return a.ssh.WriteTerminal(id, data)
}

// SSHResize propagates the terminal size to the remote PTY.
func (a *App) SSHResize(id string, cols, rows int) error {
	return a.ssh.ResizeTerminal(id, cols, rows)
}

// SSHAck reports how many bytes of a terminal's output the UI has finished
// processing; the backend pauses reading from the server when too many are
// outstanding.
func (a *App) SSHAck(id, session string, n int) {
	a.ssh.AckTerminal(id, session, n)
}

// SSHCloseTerminal ends the given terminal session but keeps the connection
// alive. A session that is no longer the active one is ignored.
func (a *App) SSHCloseTerminal(id, session string) {
	a.ssh.CloseTerminal(id, session)
}

// SSHImportConfig reads ~/.ssh/config and returns the servers it finds, for
// the UI to preview. Nothing is saved here.
func (a *App) SSHImportConfig() (lssh.ImportResult, error) {
	return lssh.ImportConfig()
}

// ---- Remote servers: the same lists and actions as the local tabs ----

// RemoteListPorts lists the listening sockets of a connected SSH server.
func (a *App) RemoteListPorts(hostID string) (lssh.RemotePorts, error) {
	return a.ssh.ListPorts(a.ctx, hostID)
}

// RemoteKillProcess terminates a process on a connected SSH server.
func (a *App) RemoteKillProcess(hostID string, pid int32) error {
	return a.ssh.KillProcess(a.ctx, hostID, pid)
}

// RemoteListContainers lists the Docker containers of a connected SSH server.
func (a *App) RemoteListContainers(hostID string) (lssh.RemoteContainers, error) {
	return a.ssh.ListContainers(a.ctx, hostID)
}

// RemoteContainerAction runs "start", "stop", "restart" or "remove" on a
// container of a connected SSH server.
func (a *App) RemoteContainerAction(hostID, containerID, action string) error {
	return a.ssh.ContainerAction(a.ctx, hostID, containerID, action)
}

// RemoteListImages lists the Docker images of a connected SSH server.
func (a *App) RemoteListImages(hostID string) (lssh.RemoteImages, error) {
	return a.ssh.ListImages(a.ctx, hostID)
}

// RemoteRemoveImage removes a Docker image from a connected SSH server.
func (a *App) RemoteRemoveImage(hostID, imageID string) error {
	return a.ssh.RemoveImage(a.ctx, hostID, imageID)
}

// RemoteStartLogs streams a remote container's logs as the same events local
// containers use ("logs:batch:<sessionID>", "logs:end:<sessionID>"). The
// frontend picks the sessionID and subscribes before calling.
func (a *App) RemoteStartLogs(hostID, sessionID, containerID string, tail int) error {
	return a.ssh.StartLogs(a.ctx, hostID, sessionID, containerID, tail)
}

// RemoteStopLogs closes a remote log stream.
func (a *App) RemoteStopLogs(sessionID string) {
	a.ssh.StopLogs(sessionID)
}

// RemoteLoadOlderLogs pages back through a remote container's logs.
func (a *App) RemoteLoadOlderLogs(hostID, containerID, beforeTs string, count int) (docker.OlderLogs, error) {
	return a.ssh.LoadOlderLogs(a.ctx, hostID, containerID, beforeTs, count)
}

// ---- Tunnels: local port forwards to containers of a server ----

// RemoteContainerNetworks reads a container's networks, IPs and TCP ports, to
// build a tunnel to it.
func (a *App) RemoteContainerNetworks(hostID, containerID string) (lssh.ContainerNet, error) {
	return a.ssh.ContainerNetworks(a.ctx, hostID, containerID)
}

// RemoteSuggestLocalPort proposes a free local port for a container port.
func (a *App) RemoteSuggestLocalPort(remotePort int) int {
	return a.ssh.SuggestLocalPort(remotePort)
}

// RemoteOpenTunnel forwards 127.0.0.1:localPort (0 = any free port) to a
// container's port through the server, like `ssh -fN -L`. Changes are
// announced with the "tunnels:changed" event.
func (a *App) RemoteOpenTunnel(hostID, containerID, network string, remotePort, localPort int) (lssh.TunnelInfo, error) {
	return a.ssh.OpenTunnel(a.ctx, hostID, containerID, network, remotePort, localPort)
}

// RemoteCloseTunnel stops a tunnel.
func (a *App) RemoteCloseTunnel(id string) {
	a.ssh.CloseTunnel(id)
}

// RemoteListTunnels returns the open tunnels.
func (a *App) RemoteListTunnels() []lssh.TunnelInfo {
	return a.ssh.ListTunnels()
}
