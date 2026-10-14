package ssh

import (
	"context"
	"errors"
	"strings"
	"time"

	"localhub/internal/docker"
)

// shJoin quotes every argument for the remote shell.
func shJoin(args []string) string {
	q := make([]string, len(args))
	for i, a := range args {
		q[i] = shQuote(a)
	}
	return strings.Join(q, " ")
}

// RebuildContainer rebuilds the image of a server container's Compose service
// and recreates it, like `docker compose up -d --build --force-recreate --no-deps <service>` run
// in the project folder on the server.
func (s *Service) RebuildContainer(ctx context.Context, hostID, containerID string, onProgress func(docker.Progress)) error {
	d, err := s.inspect(ctx, hostID, containerID)
	if err != nil {
		return err
	}
	t, err := docker.ComposeFromLabels(d.Config.Labels)
	if err != nil {
		return err
	}
	conn, err := s.remoteConn(hostID)
	if err != nil {
		return err
	}
	cd := "cd " + shQuote(t.WorkDir) + " && "

	cfg, err := runScript(ctx, conn, cd+"docker "+shJoin(t.ConfigArgs()), listTimeout)
	if err != nil {
		return err
	}
	if cfg.ExitCode != 0 {
		if strings.Contains(strings.ToLower(cfg.Stderr), "no such file") || strings.Contains(strings.ToLower(cfg.Stderr), "can't cd") {
			return errors.New("A pasta do projeto não existe mais no servidor: " + t.WorkDir)
		}
		if _, msg, ok := dockerProblem(cfg, conn.User); ok {
			return errors.New(msg)
		}
		return errors.New("O Docker Compose do servidor não conseguiu ler o projeto. Confira se o arquivo do Compose ainda existe e está válido.")
	}
	has, err := t.HasBuild([]byte(cfg.Stdout))
	if err != nil {
		return err
	}
	if !has {
		return errors.New(t.NoBuildMessage())
	}

	ctx, cancel := context.WithTimeout(ctx, docker.RebuildTimeout)
	defer cancel()
	if onProgress != nil {
		onProgress(docker.Progress{Phase: docker.PhaseStart})
	}
	// Streamed: the build output feeds the progress and, if it fails, the message.
	tail := docker.NewOutputTail(onProgress)
	code, err := streamScript(ctx, conn, cd+"docker "+shJoin(t.UpArgs())+" 2>&1", tail, tail)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return errors.New("A reconstrução passou de 20 minutos e foi cancelada.")
		}
		return err
	}
	if code != 0 {
		return errors.New("A reconstrução falhou:\n" + docker.Tail(tail.Output(), 12))
	}
	return nil
}

type remoteBuild struct {
	services map[string]bool
	problem  string
	at       time.Time
}

// remoteBuildTTL keeps a server project's answer for a while: reading it costs
// a round trip per project, and a Compose file rarely changes under the UI.
// A problem is kept for less, so a fix shows up soon.
const (
	remoteBuildTTL   = 2 * time.Minute
	remoteProblemTTL = 20 * time.Second
)

// RebuildInfos says, for the Compose containers among items (containers of this
// server), whether they can be rebuilt or why the project could not be read.
func (s *Service) RebuildInfos(ctx context.Context, hostID string, items []docker.ContainerInfo) (map[string]docker.RebuildInfo, error) {
	conn, err := s.remoteConn(hostID)
	if err != nil {
		return nil, err
	}
	items, all := docker.SplitPlatform(items)
	for _, g := range docker.GroupCompose(items) {
		key := hostID + "|" + g.Key()
		s.buildMu.Lock()
		c, ok := s.buildCache[key]
		s.buildMu.Unlock()
		ttl := remoteBuildTTL
		if c.problem != "" {
			ttl = remoteProblemTTL
		}
		if !ok || time.Since(c.at) > ttl {
			c = remoteBuild{at: time.Now()}
			res, err := runScript(ctx, conn, "cd "+shQuote(g.Target.WorkDir)+" && docker "+shJoin(g.Target.ConfigArgs()), listTimeout)
			switch {
			case err != nil:
				c.problem = "Não consegui consultar o servidor: " + err.Error()
			case res.ExitCode != 0:
				if _, msg, ok := dockerProblem(res, conn.User); ok {
					c.problem = msg
				} else {
					c.problem = docker.ComposeProblem(res.Stderr, g.Target.WorkDir)
				}
			default:
				if services, err := docker.BuildServices([]byte(res.Stdout)); err != nil {
					c.problem = err.Error()
				} else {
					c.services = services
				}
			}
			s.buildMu.Lock()
			if s.buildCache == nil {
				s.buildCache = map[string]remoteBuild{}
			}
			s.buildCache[key] = c
			s.buildMu.Unlock()
		}
		for id, info := range g.Info(c.services, c.problem) {
			all[id] = info
		}
	}
	return all, nil
}
