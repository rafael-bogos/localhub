package orm

import (
	"context"
	"database/sql"
	"strings"
)

func introspectMySQL(ctx context.Context, db *sql.DB) (*Schema, error) {
	ts := newTableSet()

	rows, err := db.QueryContext(ctx, `
		SELECT c.TABLE_NAME AS tbl, c.COLUMN_NAME AS col, c.COLUMN_TYPE AS typ,
		       c.IS_NULLABLE = 'YES' AS nullable, c.COLUMN_DEFAULT AS dflt,
		       c.EXTRA AS extra, COALESCE(t.TABLE_ROWS, -1) AS est
		FROM information_schema.COLUMNS c
		JOIN information_schema.TABLES t
		  ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
		WHERE c.TABLE_SCHEMA = DATABASE() AND t.TABLE_TYPE = 'BASE TABLE'
		ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var table string
		var col Column
		var dflt sql.NullString
		var extra string
		var est int64
		if err := rows.Scan(&table, &col.Name, &col.Type, &col.Nullable, &dflt, &extra, &est); err != nil {
			rows.Close()
			return nil, err
		}
		col.Default, col.HasDefault = dflt.String, dflt.Valid
		col.AutoIncrement = strings.Contains(strings.ToLower(extra), "auto_increment")
		t := ts.get("", table)
		t.RowEstimate = est
		t.Columns = append(t.Columns, col)
	}
	if err := closeRows(rows); err != nil {
		return nil, err
	}

	rows, err = db.QueryContext(ctx, `
		SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, NON_UNIQUE AS non_unique, COLUMN_NAME AS col
		FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE()
		ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var table, name string
		var nonUnique int
		var col sql.NullString // NULL for functional index parts
		if err := rows.Scan(&table, &name, &nonUnique, &col); err != nil {
			rows.Close()
			return nil, err
		}
		t := ts.find("", table)
		if t == nil {
			continue
		}
		if name == "PRIMARY" {
			t.PrimaryKey = append(t.PrimaryKey, col.String)
			continue
		}
		if n := len(t.Indexes); n > 0 && t.Indexes[n-1].Name == name {
			t.Indexes[n-1].Columns = append(t.Indexes[n-1].Columns, col.String)
			continue
		}
		t.Indexes = append(t.Indexes, Index{Name: name, Unique: nonUnique == 0, Columns: []string{col.String}})
	}
	if err := closeRows(rows); err != nil {
		return nil, err
	}

	rows, err = db.QueryContext(ctx, `
		SELECT k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, k.COLUMN_NAME AS col,
		       k.REFERENCED_TABLE_NAME AS ref_tbl, k.REFERENCED_COLUMN_NAME AS ref_col,
		       r.DELETE_RULE AS del
		FROM information_schema.KEY_COLUMN_USAGE k
		JOIN information_schema.REFERENTIAL_CONSTRAINTS r
		  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
		     AND r.TABLE_NAME = k.TABLE_NAME
		WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
		ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var table, name, col, refTable, refCol, del string
		if err := rows.Scan(&table, &name, &col, &refTable, &refCol, &del); err != nil {
			rows.Close()
			return nil, err
		}
		t := ts.find("", table)
		if t == nil {
			continue
		}
		if n := len(t.ForeignKeys); n > 0 && t.ForeignKeys[n-1].Name == name {
			fk := &t.ForeignKeys[n-1]
			fk.Columns = append(fk.Columns, col)
			fk.RefColumns = append(fk.RefColumns, refCol)
			continue
		}
		t.ForeignKeys = append(t.ForeignKeys, ForeignKey{
			Name: name, Columns: []string{col}, RefTable: refTable, RefColumns: []string{refCol}, OnDelete: del,
		})
	}
	if err := closeRows(rows); err != nil {
		return nil, err
	}

	markPrimaryKeys(ts)
	return ts.schema(), nil
}
