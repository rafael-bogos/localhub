package docker

import (
	"context"
	"fmt"
	"sort"
	"strings"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// ListContainers returns every container (running and stopped), with running
// containers first.
func ListContainers(ctx context.Context) ([]ContainerInfo, error) {
	cli, err := newClient(ctx)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	result, err := cli.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("falha ao listar containers")
	}

	containers := make([]ContainerInfo, 0, len(result.Items))
	for _, c := range result.Items {
		containers = append(containers, ContainerInfo{
			ID:     c.ID,
			Name:   strings.TrimPrefix(firstOrEmpty(c.Names), "/"),
			Image:  c.Image,
			Status: c.Status,
			State:  string(c.State),
			Ports:  formatPorts(c.Ports),
		})
	}

	sort.SliceStable(containers, func(i, j int) bool {
		iRunning := containers[i].State == string(container.StateRunning)
		jRunning := containers[j].State == string(container.StateRunning)
		if iRunning != jRunning {
			return iRunning
		}
		return containers[i].Name < containers[j].Name
	})

	return containers, nil
}

func firstOrEmpty(names []string) string {
	if len(names) == 0 {
		return ""
	}
	return names[0]
}

// formatPorts lists each published port once. The Docker API reports a
// separate entry per host IP (0.0.0.0 and [::]), which would otherwise show
// the same "33067->3306/tcp" twice.
func formatPorts(ports []container.PortSummary) string {
	if len(ports) == 0 {
		return ""
	}
	seen := make(map[string]bool, len(ports))
	parts := make([]string, 0, len(ports))
	for _, p := range ports {
		var label string
		if p.PublicPort > 0 {
			label = fmt.Sprintf("%d->%d/%s", p.PublicPort, p.PrivatePort, p.Type)
		} else {
			label = fmt.Sprintf("%d/%s", p.PrivatePort, p.Type)
		}
		if seen[label] {
			continue
		}
		seen[label] = true
		parts = append(parts, label)
	}
	return strings.Join(parts, ", ")
}

// StartContainer starts a stopped container.
func StartContainer(ctx context.Context, id string) error {
	cli, err := newClient(ctx)
	if err != nil {
		return err
	}
	defer cli.Close()

	if _, err := cli.ContainerStart(ctx, id, client.ContainerStartOptions{}); err != nil {
		return fmt.Errorf("falha ao iniciar o container")
	}
	return nil
}

// StopContainer stops a running container, giving it time to shut down
// gracefully before the daemon forces it.
func StopContainer(ctx context.Context, id string) error {
	cli, err := newClient(ctx)
	if err != nil {
		return err
	}
	defer cli.Close()

	if _, err := cli.ContainerStop(ctx, id, client.ContainerStopOptions{}); err != nil {
		return fmt.Errorf("falha ao parar o container")
	}
	return nil
}

// RestartContainer stops and starts a container again.
func RestartContainer(ctx context.Context, id string) error {
	cli, err := newClient(ctx)
	if err != nil {
		return err
	}
	defer cli.Close()

	if _, err := cli.ContainerRestart(ctx, id, client.ContainerRestartOptions{}); err != nil {
		return fmt.Errorf("falha ao reiniciar o container")
	}
	return nil
}

// RemoveContainer removes a stopped container. It refuses to remove a
// container that is still running rather than forcing its termination —
// the UI is expected to disable the action first, but the backend holds the
// same line if it is ever called anyway.
func RemoveContainer(ctx context.Context, id string) error {
	cli, err := newClient(ctx)
	if err != nil {
		return err
	}
	defer cli.Close()

	if _, err := cli.ContainerRemove(ctx, id, client.ContainerRemoveOptions{}); err != nil {
		switch {
		case cerrdefs.IsConflict(err):
			return fmt.Errorf("pare o container antes de removê-lo")
		case cerrdefs.IsNotFound(err):
			return fmt.Errorf("container não encontrado")
		default:
			return fmt.Errorf("falha ao remover o container")
		}
	}
	return nil
}
