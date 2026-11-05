package main

// The sensitive-photo check's verdicts, kept on the server so every browser
// shares them. The check runs in the viewer's browser (viewer.html); before
// this, its verdicts and every "Not sensitive" / "Uncensor all" lived in
// that browser's localStorage, so a second computer or phone checked every
// photo again and blurred photos already cleared elsewhere.
//
// One JSON file per phone under <data>/viewer/, outside the phone's backup
// folder so it never shows up among its files. Each photo's path maps to
// 0 (checked, fine), 1 (flagged) or 2 (someone said it isn't sensitive).
// A 2 is final: a later 0 or 1 from a browser that hadn't heard yet never
// overwrites it, so a cleared photo stays cleared.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

const maxFlagsPerPhone = 500000

var flagsMu sync.Mutex

func (s *Server) flagsFile(id string) string {
	return filepath.Join(s.cfg.DataDir, "viewer", "flags-"+cleanSegment(id)+".json")
}

func (s *Server) readFlags(id string) map[string]int {
	out := map[string]int{}
	b, err := os.ReadFile(s.flagsFile(id))
	if err == nil {
		json.Unmarshal(b, &out)
	}
	return out
}

// mergeFlags folds incoming verdicts into the stored ones and reports
// whether anything changed. Unknown values are ignored; a stored 2 wins.
func mergeFlags(stored, incoming map[string]int) bool {
	changed := false
	for p, v := range incoming {
		if p == "" || len(p) > 1024 || (v != 0 && v != 1 && v != 2) {
			continue
		}
		old, had := stored[p]
		if had && (old == v || old == 2) {
			continue
		}
		if !had && len(stored) >= maxFlagsPerPhone {
			continue
		}
		stored[p] = v
		changed = true
	}
	return changed
}

func (s *Server) handleFlagsGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	d := s.findDevice(id)
	s.mu.Unlock()
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	flagsMu.Lock()
	flags := s.readFlags(id)
	flagsMu.Unlock()
	writeJSON(w, 200, map[string]any{"flags": flags})
}

func (s *Server) handleFlagsSet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	d := s.findDevice(id)
	s.mu.Unlock()
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	var body struct {
		Set map[string]int `json:"set"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&body); err != nil {
		fail(w, 400, "bad request")
		return
	}
	flagsMu.Lock()
	defer flagsMu.Unlock()
	flags := s.readFlags(id)
	if mergeFlags(flags, body.Set) {
		b, _ := json.Marshal(flags)
		dir := filepath.Dir(s.flagsFile(id))
		tmp := s.flagsFile(id) + ".tmp"
		if err := os.MkdirAll(dir, 0o755); err != nil || os.WriteFile(tmp, b, 0o600) != nil || os.Rename(tmp, s.flagsFile(id)) != nil {
			fail(w, 500, "couldn't save")
			return
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true, "count": len(flags)})
}
