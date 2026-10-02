package docker

// ContainerInfo describes a Docker container for display in the UI.
type ContainerInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	State  string `json:"state"`
	Ports  string `json:"ports"`
	// Project and Service come from the Docker Compose labels; empty for
	// containers that weren't started by Compose.
	Project string `json:"project"`
	Service string `json:"service"`
	// Labels are all the container's labels. Platforms (Coolify, Dokku,
	// Portainer...) keep the readable name of an app there while the container
	// itself gets a generated name.
	Labels map[string]string `json:"labels"`
}

// ImageInfo describes a Docker image for display in the UI.
type ImageInfo struct {
	ID         string `json:"id"`
	Repository string `json:"repository"`
	Tag        string `json:"tag"`
	Size       string `json:"size"`
	Created    string `json:"created"`
}

// PruneResult reports the outcome of removing unused images.
type PruneResult struct {
	Count   int   `json:"count"`
	SpaceMB int64 `json:"spaceMB"`
}

// ContainerStats is one resource-usage sample for a running container.
type ContainerStats struct {
	ID         string  `json:"id"`
	CPUPercent float64 `json:"cpuPercent"`
	MemUsage   uint64  `json:"memUsage"`
	MemLimit   uint64  `json:"memLimit"`
	MemPercent float64 `json:"memPercent"`
}

// OlderLogs is the result of loading log lines older than the ones shown.
type OlderLogs struct {
	Lines   []LogLine `json:"lines"`
	HasMore bool      `json:"hasMore"`
}
