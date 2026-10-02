package ssh

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	gossh "golang.org/x/crypto/ssh"
)

const (
	// maxOutput bounds what a one-shot command may return into memory.
	maxOutput = 8 << 20
	// streamGrace is how long a stopped stream waits for the remote side to
	// exit on its own before the channel is closed.
	streamGrace = 300 * time.Millisecond
)

// execResult is the outcome of a remote command that ran to completion.
type execResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

// capWriter buffers up to max bytes and drops the rest (still reporting
// success, so the remote command is drained rather than blocked).
type capWriter struct {
	buf  bytes.Buffer
	max  int
	over bool
}

func (w *capWriter) Write(p []byte) (int, error) {
	room := w.max - w.buf.Len()
	if room < len(p) {
		w.over = true
		if room > 0 {
			w.buf.Write(p[:room])
		}
		return len(p), nil
	}
	return w.buf.Write(p)
}

// wrapScript runs script under sh with a stable locale, whatever login shell
// the remote user has, so output parsing and error matching don't depend on
// the server's language.
func wrapScript(script string) string {
	return "sh -c " + shQuote("LC_ALL=C; export LC_ALL; "+script)
}

// runScript runs script on the server and returns its output. A non-zero exit
// status is not an error: it comes back in ExitCode. Errors are for transport
// problems and timeouts.
func runScript(ctx context.Context, conn *Conn, script string, timeout time.Duration) (execResult, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	sess, err := conn.Client.NewSession()
	if err != nil {
		return execResult{}, fmt.Errorf("não foi possível abrir um canal no servidor: %w", err)
	}
	defer sess.Close()

	out, errOut := &capWriter{max: maxOutput}, &capWriter{max: maxOutput}
	sess.Stdout, sess.Stderr = out, errOut
	if err := sess.Start(wrapScript(script)); err != nil {
		return execResult{}, fmt.Errorf("não foi possível executar o comando no servidor: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- sess.Wait() }()

	select {
	case err := <-done:
		res := execResult{Stdout: out.buf.String(), Stderr: errOut.buf.String()}
		var exit *gossh.ExitError
		switch {
		case err == nil:
		case errors.As(err, &exit):
			res.ExitCode = exit.ExitStatus()
		default:
			return execResult{}, fmt.Errorf("o comando no servidor foi interrompido: %w", err)
		}
		if out.over {
			return execResult{}, errors.New("a resposta do servidor é grande demais")
		}
		return res, nil
	case <-ctx.Done():
		sess.Close()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return execResult{}, errors.New("o servidor demorou demais para responder")
		}
		return execResult{}, ctx.Err()
	case <-conn.Done():
		return execResult{}, errors.New("a conexão com o servidor foi encerrada")
	}
}

// streamScript runs cmd (a single simple command) and copies its output to
// stdout/stderr as it arrives. When ctx ends, or the connection drops, the
// remote command is killed: it runs in the background of a small wrapper that
// waits for the channel's stdin to close, which is how the server tells us
// the client is gone (without a PTY a long-running command would otherwise
// keep running). It returns the command's exit code.
func streamScript(ctx context.Context, conn *Conn, cmd string, stdout, stderr io.Writer) (int, error) {
	sess, err := conn.Client.NewSession()
	if err != nil {
		return 0, fmt.Errorf("não foi possível abrir um canal no servidor: %w", err)
	}
	defer sess.Close()

	stdin, err := sess.StdinPipe()
	if err != nil {
		return 0, err
	}
	sess.Stdout, sess.Stderr = stdout, stderr

	// A background job's stdin is /dev/null in a non-interactive shell, so the
	// channel's stdin is first saved on fd 3, which that rule doesn't touch.
	script := "exec 3<&0; " + cmd + " 3<&- & p=$!; (cat <&3 >/dev/null; kill $p 2>/dev/null) & wait $p"
	if err := sess.Start(wrapScript(script)); err != nil {
		return 0, fmt.Errorf("não foi possível executar o comando no servidor: %w", err)
	}

	done := make(chan error, 1)
	go func() { done <- sess.Wait() }()

	var waitErr error
	select {
	case waitErr = <-done:
	case <-ctx.Done():
		stdin.Close() // lets the remote wrapper kill the command
		select {
		case <-done:
		case <-time.After(streamGrace):
			sess.Close()
			<-done
		}
		return 0, ctx.Err()
	}

	var exit *gossh.ExitError
	switch {
	case waitErr == nil:
		return 0, nil
	case errors.As(waitErr, &exit):
		return exit.ExitStatus(), nil
	default:
		return 0, waitErr
	}
}
