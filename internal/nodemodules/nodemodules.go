// Package nodemodules finds and removes node_modules directories under a root
// folder. Deleting is destructive, so everything here is conservative: only a
// node_modules that sits next to a package.json is ever listed, and only a
// path returned by the most recent scan can be removed.
package nodemodules

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const (
	dirName = "node_modules"

	// maxDepth bounds how far below the root the scan descends.
	maxDepth = 12

	// removeWorkers is how many node_modules are deleted at once. Deleting is
	// disk-bound, so a small number is enough.
	removeWorkers = 2
)

// skipDirs are directory names the scan never enters, besides every
// dot-directory (.git, .cache, .nvm, .npm, ...). They hold application data or
// toolchains whose node_modules are not projects (global npm installs, Electron
// apps) and removing them would break the tools.
var skipDirs = map[string]bool{
	"Library":  true, // macOS
	"AppData":  true, // Windows
	"snap":     true, // Linux snaps
	"$RECYCLE": true,
}

// Entry is one project's node_modules.
type Entry struct {
	// Path is the absolute path of the node_modules directory.
	Path string `json:"path"`
	// Dir is the project directory that contains it.
	Dir string `json:"dir"`
	// Name is the project directory's own name.
	Name string `json:"name"`
	// Rel is the project directory relative to the scanned root ("." for the root itself).
	Rel string `json:"rel"`
}

// ScanResult is the outcome of a scan.
type ScanResult struct {
	Root    string  `json:"root"`
	Entries []Entry `json:"entries"`
}

// RemoveResult reports one removal.
type RemoveResult struct {
	Path  string `json:"path"`
	OK    bool   `json:"ok"`
	Error string `json:"error"`
}

// Emit publishes an event to the UI (wired to the Wails runtime by the app).
type Emit func(event string, data any)

var (
	mu         sync.Mutex
	cancelScan context.CancelFunc
	allowed    = map[string]bool{} // node_modules paths from the last scan
)

// ExpandRoot turns what the user typed into a clean absolute directory path,
// or explains why it can't be used.
func ExpandRoot(input string) (string, error) {
	root := strings.TrimSpace(input)
	if root == "" {
		return "", fmt.Errorf("informe o diretório raiz")
	}
	if root == "~" || strings.HasPrefix(root, "~/") || strings.HasPrefix(root, `~\`) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("não foi possível resolver o diretório pessoal")
		}
		root = filepath.Join(home, strings.TrimPrefix(strings.TrimPrefix(root, "~"), string(filepath.Separator)))
	}
	abs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("caminho inválido")
	}
	abs = filepath.Clean(abs)

	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("diretório não encontrado: %s", abs)
		}
		return "", fmt.Errorf("não foi possível acessar %s", abs)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("o caminho não é um diretório: %s", abs)
	}
	if filepath.Dir(abs) == abs {
		return "", fmt.Errorf("escolha uma pasta mais específica do que a raiz do sistema")
	}
	return abs, nil
}

// Scan lists every node_modules under root that belongs to a project (its
// parent has a package.json). A new scan cancels one still running. The scan
// never follows symlinks, never enters hidden directories or node_modules
// itself, and skips unreadable directories.
func Scan(ctx context.Context, input string) (ScanResult, error) {
	root, err := ExpandRoot(input)
	if err != nil {
		return ScanResult{}, err
	}

	ctx, cancel := context.WithCancel(ctx)
	mu.Lock()
	if cancelScan != nil {
		cancelScan()
	}
	cancelScan = cancel
	mu.Unlock()
	defer cancel()

	entries := []Entry{}
	walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			if path == root {
				return err
			}
			if d != nil && d.IsDir() {
				return fs.SkipDir // unreadable directory: skip, keep going
			}
			return nil
		}
		// Symlinks report IsDir() == false, so they are never followed.
		if !d.IsDir() || path == root {
			return nil
		}

		name := d.Name()
		if name == dirName {
			if e, ok := entryFor(root, path); ok {
				entries = append(entries, e)
			}
			return fs.SkipDir // never look inside a node_modules
		}
		if strings.HasPrefix(name, ".") || skipDirs[name] {
			return fs.SkipDir
		}
		if rel, err := filepath.Rel(root, path); err == nil && strings.Count(rel, string(filepath.Separator)) >= maxDepth {
			return fs.SkipDir
		}
		return nil
	})
	if walkErr != nil {
		if ctx.Err() != nil {
			return ScanResult{}, fmt.Errorf("busca cancelada")
		}
		return ScanResult{}, fmt.Errorf("falha ao percorrer o diretório")
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })

	mu.Lock()
	allowed = make(map[string]bool, len(entries))
	for _, e := range entries {
		allowed[e.Path] = true
	}
	mu.Unlock()

	return ScanResult{Root: root, Entries: entries}, nil
}

// CancelScan stops the scan in progress, if any.
func CancelScan() {
	mu.Lock()
	defer mu.Unlock()
	if cancelScan != nil {
		cancelScan()
		cancelScan = nil
	}
}

// entryFor builds the Entry for a node_modules path, or reports false when it
// doesn't qualify: it must be a real directory (not a symlink) whose parent
// has a package.json.
func entryFor(root, path string) (Entry, bool) {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return Entry{}, false
	}
	dir := filepath.Dir(path)
	if pj, err := os.Stat(filepath.Join(dir, "package.json")); err != nil || pj.IsDir() {
		return Entry{}, false
	}
	rel, err := filepath.Rel(root, dir)
	if err != nil {
		rel = dir
	}
	return Entry{Path: path, Dir: dir, Name: filepath.Base(dir), Rel: rel}, true
}

// isAllowed reports whether path came from the last scan.
func isAllowed(path string) bool {
	mu.Lock()
	defer mu.Unlock()
	return allowed[path]
}

// Size returns the total size in bytes of the files inside a node_modules
// from the last scan. Symlinks are counted as links, not followed, so
// pnpm-style trees don't count the same package twice.
func Size(ctx context.Context, path string) (int64, error) {
	if !isAllowed(path) {
		return 0, fmt.Errorf("caminho fora da última busca")
	}
	var total int64
	err := filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if info, err := d.Info(); err == nil {
			total += info.Size()
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return total, nil
}

// Remove deletes the given node_modules directories, reporting each result to
// emit as "nodemodules:removed" as soon as it finishes. Every path must come
// from the last scan and is re-checked right before deleting: still a real
// (non-symlink) node_modules, still next to a package.json.
func Remove(paths []string, emit Emit) []RemoveResult {
	results := make([]RemoveResult, len(paths))
	jobs := make(chan int)
	var wg sync.WaitGroup

	for w := 0; w < removeWorkers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				res := removeOne(paths[i])
				results[i] = res
				if emit != nil {
					emit("nodemodules:removed", res)
				}
			}
		}()
	}
	for i := range paths {
		jobs <- i
	}
	close(jobs)
	wg.Wait()
	return results
}

func removeOne(path string) RemoveResult {
	if !isAllowed(path) {
		return RemoveResult{Path: path, Error: "caminho fora da última busca — procure de novo"}
	}
	if filepath.Base(path) != dirName {
		return RemoveResult{Path: path, Error: "não é um node_modules"}
	}
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			forget(path)
			return RemoveResult{Path: path, OK: true} // already gone
		}
		return RemoveResult{Path: path, Error: "não foi possível acessar a pasta"}
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return RemoveResult{Path: path, Error: "não é uma pasta comum — não removida"}
	}
	if pj, err := os.Stat(filepath.Join(filepath.Dir(path), "package.json")); err != nil || pj.IsDir() {
		return RemoveResult{Path: path, Error: "o projeto não tem mais package.json — não removida"}
	}

	if err := os.RemoveAll(path); err != nil {
		return RemoveResult{Path: path, Error: "falha ao remover: " + simplifyErr(err)}
	}
	forget(path)
	return RemoveResult{Path: path, OK: true}
}

func forget(path string) {
	mu.Lock()
	delete(allowed, path)
	mu.Unlock()
}

func simplifyErr(err error) string {
	if os.IsPermission(err) {
		return "permissão negada"
	}
	return "erro do sistema de arquivos"
}
