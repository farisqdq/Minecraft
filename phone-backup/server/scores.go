package main

// The detector's scores for each checked photo or video, kept beside the
// verdicts so the cut-off can be judged and tuned from the numbers alone,
// without anyone looking at the photos. One file per phone under
// <data>/viewer, a few dozen bytes a photo.

import (
	"encoding/json"
	"math"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
)

func (s *Server) scoresFile(id string) string {
	return strings.TrimSuffix(s.flagsFile(id), ".json") + ".scores.json"
}

func (s *Server) readScores(id string) map[string][5]float32 {
	out := map[string][5]float32{}
	if b, err := os.ReadFile(s.scoresFile(id)); err == nil {
		json.Unmarshal(b, &out)
	}
	return out
}

// saveScores merges new scores in. Caller holds flagsMu.
func (s *Server) saveScores(id string, add map[string][5]float32) {
	if len(add) == 0 {
		return
	}
	all := s.readScores(id)
	for p, v := range add {
		for i := range v {
			v[i] = float32(math.Round(float64(v[i])*1000) / 1000)
		}
		all[p] = v
	}
	b, err := json.Marshal(all)
	if err != nil {
		return
	}
	tmp := s.scoresFile(id) + ".tmp"
	if os.WriteFile(tmp, b, 0o600) == nil {
		os.Rename(tmp, s.scoresFile(id))
	}
}

// GET /api/admin/devices/{id}/scores: how sure the detector was, as
// numbers only — no file names — for every currently flagged item, plus how
// many scored photos clear a range of cut-offs.
func (s *Server) handleScores(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	flagsMu.Lock()
	flags, scores := s.readFlags(id), s.readScores(id)
	flagsMu.Unlock()
	type row struct {
		Drawing, Hentai, Neutral, Porn, Sexy float32
		Video                                bool
	}
	var flagged []row
	for p, v := range flags {
		sc, ok := scores[p]
		if v != 1 || !ok {
			continue
		}
		flagged = append(flagged, row{sc[0], sc[1], sc[2], sc[3], sc[4], scanVideo.MatchString(p)})
	}
	sort.Slice(flagged, func(i, j int) bool { return flagged[i].Porn > flagged[j].Porn })
	cuts := map[string]int{}
	for _, t := range []float32{0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.999} {
		n := 0
		for _, sc := range scores {
			if sc[3] >= t {
				n++
			}
		}
		cuts[strconv.FormatFloat(float64(t), 'f', -1, 32)] = n
	}
	writeJSON(w, 200, map[string]any{"scored": len(scores), "flaggedWithScores": len(flagged), "flagged": flagged, "pornAtLeast": cuts})
}
