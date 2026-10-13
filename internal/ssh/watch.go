package ssh

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"time"

	"localhub/internal/docker"
)

// StopEvent is a container that stopped on a connected server.
type StopEvent struct {
	HostID   string `json:"hostId"`
	HostName string `json:"hostName"`
	docker.StopEvent
}

const (
	watchRetryMin = 5 * time.Second
	watchRetryMax = 60 * time.Second
)

// eventsCommand streams the "die" events of the server's containers as one JSON
// object per line. Attributes hold the container's name, image and exit code.
const eventsCommand = `docker events --filter type=container --filter event=die --format "{{json .}}"`

type dieEvent struct {
	Actor struct {
		ID         string            `json:"ID"`
		Attributes map[string]string `json:"Attributes"`
	} `json:"Actor"`
}

// WatchStops reports containers that stop on one connected server until the
// connection ends. If Docker is missing or not reachable on the server the
// command exits at once and nothing is reported: the data tabs already explain
// that situation.
func (s *Service) WatchStops(conn *Conn, hostName string, onStop func(StopEvent)) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		<-conn.Done()
		cancel()
	}()
	go func() {
		defer cancel()
		pr, pw := io.Pipe()
		defer pw.Close()
		go func() {
			sc := bufio.NewScanner(pr)
			sc.Buffer(make([]byte, 64<<10), 1<<20)
			for sc.Scan() {
				var ev dieEvent
				if json.Unmarshal(sc.Bytes(), &ev) != nil || ev.Actor.ID == "" {
					continue
				}
				onStop(StopEvent{
					HostID:    conn.ID,
					HostName:  hostName,
					StopEvent: docker.NewStopEvent(ev.Actor.ID, ev.Actor.Attributes),
				})
			}
		}()
		// The Docker daemon of the server may restart while the SSH connection
		// stays up, so the stream is reopened with a growing delay.
		delay := watchRetryMin
		for ctx.Err() == nil {
			started := time.Now()
			streamScript(ctx, conn, eventsCommand, pw, io.Discard)
			if time.Since(started) > watchRetryMax {
				delay = watchRetryMin
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(delay):
			}
			if delay *= 2; delay > watchRetryMax {
				delay = watchRetryMax
			}
		}
	}()
}
