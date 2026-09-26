package main

import (
	"context"

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
