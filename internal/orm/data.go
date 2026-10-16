package orm

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultPageSize = 50
	maxPageSize     = 500
	browseTimeout   = 20 * time.Second
	// maxCellRunes keeps one huge text/blob value from bloating a page.
	maxCellRunes = 2000
)

// BrowseRequest asks for one page of rows of one table. Table and OrderBy are
// names the user picked in the UI; they are checked against the introspected
// schema and quoted, never concatenated as typed.
type BrowseRequest struct {
	Schema  string `json:"schema"`
	Table   string `json:"table"`
	Limit   int    `json:"limit"`
	Offset  int    `json:"offset"`
	OrderBy string `json:"orderBy"`
	Desc    bool   `json:"desc"`
	// Search keeps rows that match this text. SearchColumn picks one column
	// ("" = the indexed columns) and SearchMode how to compare: "prefix"
	// (default), "exact" or "contains" (the only mode that scans the table).
	Search       string `json:"search"`
	SearchColumn string `json:"searchColumn"`
	SearchMode   string `json:"searchMode"`
}

// Page is one slice of a table. Cells are display strings; nil is SQL NULL.
type Page struct {
	Columns []string    `json:"columns"`
	Rows    [][]*string `json:"rows"`
	// HasMore says there is at least one row after this page; counting every
	// row would scan the whole table just to open it.
	HasMore bool `json:"hasMore"`
	// SearchNote says where a search looked and how ("id (igual), email
	// (começa com)"), or why it could not search.
	SearchNote string `json:"searchNote"`
}

// quoteIdent quotes a table or column name for the engine.
func quoteIdent(kind, name string) string {
	if kind == MySQL {
		return "`" + strings.ReplaceAll(name, "`", "``") + "`"
	}
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func qualified(kind string, t *Table) string {
	if kind == Postgres && t.Schema != "" {
		return quoteIdent(kind, t.Schema) + "." + quoteIdent(kind, t.Name)
	}
	return quoteIdent(kind, t.Name)
}

// likeEscape makes %, _ and the escape character literal inside a LIKE pattern.
func hasColumn(t *Table, name string) bool {
	for _, c := range t.Columns {
		if c.Name == name {
			return true
		}
	}
	return false
}

func likeEscape(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

// buildBrowse composes the SELECT for a page. It reads one row past the limit
// to learn whether another page exists.
func buildBrowse(kind string, t *Table, req BrowseRequest) (string, []any, error) {
	q, args, _, err := buildBrowseNote(kind, t, req)
	return q, args, err
}

// buildBrowseNote is buildBrowse plus the description of the search it built.
func buildBrowseNote(kind string, t *Table, req BrowseRequest) (string, []any, string, error) {
	limit := req.Limit
	if limit <= 0 {
		limit = defaultPageSize
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}
	if req.Offset < 0 {
		return "", nil, "", errors.New("Página inválida.")
	}
	if len(t.Columns) == 0 {
		return "", nil, "", errors.New("A tabela não tem colunas.")
	}

	cols := make([]string, len(t.Columns))
	for i, c := range t.Columns {
		cols[i] = quoteIdent(kind, c.Name)
	}
	var b strings.Builder
	b.WriteString("SELECT " + strings.Join(cols, ", ") + " FROM " + qualified(kind, t))

	var args []any
	ph := func() string {
		if kind == MySQL {
			return "?"
		}
		return "$" + strconv.Itoa(len(args))
	}

	var note string
	if strings.TrimSpace(req.Search) != "" {
		if req.SearchColumn != "" && !hasColumn(t, req.SearchColumn) {
			return "", nil, "", errors.New("Coluna de busca não existe nesta tabela.")
		}
		switch req.SearchMode {
		case "", SearchPrefix, SearchExact, SearchContains:
		default:
			return "", nil, "", errors.New("Modo de busca inválido.")
		}
		var conds []string
		conds, note = buildSearch(kind, t, req, &args, ph)
		if len(conds) == 0 {
			b.WriteString(" WHERE 1 = 0")
		} else {
			b.WriteString(" WHERE " + strings.Join(conds, " OR "))
		}
	}

	// A stable order is what makes paging correct: the chosen column, then the
	// primary key as tie-breaker (or as the default).
	var order []string
	dir := " ASC"
	if req.Desc {
		dir = " DESC"
	}
	if req.OrderBy != "" {
		found := false
		for _, c := range t.Columns {
			if c.Name == req.OrderBy {
				found = true
			}
		}
		if !found {
			return "", nil, "", errors.New("Coluna de ordenação não existe nesta tabela.")
		}
		order = append(order, quoteIdent(kind, req.OrderBy)+dir)
	}
	for _, pk := range t.PrimaryKey {
		if pk != req.OrderBy {
			order = append(order, quoteIdent(kind, pk)+dir)
		}
	}
	if len(order) > 0 {
		b.WriteString(" ORDER BY " + strings.Join(order, ", "))
	}

	args = append(args, limit+1, req.Offset)
	if kind == MySQL {
		b.WriteString(" LIMIT ? OFFSET ?")
	} else {
		b.WriteString(fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)-1, len(args)))
	}
	return b.String(), args, note, nil
}

// cellString renders one scanned value for display.
func cellString(v any, colType string) *string {
	var s string
	switch x := v.(type) {
	case nil:
		return nil
	case string:
		s = x
	case []byte:
		if utf8.Valid(x) {
			s = string(x)
		} else {
			s = `\x` + hex.EncodeToString(x)
		}
	case time.Time:
		lt := strings.ToLower(colType)
		switch {
		case lt == "date":
			s = x.Format("2006-01-02")
		case strings.HasPrefix(lt, "time") && !strings.Contains(lt, "stamp"):
			s = x.Format("15:04:05.999999")
		case strings.Contains(lt, "tz") || strings.Contains(lt, "with time zone"):
			s = x.Format("2006-01-02 15:04:05.999999 -07:00")
		default:
			s = x.Format("2006-01-02 15:04:05.999999")
		}
	case bool:
		s = strconv.FormatBool(x)
	default:
		s = fmt.Sprint(x)
	}
	if r := []rune(s); len(r) > maxCellRunes {
		s = string(r[:maxCellRunes]) + "…"
	}
	return &s
}

// Browse reads one page of a table of an open connection. It always runs in a
// read-only transaction, so browsing can never change data.
func (m *Manager) Browse(ctx context.Context, id string, req BrowseRequest) (*Page, error) {
	s, err := m.get(id)
	if err != nil {
		return nil, err
	}
	t, err := m.table(ctx, s, req.Schema, req.Table)
	if err != nil {
		return nil, err
	}
	query, args, note, err := buildBrowseNote(s.profile.Kind, t, req)
	if err != nil {
		return nil, err
	}

	timeout := browseTimeout
	if note != "" {
		timeout = searchTimeout * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, friendlyQuery(err, s.profile)
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, friendlyQuery(err, s.profile)
	}
	defer rows.Close()

	limit := req.Limit
	if limit <= 0 {
		limit = defaultPageSize
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}
	page := &Page{Columns: make([]string, len(t.Columns)), Rows: [][]*string{}, SearchNote: note}
	for i, c := range t.Columns {
		page.Columns[i] = c.Name
	}
	for rows.Next() {
		if len(page.Rows) == limit {
			page.HasMore = true
			break
		}
		vals := make([]any, len(t.Columns))
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, friendlyQuery(err, s.profile)
		}
		row := make([]*string, len(vals))
		for i, v := range vals {
			row[i] = cellString(v, t.Columns[i].Type)
		}
		page.Rows = append(page.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, friendlyQuery(err, s.profile)
	}
	return page, nil
}

// table finds a table in the cached structure, reading it on first use.
func (m *Manager) table(ctx context.Context, s *session, schemaName, name string) (*Table, error) {
	m.mu.Lock()
	cached := s.schema
	m.mu.Unlock()
	if cached == nil {
		if _, err := m.Introspect(ctx, s.profile.ID); err != nil {
			return nil, err
		}
		m.mu.Lock()
		cached = s.schema
		m.mu.Unlock()
	}
	if cached != nil {
		for i := range cached.Tables {
			t := &cached.Tables[i]
			if t.Name == name && t.Schema == schemaName {
				return t, nil
			}
		}
	}
	return nil, errors.New("Essa tabela não existe mais. Atualize a estrutura do banco.")
}

// friendlyQuery maps a failure while reading rows; like friendly, it never
// returns the raw driver text.
func friendlyQuery(err error, p Profile) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("A consulta demorou demais e foi cancelada. Busque por “Igual” ou “Começa com” em uma coluna indexada.")
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "permission denied") || strings.Contains(msg, "command denied") {
		return errors.New("O usuário não tem permissão para ler esta tabela.")
	}
	if strings.Contains(msg, "connection") || strings.Contains(msg, "bad connection") || strings.Contains(msg, "eof") {
		return errors.New("A conexão com o banco caiu. Desconecte e conecte de novo.")
	}
	return errors.New("Não foi possível ler os dados da tabela.")
}
