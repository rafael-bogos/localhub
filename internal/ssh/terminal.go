package ssh

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

const (
	// termFlushInterval and termFlushBytes bound how long output waits before
	// reaching the UI; chunks travel in batches so a chatty command (cat of a
	// big file) does not saturate the Wails event bridge.
	termFlushInterval = 16 * time.Millisecond
	termFlushBytes    = 64 * 1024
)

// TerminalEnd is the payload of the "ssh:end:<id>" event.
type TerminalEnd struct {
	// Reason is "exited" (the shell ended), "disconnected" (the connection
	// dropped) or "error".
	Reason  string `json:"reason"`
	Message string `json:"message"`
}

// terminal is one interactive shell on a connection.
type terminal struct {
	sess  *gossh.Session
	stdin io.WriteCloser
	once  sync.Once
}

func (t *terminal) close() {
	t.once.Do(func() {
		t.stdin.Close()
		t.sess.Close()
	})
}

// openTerminal starts a PTY shell on conn and streams its output through
// emit as "ssh:data:<id>" events (base64, because the terminal needs raw
// bytes). It returns once the shell is running; the stream ends with a
// single "ssh:end:<id>" event.
func openTerminal(conn *Conn, emit Emit, cols, rows int, onEnd func()) (*terminal, error) {
	sess, err := conn.Client.NewSession()
	if err != nil {
		return nil, fmt.Errorf("não foi possível abrir a sessão: %w", err)
	}

	modes := gossh.TerminalModes{
		gossh.ECHO:          1,
		gossh.TTY_OP_ISPEED: 38400,
		gossh.TTY_OP_OSPEED: 38400,
	}
	if err := sess.RequestPty("xterm-256color", clampDim(rows, 24), clampDim(cols, 80), modes); err != nil {
		sess.Close()
		return nil, fmt.Errorf("o servidor recusou o terminal: %w", err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		return nil, err
	}
	if err := sess.Shell(); err != nil {
		sess.Close()
		return nil, fmt.Errorf("o servidor recusou o shell: %w", err)
	}

	t := &terminal{sess: sess, stdin: stdin}
	dataEvent, endEvent := "ssh:data:"+conn.ID, "ssh:end:"+conn.ID

	chunks := make(chan []byte, 64)
	go func() { // reader
		defer close(chunks)
		buf := make([]byte, 32*1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				chunks <- append([]byte(nil), buf[:n]...)
			}
			if err != nil {
				return
			}
		}
	}()

	go func() { // batcher + end
		var pending []byte
		tick := time.NewTicker(termFlushInterval)
		defer tick.Stop()
		flush := func() {
			if len(pending) > 0 {
				emit(dataEvent, base64.StdEncoding.EncodeToString(pending))
				pending = pending[:0]
			}
		}
	loop:
		for {
			select {
			case c, ok := <-chunks:
				if !ok {
					break loop
				}
				pending = append(pending, c...)
				if len(pending) >= termFlushBytes {
					flush()
				}
			case <-tick.C:
				flush()
			}
		}
		flush()

		end := TerminalEnd{Reason: "exited"}
		select {
		case <-conn.Done():
			end = TerminalEnd{Reason: "disconnected", Message: "a conexão com o servidor foi encerrada"}
		default:
			if err := sess.Wait(); err != nil {
				var exit *gossh.ExitError
				if !errors.As(err, &exit) && !errors.Is(err, io.EOF) {
					end = TerminalEnd{Reason: "error", Message: err.Error()}
				}
			}
		}
		t.close()
		onEnd()
		emit(endEvent, end)
	}()

	return t, nil
}

func (t *terminal) write(data string) error {
	_, err := io.WriteString(t.stdin, data)
	return err
}

func (t *terminal) resize(cols, rows int) error {
	return t.sess.WindowChange(clampDim(rows, 24), clampDim(cols, 80))
}

func clampDim(v, def int) int {
	if v < 1 {
		return def
	}
	if v > 1000 {
		return 1000
	}
	return v
}
