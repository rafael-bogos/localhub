package ssh

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// A tunnel is a local port forward over a server's existing SSH connection,
// like `ssh -fN -L 33061:172.18.3.23:3306 user@server`, aimed at a container:
// connections to 127.0.0.1:<local> are carried through the server to the
// container's IP and port on the server's Docker network. It lives as long as
// the connection does.

// loopback is the only address tunnels listen on: they must not expose a
// container to other machines on the user's network.
const loopback = "127.0.0.1"

// networkPattern matches Docker network names.
var networkPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)

// ContainerNetwork is one network a container is attached to, with its IP.
type ContainerNetwork struct {
	Name string `json:"name"`
	IP   string `json:"ip"`
}

// ContainerNet is what a tunnel to a container needs to know about it.
type ContainerNet struct {
	Running  bool               `json:"running"`
	Name     string             `json:"name"`
	Networks []ContainerNetwork `json:"networks"`
	// Ports are the container's TCP ports: declared (EXPOSE) or published.
	Ports []int `json:"ports"`
}

// Kinds of tunnel.
const (
	// TunnelContainer is opened from a container (the IP is looked up on the server).
	TunnelContainer = "container"
	// TunnelForward is a free local forward to a host and port the user typed.
	TunnelForward = "forward"
)

// TunnelInfo describes an open tunnel for the UI.
type TunnelInfo struct {
	ID   string `json:"id"`
	Kind string `json:"kind"`
	// Name and SavedID belong to forwards: the name the user gave and the id of
	// the saved definition the UI opened it from.
	Name    string `json:"name"`
	SavedID string `json:"savedId"`

	HostID        string `json:"hostId"`
	ContainerID   string `json:"containerId"`
	ContainerName string `json:"containerName"`
	Network       string `json:"network"`
	RemoteIP      string `json:"remoteIp"`
	RemotePort    int    `json:"remotePort"`
	LocalPort     int    `json:"localPort"`
	// LocalAddr is where to point a client: 127.0.0.1:<port>.
	LocalAddr string `json:"localAddr"`
}

type tunnel struct {
	info    TunnelInfo
	conn    *Conn
	ln      net.Listener
	resolve func(ctx context.Context) (string, error)

	mu     sync.Mutex
	ip     string
	open   map[net.Conn]struct{}
	closed bool
}

type inspectDoc struct {
	Name  string `json:"Name"`
	State struct {
		Running bool `json:"Running"`
	} `json:"State"`
	Config struct {
		ExposedPorts map[string]struct{} `json:"ExposedPorts"`
	} `json:"Config"`
	HostConfig struct {
		NetworkMode string `json:"NetworkMode"`
	} `json:"HostConfig"`
	NetworkSettings struct {
		Ports    map[string][]struct{ HostPort string } `json:"Ports"`
		Networks map[string]struct {
			IPAddress string `json:"IPAddress"`
		} `json:"Networks"`
	} `json:"NetworkSettings"`
}

// ContainerNetworks reads a container's networks, IPs and TCP ports.
func (s *Service) ContainerNetworks(ctx context.Context, hostID, containerID string) (ContainerNet, error) {
	if err := validID(containerID); err != nil {
		return ContainerNet{}, err
	}
	conn, err := s.remoteConn(hostID)
	if err != nil {
		return ContainerNet{}, err
	}
	res, err := runScript(ctx, conn, "docker inspect "+shQuote(containerID), listTimeout)
	if err != nil {
		return ContainerNet{}, err
	}
	if res.ExitCode != 0 {
		if _, msg, ok := dockerProblem(res, conn.User); ok {
			return ContainerNet{}, errors.New(msg)
		}
		if strings.Contains(strings.ToLower(res.Stderr), "no such") {
			return ContainerNet{}, errors.New("container não encontrado")
		}
		return ContainerNet{}, failure(res, "falha ao ler o container")
	}
	return parseContainerNet(res.Stdout)
}

func parseContainerNet(out string) (ContainerNet, error) {
	var docs []inspectDoc
	if err := json.Unmarshal([]byte(out), &docs); err != nil || len(docs) == 0 {
		return ContainerNet{}, errors.New("resposta inesperada do Docker no servidor")
	}
	d := docs[0]
	cn := ContainerNet{Running: d.State.Running, Name: strings.TrimPrefix(d.Name, "/")}

	if d.HostConfig.NetworkMode == "host" {
		// The container shares the server's network: its ports are the server's.
		cn.Networks = []ContainerNetwork{{Name: "host", IP: loopback}}
	} else {
		for name, n := range d.NetworkSettings.Networks {
			if ip := net.ParseIP(n.IPAddress); ip != nil {
				cn.Networks = append(cn.Networks, ContainerNetwork{Name: name, IP: ip.String()})
			}
		}
		sort.Slice(cn.Networks, func(i, j int) bool { return cn.Networks[i].Name < cn.Networks[j].Name })
	}

	seen := map[int]bool{}
	add := func(key string) {
		num, proto, _ := strings.Cut(key, "/")
		if proto != "" && proto != "tcp" {
			return
		}
		if p, err := strconv.Atoi(num); err == nil && p >= 1 && p <= 65535 && !seen[p] {
			seen[p] = true
			cn.Ports = append(cn.Ports, p)
		}
	}
	for k := range d.Config.ExposedPorts {
		add(k)
	}
	for k := range d.NetworkSettings.Ports {
		add(k)
	}
	sort.Ints(cn.Ports)
	return cn, nil
}

// pickNetwork chooses the network (and IP) for a tunnel.
func pickNetwork(cn ContainerNet, network string) (ContainerNetwork, error) {
	if !cn.Running {
		return ContainerNetwork{}, errors.New("inicie o container antes de abrir o túnel")
	}
	if len(cn.Networks) == 0 {
		return ContainerNetwork{}, errors.New("o container não tem endereço IP em nenhuma rede")
	}
	if network == "" {
		if len(cn.Networks) > 1 {
			return ContainerNetwork{}, errors.New("o container está em mais de uma rede: escolha qual usar")
		}
		return cn.Networks[0], nil
	}
	for _, n := range cn.Networks {
		if n.Name == network {
			return n, nil
		}
	}
	return ContainerNetwork{}, errors.New("o container não está na rede " + network)
}

// SuggestLocalPort proposes a free local port for a container port: the same
// number if it is free (the natural choice), then offsets that stay out of
// the way of a local database; 0 lets the system choose.
func (s *Service) SuggestLocalPort(remotePort int) int {
	for _, p := range []int{remotePort, remotePort + 30000, remotePort + 10000, remotePort + 20000} {
		if p >= 1024 && p <= 65535 && portFree(p) {
			return p
		}
	}
	return 0
}

func portFree(p int) bool {
	ln, err := net.Listen("tcp", net.JoinHostPort(loopback, strconv.Itoa(p)))
	if err != nil {
		return false
	}
	ln.Close()
	return true
}

// OpenTunnel starts forwarding 127.0.0.1:localPort (0 = any free port) to the
// container's networkPort through the server. The container's IP is looked up
// here, never taken from the UI, and looked up again when it changes (e.g.
// after a restart).
func (s *Service) OpenTunnel(ctx context.Context, hostID, containerID, network string, remotePort, localPort int) (TunnelInfo, error) {
	if err := validID(containerID); err != nil {
		return TunnelInfo{}, err
	}
	if network != "" && !networkPattern.MatchString(network) {
		return TunnelInfo{}, errors.New("nome de rede inválido")
	}
	if remotePort < 1 || remotePort > 65535 {
		return TunnelInfo{}, errors.New("a porta do container deve estar entre 1 e 65535")
	}
	if localPort < 0 || localPort > 65535 {
		return TunnelInfo{}, errors.New("a porta local deve estar entre 1 e 65535")
	}
	conn, err := s.remoteConn(hostID)
	if err != nil {
		return TunnelInfo{}, err
	}

	resolve := func(ctx context.Context) (string, error) {
		cn, err := s.ContainerNetworks(ctx, hostID, containerID)
		if err != nil {
			return "", err
		}
		n, err := pickNetwork(cn, network)
		return n.IP, err
	}
	cn, err := s.ContainerNetworks(ctx, hostID, containerID)
	if err != nil {
		return TunnelInfo{}, err
	}
	picked, err := pickNetwork(cn, network)
	if err != nil {
		return TunnelInfo{}, err
	}

	ln, err := listenLocal(localPort)
	if err != nil {
		return TunnelInfo{}, err
	}
	actual := ln.Addr().(*net.TCPAddr).Port

	t := &tunnel{
		conn:    conn,
		ln:      ln,
		resolve: resolve,
		ip:      picked.IP,
		open:    map[net.Conn]struct{}{},
		info: TunnelInfo{
			ID:            newTunnelID(),
			Kind:          TunnelContainer,
			HostID:        hostID,
			ContainerID:   containerID,
			ContainerName: cn.Name,
			Network:       picked.Name,
			RemoteIP:      picked.IP,
			RemotePort:    remotePort,
			LocalPort:     actual,
			LocalAddr:     net.JoinHostPort(loopback, strconv.Itoa(actual)),
		},
	}

	s.registerTunnel(t)
	return t.info, nil
}

func newTunnelID() string {
	return fmt.Sprintf("t%x", time.Now().UnixNano())
}

func (t *tunnel) serve(s *Service) {
	for {
		c, err := t.ln.Accept()
		if err != nil {
			return // closed
		}
		go t.handle(c)
	}
}

func (t *tunnel) track(c net.Conn) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.closed {
		return false
	}
	t.open[c] = struct{}{}
	return true
}

func (t *tunnel) untrack(c net.Conn) {
	t.mu.Lock()
	delete(t.open, c)
	t.mu.Unlock()
}

// dial reaches the destination through the server. For a container tunnel, if
// the container's IP changed since the tunnel opened it looks the IP up again
// once.
func (t *tunnel) dial() (net.Conn, error) {
	port := strconv.Itoa(t.info.RemotePort)
	t.mu.Lock()
	ip := t.ip
	t.mu.Unlock()

	c, err := t.conn.Client.Dial("tcp", net.JoinHostPort(ip, port))
	if err == nil || t.resolve == nil {
		return c, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), listTimeout)
	defer cancel()
	newIP, rerr := t.resolve(ctx)
	if rerr != nil || newIP == ip {
		return nil, err
	}
	t.mu.Lock()
	t.ip = newIP
	t.mu.Unlock()
	return t.conn.Client.Dial("tcp", net.JoinHostPort(newIP, port))
}

func (t *tunnel) handle(local net.Conn) {
	if !t.track(local) {
		local.Close()
		return
	}
	defer t.untrack(local)
	defer local.Close()

	remote, err := t.dial()
	if err != nil {
		return // the client sees the connection close
	}
	if !t.track(remote) {
		remote.Close()
		return
	}
	defer t.untrack(remote)
	defer remote.Close()

	done := make(chan struct{}, 2)
	cp := func(dst, src net.Conn) {
		io.Copy(dst, src)
		done <- struct{}{}
	}
	go cp(remote, local)
	go cp(local, remote)
	<-done // either side finishing ends the session
}

func (t *tunnel) close() {
	t.mu.Lock()
	if t.closed {
		t.mu.Unlock()
		return
	}
	t.closed = true
	conns := make([]net.Conn, 0, len(t.open))
	for c := range t.open {
		conns = append(conns, c)
	}
	t.mu.Unlock()
	t.ln.Close()
	for _, c := range conns {
		c.Close()
	}
}

func (s *Service) closeTunnel(id string) {
	s.tmu.Lock()
	t := s.tunnels[id]
	delete(s.tunnels, id)
	s.tmu.Unlock()
	if t != nil {
		t.close()
		s.emitTunnels()
	}
}

// CloseTunnel stops a tunnel and drops its open connections.
func (s *Service) CloseTunnel(id string) { s.closeTunnel(id) }

// ListTunnels returns the open tunnels, oldest first.
func (s *Service) ListTunnels() []TunnelInfo {
	s.tmu.Lock()
	defer s.tmu.Unlock()
	list := make([]TunnelInfo, 0, len(s.tunnels))
	for _, t := range s.tunnels {
		list = append(list, t.info)
	}
	sort.Slice(list, func(i, j int) bool { return list[i].ID < list[j].ID })
	return list
}

func (s *Service) emitTunnels() { s.emit("tunnels:changed", s.ListTunnels()) }

// hostPattern matches a DNS name or an IPv4 address; IPv6 goes through net.ParseIP.
var hostPattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9._-]{0,251}[A-Za-z0-9])?$`)

func validForwardHost(h string) bool {
	return hostPattern.MatchString(h) || net.ParseIP(h) != nil
}

// OpenForward starts a free local port forward over the server's connection,
// like `ssh -fN -L localPort:remoteHost:remotePort`: 127.0.0.1:localPort
// (0 = any free port) is carried through the server to remoteHost:remotePort,
// which the server resolves and reaches itself (so it can be a private address
// the user's computer can't see). name and savedID only label the tunnel for
// the UI. It listens on loopback only.
func (s *Service) OpenForward(ctx context.Context, hostID, savedID, name, remoteHost string, remotePort, localPort int) (TunnelInfo, error) {
	remoteHost = strings.TrimSpace(remoteHost)
	if !validForwardHost(remoteHost) {
		return TunnelInfo{}, errors.New("o destino deve ser um IP ou um nome de host válido (sem espaços nem barras)")
	}
	if remotePort < 1 || remotePort > 65535 {
		return TunnelInfo{}, errors.New("a porta de destino deve estar entre 1 e 65535")
	}
	if localPort < 0 || localPort > 65535 {
		return TunnelInfo{}, errors.New("a porta local deve estar entre 1 e 65535")
	}
	if len(name) > 120 || len(savedID) > 100 {
		return TunnelInfo{}, errors.New("nome ou identificador grande demais")
	}
	conn, err := s.remoteConn(hostID)
	if err != nil {
		return TunnelInfo{}, err
	}
	// Opening the same saved tunnel twice would only fail on the port; say so.
	if savedID != "" {
		for _, t := range s.ListTunnels() {
			if t.SavedID == savedID {
				return TunnelInfo{}, errors.New("este túnel já está aberto")
			}
		}
	}

	ln, err := listenLocal(localPort)
	if err != nil {
		return TunnelInfo{}, err
	}
	actual := ln.Addr().(*net.TCPAddr).Port
	t := &tunnel{
		conn: conn,
		ln:   ln,
		ip:   remoteHost, // for a forward this is the typed host, used as is
		open: map[net.Conn]struct{}{},
		info: TunnelInfo{
			ID:         newTunnelID(),
			Kind:       TunnelForward,
			Name:       name,
			SavedID:    savedID,
			HostID:     hostID,
			RemoteIP:   remoteHost,
			RemotePort: remotePort,
			LocalPort:  actual,
			LocalAddr:  net.JoinHostPort(loopback, strconv.Itoa(actual)),
		},
	}
	s.registerTunnel(t)
	return t.info, nil
}

// listenLocal opens the loopback listener of a tunnel with readable errors.
func listenLocal(localPort int) (net.Listener, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(loopback, strconv.Itoa(localPort)))
	if err != nil {
		if strings.Contains(err.Error(), "address already in use") {
			return nil, fmt.Errorf("a porta %d já está em uso neste computador", localPort)
		}
		if strings.Contains(err.Error(), "permission denied") {
			return nil, fmt.Errorf("sem permissão para usar a porta %d (portas abaixo de 1024 exigem privilégio)", localPort)
		}
		return nil, fmt.Errorf("não foi possível abrir a porta %d: %w", localPort, err)
	}
	return ln, nil
}

// registerTunnel starts serving a tunnel and ties its life to the connection's.
func (s *Service) registerTunnel(t *tunnel) {
	s.tmu.Lock()
	if s.tunnels == nil {
		s.tunnels = map[string]*tunnel{}
	}
	s.tunnels[t.info.ID] = t
	s.tmu.Unlock()

	go t.serve(s)
	go func() { // the tunnel ends with its connection
		<-t.conn.Done()
		s.closeTunnel(t.info.ID)
	}()
	s.emitTunnels()
}
