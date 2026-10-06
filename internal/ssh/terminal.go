package ssh

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
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
	session string
	sess    *gossh.Session
	stdin   io.WriteCloser
	once    sync.Once
	// ended is set once the stream finished; an ended terminal no longer
	// occupies the single terminal slot.
	ended atomic.Bool
	// flow holds the reader back when the UI falls behind.
	flow *flowControl
}

func (t *terminal) close() {
	t.once.Do(func() {
		if t.flow != nil {
			t.flow.close()
		}
		t.stdin.Close()
		t.sess.Close()
	})
}

// openTerminal starts a PTY on conn running command (the login shell when it
// is empty) and streams its output through
// emit as "ssh:data:<session>" events (base64, because the terminal needs raw
// bytes). It returns once the shell is running; the stream ends with a
// single "ssh:end:<session>" event. Events are keyed by a session the caller
// picks (not by server), so a late event of a closed terminal can never be
// mistaken for the one that replaced it.
func openTerminal(conn *Conn, emit Emit, session, command string, cols, rows int, onEnd func(*terminal)) (*terminal, error) {
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
	start := sess.Shell
	if command != "" {
		start = func() error { return sess.Start(command) }
	}
	if err := start(); err != nil {
		sess.Close()
		return nil, fmt.Errorf("o servidor recusou o terminal: %w", err)
	}

	t := &terminal{session: session, sess: sess, stdin: stdin, flow: newFlowControl()}
	dataEvent, endEvent := "ssh:data:"+session, "ssh:end:"+session

	chunks := make(chan []byte, 64)
	go func() { // reader
		defer close(chunks)
		buf := make([]byte, 32*1024)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				t.flow.sent(n)
				chunks <- append([]byte(nil), buf[:n]...)
			}
			if err != nil {
				return
			}
			t.flow.wait(conn.Done()) // pause here while the UI is behind
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
		t.ended.Store(true)
		onEnd(t)
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

// ack tells the flow control that the UI processed n bytes of output.
func (t *terminal) ack(n int) { t.flow.ack(n) }
