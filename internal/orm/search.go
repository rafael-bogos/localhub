package orm

import (
	"regexp"
	"strconv"
	"strings"
)

// Search modes. Prefix and exact can be answered by an index; contains cannot
// (a leading wildcard forces a scan of every row), so it is opt-in, per column.
const (
	SearchPrefix   = "prefix"
	SearchExact    = "exact"
	SearchContains = "contains"
)

// searchTimeout is shorter than a plain page read: a search that has not
// answered by now is scanning, and the user should narrow it instead.
const searchTimeout = 10

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type colClass int

const (
	classOther colClass = iota
	classInt
	classUUID
	classText
)

// classify sorts an engine type name ("character varying(80)", "int(11)
// unsigned") into the few families that decide how a column is compared.
func classify(typ string) colClass {
	t := strings.ToLower(strings.TrimSpace(typ))
	if i := strings.IndexByte(t, '('); i >= 0 {
		t = strings.TrimSpace(t[:i] + t[strings.IndexByte(t, ')')+1:])
	}
	t = strings.TrimSuffix(strings.TrimSuffix(t, " unsigned"), " zerofill")
	switch t {
	case "smallint", "integer", "int", "int2", "int4", "int8", "bigint", "tinyint", "mediumint":
		return classInt
	case "uuid":
		return classUUID
	case "text", "varchar", "character varying", "char", "character", "bpchar", "citext", "name",
		"tinytext", "mediumtext", "longtext":
		return classText
	}
	return classOther
}

// indexLead reports which columns start an index (the primary key included):
// only those can be searched without reading the whole table.
func indexLead(t *Table) map[string]bool {
	lead := map[string]bool{}
	if len(t.PrimaryKey) > 0 {
		lead[t.PrimaryKey[0]] = true
	}
	for _, ix := range t.Indexes {
		if len(ix.Columns) > 0 {
			lead[ix.Columns[0]] = true
		}
	}
	return lead
}

// prefixIndexed reports whether a LIKE 'x%' on the column can use an index. In
// MySQL any index leading with the column does. PostgreSQL only uses a plain
// index for it when the index is built with text_pattern_ops or a C collation.
func prefixIndexed(kind string, t *Table, col string, lead map[string]bool) bool {
	if !lead[col] {
		return false
	}
	if kind == MySQL {
		return true
	}
	for _, c := range t.PrefixCols {
		if c == col {
			return true
		}
	}
	return false
}

// buildSearch composes the WHERE conditions for a search. Without a chosen
// column it only touches indexed columns, with the cheapest comparison each can
// answer from its index: equality for numbers/UUIDs, prefix (or equality when
// the index cannot serve a prefix) for text. With a chosen column it does what
// the user asked, and the note says when that has no index behind it.
// The returned conditions are joined with OR; none means "matches nothing".
func buildSearch(kind string, t *Table, req BrowseRequest, args *[]any, ph func() string) (conds []string, note string) {
	term := strings.TrimSpace(req.Search)
	mode := req.SearchMode
	if mode == "" {
		mode = SearchPrefix
	}
	lead := indexLead(t)
	var notes []string

	likeOp := " LIKE "
	if kind == Postgres {
		likeOp = " ILIKE "
	}
	asText := func(name string) string {
		if kind == MySQL {
			return "CAST(" + quoteIdent(kind, name) + " AS CHAR)"
		}
		return quoteIdent(kind, name) + "::text"
	}

	for _, c := range t.Columns {
		chosen := req.SearchColumn != ""
		if chosen && c.Name != req.SearchColumn {
			continue
		}
		if !chosen && !lead[c.Name] {
			continue
		}
		q := quoteIdent(kind, c.Name)
		class := classify(c.Type)
		indexed := lead[c.Name]
		add := func(cond string, arg any, label string) {
			*(args) = append(*args, arg)
			conds = append(conds, strings.Replace(cond, "?", ph(), 1))
			if chosen && !indexed {
				label += ", sem índice"
			}
			notes = append(notes, c.Name+" ("+label+")")
		}

		if mode == SearchContains {
			if chosen {
				add(asText(c.Name)+likeOp+"?", "%"+likeEscape(term)+"%", "contém")
			}
			continue
		}
		switch class {
		case classInt:
			if n, err := strconv.ParseInt(term, 10, 64); err == nil {
				add(q+" = ?", n, "igual")
			}
		case classUUID:
			if uuidRe.MatchString(term) {
				add(q+" = ?", strings.ToLower(term), "igual")
			}
		case classText:
			if mode == SearchPrefix && (chosen || prefixIndexed(kind, t, c.Name, lead)) {
				// Case-sensitive LIKE: ILIKE/LOWER() would hide the column from its index.
				add(q+" LIKE ?", likeEscape(term)+"%", "começa com")
			} else {
				add(q+" = ?", term, "igual")
			}
		default:
			if chosen {
				if mode == SearchExact {
					add(asText(c.Name)+" = ?", term, "igual")
				} else {
					add(asText(c.Name)+" LIKE ?", likeEscape(term)+"%", "começa com")
				}
			}
		}
	}

	if len(conds) == 0 {
		if req.SearchColumn == "" {
			return nil, "Nenhuma coluna indexada serve para este termo. Escolha uma coluna ou use “Contém” (mais lento)."
		}
		return nil, "O termo não se aplica a esta coluna."
	}
	return conds, "Buscando em: " + strings.Join(notes, ", ")
}
