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
	"strconv"
	"strings"
	"sync"
)

const maxFlagsPerPhone = 500000

var flagsMu sync.Mutex

func (s *Server) flagsFile(id string) string {
	return filepath.Join(s.cfg.DataDir, "viewer", "flags-"+cleanSegment(id)+".json")
}

// writeFlags saves a phone's verdicts atomically. Caller holds flagsMu.
func (s *Server) writeFlags(id string, flags map[string]int) error {
	b, err := json.Marshal(flags)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.flagsFile(id)), 0o755); err != nil {
		return err
	}
	tmp := s.flagsFile(id) + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.flagsFile(id))
}

// The flags' epoch goes up when stored verdicts are thrown away on purpose
// (handleFlagsRecheck). Browsers keep a copy and send what the server lacks;
// a browser on an older epoch must drop its copy instead, or it would put
// back exactly what was cleared.
func (s *Server) flagsEpoch(id string) int {
	b, _ := os.ReadFile(strings.TrimSuffix(s.flagsFile(id), ".json") + ".epoch")
	n, _ := strconv.Atoi(strings.TrimSpace(string(b)))
	return n
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
	// Someone's looking at the gallery: check anything new now.
	s.kickScan()
	epoch := s.flagsEpoch(id)
	flagsMu.Unlock()
	writeJSON(w, 200, map[string]any{"flags": flags, "epoch": epoch, "scan": s.scanStatus(id)})
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
		Set   map[string]int `json:"set"`
		Epoch *int           `json:"epoch"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<20)).Decode(&body); err != nil {
		fail(w, 400, "bad request")
		return
	}
	flagsMu.Lock()
	defer flagsMu.Unlock()
	if body.Epoch != nil && *body.Epoch < s.flagsEpoch(id) {
		fail(w, 409, "out of date: reload the gallery")
		return
	}
	flags := s.readFlags(id)
	if mergeFlags(flags, body.Set) {
		if err := s.writeFlags(id, flags); err != nil {
			fail(w, 500, "couldn't save")
			return
		}
	}
	writeJSON(w, 200, map[string]any{"ok": true, "count": len(flags)})
}

// handleFlagsRecheck forgets every "not sensitive" mark on a phone so the
// scanner checks those photos again: the detector gives the same answer each
// time, so the ones it flagged before come back flagged. For undoing a mass
// clear; the epoch tells every browser to drop its copy.
func (s *Server) handleFlagsRecheck(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	d := s.findDevice(id)
	s.mu.Unlock()
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	// Which verdicts to throw away: "not sensitive" marks (2) by default, or
	// e.g. [1] to re-check every flagged photo after the cut-off changes.
	var body struct {
		Values []int `json:"values"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body)
	if len(body.Values) == 0 {
		body.Values = []int{2}
	}
	drop := map[int]bool{}
	for _, v := range body.Values {
		drop[v] = true
	}
	flagsMu.Lock()
	s.saveList(id, "before-rescan")
	flags := s.readFlags(id)
	n := 0
	for p, v := range flags {
		if drop[v] {
			delete(flags, p)
			n++
		}
	}
	epoch := s.flagsEpoch(id) + 1
	err := s.writeFlags(id, flags)
	if err == nil {
		err = os.WriteFile(strings.TrimSuffix(s.flagsFile(id), ".json")+".epoch", []byte(strconv.Itoa(epoch)), 0o600)
	}
	flagsMu.Unlock()
	if err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	s.logger.Printf("flags: %s: %d photos marked %v sent back for re-checking", id, n, body.Values)
	s.kickScan()
	writeJSON(w, 200, map[string]any{"ok": true, "rechecking": n, "epoch": epoch})
}
