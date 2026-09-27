package main

import (
	"context"

	"localhub/internal/docker"
	"localhub/internal/ports"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ListPorts returns the local ports currently in use, along with the
// process using each one.
func (a *App) ListPorts() ([]ports.PortInfo, error) {
	return ports.ListPorts()
}

// KillProcess terminates the process holding the given PID.
func (a *App) KillProcess(pid int32) error {
	return ports.KillProcess(pid)
}

// ListContainers returns every Docker container on the local daemon, running
// containers first.
func (a *App) ListContainers() ([]docker.ContainerInfo, error) {
	return docker.ListContainers(a.ctx)
}

// StartContainer starts a stopped container.
func (a *App) StartContainer(id string) error {
	return docker.StartContainer(a.ctx, id)
}

// StopContainer stops a running container.
func (a *App) StopContainer(id string) error {
	return docker.StopContainer(a.ctx, id)
}

// RestartContainer stops and starts a container again.
func (a *App) RestartContainer(id string) error {
	return docker.RestartContainer(a.ctx, id)
}

// RemoveContainer removes a stopped container.
func (a *App) RemoveContainer(id string) error {
	return docker.RemoveContainer(a.ctx, id)
}

// ListImages returns every local Docker image.
func (a *App) ListImages() ([]docker.ImageInfo, error) {
	return docker.ListImages(a.ctx)
}

// RemoveImage removes a local Docker image.
func (a *App) RemoveImage(id string) error {
	return docker.RemoveImage(a.ctx, id)
}

// PruneImages removes dangling (untagged) images and reports how many were
// removed and how much space was reclaimed.
func (a *App) PruneImages() (docker.PruneResult, error) {
	return docker.PruneImages(a.ctx)
}
