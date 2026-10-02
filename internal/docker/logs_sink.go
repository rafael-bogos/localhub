package docker

import (
	"io"
	"time"
)

// LineAssembler turns raw stream chunks into complete log lines. Exported so
// other log sources (containers on a remote server) share the exact line
// handling of local logs: chunk-spanning lines, \r\n, ANSI stripping, the
// per-line size cap and timestamp splitting.
type LineAssembler = lineAssembler

// NewLineAssembler returns an assembler for the given stream ("stdout" or
// "stderr"). Call Flush when the stream ends.
func NewLineAssembler(stream string, emit func(LogLine)) *LineAssembler {
	return newLineAssembler(stream, emit)
}

// LogSink assembles a stdout/stderr pair into batched LogLine events, with
// the same batching as the local live stream.
type LogSink struct {
	batcher *logBatcher
	out     *lineAssembler
	err     *lineAssembler
}

// NewLogSink creates a sink that calls flush with each batch of lines.
func NewLogSink(flush func([]LogLine)) *LogSink {
	b := newLogBatcher(flush)
	return &LogSink{
		batcher: b,
		out:     newLineAssembler("stdout", b.add),
		err:     newLineAssembler("stderr", b.add),
	}
}

func (s *LogSink) Stdout() io.Writer { return s.out }
func (s *LogSink) Stderr() io.Writer { return s.err }

// Close emits any unterminated last line and sends the pending batch.
func (s *LogSink) Close() {
	s.out.Flush()
	s.err.Flush()
	s.batcher.close()
}

// OlderCollector gathers "the page of lines before a timestamp" out of a log
// read up to that boundary, keeping only the last count lines in memory.
type OlderCollector struct {
	before time.Time
	count  int
	kept   []LogLine
	total  int
}

// NewOlderCollector expects before to be the oldest timestamp the UI already
// shows; count <= 0 means the default page of 500.
func NewOlderCollector(before time.Time, count int) *OlderCollector {
	if count <= 0 {
		count = 500
	}
	return &OlderCollector{before: before, count: count}
}

// Add receives each line of the log, oldest first.
func (c *OlderCollector) Add(l LogLine) {
	// Until is inclusive: skip the boundary lines the UI already has.
	if t, err := time.Parse(time.RFC3339Nano, l.Ts); err == nil && !t.Before(c.before) {
		return
	}
	c.total++
	c.kept = append(c.kept, l)
	if len(c.kept) >= c.count*2 {
		c.kept = append(c.kept[:0], c.kept[len(c.kept)-c.count:]...)
	}
}

// Result returns the last count lines (oldest first) and whether more exist
// before them.
func (c *OlderCollector) Result() ([]LogLine, bool) {
	kept := c.kept
	if len(kept) > c.count {
		kept = kept[len(kept)-c.count:]
	}
	return kept, c.total > c.count
}
