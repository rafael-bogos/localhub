package docker

import (
	"context"
	"fmt"

	"github.com/moby/moby/client"
)

// CleanupOptions selects which categories to prune. Nothing is touched
// unless the caller explicitly asks for it — the user decides per run.
type CleanupOptions struct {
	Containers bool `json:"containers"`
	Images     bool `json:"images"`
	Networks   bool `json:"networks"`
	BuildCache bool `json:"buildCache"`
}

// CleanupResult reports how many resources were removed in each selected
// category and the total disk space reclaimed.
type CleanupResult struct {
	ContainersRemoved int   `json:"containersRemoved"`
	ImagesRemoved     int   `json:"imagesRemoved"`
	NetworksRemoved   int   `json:"networksRemoved"`
	BuildCacheRemoved int   `json:"buildCacheRemoved"`
	SpaceMB           int64 `json:"spaceMB"`
}

// Cleanup runs a selective "docker system prune": only the categories set to
// true in opts are touched. Order follows `docker system prune` itself —
// containers, then networks, then images, then build cache — so a container
// freed in this same run is already gone by the time images are judged
// unused. Volumes are intentionally never included: they hold persistent
// data (e.g. databases) and pruning them is out of scope.
func Cleanup(ctx context.Context, opts CleanupOptions) (CleanupResult, error) {
	cli, err := newClient(ctx)
	if err != nil {
		return CleanupResult{}, err
	}
	defer cli.Close()

	var result CleanupResult
	var spaceReclaimed uint64

	if opts.Containers {
		pruned, err := cli.ContainerPrune(ctx, client.ContainerPruneOptions{})
		if err != nil {
			return CleanupResult{}, fmt.Errorf("falha ao limpar containers parados")
		}
		result.ContainersRemoved = len(pruned.Report.ContainersDeleted)
		spaceReclaimed += pruned.Report.SpaceReclaimed
	}

	if opts.Networks {
		pruned, err := cli.NetworkPrune(ctx, client.NetworkPruneOptions{})
		if err != nil {
			return CleanupResult{}, fmt.Errorf("falha ao limpar redes não usadas")
		}
		result.NetworksRemoved = len(pruned.Report.NetworksDeleted)
	}

	if opts.Images {
		// dangling=false asks the daemon for every unused image, not only
		// the untagged <none>:<none> ones PruneImages already covers.
		filters := make(client.Filters).Add("dangling", "false")
		pruned, err := cli.ImagePrune(ctx, client.ImagePruneOptions{Filters: filters})
		if err != nil {
			return CleanupResult{}, fmt.Errorf("falha ao limpar imagens não usadas")
		}
		result.ImagesRemoved = len(pruned.Report.ImagesDeleted)
		spaceReclaimed += pruned.Report.SpaceReclaimed
	}

	if opts.BuildCache {
		pruned, err := cli.BuildCachePrune(ctx, client.BuildCachePruneOptions{})
		if err != nil {
			return CleanupResult{}, fmt.Errorf("falha ao limpar o cache de build")
		}
		result.BuildCacheRemoved = len(pruned.Report.CachesDeleted)
		spaceReclaimed += pruned.Report.SpaceReclaimed
	}

	result.SpaceMB = int64(spaceReclaimed) / (1024 * 1024)
	return result, nil
}
