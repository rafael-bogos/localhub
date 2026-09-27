package docker

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/client"
)

// ListImages returns every local image, most recently created first.
func ListImages(ctx context.Context) ([]ImageInfo, error) {
	cli, err := newClient(ctx)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	result, err := cli.ImageList(ctx, client.ImageListOptions{All: false})
	if err != nil {
		return nil, fmt.Errorf("falha ao listar imagens")
	}

	images := make([]ImageInfo, 0, len(result.Items))
	for _, img := range result.Items {
		repo, tag := repoAndTag(img.RepoTags)
		images = append(images, ImageInfo{
			ID:         shortID(img.ID),
			Repository: repo,
			Tag:        tag,
			Size:       formatSize(img.Size),
			Created:    time.Unix(img.Created, 0).Format("2006-01-02 15:04"),
		})
	}

	sort.SliceStable(images, func(i, j int) bool {
		return images[i].Created > images[j].Created
	})

	return images, nil
}

func repoAndTag(repoTags []string) (repo string, tag string) {
	if len(repoTags) == 0 || repoTags[0] == "<none>:<none>" {
		return "<none>", "<none>"
	}
	parts := strings.SplitN(repoTags[0], ":", 2)
	if len(parts) == 1 {
		return parts[0], "latest"
	}
	return parts[0], parts[1]
}

func shortID(id string) string {
	id = strings.TrimPrefix(id, "sha256:")
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

func formatSize(bytes int64) string {
	const unit = 1024
	if bytes < unit {
		return fmt.Sprintf("%dB", bytes)
	}
	div, exp := int64(unit), 0
	for n := bytes / unit; n >= unit && exp < 5; n /= unit {
		div *= unit
		exp++
	}
	formatted := strings.TrimSuffix(fmt.Sprintf("%.1f", float64(bytes)/float64(div)), ".0")
	return fmt.Sprintf("%s%cB", formatted, "KMGTPE"[exp])
}

// RemoveImage removes a local image.
func RemoveImage(ctx context.Context, id string) error {
	cli, err := newClient(ctx)
	if err != nil {
		return err
	}
	defer cli.Close()

	if _, err := cli.ImageRemove(ctx, id, client.ImageRemoveOptions{PruneChildren: true}); err != nil {
		switch {
		case cerrdefs.IsConflict(err):
			return fmt.Errorf("essa imagem está em uso por um container")
		case cerrdefs.IsNotFound(err):
			return fmt.Errorf("imagem não encontrada")
		default:
			return fmt.Errorf("falha ao remover a imagem")
		}
	}
	return nil
}

// PruneImages removes dangling (untagged) images and reports how many were
// removed and how much space was reclaimed.
func PruneImages(ctx context.Context) (PruneResult, error) {
	cli, err := newClient(ctx)
	if err != nil {
		return PruneResult{}, err
	}
	defer cli.Close()

	filters := make(client.Filters).Add("dangling", "true")
	result, err := cli.ImagePrune(ctx, client.ImagePruneOptions{Filters: filters})
	if err != nil {
		return PruneResult{}, fmt.Errorf("falha ao limpar imagens não usadas")
	}

	return PruneResult{
		Count:   len(result.Report.ImagesDeleted),
		SpaceMB: int64(result.Report.SpaceReclaimed) / (1024 * 1024),
	}, nil
}
