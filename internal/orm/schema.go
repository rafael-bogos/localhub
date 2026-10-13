// Package orm is localhub's native database layer: connections to PostgreSQL
// and MySQL/MariaDB, introspection into a dialect-neutral schema model and,
// in later phases, data browsing, schema diffing and migrations. It knows
// nothing about Wails; app.go exposes it the way it does for internal/docker.
package orm

// Schema is the structure of one database, the same shape whichever engine
// it came from.
type Schema struct {
	Tables []Table `json:"tables"`
}

// Table is one base table (views are not listed in this version).
type Table struct {
	// Schema is the namespace in PostgreSQL ("public", ...). Empty in MySQL,
	// where the database itself is the namespace.
	Schema      string       `json:"schema"`
	Name        string       `json:"name"`
	Columns     []Column     `json:"columns"`
	PrimaryKey  []string     `json:"primaryKey"`
	Indexes     []Index      `json:"indexes"`
	ForeignKeys []ForeignKey `json:"foreignKeys"`
	// RowEstimate is the engine's own estimate, -1 when it has none. It is
	// never a COUNT(*): that would scan big tables just to open the list.
	RowEstimate int64 `json:"rowEstimate"`
}

// Column is one column with its type as the engine spells it.
type Column struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	Nullable      bool   `json:"nullable"`
	Default       string `json:"default"`
	HasDefault    bool   `json:"hasDefault"`
	AutoIncrement bool   `json:"autoIncrement"`
	PrimaryKey    bool   `json:"primaryKey"`
}

// Index is a secondary or unique index; the primary key is kept apart.
type Index struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
}

// ForeignKey points columns of one table at columns of another.
type ForeignKey struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	// OnDelete is "NO ACTION", "RESTRICT", "CASCADE", "SET NULL" or "SET DEFAULT".
	OnDelete string `json:"onDelete"`
}

// tableKey identifies a table while rows of separate queries are merged.
type tableKey struct{ schema, name string }

// tableSet collects tables in the order they were first seen.
type tableSet struct {
	order []tableKey
	by    map[tableKey]*Table
}

func newTableSet() *tableSet { return &tableSet{by: map[tableKey]*Table{}} }

func (s *tableSet) get(schema, name string) *Table {
	k := tableKey{schema, name}
	t, ok := s.by[k]
	if !ok {
		t = &Table{Schema: schema, Name: name, RowEstimate: -1,
			Columns: []Column{}, PrimaryKey: []string{}, Indexes: []Index{}, ForeignKeys: []ForeignKey{}}
		s.by[k] = t
		s.order = append(s.order, k)
	}
	return t
}

// find returns an already-seen table, or nil.
func (s *tableSet) find(schema, name string) *Table { return s.by[tableKey{schema, name}] }

func (s *tableSet) schema() *Schema {
	out := &Schema{Tables: make([]Table, 0, len(s.order))}
	for _, k := range s.order {
		out.Tables = append(out.Tables, *s.by[k])
	}
	return out
}
