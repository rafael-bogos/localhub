package docker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	cerrdefs "github.com/containerd/errdefs"
	"github.com/moby/moby/client"
)

// Rebuilding a container means rebuilding its image and recreating it, which
// only has a meaning when something says how it was built. Docker Compose
// records that in labels; a container made with `docker run` has nothing to
// rebuild from.

const (
	labelProject    = "com.docker.compose.project"
	labelService    = "com.docker.compose.service"
	labelWorkingDir = "com.docker.compose.project.working_dir"
	labelConfigFile = "com.docker.compose.project.config_files"

	// RebuildTimeout bounds one rebuild: image builds can be slow.
	RebuildTimeout = 20 * time.Minute
)

// names Compose accepts for projects and services.
var composeName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]*$`)

// ComposeTarget is where a Compose service lives.
type ComposeTarget struct {
	Project string
	Service string
	WorkDir string
	Files   []string
}

// ErrNotCompose says the container has no Compose origin to rebuild from.
var ErrNotCompose = errors.New("Este container não foi criado pelo Docker Compose, então não há de onde reconstruir a imagem. Reconstrua-o pelo projeto que o criou.")

// ComposeFromLabels reads a container's Compose origin.
func ComposeFromLabels(labels map[string]string) (ComposeTarget, error) {
	t := ComposeTarget{
		Project: labels[labelProject],
		Service: labels[labelService],
		WorkDir: labels[labelWorkingDir],
	}
	if t.Project == "" || t.Service == "" {
		return ComposeTarget{}, ErrNotCompose
	}
	if !composeName.MatchString(t.Project) || !composeName.MatchString(t.Service) {
		return ComposeTarget{}, errors.New("Nome de projeto ou serviço do Compose não suportado.")
	}
	for _, f := range strings.Split(labels[labelConfigFile], ",") {
		if f = strings.TrimSpace(f); f != "" {
			t.Files = append(t.Files, f)
		}
	}
	if len(t.Files) == 0 || t.WorkDir == "" {
		return ComposeTarget{}, errors.New("O container não guarda onde está o arquivo do Compose (criado por uma versão antiga?). Reconstrua-o pelo projeto.")
	}
	return t, nil
}

// base is the compose command line up to the subcommand.
func (t ComposeTarget) base() []string {
	args := []string{"compose", "--project-name", t.Project, "--project-directory", t.WorkDir}
	for _, f := range t.Files {
		args = append(args, "-f", f)
	}
	return args
}

// ConfigArgs reads the resolved project as JSON.
func (t ComposeTarget) ConfigArgs() []string { return append(t.base(), "config", "--format", "json") }

// UpArgs rebuilds the service's image and always recreates that one service
// (without --force-recreate an unchanged image would leave the container as
// is). Plain progress prints one line per build step, which is what
// ParseProgress reads and what is left for the error message on failure.
func (t ComposeTarget) UpArgs() []string {
	args := append([]string{"compose", "--progress", "plain"}, t.base()[1:]...)
	return append(args, "up", "-d", "--build", "--force-recreate", "--no-deps", t.Service)
}

// BuildServices reads `compose config` JSON and says, per service, whether it
// builds an image (as opposed to using a ready-made one, which has nothing to
// rebuild).
func BuildServices(configJSON []byte) (map[string]bool, error) {
	var cfg struct {
		Services map[string]struct {
			Build json.RawMessage `json:"build"`
		} `json:"services"`
	}
	if err := json.Unmarshal(configJSON, &cfg); err != nil {
		return nil, errors.New("Não consegui ler a configuração do Compose deste projeto.")
	}
	out := make(map[string]bool, len(cfg.Services))
	for name, svc := range cfg.Services {
		out[name] = len(svc.Build) > 0 && string(svc.Build) != "null"
	}
	return out, nil
}

// HasBuild says whether this target's service builds an image.
func (t ComposeTarget) HasBuild(configJSON []byte) (bool, error) {
	m, err := BuildServices(configJSON)
	if err != nil {
		return false, err
	}
	has, ok := m[t.Service]
	if !ok {
		return false, fmt.Errorf("O serviço %s não existe mais no arquivo do Compose.", t.Service)
	}
	return has, nil
}

// NoBuildMessage is the answer when the service uses a ready-made image.
func (t ComposeTarget) NoBuildMessage() string {
	return fmt.Sprintf("O serviço %s usa uma imagem pronta (não tem build no Compose), então não há o que reconstruir.", t.Service)
}

// Tail keeps the last lines of a command's output for an error message.
func Tail(out string, lines int) string {
	var parts []string
	for _, l := range strings.Split(out, "\n") {
		if strings.TrimSpace(l) != "" {
			parts = append(parts, strings.TrimRight(l, " \t\r"))
		}
	}
	if len(parts) > lines {
		parts = parts[len(parts)-lines:]
	}
	s := strings.TrimSpace(strings.Join(parts, "\n"))
	if r := []rune(s); len(r) > 2000 {
		s = "…" + string(r[len(r)-2000:])
	}
	return s
}

// Rebuild phases reported while it runs.
const (
	PhaseStart    = "start"    // reading the project, nothing built yet
	PhaseBuild    = "build"    // building the image, Step/Total known
	PhaseRecreate = "recreate" // image ready, swapping the container
)

// Progress is what a running rebuild tells the UI.
type Progress struct {
	Phase string `json:"phase"`
	// Step of Total is the BuildKit stage being run (e.g. 3 of 5); 0 when unknown.
	Step  int `json:"step"`
	Total int `json:"total"`
	// Text is the instruction being run ("RUN npm ci"), cut to a readable size.
	Text string `json:"text"`
}

var (
	// "#7 [app 3/5] RUN npm ci" and "#7 [3/5] RUN npm ci"
	buildStep = regexp.MustCompile(`^#\d+ \[(?:[^\]]*? )?(\d+)/(\d+)\] (.+)$`)
	// "Container app  Recreate", "Container app  Started"...
	recreateLine = regexp.MustCompile(`(?i)^\s*Container \S+\s+(Stopping|Stopped|Recreate|Recreated|Starting|Started|Creating|Created|Removing|Removed)\b`)
)

// ParseProgress reads one line of `docker compose --progress plain` output.
func ParseProgress(line string) (Progress, bool) {
	if m := buildStep.FindStringSubmatch(line); m != nil {
		n, _ := strconv.Atoi(m[1])
		total, _ := strconv.Atoi(m[2])
		text := strings.TrimSpace(m[3])
		if r := []rune(text); len(r) > 120 {
			text = string(r[:120]) + "…"
		}
		return Progress{Phase: PhaseBuild, Step: n, Total: total, Text: text}, true
	}
	if recreateLine.MatchString(line) {
		return Progress{Phase: PhaseRecreate}, true
	}
	return Progress{}, false
}

// outputTail is an io.Writer that splits a command's output into lines, hands
// the progress ones to onProgress and keeps the last lines for an error message.
type outputTail struct {
	mu         sync.Mutex
	partial    string
	lines      []string
	onProgress func(Progress)
	// last avoids repeating the same build step.
	last string
}

const keepLines = 60

// NewOutputTail returns the writer used by both the local and the remote rebuild.
func NewOutputTail(onProgress func(Progress)) *outputTail { return &outputTail{onProgress: onProgress} }

func (o *outputTail) Write(b []byte) (int, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.partial += string(b)
	parts := strings.FieldsFunc(o.partial, func(r rune) bool { return r == '\n' || r == '\r' })
	// The last piece may be a line still being written.
	if !strings.HasSuffix(o.partial, "\n") && !strings.HasSuffix(o.partial, "\r") && len(parts) > 0 {
		o.partial = parts[len(parts)-1]
		parts = parts[:len(parts)-1]
	} else {
		o.partial = ""
	}
	for _, l := range parts {
		o.lines = append(o.lines, l)
		if len(o.lines) > keepLines {
			o.lines = o.lines[len(o.lines)-keepLines:]
		}
		if o.onProgress != nil {
			if p, ok := ParseProgress(l); ok && (p.Phase != PhaseBuild || p.Text != o.last) {
				o.last = p.Text
				o.onProgress(p)
			}
		}
	}
	return len(b), nil
}

// Output is what was kept, for the failure message.
func (o *outputTail) Output() string {
	o.mu.Lock()
	defer o.mu.Unlock()
	return strings.Join(append(o.lines, o.partial), "\n")
}

// dockerCmd builds a docker CLI command against the same engine the SDK
// client (newClient) talks to, so the container is never read from one engine
// and rebuilt on another.
func dockerCmd(ctx context.Context, dir string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Dir = dir
	if os.Getenv("DOCKER_HOST") == "" {
		if host := engineHost(); host != "" {
			cmd.Env = append(os.Environ(), "DOCKER_HOST="+host)
		} else {
			cmd.Env = append(os.Environ(), "DOCKER_CONTEXT=default")
		}
	}
	return cmd
}

// RebuildContainer rebuilds the image of a container's Compose service and
// recreates it, like `docker compose up -d --build --force-recreate --no-deps <service>`.
func RebuildContainer(ctx context.Context, id string, onProgress func(Progress)) error {
	cli, err := newClient(ctx)
	if err != nil {
		return err
	}
	res, err := cli.ContainerInspect(ctx, id, client.ContainerInspectOptions{})
	cli.Close()
	if err != nil {
		if cerrdefs.IsNotFound(err) {
			return errors.New("container não encontrado")
		}
		return errors.New("falha ao ler o container")
	}
	var labels map[string]string
	if res.Container.Config != nil {
		labels = res.Container.Config.Labels
	}
	t, err := ComposeFromLabels(labels)
	if err != nil {
		return err
	}
	if _, err := os.Stat(t.WorkDir); err != nil {
		return fmt.Errorf("A pasta do projeto não existe mais neste computador: %s", t.WorkDir)
	}

	ctx, cancel := context.WithTimeout(ctx, RebuildTimeout)
	defer cancel()

	out, err := dockerCmd(ctx, t.WorkDir, t.ConfigArgs()...).Output()
	if err != nil {
		if errors.Is(err, exec.ErrNotFound) {
			return errors.New("O comando docker não foi encontrado neste computador.")
		}
		return errors.New("O Docker Compose não conseguiu ler o projeto. Confira se o arquivo do Compose ainda existe e está válido.")
	}
	has, err := t.HasBuild(out)
	if err != nil {
		return err
	}
	if !has {
		return errors.New(t.NoBuildMessage())
	}

	if onProgress != nil {
		onProgress(Progress{Phase: PhaseStart})
	}
	tail := NewOutputTail(onProgress)
	up := dockerCmd(ctx, t.WorkDir, t.UpArgs()...)
	up.Stdout, up.Stderr = tail, tail
	if err := up.Run(); err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return errors.New("A reconstrução passou de 20 minutos e foi cancelada.")
		}
		return errors.New("A reconstrução falhou:\n" + Tail(tail.Output(), 12))
	}
	return nil
}
