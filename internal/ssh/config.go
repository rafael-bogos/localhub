package ssh

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

// ConfigHost is one concrete server found in ~/.ssh/config.
type ConfigHost struct {
	Name    string `json:"name"`
	Address string `json:"address"`
	Port    int    `json:"port"`
	User    string `json:"user"`
	// KeyPath is the first IdentityFile, with ~ expanded; empty means "use the agent".
	KeyPath string `json:"keyPath"`
}

// ImportResult is what the UI previews before saving anything.
type ImportResult struct {
	Hosts []ConfigHost `json:"hosts"`
	// Ignored counts what the basic importer skipped: wildcard Host blocks,
	// Include and Match lines, and servers that need ProxyJump/ProxyCommand.
	Ignored int `json:"ignored"`
}

// ImportConfig reads ~/.ssh/config.
func ImportConfig() (ImportResult, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return ImportResult{}, fmt.Errorf("pasta do usuário indisponível: %w", err)
	}
	f, err := os.Open(filepath.Join(home, ".ssh", "config"))
	if errors.Is(err, os.ErrNotExist) {
		return ImportResult{}, errors.New("o arquivo ~/.ssh/config não existe")
	}
	if err != nil {
		return ImportResult{}, err
	}
	defer f.Close()
	return ParseConfig(f, home, localUser()), nil
}

func localUser() string {
	if u, err := user.Current(); err == nil && u.Username != "" {
		return u.Username
	}
	return os.Getenv("USER")
}

// block is one "Host" section being accumulated.
type block struct {
	aliases   []string // concrete (no wildcard) names
	wildcard  bool     // at least one pattern was a wildcard/negation
	hostName  string
	user      string
	port      int
	key       string
	proxied   bool
	hasValues bool
}

// ParseConfig reads the basic subset of ssh_config the importer supports:
// Host, HostName, User, Port and IdentityFile. defaultUser fills servers
// without a User, as OpenSSH does with the local login.
func ParseConfig(r io.Reader, home, defaultUser string) ImportResult {
	var res ImportResult
	var cur *block

	flush := func() {
		if cur == nil {
			return
		}
		b := cur
		cur = nil
		if b.wildcard {
			res.Ignored++ // "Host *" style defaults are not applied in v1
		}
		for _, alias := range b.aliases {
			if b.proxied {
				res.Ignored++
				continue
			}
			h := ConfigHost{Name: alias, Address: alias, Port: 22, User: defaultUser}
			if b.hostName != "" {
				h.Address = b.hostName
			}
			if b.port > 0 {
				h.Port = b.port
			}
			if b.user != "" {
				h.User = b.user
			}
			h.KeyPath = resolveKey(b.key, home)
			res.Hosts = append(res.Hosts, h)
		}
	}

	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		key, value := splitDirective(sc.Text())
		if key == "" {
			continue
		}
		switch key {
		case "host":
			flush()
			cur = &block{}
			for _, pat := range fields(value) {
				if strings.ContainsAny(pat, "*?!") {
					cur.wildcard = true
				} else {
					cur.aliases = append(cur.aliases, pat)
				}
			}
		case "match":
			flush()
			res.Ignored++
		case "include":
			res.Ignored++
		case "hostname":
			if cur != nil && cur.hostName == "" {
				cur.hostName = unquote(value)
			}
		case "user":
			if cur != nil && cur.user == "" {
				cur.user = unquote(value)
			}
		case "port":
			if cur != nil && cur.port == 0 {
				if n, err := strconv.Atoi(unquote(value)); err == nil && n >= 1 && n <= 65535 {
					cur.port = n
				}
			}
		case "identityfile":
			if cur != nil && cur.key == "" {
				cur.key = unquote(value)
			}
		case "proxyjump", "proxycommand":
			if cur != nil {
				cur.proxied = true
			}
		}
	}
	flush()
	return res
}

// splitDirective parses "Key value" and "Key=value", dropping comments.
// Keys are returned lower-case; blank and comment lines return "".
func splitDirective(line string) (key, value string) {
	line = strings.TrimSpace(line)
	if line == "" || strings.HasPrefix(line, "#") {
		return "", ""
	}
	i := strings.IndexAny(line, " \t=")
	if i < 0 {
		return strings.ToLower(line), ""
	}
	key = strings.ToLower(line[:i])
	value = strings.TrimSpace(strings.TrimLeft(line[i:], " \t="))
	return key, value
}

// fields splits a value on whitespace, honoring double quotes.
func fields(v string) []string {
	var out []string
	var cur strings.Builder
	inQuote, has := false, false
	for _, r := range v {
		switch {
		case r == '"':
			inQuote, has = !inQuote, true
		case (r == ' ' || r == '\t') && !inQuote:
			if has {
				out = append(out, cur.String())
				cur.Reset()
				has = false
			}
		case r == '#' && !inQuote && !has:
			return out
		default:
			cur.WriteRune(r)
			has = true
		}
	}
	if has {
		out = append(out, cur.String())
	}
	return out
}

func unquote(v string) string {
	if f := fields(v); len(f) > 0 {
		return f[0]
	}
	return ""
}

// resolveKey expands ~ in an IdentityFile. Paths using ssh_config tokens
// (%d, %h, ...) are not supported and fall back to the agent.
func resolveKey(p, home string) string {
	if p == "" || strings.Contains(p, "%") {
		return ""
	}
	if p == "~" || strings.HasPrefix(p, "~/") {
		return filepath.Join(home, p[1:])
	}
	return p
}
