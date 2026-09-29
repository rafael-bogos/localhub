package docker

import (
	"context"
	"fmt"
	"time"

	"github.com/moby/moby/client"
)

const pingTimeout = 3 * time.Second

// newClient connects to the local Docker daemon and verifies it responds
// before handing the client back, so every caller fails fast with a clear
// Portuguese message instead of a raw SDK error deep in a list/remove call.
func newClient(ctx context.Context) (*client.Client, error) {
	cli, err := client.New(client.FromEnv)
	if err != nil {
		return nil, fmt.Errorf("não foi possível iniciar o cliente Docker")
	}

	pingCtx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()

	if _, err := cli.Ping(pingCtx, client.PingOptions{}); err != nil {
		cli.Close()
		return nil, fmt.Errorf("não foi possível conectar ao Docker — verifique se o Docker Desktop ou o daemon estão em execução")
	}

	return cli, nil
}
