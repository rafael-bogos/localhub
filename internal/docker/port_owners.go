package docker

import (
	"context"
	"fmt"

	"github.com/moby/moby/client"
)

// PortOwner ties a published host port to the running container behind it.
type PortOwner struct {
	Protocol      string `json:"protocol"`
	Port          uint32 `json:"port"`
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
}

// ListPortOwners returns, for every host port published by a running
// container, which container owns it. A port published on both IPv4 and IPv6
// appears once.
func ListPortOwners(ctx context.Context) ([]PortOwner, error) {
	cli, err := newClient(ctx)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	// Without All, the daemon lists only running containers.
	list, err := cli.ContainerList(ctx, client.ContainerListOptions{})
	if err != nil {
		return nil, fmt.Errorf("falha ao listar containers")
	}

	seen := map[string]bool{}
	owners := []PortOwner{}
	for _, c := range list.Items {
		for _, p := range c.Ports {
			if p.PublicPort == 0 {
				continue
			}
			key := fmt.Sprintf("%s:%d", p.Type, p.PublicPort)
			if seen[key] {
				continue
			}
			seen[key] = true
			owners = append(owners, PortOwner{
				Protocol:      p.Type,
				Port:          uint32(p.PublicPort),
				ContainerID:   c.ID,
				ContainerName: trimName(c.Names),
			})
		}
	}
	return owners, nil
}
