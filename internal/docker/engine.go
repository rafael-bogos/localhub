package docker

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// The docker CLI decides which engine to talk to from DOCKER_HOST or, failing
// that, the active Docker context (Docker Desktop, for one, installs its own
// context and leaves /var/run/docker.sock empty or pointing elsewhere). The
// SDK client only follows DOCKER_HOST, so without this the app would list the
// containers of a different engine than the one the user's `docker ps` shows.

// engineHost returns the address of the engine to use, or "" to leave the
// choice to the SDK defaults (DOCKER_HOST, then the standard socket).
func engineHost() string {
	if os.Getenv("DOCKER_HOST") != "" {
		return ""
	}
	cfgDir := os.Getenv("DOCKER_CONFIG")
	if cfgDir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		cfgDir = filepath.Join(home, ".docker")
	}

	name := os.Getenv("DOCKER_CONTEXT")
	if name == "" {
		var cfg struct {
			CurrentContext string `json:"currentContext"`
		}
		if b, err := os.ReadFile(filepath.Join(cfgDir, "config.json")); err == nil {
			_ = json.Unmarshal(b, &cfg)
		}
		name = cfg.CurrentContext
	}
	if name == "" || name == "default" {
		return ""
	}

	sum := sha256.Sum256([]byte(name))
	b, err := os.ReadFile(filepath.Join(cfgDir, "contexts", "meta", hex.EncodeToString(sum[:]), "meta.json"))
	if err != nil {
		return ""
	}
	var meta struct {
		Endpoints struct {
			Docker struct {
				Host string `json:"Host"`
			} `json:"docker"`
		} `json:"Endpoints"`
	}
	if json.Unmarshal(b, &meta) != nil {
		return ""
	}
	host := meta.Endpoints.Docker.Host
	// Only addresses the SDK dials directly; an ssh:// context falls back to
	// the default engine rather than failing the whole app.
	if strings.HasPrefix(host, "unix://") || strings.HasPrefix(host, "tcp://") || strings.HasPrefix(host, "npipe://") {
		return host
	}
	return ""
}
