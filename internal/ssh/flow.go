package ssh

import (
	"sync"
	"time"
)

const (
	// flowHigh is how much terminal output may be in flight (sent to the UI
	// and not yet processed) before reading from the server pauses; reading
	// resumes once it falls to flowLow. Without a limit a program that prints
	// faster than the UI can draw (cat of a big file, `yes`, build logs) piles
	// output up in front of everything else, so a keystroke's echo and even
	// Ctrl+C take effect only after the whole backlog is chewed through.
	flowHigh = 256 << 10
	flowLow  = 64 << 10
	// flowStall is how long to wait for the UI to acknowledge before giving up
	// and carrying on (e.g. the page was reloaded and will never ack).
	flowStall = 5 * time.Second
)

// flowControl counts the bytes of a terminal's output that the UI has not
// acknowledged yet and holds the reader back while there are too many.
type flowControl struct {
	mu      sync.Mutex
	pending int
	closed  bool
	wake    chan struct{} // capacity 1: an ack or close happened
}

func newFlowControl() *flowControl {
	return &flowControl{wake: make(chan struct{}, 1)}
}

func (f *flowControl) signal() {
	select {
	case f.wake <- struct{}{}:
	default:
	}
}

// sent records n bytes handed to the UI.
func (f *flowControl) sent(n int) {
	f.mu.Lock()
	f.pending += n
	f.mu.Unlock()
}

// ack records that the UI processed n bytes.
func (f *flowControl) ack(n int) {
	f.mu.Lock()
	f.pending -= n
	if f.pending < 0 {
		f.pending = 0
	}
	f.mu.Unlock()
	f.signal()
}

func (f *flowControl) close() {
	f.mu.Lock()
	f.closed = true
	f.mu.Unlock()
	f.signal()
}

// wait blocks while too much output is unacknowledged. It returns as soon as
// the backlog is back under flowLow, the terminal is closed, the connection
// ends (connDone), or the UI has been silent for flowStall.
func (f *flowControl) wait(connDone <-chan struct{}) {
	f.mu.Lock()
	over := f.pending > flowHigh
	f.mu.Unlock()
	if !over {
		return
	}

	stall := time.NewTimer(flowStall)
	defer stall.Stop()
	for {
		f.mu.Lock()
		done := f.closed || f.pending <= flowLow
		f.mu.Unlock()
		if done {
			return
		}
		select {
		case <-f.wake:
			if !stall.Stop() {
				select {
				case <-stall.C:
				default:
				}
			}
			stall.Reset(flowStall) // progress was made: the UI is alive
		case <-connDone:
			return
		case <-stall.C:
			f.mu.Lock()
			f.pending = 0
			f.mu.Unlock()
			return
		}
	}
}
