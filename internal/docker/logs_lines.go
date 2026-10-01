package docker

import (
	"bytes"
	"regexp"
	"strings"
	"time"
)

// maxLogLine caps one log line. A container that prints megabytes without a
// newline would otherwise grow the buffer (and the event sent to the UI)
// without bound.
const maxLogLine = 64 * 1024

const truncatedSuffix = " … [linha truncada]"

// LogLine is one complete log line, ready for the UI.
type LogLine struct {
	// Ts is the RFC3339 timestamp Docker attached to the line ("" if absent).
	Ts string `json:"ts"`
	// Stream is "stdout" or "stderr".
	Stream string `json:"stream"`
	Text   string `json:"text"`
}

// ansiEscape matches CSI sequences (colors, cursor moves). Logs are shown as
// plain monochrome text, so they are stripped rather than rendered.
var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]`)

// lineAssembler turns the arbitrary chunks of one stream into complete lines.
// The Docker stream splits output at any byte, so a chunk may end mid-line;
// the tail waits in the buffer until its newline arrives.
type lineAssembler struct {
	stream   string
	emit     func(LogLine)
	buf      []byte
	skipping bool // dropping the rest of an over-long line, up to its newline
}

func newLineAssembler(stream string, emit func(LogLine)) *lineAssembler {
	return &lineAssembler{stream: stream, emit: emit}
}

// Write implements io.Writer so it can be a stdcopy destination.
func (a *lineAssembler) Write(p []byte) (int, error) {
	a.buf = append(a.buf, p...)

	for {
		i := bytes.IndexByte(a.buf, '\n')
		if i < 0 {
			break
		}
		line := a.buf[:i]
		a.buf = a.buf[i+1:]

		if a.skipping {
			a.skipping = false
			continue
		}
		a.emitLine(line, false)
	}

	if len(a.buf) > maxLogLine {
		if !a.skipping {
			a.emitLine(a.buf[:maxLogLine], true)
			a.skipping = true
		}
		a.buf = a.buf[:0]
	}

	// Copy so the slice doesn't pin an ever-larger backing array.
	if len(a.buf) == 0 {
		a.buf = nil
	}

	return len(p), nil
}

// Flush emits a trailing line that never got its newline (end of stream).
func (a *lineAssembler) Flush() {
	if len(a.buf) > 0 && !a.skipping {
		a.emitLine(a.buf, false)
	}
	a.buf = nil
	a.skipping = false
}

func (a *lineAssembler) emitLine(raw []byte, truncated bool) {
	ts, text := splitTimestamp(strings.TrimSuffix(string(raw), "\r"))
	text = ansiEscape.ReplaceAllString(text, "")
	text = strings.ToValidUTF8(text, "�")
	if truncated {
		text += truncatedSuffix
	}
	a.emit(LogLine{Ts: ts, Stream: a.stream, Text: text})
}

// splitTimestamp separates the RFC3339Nano prefix Docker adds when
// Timestamps is on. A line without a parseable prefix is returned whole.
func splitTimestamp(line string) (ts, text string) {
	i := strings.IndexByte(line, ' ')
	if i < 20 || i > 40 {
		return "", line
	}
	if _, err := time.Parse(time.RFC3339Nano, line[:i]); err != nil {
		return "", line
	}
	return line[:i], line[i+1:]
}
