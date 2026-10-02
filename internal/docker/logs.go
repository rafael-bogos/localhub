package docker

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/pkg/stdcopy"
	"github.com/moby/moby/client"
)

const (
	// logFlushInterval and logFlushLines bound how long a line waits before
	// reaching the UI. Lines travel in batches: one Wails event per line
	// would saturate the bridge on a chatty container.
	logFlushInterval = 100 * time.Millisecond
	logFlushLines    = 200
)

// Emit publishes an event to the UI (the app wires it to the Wails runtime).
type Emit func(event string, data any)

// LogsEnd is the payload of the "logs:end:<session>" event.
type LogsEnd struct {
	// Reason is "stopped" (stream ended, container not running), "removed"
	// (container is gone) or "error".
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

var (
	logsMu      sync.Mutex
	logsCancel  context.CancelFunc
	logsSession string
)

// StartLogs streams the logs of a container to the UI as events, replacing
// any stream already open. The caller picks sessionID and subscribes to the
// events *before* calling, so no early batch is lost.
//
// Events: "logs:batch:<sessionID>" ([]LogLine) and "logs:end:<sessionID>"
// (LogsEnd).
func StartLogs(ctx context.Context, sessionID, containerID string, tail int, emit Emit) error {
	StopLogs(logsSessionID())

	cli, err := newClient(ctx)
	if err != nil {
		return err
	}

	tty, err := containerHasTTY(ctx, cli, containerID)
	if err != nil {
		cli.Close()
		return err
	}

	sctx, cancel := context.WithCancel(ctx)
	body, err := cli.ContainerLogs(sctx, containerID, client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Timestamps: true,
		Tail:       tailArg(tail),
	})
	if err != nil {
		cancel()
		cli.Close()
		return fmt.Errorf("falha ao abrir os logs do container")
	}

	logsMu.Lock()
	logsCancel, logsSession = cancel, sessionID
	logsMu.Unlock()

	go func() {
		defer cli.Close()
		defer body.Close()
		defer cancel()

		batcher := newLogBatcher(func(lines []LogLine) {
			emit("logs:batch:"+sessionID, lines)
		})
		out := newLineAssembler("stdout", batcher.add)
		errOut := newLineAssembler("stderr", batcher.add)

		readErr := copyLogs(body, out, errOut, tty)
		out.Flush()
		errOut.Flush()
		batcher.close()

		if sctx.Err() != nil {
			return // stopped by StopLogs or the app closing
		}

		emit("logs:end:"+sessionID, endReason(ctx, cli, containerID, readErr))
		clearSession(sessionID)
	}()

	return nil
}

// StopLogs closes the stream of the given session, if it is the active one.
func StopLogs(sessionID string) {
	logsMu.Lock()
	defer logsMu.Unlock()
	if logsCancel != nil && logsSession == sessionID {
		logsCancel()
		logsCancel, logsSession = nil, ""
	}
}

func logsSessionID() string {
	logsMu.Lock()
	defer logsMu.Unlock()
	return logsSession
}

func clearSession(sessionID string) {
	logsMu.Lock()
	defer logsMu.Unlock()
	if logsSession == sessionID {
		logsCancel, logsSession = nil, ""
	}
}

// copyLogs reads the Docker log stream into the two assemblers. Containers
// with a TTY send raw output (stdout only); the rest multiplex stdout and
// stderr and need demuxing.
func copyLogs(body io.Reader, out, errOut io.Writer, tty bool) error {
	if tty {
		_, err := io.Copy(out, body)
		return err
	}
	_, err := stdcopy.StdCopy(out, errOut, body)
	return err
}

func containerHasTTY(ctx context.Context, cli *client.Client, id string) (bool, error) {
	res, err := cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil {
		if cerrdefs.IsNotFound(err) {
			return false, fmt.Errorf("container não encontrado — talvez já tenha sido removido")
		}
		return false, fmt.Errorf("falha ao ler o container")
	}
	return res.Container.Config != nil && res.Container.Config.Tty, nil
}

func endReason(ctx context.Context, cli *client.Client, id string, readErr error) LogsEnd {
	res, err := cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	if err != nil && cerrdefs.IsNotFound(err) {
		return LogsEnd{Reason: "removed", Message: "container removido"}
	}
	if readErr != nil && readErr != io.EOF && !(err == nil && !res.Container.State.Running) {
		return LogsEnd{Reason: "error", Message: "a conexão com os logs foi interrompida"}
	}
	return LogsEnd{Reason: "stopped", Message: "container parado"}
}

func tailArg(tail int) string {
	if tail <= 0 {
		return "all"
	}
	return fmt.Sprintf("%d", tail)
}

// logBatcher groups lines and flushes them every logFlushInterval or
// logFlushLines lines, whichever comes first.
type logBatcher struct {
	mu      sync.Mutex // guards lines
	flushMu sync.Mutex // serializes flush so batches reach the UI in order
	lines   []LogLine
	flush   func([]LogLine)
	stop    chan struct{}
	done    chan struct{}
}

func newLogBatcher(flush func([]LogLine)) *logBatcher {
	b := &logBatcher{flush: flush, stop: make(chan struct{}), done: make(chan struct{})}
	go func() {
		defer close(b.done)
		t := time.NewTicker(logFlushInterval)
		defer t.Stop()
		for {
			select {
			case <-t.C:
				b.drain()
			case <-b.stop:
				return
			}
		}
	}()
	return b
}

func (b *logBatcher) add(l LogLine) {
	b.mu.Lock()
	b.lines = append(b.lines, l)
	full := len(b.lines) >= logFlushLines
	b.mu.Unlock()
	if full {
		b.drain()
	}
}

func (b *logBatcher) drain() {
	b.flushMu.Lock()
	defer b.flushMu.Unlock()

	b.mu.Lock()
	lines := b.lines
	b.lines = nil
	b.mu.Unlock()
	if len(lines) > 0 {
		b.flush(lines)
	}
}

// close stops the ticker and sends whatever is still pending.
func (b *logBatcher) close() {
	close(b.stop)
	<-b.done
	b.drain()
}

// trimName is shared by the port-owner lookup.
func trimName(names []string) string {
	return RealName(names)
}

// LoadOlderLogs returns up to count lines strictly older than beforeTs
// (oldest first), and whether more exist before them. It is a one-shot read,
// not a stream.
//
// Tail can't be combined with Until: the daemon applies Tail to the end of
// the whole log first and only then filters by Until, so paging back would
// come up empty. Instead the log is read up to the boundary and only the last
// count lines are kept.
func LoadOlderLogs(ctx context.Context, containerID, beforeTs string, count int) ([]LogLine, bool, error) {
	before, err := time.Parse(time.RFC3339Nano, beforeTs)
	if err != nil {
		return nil, false, fmt.Errorf("marca de tempo inválida")
	}
	if count <= 0 {
		count = 500
	}

	cli, err := newClient(ctx)
	if err != nil {
		return nil, false, err
	}
	defer cli.Close()

	tty, err := containerHasTTY(ctx, cli, containerID)
	if err != nil {
		return nil, false, err
	}

	body, err := cli.ContainerLogs(ctx, containerID, client.ContainerLogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Timestamps: true,
		Until:      beforeTs,
	})
	if err != nil {
		return nil, false, fmt.Errorf("falha ao ler os logs do container")
	}
	defer body.Close()

	collector := NewOlderCollector(before, count)
	out := newLineAssembler("stdout", collector.Add)
	errOut := newLineAssembler("stderr", collector.Add)
	if err := copyLogs(body, out, errOut, tty); err != nil && err != io.EOF {
		return nil, false, fmt.Errorf("falha ao ler os logs do container")
	}
	out.Flush()
	errOut.Flush()

	kept, more := collector.Result()
	return kept, more, nil
}
