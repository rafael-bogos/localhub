package docker

// ContainerInfo describes a Docker container for display in the UI.
type ContainerInfo struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
	State  string `json:"state"`
	Ports  string `json:"ports"`
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
