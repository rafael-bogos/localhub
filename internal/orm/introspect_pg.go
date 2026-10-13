package orm

import (
	"context"
	"database/sql"
	"strings"
)

// sep joins array elements inside one SQL value, so a column name containing a
// comma doesn't split wrongly.
const sep = "\x1f"

const pgSystemSchemas = `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'`

func introspectPostgres(ctx context.Context, db *sql.DB) (*Schema, error) {
	ts := newTableSet()

	rows, err := db.QueryContext(ctx, `
		SELECT n.nspname, c.relname, a.attname,
		       format_type(a.atttypid, a.atttypmod),
		       NOT a.attnotnull,
		       COALESCE(pg_get_expr(d.adbin, d.adrelid), ''),
		       d.adbin IS NOT NULL,
		       a.attidentity <> '',
		       c.reltuples::bigint
		FROM pg_attribute a
		JOIN pg_class c ON c.oid = a.attrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
		WHERE c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped AND `+pgSystemSchemas+`
		ORDER BY n.nspname, c.relname, a.attnum`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var schema, table string
		var col Column
		var identity bool
		var est int64
		if err := rows.Scan(&schema, &table, &col.Name, &col.Type, &col.Nullable, &col.Default, &col.HasDefault, &identity, &est); err != nil {
			rows.Close()
			return nil, err
		}
		col.AutoIncrement = identity || strings.HasPrefix(col.Default, "nextval(")
		t := ts.get(schema, table)
		t.RowEstimate = est
		t.Columns = append(t.Columns, col)
	}
	if err := closeRows(rows); err != nil {
		return nil, err
	}

	// Indexes, primary key included (flagged, then split out below).
	rows, err = db.QueryContext(ctx, `
		SELECT n.nspname, c.relname, i.relname, ix.indisunique, ix.indisprimary,
		       array_to_string(ARRAY(
		         SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY k(attnum, ord)
		         JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.attnum
		         ORDER BY k.ord), chr(31))
		FROM pg_index ix
		JOIN pg_class c ON c.oid = ix.indrelid
		JOIN pg_class i ON i.oid = ix.indexrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE c.relkind IN ('r', 'p') AND `+pgSystemSchemas+`
		ORDER BY n.nspname, c.relname, i.relname`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var schema, table, name, cols string
		var unique, primary bool
		if err := rows.Scan(&schema, &table, &name, &unique, &primary, &cols); err != nil {
			rows.Close()
			return nil, err
		}
		t := ts.find(schema, table)
		if t == nil {
			continue
		}
		list := splitList(cols)
		if primary {
			t.PrimaryKey = list
			continue
		}
		t.Indexes = append(t.Indexes, Index{Name: name, Columns: list, Unique: unique})
	}
	if err := closeRows(rows); err != nil {
		return nil, err
	}

	rows, err = db.QueryContext(ctx, `
		SELECT n.nspname, c.relname, con.conname,
		       array_to_string(ARRAY(
		         SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
		         JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
		         ORDER BY k.ord), chr(31)),
		       rn.nspname, rc.relname,
		       array_to_string(ARRAY(
		         SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord)
		         JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.attnum
		         ORDER BY k.ord), chr(31)),
		       con.confdeltype::text
		FROM pg_constraint con
		JOIN pg_class c ON c.oid = con.conrelid
		JOIN pg_namespace n ON n.oid = c.relnamespace
		JOIN pg_class rc ON rc.oid = con.confrelid
		JOIN pg_namespace rn ON rn.oid = rc.relnamespace
		WHERE con.contype = 'f' AND `+pgSystemSchemas+`
		ORDER BY n.nspname, c.relname, con.conname`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var schema, table, name, cols, refSchema, refTable, refCols, del string
		if err := rows.Scan(&schema, &table, &name, &cols, &refSchema, &refTable, &refCols, &del); err != nil {
			rows.Close()
			return nil, err
		}
		if t := ts.find(schema, table); t != nil {
			t.ForeignKeys = append(t.ForeignKeys, ForeignKey{
				Name: name, Columns: splitList(cols),
				RefSchema: refSchema, RefTable: refTable, RefColumns: splitList(refCols),
				OnDelete: pgAction(del),
			})
		}
	}
	if err := closeRows(rows); err != nil {
		return nil, err
	}

	markPrimaryKeys(ts)
	return ts.schema(), nil
}

func pgAction(c string) string {
	switch c {
	case "r":
		return "RESTRICT"
	case "c":
		return "CASCADE"
	case "n":
		return "SET NULL"
	case "d":
		return "SET DEFAULT"
	}
	return "NO ACTION"
}

func splitList(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, sep)
}

func closeRows(rows *sql.Rows) error {
	err := rows.Err()
	if cerr := rows.Close(); err == nil {
		err = cerr
	}
	return err
}

// markPrimaryKeys flags each column that is part of its table's primary key.
func markPrimaryKeys(ts *tableSet) {
	for _, t := range ts.by {
		for i := range t.Columns {
			for _, pk := range t.PrimaryKey {
				if t.Columns[i].Name == pk {
					t.Columns[i].PrimaryKey = true
				}
			}
		}
	}
}
