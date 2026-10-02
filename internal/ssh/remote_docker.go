package ssh

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"localhub/internal/docker"
)

// RemoteContainers is the Docker containers of one server.
type RemoteContainers struct {
	Status  string                 `json:"status"`
	Message string                 `json:"message"`
	Items   []docker.ContainerInfo `json:"items"`
}

// RemoteImages is the Docker images of one server.
type RemoteImages struct {
	Status  string             `json:"status"`
	Message string             `json:"message"`
	Items   []docker.ImageInfo `json:"items"`
}

// dockerProblem classifies a failed docker command. ok is false when the
// failure isn't one of the expected "this server can't do Docker" situations.
func dockerProblem(res execResult) (status, message string, ok bool) {
	s := strings.ToLower(res.Stderr)
	switch {
	case res.ExitCode == 127 || strings.Contains(s, "docker: not found") || strings.Contains(s, "command not found"):
		return StatusNoDocker, "O Docker não está instalado neste servidor.", true
	case strings.Contains(s, "permission denied"):
		return StatusDenied, "Sem permissão para usar o Docker neste servidor (o usuário precisa estar no grupo docker).", true
	case strings.Contains(s, "cannot connect to the docker daemon") || strings.Contains(s, "is the docker daemon running"):
		return StatusDaemonDown, "O serviço do Docker não está em execução neste servidor.", true
	}
	return "", "", false
}

// firstLine is the first non-empty line of s, for error messages.
func firstLine(s string) string {
	for _, l := range strings.Split(s, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			return l
		}
	}
	return ""
}

// jsonLines decodes the one-JSON-object-per-line output of
// `docker ... --format "{{json .}}"`.
func jsonLines[T any](out string) ([]T, error) {
	var items []T
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var v T
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			return nil, fmt.Errorf("resposta inesperada do Docker no servidor")
		}
		items = append(items, v)
	}
	return items, nil
}

type psRow struct {
	ID     string `json:"ID"`
	Names  string `json:"Names"`
	Image  string `json:"Image"`
	Status string `json:"Status"`
	State  string `json:"State"`
	Ports  string `json:"Ports"`
}

func parseContainers(out string) ([]docker.ContainerInfo, error) {
	rows, err := jsonLines[psRow](out)
	if err != nil {
		return nil, err
	}
	list := make([]docker.ContainerInfo, 0, len(rows))
	for _, r := range rows {
		state := strings.ToLower(r.State)
		if state == "" { // old Docker versions have no State column
			state = "exited"
			if strings.HasPrefix(r.Status, "Up") {
				state = "running"
			}
		}
		name, _, _ := strings.Cut(r.Names, ",")
		list = append(list, docker.ContainerInfo{
			ID:     r.ID,
			Name:   strings.TrimPrefix(name, "/"),
			Image:  r.Image,
			Status: r.Status,
			State:  state,
			Ports:  formatRemotePorts(r.Ports),
		})
	}
	sort.SliceStable(list, func(i, j int) bool {
		ri, rj := list[i].State == "running", list[j].State == "running"
		if ri != rj {
			return ri
		}
		return list[i].Name < list[j].Name
	})
	return list, nil
}

// formatRemotePorts rewrites the CLI's "0.0.0.0:33067->3306/tcp, [::]:33067->3306/tcp"
// as the local listing shows it ("33067->3306/tcp"), each published port once.
func formatRemotePorts(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	seen := map[string]bool{}
	var parts []string
	for _, item := range strings.Split(s, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		label := item
		if left, right, found := strings.Cut(item, "->"); found {
			pub := left
			if i := strings.LastIndexByte(left, ':'); i >= 0 {
				pub = left[i+1:]
			}
			label = pub + "->" + right
		}
		if !seen[label] {
			seen[label] = true
			parts = append(parts, label)
		}
	}
	return strings.Join(parts, ", ")
}

type imageRow struct {
	ID         string `json:"ID"`
	Repository string `json:"Repository"`
	Tag        string `json:"Tag"`
	Size       string `json:"Size"`
	CreatedAt  string `json:"CreatedAt"`
}

func parseImages(out string) ([]docker.ImageInfo, error) {
	rows, err := jsonLines[imageRow](out)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	list := make([]docker.ImageInfo, 0, len(rows))
	for _, r := range rows {
		id := strings.TrimPrefix(r.ID, "sha256:")
		if len(id) > 12 {
			id = id[:12]
		}
		// One row per image, like the local listing: an image with several
		// tags would otherwise appear (and be removed) more than once.
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		created := r.CreatedAt
		if len(created) > 16 {
			created = created[:16] // "2006-01-02 15:04"
		}
		list = append(list, docker.ImageInfo{
			ID:         id,
			Repository: r.Repository,
			Tag:        r.Tag,
			Size:       r.Size,
			Created:    created,
		})
	}
	sort.SliceStable(list, func(i, j int) bool { return list[i].Created > list[j].Created })
	return list, nil
}

// containerActionMessage and imageRemoveMessage map docker's stderr to the
// same plain messages the local actions give.
func containerActionMessage(action, stderr string) string {
	s := strings.ToLower(stderr)
	switch {
	case strings.Contains(s, "no such container"):
		return "container não encontrado"
	case strings.Contains(s, "running container") || strings.Contains(s, "stop the container before"):
		return "pare o container antes de removê-lo"
	}
	switch action {
	case "start":
		return "falha ao iniciar o container"
	case "stop":
		return "falha ao parar o container"
	case "restart":
		return "falha ao reiniciar o container"
	default:
		return "falha ao remover o container"
	}
}

func imageRemoveMessage(stderr string) string {
	s := strings.ToLower(stderr)
	switch {
	case strings.Contains(s, "no such image"):
		return "imagem não encontrada"
	case strings.Contains(s, "being used") || strings.Contains(s, "conflict") || strings.Contains(s, "must be forced") || strings.Contains(s, "referenced in multiple"):
		return "essa imagem está em uso por um container"
	}
	return "falha ao remover a imagem"
}
