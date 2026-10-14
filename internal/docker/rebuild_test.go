package docker

import (
	"reflect"
	"strings"
	"testing"
)

func TestComposeFromLabels(t *testing.T) {
	ok := map[string]string{
		labelProject: "shop", labelService: "api",
		labelWorkingDir: "/srv/shop", labelConfigFile: "/srv/shop/compose.yml, /srv/shop/compose.dev.yml",
	}
	tg, err := ComposeFromLabels(ok)
	if err != nil || tg.Project != "shop" || len(tg.Files) != 2 || tg.Files[1] != "/srv/shop/compose.dev.yml" {
		t.Fatalf("%+v %v", tg, err)
	}
	want := []string{"compose", "--progress", "plain", "--project-name", "shop", "--project-directory", "/srv/shop",
		"-f", "/srv/shop/compose.yml", "-f", "/srv/shop/compose.dev.yml", "up", "-d", "--build", "--force-recreate", "--no-deps", "api"}
	if got := tg.UpArgs(); !reflect.DeepEqual(got, want) {
		t.Errorf("args: %v", got)
	}
	if _, err := ComposeFromLabels(map[string]string{}); err != ErrNotCompose {
		t.Errorf("sem labels deve dar ErrNotCompose: %v", err)
	}
	bad := map[string]string{labelProject: "shop", labelService: "--rm", labelWorkingDir: "/x", labelConfigFile: "/x/c.yml"}
	if _, err := ComposeFromLabels(bad); err == nil {
		t.Error("nome de serviço que parece flag deve ser recusado")
	}
	noFile := map[string]string{labelProject: "a", labelService: "b"}
	delete(noFile, labelConfigFile)
	if _, err := ComposeFromLabels(noFile); err == nil || err == ErrNotCompose {
		t.Errorf("sem arquivo do compose: %v", err)
	}
}

func TestHasBuild(t *testing.T) {
	tg := ComposeTarget{Service: "api"}
	cases := map[string]struct {
		has bool
		err bool
	}{
		`{"services":{"api":{"build":{"context":"/x"}}}}`: {true, false},
		`{"services":{"api":{"image":"redis"}}}`:          {false, false},
		`{"services":{"api":{"build":null}}}`:             {false, false},
		`{"services":{"web":{"build":{}}}}`:               {false, true},
		`not json`:                                        {false, true},
	}
	for in, want := range cases {
		has, err := tg.HasBuild([]byte(in))
		if has != want.has || (err != nil) != want.err {
			t.Errorf("%s: has=%v err=%v", in, has, err)
		}
	}
}

func TestTail(t *testing.T) {
	var b strings.Builder
	for i := 1; i <= 30; i++ {
		b.WriteString("linha\n")
	}
	if got := strings.Count(Tail(b.String(), 12), "\n") + 1; got != 12 {
		t.Errorf("linhas: %d", got)
	}
	if got := Tail(strings.Repeat("x", 5000), 5); len([]rune(got)) > 2001 {
		t.Errorf("deve limitar o tamanho: %d", len([]rune(got)))
	}
}

func TestParseProgress(t *testing.T) {
	cases := []struct {
		line string
		want Progress
		ok   bool
	}{
		{"#7 [app 3/5] RUN npm ci", Progress{Phase: PhaseBuild, Step: 3, Total: 5, Text: "RUN npm ci"}, true},
		{"#12 [2/4] COPY . .", Progress{Phase: PhaseBuild, Step: 2, Total: 4, Text: "COPY . ."}, true},
		{"#9 [web builder 1/3] FROM docker.io/library/node:20", Progress{Phase: PhaseBuild, Step: 1, Total: 3, Text: "FROM docker.io/library/node:20"}, true},
		{" Container lh-app  Recreate", Progress{Phase: PhaseRecreate}, true},
		{"Container lh-app Started", Progress{Phase: PhaseRecreate}, true},
		{"#7 DONE 1.2s", Progress{}, false},
		{"#8 [internal] load build definition from Dockerfile", Progress{}, false},
		{"", Progress{}, false},
	}
	for _, c := range cases {
		got, ok := ParseProgress(c.line)
		if ok != c.ok || got != c.want {
			t.Errorf("%q: got %+v %v, want %+v %v", c.line, got, ok, c.want, c.ok)
		}
	}
}

func TestOutputTailSplitsLinesAcrossWrites(t *testing.T) {
	var got []Progress
	o := NewOutputTail(func(p Progress) { got = append(got, p) })
	// One line arrives in two chunks, and \r-terminated updates count as lines.
	o.Write([]byte("#1 [app 1/2] FR"))
	o.Write([]byte("OM alpine\n#2 [app 2/2] RUN x\r"))
	o.Write([]byte("#3 DONE 0.1s\nfim sem quebra"))
	if len(got) != 2 || got[0].Step != 1 || got[0].Text != "FROM alpine" || got[1].Step != 2 {
		t.Errorf("progresso: %+v", got)
	}
	if out := o.Output(); !strings.Contains(out, "fim sem quebra") || !strings.Contains(out, "#3 DONE") {
		t.Errorf("saída guardada: %q", out)
	}
	for i := 0; i < 200; i++ {
		o.Write([]byte("x\n"))
	}
	if n := strings.Count(o.Output(), "\n") + 1; n > keepLines+1 {
		t.Errorf("deve guardar só o fim: %d linhas", n)
	}
}

func TestBuildServices(t *testing.T) {
	cfg := `{"services":{"api":{"build":{"context":"/x"}},"db":{"image":"postgres:15"},"x":{"build":null}}}`
	m, err := BuildServices([]byte(cfg))
	if err != nil || !m["api"] || m["db"] || m["x"] || len(m) != 3 {
		t.Errorf("%v %v", m, err)
	}
	if _, err := BuildServices([]byte("nope")); err == nil {
		t.Error("JSON inválido deve dar erro")
	}
}

func TestGroupComposeAndInfo(t *testing.T) {
	lbl := func(project, service string) map[string]string {
		return map[string]string{labelProject: project, labelService: service, labelWorkingDir: "/srv/" + project, labelConfigFile: "/srv/" + project + "/compose.yml"}
	}
	items := []ContainerInfo{
		{ID: "a1", Labels: lbl("shop", "api")},
		{ID: "a2", Labels: lbl("shop", "api")},
		{ID: "d1", Labels: lbl("shop", "db")},
		{ID: "o1", Labels: lbl("other", "web")},
		{ID: "solto", Labels: map[string]string{}},
	}
	groups := GroupCompose(items)
	if len(groups) != 2 {
		t.Fatalf("grupos: %d", len(groups))
	}
	got := groups[0].Info(map[string]bool{"api": true, "db": false}, "")
	if len(got) != 2 || !got["a1"].Build || !got["a2"].Build {
		t.Errorf("só o serviço com build: %v", got)
	}
	if _, ok := got["d1"]; ok {
		t.Error("imagem pronta não tem informação (sem botão)")
	}
	bad := groups[1].Info(nil, "motivo")
	if bad["o1"].Problem != "motivo" || bad["o1"].Build {
		t.Errorf("problema vira explicação: %v", bad)
	}
}

func TestComposeProblem(t *testing.T) {
	cases := map[string]string{
		"docker: 'compose' is not a docker command.":                    "v2",
		"unknown flag: --project-name":                                  "v2",
		"bash: line 0: cd: /srv/x: No such file or directory\ncan't cd": "não existe",
		"open /srv/x/compose.yml: permission denied":                    "permissão",
		"required variable DB_PASS is missing a value":                  "DB_PASS",
		"": "não conseguiu ler",
	}
	for in, want := range cases {
		if got := ComposeProblem(in, "/srv/x"); !strings.Contains(got, want) {
			t.Errorf("%q -> %q (queria %q)", in, got, want)
		}
	}
}

func TestPlatformContainersAreExplainedNotRead(t *testing.T) {
	compose := map[string]string{labelProject: "x", labelService: "app", labelWorkingDir: "/artifacts/abc", labelConfigFile: "/artifacts/abc/docker-compose.yml"}
	coolify := map[string]string{"coolify.managed": "true", "coolify.name": "app"}
	for k, v := range compose {
		coolify[k] = v
	}
	if got := Platform(coolify); got != "Coolify" {
		t.Errorf("plataforma: %q", got)
	}
	if got := Platform(compose); got != "" {
		t.Errorf("compose puro não é plataforma: %q", got)
	}
	rest, managed := SplitPlatform([]ContainerInfo{{ID: "c1", Labels: coolify}, {ID: "p1", Labels: compose}, {ID: "s1", Labels: map[string]string{"coolify.managed": "true"}}})
	if len(rest) != 1 || rest[0].ID != "p1" {
		t.Errorf("resto: %+v", rest)
	}
	if !managed["c1"].Redeploy || managed["c1"].Platform != "Coolify" || managed["c1"].Build || managed["c1"].Problem != "" {
		t.Errorf("Coolify tem redeploy pela API: %+v", managed["c1"])
	}
	_, other := SplitPlatform([]ContainerInfo{{ID: "d1", Labels: map[string]string{"dokku.x": "1", labelProject: "a", labelService: "b", labelWorkingDir: "/x", labelConfigFile: "/x/c.yml"}}})
	if other["d1"].Redeploy || !strings.Contains(other["d1"].Problem, "Dokku") {
		t.Errorf("outras plataformas só explicam: %+v", other["d1"])
	}
	if _, ok := managed["s1"]; ok {
		t.Error("container da plataforma que não é de Compose não ganha botão")
	}
}
