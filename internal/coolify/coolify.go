// Package coolify talks to the API of a Coolify instance, to redeploy the
// applications whose containers localhub lists. It knows nothing about Wails.
package coolify

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// Config is how to reach one Coolify: its address and an API token (created in
// Coolify under Keys & Tokens, with the read and deploy permissions).
type Config struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

const (
	requestTimeout = 20 * time.Second
	// DeployTimeout bounds the wait for a deploy to finish.
	DeployTimeout = 30 * time.Minute
)

// pollEvery is how often a running deploy is checked (a variable for tests).
var pollEvery = 3 * time.Second

// ErrAuth marks a token problem, so the UI can offer to fix the settings.
var ErrAuth = errors.New("Token do Coolify inválido, expirado ou sem permissão (precisa de read e deploy).")

// Client is a Coolify API client.
type Client struct {
	base  string // https://coolify.example.com/api/v1
	token string
	http  *http.Client
}

// NewClient validates the address and builds a client. The token is only ever
// sent in the Authorization header, never in the URL or in an error message.
func NewClient(c Config) (*Client, error) {
	raw := strings.TrimSpace(c.URL)
	if raw == "" {
		return nil, errors.New("Informe o endereço do Coolify.")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, errors.New("Endereço do Coolify inválido. Exemplo: https://coolify.suaempresa.com")
	}
	if strings.TrimSpace(c.Token) == "" {
		return nil, errors.New("Informe o token da API do Coolify.")
	}
	path := strings.TrimRight(u.Path, "/")
	path = strings.TrimSuffix(path, "/api/v1")
	base := u.Scheme + "://" + u.Host + path + "/api/v1"
	return &Client{
		base:  base,
		token: strings.TrimSpace(c.Token),
		http: &http.Client{
			Timeout: requestTimeout,
			// A redirect (often http -> https) would drop the token; say so instead.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

// IsPlainHTTP says the address sends the token unencrypted (the UI warns).
func IsPlainHTTP(rawURL string) bool {
	raw := strings.TrimSpace(rawURL)
	return strings.HasPrefix(strings.ToLower(raw), "http://")
}

func (c *Client) do(ctx context.Context, method, path string, query url.Values, out any) error {
	u := c.base + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, nil)
	if err != nil {
		return errors.New("Endereço do Coolify inválido.")
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return friendlyNet(err, c.base)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))

	switch {
	case resp.StatusCode >= 300 && resp.StatusCode < 400:
		return fmt.Errorf("O endereço do Coolify redireciona para %s. Use o endereço final (em geral com https://).", resp.Header.Get("Location"))
	case resp.StatusCode == http.StatusUnauthorized:
		return ErrAuth
	case resp.StatusCode == http.StatusForbidden:
		return ErrAuth
	case resp.StatusCode == http.StatusTooManyRequests:
		return errors.New("O Coolify limitou as requisições. Tente de novo em instantes.")
	case resp.StatusCode == http.StatusNotFound:
		return errNotFound
	case resp.StatusCode == http.StatusMethodNotAllowed:
		return errMethod
	case resp.StatusCode >= 500:
		return fmt.Errorf("O Coolify respondeu com erro (HTTP %d).", resp.StatusCode)
	case resp.StatusCode >= 400:
		return errors.New("O Coolify recusou o pedido: " + apiMessage(body))
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return errors.New("O endereço não parece ser a API do Coolify. Confira a URL e se a API está habilitada (Settings → Advanced → API Access).")
	}
	return nil
}

var (
	errNotFound = errors.New("Recurso não encontrado no Coolify.")
	errMethod   = errors.New("método não aceito")
)

// apiMessage reads Coolify's {"message": "..."} error body.
func apiMessage(body []byte) string {
	var e struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &e) == nil && e.Message != "" {
		if r := []rune(e.Message); len(r) > 200 {
			return string(r[:200]) + "…"
		}
		return e.Message
	}
	return "resposta inesperada"
}

func friendlyNet(err error, base string) error {
	host := base
	if u, e := url.Parse(base); e == nil {
		host = u.Host
	}
	var dns *net.DNSError
	var cert x509.UnknownAuthorityError
	var host2 x509.HostnameError
	msg := strings.ToLower(err.Error())
	switch {
	case errors.As(err, &dns):
		return errors.New("Não encontrei o endereço " + host + ". Confira a URL do Coolify.")
	case errors.As(err, &cert), errors.As(err, &host2), strings.Contains(msg, "certificate"):
		return errors.New("O certificado do Coolify em " + host + " não é confiável.")
	case strings.Contains(msg, "connection refused"):
		return errors.New("Conexão recusada em " + host + ". O Coolify está no ar?")
	case errors.Is(err, context.DeadlineExceeded), strings.Contains(msg, "timeout"), strings.Contains(msg, "deadline"):
		return errors.New("O Coolify em " + host + " demorou demais para responder.")
	case errors.Is(err, context.Canceled):
		return context.Canceled
	}
	return errors.New("Não foi possível falar com o Coolify em " + host + ".")
}

// Ping checks the address and the token, returning the name of the team the
// token belongs to.
func (c *Client) Ping(ctx context.Context) (string, error) {
	var team struct {
		Name string `json:"name"`
	}
	if err := c.do(ctx, http.MethodGet, "/teams/current", nil, &team); err != nil {
		return "", err
	}
	return team.Name, nil
}

// App is an application registered in Coolify.
type App struct {
	ID   int    `json:"id"`
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

// Applications lists the applications the token can see.
func (c *Client) Applications(ctx context.Context) ([]App, error) {
	var apps []App
	if err := c.do(ctx, http.MethodGet, "/applications", nil, &apps); err != nil {
		return nil, err
	}
	return apps, nil
}

var uuidLike = regexp.MustCompile(`[a-z0-9]{24}`)

// Candidates are the strings of a container that may be its application's
// UUID: Coolify names containers "<uuid>-<number>" and uses the UUID as the
// Compose project. Anything not matching a real application is discarded later.
func Candidates(name string, labels map[string]string) []string {
	seen := map[string]bool{}
	var out []string
	add := func(s string) {
		for _, m := range uuidLike.FindAllString(strings.ToLower(s), -1) {
			if !seen[m] {
				seen[m] = true
				out = append(out, m)
			}
		}
	}
	add(name)
	for _, k := range []string{"com.docker.compose.project", "coolify.name", "coolify.resourceName"} {
		add(labels[k])
	}
	return out
}

// FindApp picks the application of a container: by a UUID found in its names,
// else by the numeric id Coolify puts in the "coolify.applicationId" label.
func FindApp(apps []App, name string, labels map[string]string) (App, bool) {
	byUUID := map[string]App{}
	for _, a := range apps {
		byUUID[strings.ToLower(a.UUID)] = a
	}
	for _, cand := range Candidates(name, labels) {
		if a, ok := byUUID[cand]; ok {
			return a, true
		}
	}
	if id, err := strconv.Atoi(labels["coolify.applicationId"]); err == nil {
		for _, a := range apps {
			if a.ID == id {
				return a, true
			}
		}
	}
	return App{}, false
}

// Deploy starts a deploy of an application and returns the deployment's UUID.
func (c *Client) Deploy(ctx context.Context, appUUID string, force bool) (string, error) {
	q := url.Values{"uuid": {appUUID}}
	if force {
		q.Set("force", "true")
	}
	var res struct {
		Deployments []struct {
			Message        string `json:"message"`
			DeploymentUUID string `json:"deployment_uuid"`
		} `json:"deployments"`
	}
	err := c.do(ctx, http.MethodPost, "/deploy", q, &res)
	if errors.Is(err, errMethod) || errors.Is(err, errNotFound) {
		// Older Coolify versions only accept GET here.
		err = c.do(ctx, http.MethodGet, "/deploy", q, &res)
	}
	if err != nil {
		if errors.Is(err, errNotFound) {
			return "", errors.New("O Coolify não achou esse app para fazer o deploy.")
		}
		return "", err
	}
	if len(res.Deployments) == 0 || res.Deployments[0].DeploymentUUID == "" {
		return "", errors.New("O Coolify não iniciou o deploy: " + "resposta sem deployment.")
	}
	return res.Deployments[0].DeploymentUUID, nil
}

// Deployment is the state of one deploy.
type Deployment struct {
	Status string `json:"status"`
	Logs   string `json:"logs"`
}

// Deployment reads a deploy's status and log.
func (c *Client) Deployment(ctx context.Context, deploymentUUID string) (Deployment, error) {
	var d Deployment
	if err := c.do(ctx, http.MethodGet, "/deployments/"+url.PathEscape(deploymentUUID), nil, &d); err != nil {
		return Deployment{}, err
	}
	return d, nil
}

// Outcome classifies a Coolify deployment status.
type Outcome int

const (
	Pending Outcome = iota
	Finished
	Failed
)

// Classify says whether a status is final. Coolify's statuses are "queued",
// "in_progress", "finished", "failed" and "cancelled-by-user".
func Classify(status string) Outcome {
	s := strings.ToLower(status)
	switch {
	case s == "finished":
		return Finished
	case s == "failed", strings.HasPrefix(s, "cancel"):
		return Failed
	}
	return Pending
}

// StatusText is the status in Portuguese, for the row's progress line.
func StatusText(status string) string {
	switch strings.ToLower(status) {
	case "queued":
		return "na fila"
	case "in_progress":
		return "em andamento"
	case "finished":
		return "concluído"
	case "failed":
		return "falhou"
	}
	if strings.HasPrefix(strings.ToLower(status), "cancel") {
		return "cancelado"
	}
	return status
}

// LogTail extracts the last lines of a deployment log (a JSON array of
// entries with an "output" text, or plain text).
func LogTail(logs string, lines int) string {
	var entries []struct {
		Output string `json:"output"`
		Hidden bool   `json:"hidden"`
	}
	var texts []string
	if json.Unmarshal([]byte(logs), &entries) == nil {
		for _, e := range entries {
			if !e.Hidden && strings.TrimSpace(e.Output) != "" {
				texts = append(texts, strings.Split(strings.TrimRight(e.Output, "\n"), "\n")...)
			}
		}
	} else {
		texts = strings.Split(logs, "\n")
	}
	var kept []string
	for _, l := range texts {
		if l = strings.TrimRight(l, " \t\r"); strings.TrimSpace(l) != "" {
			kept = append(kept, l)
		}
	}
	if len(kept) > lines {
		kept = kept[len(kept)-lines:]
	}
	s := strings.Join(kept, "\n")
	if r := []rune(s); len(r) > 2000 {
		s = "…" + string(r[len(r)-2000:])
	}
	return s
}

// Wait follows a deployment until it ends, telling onStatus each time the
// status changes. It returns nil on success and an error (with the end of the
// log) when the deploy failed or was cancelled.
func (c *Client) Wait(ctx context.Context, deploymentUUID string, onStatus func(status string)) error {
	ctx, cancel := context.WithTimeout(ctx, DeployTimeout)
	defer cancel()
	last := ""
	for {
		d, err := c.Deployment(ctx, deploymentUUID)
		if err != nil {
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return errors.New("O deploy passou de 30 minutos. Acompanhe pelo painel do Coolify.")
			}
			return err
		}
		if d.Status != last {
			last = d.Status
			if onStatus != nil {
				onStatus(d.Status)
			}
		}
		switch Classify(d.Status) {
		case Finished:
			return nil
		case Failed:
			msg := "O deploy " + StatusText(d.Status) + " no Coolify."
			if tail := LogTail(d.Logs, 12); tail != "" {
				msg += "\n" + tail
			}
			return errors.New(msg)
		}
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return errors.New("O deploy passou de 30 minutos. Acompanhe pelo painel do Coolify.")
			}
			return ctx.Err()
		case <-time.After(pollEvery):
		}
	}
}
