package orm

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

const (
	maxChangesPerSave = 500
	writeTimeout      = 30 * time.Second
)

// CellValue is a column's new value as text; a nil Value is SQL NULL.
type CellValue struct {
	Column string  `json:"column"`
	Value  *string `json:"value"`
}

// RowChange is new values for one row, found by its primary key.
type RowChange struct {
	Key map[string]string `json:"key"`
	Set []CellValue       `json:"set"`
}

// UpdateRequest is a batch of row edits to one table, applied together or not
// at all.
type UpdateRequest struct {
	Schema  string      `json:"schema"`
	Table   string      `json:"table"`
	Changes []RowChange `json:"changes"`
}

// typeName guards the column type that goes into a CAST: it comes from the
// engine's own catalog, but it is still put into SQL text, so it is checked.
var typeName = regexp.MustCompile(`^[A-Za-z0-9_ ,."()\[\]]{1,120}$`)

// valueExpr is how one parameter is written in SQL. PostgreSQL gets the
// column's type spelled out, so text from the UI becomes a number, date or
// uuid in the database (and a clear error if it cannot).
func valueExpr(kind string, c Column, n int) (string, error) {
	if kind == MySQL {
		return "?", nil
	}
	if !typeName.MatchString(c.Type) {
		return "", errors.New("Tipo de coluna não suportado para edição: " + c.Name + ".")
	}
	return fmt.Sprintf("CAST($%d::text AS %s)", n, c.Type), nil
}

// mysqlValue maps the words a boolean shows as to what MySQL stores.
func mysqlValue(c Column, v string) any {
	lt := strings.ToLower(c.Type)
	if strings.HasPrefix(lt, "tinyint(1)") || lt == "bool" || lt == "boolean" {
		switch strings.ToLower(v) {
		case "true":
			return "1"
		case "false":
			return "0"
		}
	}
	return v
}

// buildUpdate composes the UPDATE of one row. Table and columns are looked up
// in the introspected table; values only ever travel as parameters.
func buildUpdate(kind string, t *Table, ch RowChange) (string, []any, error) {
	if len(t.PrimaryKey) == 0 {
		return "", nil, errors.New("Esta tabela não tem chave primária e não pode ser editada.")
	}
	if len(ch.Set) == 0 {
		return "", nil, errors.New("Alteração vazia.")
	}
	cols := map[string]Column{}
	for _, c := range t.Columns {
		cols[c.Name] = c
	}
	isPK := map[string]bool{}
	for _, k := range t.PrimaryKey {
		isPK[k] = true
	}

	values := make(map[string]*string, len(ch.Set))
	names := make([]string, 0, len(ch.Set))
	for _, cv := range ch.Set {
		name := cv.Column
		if _, ok := cols[name]; !ok {
			return "", nil, errors.New("Coluna inexistente: " + name + ".")
		}
		if isPK[name] {
			return "", nil, errors.New("A chave primária não pode ser editada (" + name + ").")
		}
		if _, dup := values[name]; dup {
			return "", nil, errors.New("Coluna repetida na alteração: " + name + ".")
		}
		values[name] = cv.Value
		names = append(names, name)
	}
	// Deterministic: in the table's own column order.
	order := map[string]int{}
	for i, c := range t.Columns {
		order[c.Name] = i
	}
	sort.Slice(names, func(i, j int) bool { return order[names[i]] < order[names[j]] })

	var args []any
	add := func(c Column, v string) (string, error) {
		if kind == MySQL {
			args = append(args, mysqlValue(c, v))
			return "?", nil
		}
		args = append(args, v)
		return valueExpr(kind, c, len(args))
	}

	sets := make([]string, 0, len(names))
	for _, name := range names {
		v := values[name]
		if v == nil {
			sets = append(sets, quoteIdent(kind, name)+" = NULL")
			continue
		}
		expr, err := add(cols[name], *v)
		if err != nil {
			return "", nil, err
		}
		sets = append(sets, quoteIdent(kind, name)+" = "+expr)
	}

	wheres := make([]string, 0, len(t.PrimaryKey))
	for _, k := range t.PrimaryKey {
		v, ok := ch.Key[k]
		if !ok {
			return "", nil, errors.New("Faltou o valor da chave primária " + k + ".")
		}
		expr, err := add(cols[k], v)
		if err != nil {
			return "", nil, err
		}
		wheres = append(wheres, quoteIdent(kind, k)+" = "+expr)
	}
	return "UPDATE " + qualified(kind, t) + " SET " + strings.Join(sets, ", ") + " WHERE " + strings.Join(wheres, " AND "), args, nil
}

// Update applies row edits in one transaction. Each edit must touch exactly
// one row; otherwise everything is rolled back.
func (m *Manager) Update(ctx context.Context, id string, req UpdateRequest) (int, error) {
	s, err := m.get(id)
	if err != nil {
		return 0, err
	}
	if s.profile.ReadOnly {
		return 0, errors.New("Esta conexão está em modo somente leitura. Edite a conexão para permitir alterações.")
	}
	if len(req.Changes) == 0 {
		return 0, errors.New("Nenhuma alteração para salvar.")
	}
	if len(req.Changes) > maxChangesPerSave {
		return 0, errors.New("Muitas alterações de uma vez. Salve em lotes menores.")
	}
	t, err := m.table(ctx, s, req.Schema, req.Table)
	if err != nil {
		return 0, err
	}

	type stmt struct {
		q    string
		args []any
	}
	stmts := make([]stmt, 0, len(req.Changes))
	for _, ch := range req.Changes {
		q, args, err := buildUpdate(s.profile.Kind, t, ch)
		if err != nil {
			return 0, err
		}
		stmts = append(stmts, stmt{q, args})
	}

	ctx, cancel := context.WithTimeout(ctx, writeTimeout)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return 0, friendlyWrite(err)
	}
	defer tx.Rollback()
	for _, st := range stmts {
		res, err := tx.ExecContext(ctx, st.q, st.args...)
		if err != nil {
			return 0, friendlyWrite(err)
		}
		if n, err := res.RowsAffected(); err == nil && n != 1 {
			return 0, errors.New("Uma das linhas não foi encontrada (foi alterada ou removida por outra pessoa?). Nada foi salvo; atualize a tabela.")
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, friendlyWrite(err)
	}
	return len(stmts), nil
}

// friendlyWrite explains a failed write without echoing the driver's text,
// which can carry values from the user's data.
func friendlyWrite(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("A gravação demorou demais e foi cancelada. Nada foi salvo.")
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "23505"), strings.Contains(msg, "duplicate entry"), strings.Contains(msg, "unique constraint"):
		return errors.New("Esse valor já existe em outra linha (a coluna é única). Nada foi salvo.")
	case strings.Contains(msg, "23503"), strings.Contains(msg, "foreign key"):
		return errors.New("Violação de chave estrangeira: o valor aponta para uma linha que não existe, ou a linha é usada por outra tabela. Nada foi salvo.")
	case strings.Contains(msg, "23502"), strings.Contains(msg, "cannot be null"), strings.Contains(msg, "not-null"), strings.Contains(msg, "doesn't have a default"):
		return errors.New("Uma coluna obrigatória ficou vazia (NULL). Nada foi salvo.")
	case strings.Contains(msg, "22p02"), strings.Contains(msg, "invalid input"), strings.Contains(msg, "incorrect"), strings.Contains(msg, "out of range"),
		strings.Contains(msg, "22007"), strings.Contains(msg, "22003"), strings.Contains(msg, "data too long"), strings.Contains(msg, "22001"), strings.Contains(msg, "22008"):
		return errors.New("Valor inválido para o tipo da coluna (formato, tamanho ou intervalo). Nada foi salvo.")
	case strings.Contains(msg, "23514"), strings.Contains(msg, "check constraint"):
		return errors.New("O valor não passa na regra (CHECK) da coluna. Nada foi salvo.")
	case strings.Contains(msg, "permission denied"), strings.Contains(msg, "command denied"), strings.Contains(msg, "read-only"):
		return errors.New("O usuário não tem permissão para alterar esta tabela. Nada foi salvo.")
	case strings.Contains(msg, "connection"), strings.Contains(msg, "eof"):
		return errors.New("A conexão com o banco caiu. Nada foi salvo; conecte de novo.")
	}
	return errors.New("Não foi possível salvar as alterações. Nada foi salvo.")
}
