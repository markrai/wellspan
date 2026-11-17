package store

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

type Snapshot struct {
	Revision int64
	Body     []byte
	Exists   bool
}

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	if path == "" || path == ":memory:" {
		return nil, errors.New("a persistent SQLite path is required")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	for _, query := range []string{
		"PRAGMA busy_timeout=5000",
		"PRAGMA journal_mode=WAL",
		"PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(query); err != nil {
			db.Close()
			return nil, fmt.Errorf("initialize SQLite: %w", err)
		}
	}
	var version int
	if err := db.QueryRow("PRAGMA user_version").Scan(&version); err != nil {
		db.Close()
		return nil, fmt.Errorf("read SQLite schema version: %w", err)
	}
	if version != 0 && version != 1 {
		db.Close()
		return nil, fmt.Errorf("unsupported SQLite schema version %d", version)
	}
	if _, err := db.Exec("CREATE TABLE IF NOT EXISTS board_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL CHECK(revision>0), payload BLOB NOT NULL)"); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize SQLite table: %w", err)
	}
	if version == 0 {
		if _, err := db.Exec("PRAGMA user_version=1"); err != nil {
			db.Close()
			return nil, fmt.Errorf("set SQLite schema version: %w", err)
		}
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) Read(ctx context.Context) (Snapshot, error) {
	var snap Snapshot
	err := s.db.QueryRowContext(ctx, "SELECT revision, payload FROM board_state WHERE id=1").Scan(&snap.Revision, &snap.Body)
	if errors.Is(err, sql.ErrNoRows) {
		return snap, nil
	}
	if err != nil {
		return snap, err
	}
	snap.Exists = true
	return snap, nil
}

func (s *Store) Bootstrap(ctx context.Context, body []byte) (Snapshot, bool, error) {
	result, err := s.db.ExecContext(ctx, "INSERT OR IGNORE INTO board_state (id, revision, payload) VALUES (1, 1, ?)", body)
	if err != nil {
		return Snapshot{}, false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return Snapshot{}, false, err
	}
	snap, err := s.Read(ctx)
	if err != nil {
		return Snapshot{}, false, err
	}
	if affected == 1 {
		return snap, true, nil
	}
	if !bytes.Equal(snap.Body, body) {
		return snap, false, nil
	}
	return snap, true, nil
}

func (s *Store) Replace(ctx context.Context, previous int64, body []byte) (Snapshot, bool, error) {
	if previous < 1 {
		return Snapshot{}, false, errors.New("revision must be positive")
	}
	result, err := s.db.ExecContext(ctx, "UPDATE board_state SET revision=revision+1, payload=? WHERE id=1 AND revision=?", body, previous)
	if err != nil {
		return Snapshot{}, false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return Snapshot{}, false, err
	}
	snap, err := s.Read(ctx)
	return snap, count == 1, err
}
