package docker

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Which containers can be rebuilt: the ones whose Compose service has a build
// section. The labels say a container came from Compose, not whether its image
// was built or just named, so each project's file has to be read.

// ComposeGroup is the containers of one Compose project definition (the same
// folder and files), which share one `compose config`.
type ComposeGroup struct {
	Target ComposeTarget
	// Members are the containers (ID) by service name.
	Members map[string][]string
}

// Key identifies a project definition.
func (g *ComposeGroup) Key() string {
	return g.Target.Project + "|" + g.Target.WorkDir + "|" + strings.Join(g.Target.Files, ",")
}

// GroupCompose splits containers by Compose project; containers that did not
// come from Compose are left out.
func GroupCompose(items []ContainerInfo) []*ComposeGroup {
	by := map[string]*ComposeGroup{}
	var order []string
	for _, c := range items {
		t, err := ComposeFromLabels(c.Labels)
		if err != nil {
			continue
		}
		g := &ComposeGroup{Target: t}
		k := g.Key()
		if ex, ok := by[k]; ok {
			g = ex
		} else {
			g.Members = map[string][]string{}
			by[k] = g
			order = append(order, k)
		}
		g.Members[t.Service] = append(g.Members[t.Service], c.ID)
	}
	out := make([]*ComposeGroup, len(order))
	for i, k := range order {
		out[i] = by[k]
	}
	return out
}

// Platform returns the deploy platform that manages a container ("" when none),
// judging by the labels it leaves on what it runs. Those containers come from
// a build the platform did in a temporary folder, so there is no Compose
// project to rebuild from: it is redeployed through the platform.
func Platform(labels map[string]string) string {
	for key := range labels {
		switch {
		case strings.HasPrefix(key, "coolify."):
			return "Coolify"
		case strings.HasPrefix(key, "dokku"), strings.HasPrefix(key, "com.dokku"):
			return "Dokku"
		case strings.HasPrefix(key, "caprover"):
			return "CapRover"
		case strings.HasPrefix(key, "io.portainer."):
			return "Portainer"
		case strings.HasPrefix(key, "com.docker.stack."), strings.HasPrefix(key, "com.docker.swarm."):
			return "Docker Swarm"
		}
	}
	return ""
}

// platformInfo says what can be done with a platform's container: Coolify has
// an API to redeploy through, the others are rebuilt from their own panel.
func platformInfo(platform string) RebuildInfo {
	if platform == "Coolify" {
		return RebuildInfo{Platform: platform, Redeploy: true}
	}
	return RebuildInfo{Platform: platform, Problem: "Este container é gerenciado pelo " + platform + ", que faz o build numa pasta temporária. Reconstrua-o pelo painel do " + platform + "."}
}

// SplitPlatform separates the containers a deploy platform manages (answered
// right away) from the rest, which still need their Compose project read.
func SplitPlatform(items []ContainerInfo) (rest []ContainerInfo, managed map[string]RebuildInfo) {
	managed = map[string]RebuildInfo{}
	for _, c := range items {
		if p := Platform(c.Labels); p != "" {
			if _, err := ComposeFromLabels(c.Labels); err == nil {
				managed[c.ID] = platformInfo(p)
			}
			continue
		}
		rest = append(rest, c)
	}
	return rest, managed
}

// RebuildInfo is what the UI needs to know about one Compose container.
type RebuildInfo struct {
	// Build: the service builds its image, so "Reconstruir" applies.
	Build bool `json:"build"`
	// Problem, when set, is why the project could not be read (the button is
	// then shown disabled with this as its explanation).
	Problem string `json:"problem"`
	// Platform names the deploy platform that manages the container, and
	// Redeploy says localhub can ask it to redeploy (Coolify's API).
	Platform string `json:"platform"`
	Redeploy bool   `json:"redeploy"`
}

// Info answers for every container of the group.
func (g *ComposeGroup) Info(services map[string]bool, problem string) map[string]RebuildInfo {
	out := map[string]RebuildInfo{}
	for svc, members := range g.Members {
		for _, id := range members {
			switch {
			case problem != "":
				out[id] = RebuildInfo{Problem: problem}
			case services[svc]:
				out[id] = RebuildInfo{Build: true}
			}
			// A service with a ready-made image has nothing to say: no button.
		}
	}
	return out
}

// ComposeProblem turns a failed `compose config` into a sentence about why the
// project could not be read; stderr is the command's error output.
func ComposeProblem(stderr string, workDir string) string {
	low := strings.ToLower(stderr)
	switch {
	case strings.Contains(low, "is not a docker command"), strings.Contains(low, "unknown shorthand flag"),
		strings.Contains(low, "unknown flag: --project"), strings.Contains(low, "unknown flag: --progress"):
		return "O Docker Compose v2 não está instalado (ou é antigo demais): é preciso o comando `docker compose`."
	case strings.Contains(low, "can't cd"), strings.Contains(low, "no such file or directory") && strings.Contains(low, strings.ToLower(workDir)):
		return "A pasta do projeto não existe mais: " + workDir
	case strings.Contains(low, "permission denied"):
		return "Sem permissão para ler o projeto Compose em " + workDir + "."
	}
	line := ""
	for _, l := range strings.Split(stderr, "\n") {
		if l = strings.TrimSpace(l); l != "" {
			line = l
			break
		}
	}
	if r := []rune(line); len(r) > 160 {
		line = string(r[:160]) + "…"
	}
	if line == "" {
		return "O Compose não conseguiu ler o projeto."
	}
	return "O Compose não conseguiu ler o projeto: " + line
}

const (
	configTimeout = 20 * time.Second
	maxConfigJobs = 4
)

type cachedBuild struct {
	sig      string
	services map[string]bool
}

var (
	buildMu    sync.Mutex
	buildCache = map[string]cachedBuild{}
)

// fileSig changes when a Compose file is edited; "" when one cannot be read,
// which turns the cache off for that project.
func fileSig(files []string) string {
	var b strings.Builder
	for _, f := range files {
		st, err := os.Stat(f)
		if err != nil {
			return ""
		}
		fmt.Fprintf(&b, "%s:%d:%d;", f, st.Size(), st.ModTime().UnixNano())
	}
	return b.String()
}

func buildServices(ctx context.Context, g *ComposeGroup) (map[string]bool, string) {
	sig := fileSig(g.Target.Files)
	if sig != "" {
		buildMu.Lock()
		c, ok := buildCache[g.Key()]
		buildMu.Unlock()
		if ok && c.sig == sig {
			return c.services, ""
		}
	}
	if _, err := os.Stat(g.Target.WorkDir); err != nil {
		return nil, "A pasta do projeto não existe mais neste computador: " + g.Target.WorkDir
	}
	ctx, cancel := context.WithTimeout(ctx, configTimeout)
	defer cancel()
	out, err := dockerCmd(ctx, g.Target.WorkDir, g.Target.ConfigArgs()...).Output()
	if err != nil {
		var ee *exec.ExitError
		stderr := ""
		if errors.As(err, &ee) {
			stderr = string(ee.Stderr)
		} else if errors.Is(err, exec.ErrNotFound) {
			return nil, "O comando docker não foi encontrado neste computador."
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return nil, "O Compose demorou demais para ler o projeto."
		}
		return nil, ComposeProblem(stderr, g.Target.WorkDir)
	}
	services, err := BuildServices(out)
	if err != nil {
		return nil, err.Error()
	}
	if sig != "" {
		buildMu.Lock()
		buildCache[g.Key()] = cachedBuild{sig: sig, services: services}
		buildMu.Unlock()
	}
	return services, ""
}

// RebuildInfos says, for the containers among items that came from Docker
// Compose, whether they can be rebuilt (the service has a build) or why the
// project could not be read. Containers of services with a ready-made image,
// and containers not from Compose, are absent.
func RebuildInfos(ctx context.Context, items []ContainerInfo) map[string]RebuildInfo {
	items, managed := SplitPlatform(items)
	groups := GroupCompose(items)
	results := make([]map[string]RebuildInfo, len(groups))
	sem := make(chan struct{}, maxConfigJobs)
	var wg sync.WaitGroup
	for i, g := range groups {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			services, problem := buildServices(ctx, g)
			results[i] = g.Info(services, problem)
		}()
	}
	wg.Wait()
	all := managed
	for _, r := range results {
		for id, info := range r {
			all[id] = info
		}
	}
	return all
}
