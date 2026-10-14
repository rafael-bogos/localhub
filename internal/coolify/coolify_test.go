package coolify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// fake is a minimal Coolify: it checks the token and walks a deployment
// through queued -> in_progress -> the final status.
type fake struct {
	final     string
	polls     atomic.Int32
	getDeploy bool // old versions: only GET /deploy
	seenAuth  atomic.Value
}

func (f *fake) handler() http.Handler {
	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			f.seenAuth.Store(r.Header.Get("Authorization"))
			if r.Header.Get("Authorization") != "Bearer 1|segredo" {
				w.WriteHeader(401)
				w.Write([]byte(`{"message":"Unauthenticated."}`))
				return
			}
			h(w, r)
		}
	}
	mux.HandleFunc("/api/v1/teams/current", auth(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"id":0,"name":"Equipe Dev"}`))
	}))
	mux.HandleFunc("/api/v1/applications", auth(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`[{"id":7,"uuid":"tr7tg4eie3ue1hp8ssgx62s2","name":"api"},{"id":9,"uuid":"zzzzzzzzzzzzzzzzzzzzzzzz","name":"web"}]`))
	}))
	mux.HandleFunc("/api/v1/deploy", auth(func(w http.ResponseWriter, r *http.Request) {
		if f.getDeploy && r.Method == http.MethodPost {
			w.WriteHeader(405)
			return
		}
		if r.URL.Query().Get("uuid") != "tr7tg4eie3ue1hp8ssgx62s2" {
			w.WriteHeader(404)
			return
		}
		w.Write([]byte(`{"deployments":[{"message":"ok","resource_uuid":"tr7tg4eie3ue1hp8ssgx62s2","deployment_uuid":"dep-1"}]}`))
	}))
	mux.HandleFunc("/api/v1/deployments/dep-1", auth(func(w http.ResponseWriter, r *http.Request) {
		n := f.polls.Add(1)
		status := "in_progress"
		if n == 1 {
			status = "queued"
		}
		logs := ""
		if n >= 3 {
			status = f.final
			logs = `[{"output":"Building...","hidden":false},{"output":"ERRO: npm falhou","hidden":false},{"output":"segredo-oculto","hidden":true}]`
		}
		json.NewEncoder(w).Encode(map[string]string{"status": status, "logs": logs})
	}))
	return mux
}

func setup(t *testing.T, f *fake) *Client {
	t.Helper()
	pollEvery = 5 * time.Millisecond
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	c, err := NewClient(Config{URL: srv.URL, Token: "1|segredo"})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestNewClientValidation(t *testing.T) {
	for _, cfg := range []Config{{URL: "", Token: "x"}, {URL: "ftp://x", Token: "x"}, {URL: "https://x", Token: " "}} {
		if _, err := NewClient(cfg); err == nil {
			t.Errorf("%+v deveria falhar", cfg)
		}
	}
	c, err := NewClient(Config{URL: "coolify.exemplo.com/", Token: "t"})
	if err != nil || c.base != "https://coolify.exemplo.com/api/v1" {
		t.Errorf("normalização: %v %v", c, err)
	}
	c, _ = NewClient(Config{URL: "https://x.com/api/v1/", Token: "t"})
	if c.base != "https://x.com/api/v1" {
		t.Errorf("não duplicar /api/v1: %s", c.base)
	}
	if !IsPlainHTTP("http://10.0.0.5:8000") || IsPlainHTTP("https://x") {
		t.Error("IsPlainHTTP")
	}
}

func TestPingAndAuthErrors(t *testing.T) {
	f := &fake{final: "finished"}
	c := setup(t, f)
	if team, err := c.Ping(context.Background()); err != nil || team != "Equipe Dev" {
		t.Fatalf("ping: %q %v", team, err)
	}
	if f.seenAuth.Load() != "Bearer 1|segredo" {
		t.Error("o token vai no cabeçalho Authorization")
	}
	bad := *c
	bad.token = "errado"
	_, err := bad.Ping(context.Background())
	if err != ErrAuth || strings.Contains(err.Error(), "errado") {
		t.Errorf("token errado: %v", err)
	}
}

func TestFindApp(t *testing.T) {
	apps := []App{{ID: 7, UUID: "tr7tg4eie3ue1hp8ssgx62s2", Name: "api"}, {ID: 9, UUID: "zzzzzzzzzzzzzzzzzzzzzzzz", Name: "web"}}
	if a, ok := FindApp(apps, "tr7tg4eie3ue1hp8ssgx62s2-123456789012", nil); !ok || a.Name != "api" {
		t.Errorf("pelo nome do container: %v %v", a, ok)
	}
	if a, ok := FindApp(apps, "worker-zzzzzzzzzzzzzzzzzzzzzzzz-9", nil); !ok || a.Name != "web" {
		t.Errorf("uuid no meio do nome: %v %v", a, ok)
	}
	if a, ok := FindApp(apps, "x", map[string]string{"com.docker.compose.project": "ZZZZZZZZZZZZZZZZZZZZZZZZ"}); !ok || a.Name != "web" {
		t.Errorf("pelo projeto do compose: %v %v", a, ok)
	}
	if a, ok := FindApp(apps, "nada", map[string]string{"coolify.applicationId": "7"}); !ok || a.Name != "api" {
		t.Errorf("pelo applicationId: %v %v", a, ok)
	}
	if _, ok := FindApp(apps, "qualquercoisa-123", map[string]string{"coolify.applicationId": "99"}); ok {
		t.Error("sem correspondência não deve achar app")
	}
}

func TestDeployAndWaitSuccess(t *testing.T) {
	f := &fake{final: "finished"}
	c := setup(t, f)
	ctx := context.Background()
	apps, err := c.Applications(ctx)
	if err != nil || len(apps) != 2 {
		t.Fatalf("apps: %v %v", apps, err)
	}
	dep, err := c.Deploy(ctx, "tr7tg4eie3ue1hp8ssgx62s2", false)
	if err != nil || dep != "dep-1" {
		t.Fatalf("deploy: %q %v", dep, err)
	}
	var seen []string
	if err := c.Wait(ctx, dep, func(s string) { seen = append(seen, s) }); err != nil {
		t.Fatalf("wait: %v", err)
	}
	if strings.Join(seen, ",") != "queued,in_progress,finished" {
		t.Errorf("status vistos: %v", seen)
	}
}

func TestDeployFailureCarriesLogTail(t *testing.T) {
	f := &fake{final: "failed"}
	c := setup(t, f)
	err := c.Wait(context.Background(), "dep-1", nil)
	if err == nil || !strings.Contains(err.Error(), "falhou") || !strings.Contains(err.Error(), "ERRO: npm falhou") {
		t.Fatalf("falha deve trazer o fim do log: %v", err)
	}
	if strings.Contains(err.Error(), "segredo-oculto") {
		t.Error("entradas ocultas do log não devem aparecer")
	}
}

func TestDeployFallsBackToGETOnOldCoolify(t *testing.T) {
	f := &fake{final: "finished", getDeploy: true}
	c := setup(t, f)
	if dep, err := c.Deploy(context.Background(), "tr7tg4eie3ue1hp8ssgx62s2", true); err != nil || dep != "dep-1" {
		t.Errorf("GET de reserva: %q %v", dep, err)
	}
}

func TestDeployUnknownApp(t *testing.T) {
	c := setup(t, &fake{final: "finished"})
	_, err := c.Deploy(context.Background(), "naoexistenaoexistenaoexist", false)
	if err == nil || !strings.Contains(err.Error(), "não achou") {
		t.Errorf("%v", err)
	}
}

func TestNotCoolifyAndRedirect(t *testing.T) {
	html := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("<html>login</html>")) }))
	defer html.Close()
	c, _ := NewClient(Config{URL: html.URL, Token: "t"})
	if _, err := c.Ping(context.Background()); err == nil || !strings.Contains(err.Error(), "não parece ser a API") {
		t.Errorf("HTML: %v", err)
	}
	redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, "https://outro.exemplo.com/", 301) }))
	defer redir.Close()
	c, _ = NewClient(Config{URL: redir.URL, Token: "t"})
	if _, err := c.Ping(context.Background()); err == nil || !strings.Contains(err.Error(), "redireciona") {
		t.Errorf("redirect: %v", err)
	}
}

func TestClassify(t *testing.T) {
	for s, want := range map[string]Outcome{"queued": Pending, "in_progress": Pending, "finished": Finished, "failed": Failed, "cancelled-by-user": Failed, "": Pending} {
		if got := Classify(s); got != want {
			t.Errorf("%q: %v", s, got)
		}
	}
}
