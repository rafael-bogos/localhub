package docker

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

// statsConcurrency caps how many containers are sampled at once.
const statsConcurrency = 16

// statsTimeout bounds one whole sampling round. Each container's sample
// takes ~1s (the daemon waits a second to get a CPU delta), and they run in
// parallel, so a healthy round finishes in about that long.
const statsTimeout = 8 * time.Second

// ListContainerStats samples CPU and memory for every running container.
// Containers whose sample fails (e.g. one that just stopped) are skipped
// rather than failing the whole call.
func ListContainerStats(ctx context.Context) ([]ContainerStats, error) {
	cli, err := newClient(ctx)
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	ctx, cancel := context.WithTimeout(ctx, statsTimeout)
	defer cancel()

	// Without All, the daemon lists only running containers.
	list, err := cli.ContainerList(ctx, client.ContainerListOptions{})
	if err != nil {
		return nil, err
	}

	var (
		mu     sync.Mutex
		wg     sync.WaitGroup
		sem    = make(chan struct{}, statsConcurrency)
		result = make([]ContainerStats, 0, len(list.Items))
	)
	for _, c := range list.Items {
		wg.Add(1)
		sem <- struct{}{}
		go func(id string) {
			defer wg.Done()
			defer func() { <-sem }()

			s, err := sampleStats(ctx, cli, id)
			if err != nil {
				return
			}
			mu.Lock()
			result = append(result, s)
			mu.Unlock()
		}(c.ID)
	}
	wg.Wait()

	return result, nil
}

func sampleStats(ctx context.Context, cli *client.Client, id string) (ContainerStats, error) {
	res, err := cli.ContainerStats(ctx, id, client.ContainerStatsOptions{IncludePreviousSample: true})
	if err != nil {
		return ContainerStats{}, err
	}
	defer res.Body.Close()

	var raw container.StatsResponse
	if err := json.NewDecoder(res.Body).Decode(&raw); err != nil {
		return ContainerStats{}, err
	}

	usage := memoryUsage(raw.MemoryStats)
	limit := raw.MemoryStats.Limit
	var memPercent float64
	if limit > 0 {
		memPercent = float64(usage) / float64(limit) * 100
	}

	return ContainerStats{
		ID:         id,
		CPUPercent: cpuPercent(raw),
		MemUsage:   usage,
		MemLimit:   limit,
		MemPercent: memPercent,
	}, nil
}

// cpuPercent follows `docker stats`: the container's CPU time delta over the
// system's, scaled by the number of CPUs, so 100% is one full core.
func cpuPercent(s container.StatsResponse) float64 {
	cpuDelta := float64(s.CPUStats.CPUUsage.TotalUsage) - float64(s.PreCPUStats.CPUUsage.TotalUsage)
	sysDelta := float64(s.CPUStats.SystemUsage) - float64(s.PreCPUStats.SystemUsage)
	if cpuDelta <= 0 || sysDelta <= 0 {
		return 0
	}

	cpus := float64(s.CPUStats.OnlineCPUs)
	if cpus == 0 {
		cpus = float64(len(s.CPUStats.CPUUsage.PercpuUsage))
	}
	if cpus == 0 {
		cpus = 1
	}

	return cpuDelta / sysDelta * cpus * 100
}

// memoryUsage is the container's usage without reclaimable page cache, the
// same figure `docker stats` reports (cgroup v2 calls the cache counter
// "inactive_file", v1 calls it "total_inactive_file").
func memoryUsage(m container.MemoryStats) uint64 {
	cache, ok := m.Stats["inactive_file"]
	if !ok {
		cache = m.Stats["total_inactive_file"]
	}
	if cache < m.Usage {
		return m.Usage - cache
	}
	return m.Usage
}
