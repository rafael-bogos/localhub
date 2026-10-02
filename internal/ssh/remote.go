package ssh

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"localhub/internal/docker"
	"localhub/internal/ports"
)

const (
	listTimeout   = 20 * time.Second
	actionTimeout = 60 * time.Second // docker stop waits for the container to exit
	olderTimeout  = 90 * time.Second
	inspectTimout = 10 * time.Second
)

var errNotConnected = errors.New("este servidor não está conectado")

func (s *Service) remoteConn(id string) (*Conn, error) {
	conn, ok := s.mgr.Get(id)
	if !ok {
		return nil, errNotConnected
	}
	return conn, nil
}

// failure turns a command that exited non-zero into the error shown in the UI.
func failure(res execResult, message string) error {
	if message == "" {
		message = firstLine(res.Stderr)
	}
	return errors.New(message)
}

// ---- Processes ----

// ListPorts lists the listening sockets of a connected server.
func (s *Service) ListPorts(ctx context.Context, id string) (RemotePorts, error) {
	conn, err := s.remoteConn(id)
	if err != nil {
		return RemotePorts{}, err
	}
	res, err := runScript(ctx, conn, "ss -H -tulnp", listTimeout)
	if err != nil {
		return RemotePorts{}, err
	}
	if res.ExitCode == 127 {
		return RemotePorts{Status: StatusNoSS, Message: "O comando ss não foi encontrado neste servidor (pacote iproute2).", Ports: []ports.PortInfo{}}, nil
	}
	if res.ExitCode != 0 {
		return RemotePorts{}, failure(res, "falha ao listar as portas do servidor")
	}
	list, limited := parseSS(res.Stdout)
	return RemotePorts{Status: StatusOK, Ports: list, Limited: limited}, nil
}

// KillProcess sends SIGTERM to a process on a connected server.
func (s *Service) KillProcess(ctx context.Context, id string, pid int32) error {
	if err := validPID(pid); err != nil {
		return err
	}
	conn, err := s.remoteConn(id)
	if err != nil {
		return err
	}
	res, err := runScript(ctx, conn, "kill -TERM "+strconv.Itoa(int(pid)), listTimeout)
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return errors.New(killMessage(res.Stderr))
	}
	return nil
}

// ---- Containers and images ----

// ListContainers lists every container of a connected server.
func (s *Service) ListContainers(ctx context.Context, id string) (RemoteContainers, error) {
	conn, err := s.remoteConn(id)
	if err != nil {
		return RemoteContainers{}, err
	}
	res, err := runScript(ctx, conn, `docker ps -a --no-trunc --format "{{json .}}"`, listTimeout)
	if err != nil {
		return RemoteContainers{}, err
	}
	if res.ExitCode != 0 {
		if status, msg, ok := dockerProblem(res, conn.User); ok {
			return RemoteContainers{Status: status, Message: msg, Items: []docker.ContainerInfo{}}, nil
		}
		return RemoteContainers{}, failure(res, "falha ao listar os containers do servidor")
	}
	items, err := parseContainers(res.Stdout)
	if err != nil {
		return RemoteContainers{}, err
	}
	return RemoteContainers{Status: StatusOK, Items: items}, nil
}

// ContainerAction runs start, stop, restart or remove on a container.
func (s *Service) ContainerAction(ctx context.Context, id, containerID, action string) error {
	verb, ok := containerActions[action]
	if !ok {
		return errors.New("ação desconhecida")
	}
	if err := validID(containerID); err != nil {
		return err
	}
	conn, err := s.remoteConn(id)
	if err != nil {
		return err
	}
	res, err := runScript(ctx, conn, "docker "+verb+" "+shQuote(containerID), actionTimeout)
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return errors.New(containerActionMessage(action, res.Stderr))
	}
	return nil
}

// ListImages lists the images of a connected server.
func (s *Service) ListImages(ctx context.Context, id string) (RemoteImages, error) {
	conn, err := s.remoteConn(id)
	if err != nil {
		return RemoteImages{}, err
	}
	res, err := runScript(ctx, conn, `docker images --format "{{json .}}"`, listTimeout)
	if err != nil {
		return RemoteImages{}, err
	}
	if res.ExitCode != 0 {
		if status, msg, ok := dockerProblem(res, conn.User); ok {
			return RemoteImages{Status: status, Message: msg, Items: []docker.ImageInfo{}}, nil
		}
		return RemoteImages{}, failure(res, "falha ao listar as imagens do servidor")
	}
	items, err := parseImages(res.Stdout)
	if err != nil {
		return RemoteImages{}, err
	}
	return RemoteImages{Status: StatusOK, Items: items}, nil
}

// RemoveImage removes an image from a connected server.
func (s *Service) RemoveImage(ctx context.Context, id, imageID string) error {
	if err := validID(imageID); err != nil {
		return err
	}
	conn, err := s.remoteConn(id)
	if err != nil {
		return err
	}
	res, err := runScript(ctx, conn, "docker rmi "+shQuote(imageID), actionTimeout)
	if err != nil {
		return err
	}
	if res.ExitCode != 0 {
		return errors.New(imageRemoveMessage(res.Stderr))
	}
	return nil
}

// ---- Container logs ----

func tailArg(tail int) string {
	if tail <= 0 {
		return "all"
	}
	return strconv.Itoa(tail)
}

// inspectRunning reports whether the container is running. found is false when
// it doesn't exist; err is for anything else (Docker missing, denied...).
func inspectRunning(ctx context.Context, conn *Conn, containerID string) (running, found bool, err error) {
	res, err := runScript(ctx, conn, `docker inspect --format "{{.State.Running}}" `+shQuote(containerID), inspectTimout)
	if err != nil {
		return false, false, err
	}
	if res.ExitCode != 0 {
		if strings.Contains(strings.ToLower(res.Stderr), "no such") {
			return false, false, nil
		}
		if _, msg, ok := dockerProblem(res, conn.User); ok {
			return false, false, errors.New(msg)
		}
		return false, false, failure(res, "falha ao ler o container")
	}
	return strings.TrimSpace(res.Stdout) == "true", true, nil
}

// StartLogs streams a container's logs to the UI as events
// ("logs:batch:<session>", "logs:end:<session>"), the same as local
// containers. The frontend picks the session and subscribes before calling.
func (s *Service) StartLogs(ctx context.Context, id, session, containerID string, tail int) error {
	if session == "" || len(session) > 100 {
		return errors.New("sessão de logs inválida")
	}
	if err := validID(containerID); err != nil {
		return err
	}
	conn, err := s.remoteConn(id)
	if err != nil {
		return err
	}
	if _, found, err := inspectRunning(ctx, conn, containerID); err != nil {
		return err
	} else if !found {
		return errors.New("container não encontrado — talvez já tenha sido removido")
	}

	lctx, cancel := context.WithCancel(ctx)
	s.mu.Lock()
	if s.logs == nil {
		s.logs = map[string]context.CancelFunc{}
	}
	if old := s.logs[session]; old != nil {
		old()
	}
	s.logs[session] = cancel
	s.mu.Unlock()

	cmd := fmt.Sprintf("docker logs -f --timestamps --tail %s %s", tailArg(tail), shQuote(containerID))
	go func() {
		defer cancel()
		sink := docker.NewLogSink(func(lines []docker.LogLine) {
			s.emit("logs:batch:"+session, lines)
		})
		code, err := streamScript(lctx, conn, cmd, sink.Stdout(), sink.Stderr())
		sink.Close()

		s.mu.Lock()
		if s.logs[session] != nil {
			delete(s.logs, session)
		}
		s.mu.Unlock()
		if lctx.Err() != nil {
			return // stopped by StopLogs or the app closing
		}
		s.emit("logs:end:"+session, logsEnd(ctx, conn, containerID, code, err))
	}()
	return nil
}

// logsEnd explains why a log stream finished, like the local streams do.
func logsEnd(ctx context.Context, conn *Conn, containerID string, code int, streamErr error) docker.LogsEnd {
	select {
	case <-conn.Done():
		return docker.LogsEnd{Reason: "error", Message: "a conexão com o servidor foi encerrada"}
	default:
	}
	running, found, err := inspectRunning(ctx, conn, containerID)
	switch {
	case err == nil && !found:
		return docker.LogsEnd{Reason: "removed", Message: "container removido"}
	case err == nil && !running:
		return docker.LogsEnd{Reason: "stopped", Message: "container parado"}
	case streamErr != nil || code != 0:
		return docker.LogsEnd{Reason: "error", Message: "a conexão com os logs foi interrompida"}
	}
	return docker.LogsEnd{Reason: "stopped", Message: "container parado"}
}

// StopLogs ends the stream of a session.
func (s *Service) StopLogs(session string) {
	s.mu.Lock()
	cancel := s.logs[session]
	delete(s.logs, session)
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

// LoadOlderLogs returns up to count lines strictly older than beforeTs
// (oldest first) and whether more exist, like the local one-shot read.
func (s *Service) LoadOlderLogs(ctx context.Context, id, containerID, beforeTs string, count int) (docker.OlderLogs, error) {
	if err := validID(containerID); err != nil {
		return docker.OlderLogs{}, err
	}
	before, err := time.Parse(time.RFC3339Nano, beforeTs)
	if err != nil {
		return docker.OlderLogs{}, errors.New("marca de tempo inválida")
	}
	conn, err := s.remoteConn(id)
	if err != nil {
		return docker.OlderLogs{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, olderTimeout)
	defer cancel()

	collector := docker.NewOlderCollector(before, count)
	out := docker.NewLineAssembler("stdout", collector.Add)
	errOut := docker.NewLineAssembler("stderr", collector.Add)
	cmd := fmt.Sprintf("docker logs --timestamps --until %s %s", shQuote(before.UTC().Format(time.RFC3339Nano)), shQuote(containerID))
	code, err := streamScript(ctx, conn, cmd, out, errOut)
	out.Flush()
	errOut.Flush()
	if err != nil || code != 0 {
		return docker.OlderLogs{}, errors.New("falha ao ler os logs do container")
	}
	lines, more := collector.Result()
	return docker.OlderLogs{Lines: lines, HasMore: more}, nil
}
