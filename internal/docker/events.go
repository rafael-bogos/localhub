package docker

import (
	"context"
	"strconv"
	"time"

	"github.com/moby/moby/client"
)

// StopEvent is a container that stopped running: the daemon's "die" event.
type StopEvent struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Image    string `json:"image"`
	ExitCode int    `json:"exitCode"`
}

// NewStopEvent builds a StopEvent from the attributes of a "die" event, which
// carry the container's name, image and exit code.
func NewStopEvent(id string, attrs map[string]string) StopEvent {
	code, _ := strconv.Atoi(attrs["exitCode"])
	return StopEvent{ID: id, Name: attrs["name"], Image: attrs["image"], ExitCode: code}
}

const (
	retryMin = 3 * time.Second
	retryMax = 30 * time.Second
)

// WatchStops reports every local container that stops, until ctx ends. A
// Docker daemon that is off or goes away is not an error: the watcher keeps
// retrying with a growing delay and resumes when the daemon is back, so
// containers stopping while Docker was unreachable are not reported (there is
// nothing to read them from).
func WatchStops(ctx context.Context, onStop func(StopEvent)) {
	delay := retryMin
	for ctx.Err() == nil {
		if watchOnce(ctx, onStop) {
			delay = retryMin
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		if delay *= 2; delay > retryMax {
			delay = retryMax
		}
	}
}

// watchOnce streams events until the stream breaks. It reports whether the
// stream was established, which resets the retry delay.
func watchOnce(ctx context.Context, onStop func(StopEvent)) bool {
	cli, err := newClient(ctx)
	if err != nil {
		return false
	}
	defer cli.Close()

	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	res := cli.Events(streamCtx, client.EventsListOptions{
		Filters: make(client.Filters).Add("type", "container").Add("event", "die"),
	})
	for {
		select {
		case msg := <-res.Messages:
			onStop(NewStopEvent(msg.Actor.ID, msg.Actor.Attributes))
		case <-res.Err:
			return true
		case <-ctx.Done():
			return true
		}
	}
}
