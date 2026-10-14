package docker

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func writeContext(t *testing.T, dir, name, host string) {
	t.Helper()
	sum := sha256.Sum256([]byte(name))
	d := filepath.Join(dir, "contexts", "meta", hex.EncodeToString(sum[:]))
	if err := os.MkdirAll(d, 0o755); err != nil {
		t.Fatal(err)
	}
	meta := `{"Name":"` + name + `","Endpoints":{"docker":{"Host":"` + host + `"}}}`
	if err := os.WriteFile(filepath.Join(d, "meta.json"), []byte(meta), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestEngineHost(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("DOCKER_CONFIG", dir)
	t.Setenv("DOCKER_HOST", "")
	t.Setenv("DOCKER_CONTEXT", "")

	if got := engineHost(); got != "" {
		t.Errorf("sem config: %q", got)
	}
	os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{"currentContext":"desktop-linux"}`), 0o644)
	writeContext(t, dir, "desktop-linux", "unix:///home/u/.docker/desktop/docker.sock")
	if got := engineHost(); got != "unix:///home/u/.docker/desktop/docker.sock" {
		t.Errorf("contexto ativo: %q", got)
	}
	t.Setenv("DOCKER_CONTEXT", "default")
	if got := engineHost(); got != "" {
		t.Errorf("DOCKER_CONTEXT=default: %q", got)
	}
	t.Setenv("DOCKER_CONTEXT", "")
	t.Setenv("DOCKER_HOST", "tcp://10.0.0.5:2375")
	if got := engineHost(); got != "" {
		t.Errorf("DOCKER_HOST manda: %q", got)
	}
	t.Setenv("DOCKER_HOST", "")
	os.WriteFile(filepath.Join(dir, "config.json"), []byte(`{"currentContext":"remoto"}`), 0o644)
	writeContext(t, dir, "remoto", "ssh://user@host")
	if got := engineHost(); got != "" {
		t.Errorf("ssh:// não é suportado e deve cair no padrão: %q", got)
	}
}
