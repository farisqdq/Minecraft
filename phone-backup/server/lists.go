package main

// Saved copies of each phone's sensitive-photo verdicts ("lists"), so a
// re-scan or a change of checker can always be undone: one was lost that
// way before. A copy is saved before every re-scan and every restore, and
// after a scanner pass that changed something (at most hourly). The newest
// 30 are kept, under <data>/viewer/history/<phone>/.
//
// The site's Gallery shows them and can put any one back, and can start a
// re-scan; these are admin routes, behind the server secret.

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const keepLists = 30

func (s *Server) listsDir(id string) string {
	return filepath.Join(s.cfg.DataDir, "viewer", "history", cleanSegment(id))
}

// saveList copies the phone's current verdicts. Caller holds flagsMu.
func (s *Server) saveList(id, reason string) {
	flags := s.readFlags(id)
	if len(flags) == 0 {
		return
	}
	dir := s.listsDir(id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	b, err := json.Marshal(flags)
	if err != nil {
		return
	}
	name := time.Now().UTC().Format("20060102-150405") + "-" + reason + ".json"
	if os.WriteFile(filepath.Join(dir, name), b, 0o600) != nil {
		return
	}
	names := s.listNames(id)
	for len(names) > keepLists {
		os.Remove(filepath.Join(dir, names[len(names)-1]))
		names = names[:len(names)-1]
	}
}

// listNames: saved lists, newest first.
func (s *Server) listNames(id string) []string {
	ents, _ := os.ReadDir(s.listsDir(id))
	var names []string
	for _, e := range ents {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			names = append(names, e.Name())
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	return names
}

// listAge: how long ago a saved list was made, from its name.
func listAge(name string) time.Duration {
	at, err := time.Parse("20060102-150405", name[:min(15, len(name))])
	if err != nil {
		return time.Duration(1 << 62)
	}
	return time.Since(at)
}

var listReasons = map[string]string{
	"before-rescan":  "Before a re-scan",
	"before-restore": "Before a restore",
	"after-scan":     "After a scan",
}

// GET /api/admin/devices/{id}/lists: the saved lists with their counts, and
// the current one's, plus the scanner's progress.
func (s *Server) handleLists(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	count := func(f map[string]int) map[string]int {
		c := map[string]int{"flagged": 0, "notSensitive": 0, "checked": len(f)}
		for _, v := range f {
			if v == 1 {
				c["flagged"]++
			} else if v == 2 {
				c["notSensitive"]++
			}
		}
		return c
	}
	flagsMu.Lock()
	current := count(s.readFlags(id))
	type item struct {
		Name   string         `json:"name"`
		At     time.Time      `json:"at"`
		Reason string         `json:"reason"`
		Counts map[string]int `json:"counts"`
	}
	var items []item
	for _, n := range s.listNames(id) {
		b, err := os.ReadFile(filepath.Join(s.listsDir(id), n))
		if err != nil {
			continue
		}
		var f map[string]int
		if json.Unmarshal(b, &f) != nil {
			continue
		}
		at, _ := time.Parse("20060102-150405", n[:min(15, len(n))])
		reason := strings.TrimSuffix(n[min(16, len(n)):], ".json")
		if label, ok := listReasons[reason]; ok {
			reason = label
		}
		items = append(items, item{n, at, reason, count(f)})
	}
	flagsMu.Unlock()
	writeJSON(w, 200, map[string]any{"current": current, "lists": items, "scan": s.scanStatus(id)})
}

// POST /api/admin/devices/{id}/lists/restore {"name": "..."}: puts a saved
// list back (saving the current one first). Browsers drop their copies
// (the epoch moves on) and photos the list doesn't cover get checked.
func (s *Server) handleListRestore(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil ||
		body.Name == "" || strings.ContainsAny(body.Name, `/\`) || !strings.HasSuffix(body.Name, ".json") {
		fail(w, 400, "bad request")
		return
	}
	flagsMu.Lock()
	b, err := os.ReadFile(filepath.Join(s.listsDir(id), body.Name))
	var flags map[string]int
	if err == nil {
		err = json.Unmarshal(b, &flags)
	}
	if err != nil {
		flagsMu.Unlock()
		fail(w, 404, "no such list")
		return
	}
	s.saveList(id, "before-restore")
	epoch := s.flagsEpoch(id) + 1
	err = s.writeFlags(id, flags)
	if err == nil {
		err = os.WriteFile(strings.TrimSuffix(s.flagsFile(id), ".json")+".epoch", []byte(strconv.Itoa(epoch)), 0o600)
	}
	flagsMu.Unlock()
	if err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	s.logger.Printf("flags: %s: restored list %s", id, body.Name)
	s.kickScan()
	writeJSON(w, 200, map[string]any{"ok": true, "epoch": epoch})
}
