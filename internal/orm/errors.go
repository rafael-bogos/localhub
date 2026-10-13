package orm

import (
	"context"
	"errors"
	"net"
	"strings"
	"syscall"
)

// friendly turns a driver error into a sentence the user can act on. The raw
// message is never returned: it can carry the connection string.
func friendly(err error, p Profile) error {
	if err == nil {
		return nil
	}
	msg := strings.ToLower(err.Error())
	var dns *net.DNSError
	switch {
	case errors.As(err, &dns), strings.Contains(msg, "no such host"):
		return errors.New("Não encontrei o endereço " + p.Host + ". Confira o host.")
	case errors.Is(err, syscall.ECONNREFUSED), strings.Contains(msg, "connection refused"):
		return errors.New("Conexão recusada em " + p.Host + ". O banco está rodando e a porta está certa?")
	case errors.Is(err, context.DeadlineExceeded), strings.Contains(msg, "i/o timeout"), strings.Contains(msg, "timeout"):
		return errors.New("O banco demorou demais para responder. Confira o host, a porta e o firewall.")
	case strings.Contains(msg, "password authentication failed"),
		strings.Contains(msg, "access denied for user"),
		strings.Contains(msg, "sqlstate 28"):
		return errors.New("Usuário ou senha incorretos.")
	case strings.Contains(msg, "does not exist") && strings.Contains(msg, "database"),
		strings.Contains(msg, "unknown database"):
		return errors.New("O banco \"" + p.Database + "\" não existe nesse servidor.")
	case strings.Contains(msg, "ssl") || strings.Contains(msg, "tls"):
		return errors.New("Falha na conexão segura. Tente trocar a opção de SSL.")
	case strings.Contains(msg, "no pg_hba.conf entry"):
		return errors.New("O servidor não aceita conexões deste computador (pg_hba.conf).")
	}
	return errors.New("Não foi possível conectar ao banco.")
}
