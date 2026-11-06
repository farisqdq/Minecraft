package main

// Search photos by what's in them. Each photo (and each video, by its
// thumbnail frame) gets a CLIP vector once (clip.go), kept per phone in
// <data>/viewer/clip-<id>.bin; a search turns the words into a vector and
// returns the photos that point the same way, best first. It all runs on
// this server: no photo or search leaves it.
//
// Indexing a photo takes a second or two, so the scanner loop (scan.go)
// does it in batches between its sensitive-photo passes: the backlog fills
// in over the first day or so and new photos join within minutes, while the
// sensitive check and backups keep their turn.

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"io"
	"io/fs"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

const clipBatch = 300 // photos indexed per pass before the scanner gets its turn

type searchIndex struct {
	mu       sync.Mutex
	vecs     map[string]map[string][]float32 // device -> path -> unit vector
	failed   map[string]bool                 // device|path that couldn't be read
	progress map[string]*scanProgress
	errText  string // why indexing can't run (e.g. the model download failed)
	fileMu   sync.Mutex
}

var search = &searchIndex{vecs: map[string]map[string][]float32{}, failed: map[string]bool{}, progress: map[string]*scanProgress{}}

var (
	clipFetchMu    sync.Mutex
	clipFetchErr   error
	clipFetchTried time.Time
)

// clipWeights finds or fetches the CLIP checkpoint (about 600 MB), checked
// against its pinned SHA-256. A failure is remembered for an hour.
func (s *Server) clipWeights() (string, error) {
	clipFetchMu.Lock()
	defer clipFetchMu.Unlock()
	path := filepath.Join(s.cfg.DataDir, "tools", "clip-vit-base-patch32.bin")
	if _, err := os.Stat(path); err == nil {
		return path, nil
	}
	if clipFetchErr != nil && time.Since(clipFetchTried) < time.Hour {
		return "", clipFetchErr
	}
	clipFetchTried = time.Now()
	s.logger.Printf("photo search: downloading the CLIP model")
	if err := fetchVerified(clipModelURL, clipModelSHA, path); err != nil {
		clipFetchErr = fmt.Errorf("couldn't get the search model: %w", err)
		s.logger.Printf("photo search: %v", clipFetchErr)
		return "", clipFetchErr
	}
	clipFetchErr = nil
	s.logger.Printf("photo search: model ready")
	return path, nil
}

func fetchVerified(url, sum, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	resp, err := (&http.Client{Timeout: 60 * time.Minute}).Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download: %s", resp.Status)
	}
	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), resp.Body)
	f.Close()
	if err != nil {
		os.Remove(tmp)
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != sum {
		os.Remove(tmp)
		return fmt.Errorf("download didn't match the expected checksum (%s)", got)
	}
	return os.Rename(tmp, dst)
}

func (s *Server) clip() (*clipModel, error) {
	path, err := s.clipWeights()
	if err != nil {
		return nil, err
	}
	return loadCLIP(path)
}

// ---------- the per-phone vector file ----------

func (s *Server) clipFile(id string) string {
	return filepath.Join(s.cfg.DataDir, "viewer", "clip-"+cleanSegment(id)+".bin")
}

// vectorsFor loads a phone's vectors the first time they're needed.
// Each record: uint16 path length, the path, 512 little-endian float32s.
func (s *Server) vectorsFor(id string) map[string][]float32 {
	search.mu.Lock()
	defer search.mu.Unlock()
	if v := search.vecs[id]; v != nil {
		return v
	}
	v := map[string][]float32{}
	if b, err := os.ReadFile(s.clipFile(id)); err == nil {
		for len(b) >= 2 {
			n := int(binary.LittleEndian.Uint16(b))
			if len(b) < 2+n+clipDim*4 {
				break // a record cut short by a crash; the rest is redone
			}
			p := string(b[2 : 2+n])
			vec := make([]float32, clipDim)
			for i := range vec {
				vec[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[2+n+i*4:]))
			}
			v[p] = vec
			b = b[2+n+clipDim*4:]
		}
	}
	search.vecs[id] = v
	return v
}

func (s *Server) addVector(id, path string, vec []float32) error {
	rec := make([]byte, 2+len(path)+clipDim*4)
	binary.LittleEndian.PutUint16(rec, uint16(len(path)))
	copy(rec[2:], path)
	for i, x := range vec {
		binary.LittleEndian.PutUint32(rec[2+len(path)+i*4:], math.Float32bits(x))
	}
	search.fileMu.Lock()
	err := os.MkdirAll(filepath.Dir(s.clipFile(id)), 0o755)
	if err == nil {
		var f *os.File
		if f, err = os.OpenFile(s.clipFile(id), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600); err == nil {
			_, err = f.Write(rec)
			f.Close()
		}
	}
	search.fileMu.Unlock()
	if err != nil {
		return err
	}
	vs := s.vectorsFor(id)
	search.mu.Lock()
	vs[path] = vec
	search.mu.Unlock()
	return nil
}

// ---------- indexing ----------

// startIndexer runs photo-search indexing in its own loop, alongside the
// sensitive check rather than after it (a full re-check would otherwise
// hold search back for an hour or more), on a quarter of the cores.
func (s *Server) startIndexer() {
	go func() {
		time.Sleep(45 * time.Second) // let the server settle after a start or an update
		for {
			if s.indexAll(clipBatch) {
				continue // more waiting: straight on with the next batch
			}
			time.Sleep(scanEvery)
		}
	}()
}

// indexAll indexes up to `limit` new photos across the phones and says
// whether there are more waiting.
func (s *Server) indexAll(limit int) bool {
	m, err := s.clip()
	if err != nil {
		s.setSearchError(err)
		return false
	}
	s.setSearchError(errors.New(""))
	s.mu.Lock()
	var ids []string
	for _, d := range s.devices {
		if d.TokenHash != "" {
			ids = append(ids, d.ID)
		}
	}
	s.mu.Unlock()
	more := false
	for _, id := range ids {
		if s.indexDevice(m, id, limit) {
			more = true
		}
	}
	return more
}

func (s *Server) setSearchError(err error) {
	search.mu.Lock()
	search.errText = err.Error()
	search.mu.Unlock()
}

func (s *Server) indexDevice(m *clipModel, id string, limit int) bool {
	base := s.deviceDir(id)
	_, ffErr := s.ffmpegPath()
	var all []string
	filepath.WalkDir(filepath.Join(base, "Photos"), func(p string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() || strings.HasSuffix(e.Name(), ".part") {
			return nil
		}
		if scanPhoto.MatchString(e.Name()) || (ffErr == nil && scanVideo.MatchString(e.Name())) {
			if rel, err := filepath.Rel(base, p); err == nil {
				all = append(all, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	sort.Sort(sort.Reverse(sort.StringSlice(all))) // newest-looking first
	have := s.vectorsFor(id)
	search.mu.Lock()
	var todo []string
	for _, p := range all {
		if _, ok := have[p]; !ok && !search.failed[id+"|"+p] {
			todo = append(todo, p)
		}
	}
	prog := &scanProgress{Total: len(all), Done: len(all) - len(todo), Running: len(todo) > 0}
	if old := search.progress[id]; old != nil {
		prog.PerMinute = old.PerMinute
	}
	search.progress[id] = prog
	search.mu.Unlock()
	more := len(todo) > limit
	if more {
		todo = todo[:limit]
	}
	if len(todo) == 0 {
		return false
	}

	workers := max(1, runtime.NumCPU()/4)
	jobs := make(chan string)
	var wg sync.WaitGroup
	start, done := time.Now(), 0
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for rel := range jobs {
				vec, err := s.embedFile(m, id, rel)
				if err == nil {
					err = s.addVector(id, rel, vec)
				}
				search.mu.Lock()
				if err != nil {
					search.failed[id+"|"+rel] = true
					prog.Done++ // can't be read: nothing more to do with it either
				} else {
					prog.Done++
					done++
					if mins := time.Since(start).Minutes(); mins > 0.05 {
						prog.PerMinute = float64(done) / mins
					}
				}
				search.mu.Unlock()
			}
		}()
	}
	for _, rel := range todo {
		jobs <- rel
	}
	close(jobs)
	wg.Wait()
	search.mu.Lock()
	prog.Running = more
	search.mu.Unlock()
	s.logger.Printf("photo search: %s: %d more indexed in %s (%d of %d)", id, done, time.Since(start).Round(time.Second), prog.Done, prog.Total)
	return more
}

// embedFile embeds a photo or video from its gallery thumbnail, making the
// thumbnail if it isn't cached yet.
func (s *Server) embedFile(m *clipModel, id, rel string) ([]float32, error) {
	full := filepath.Join(s.deviceDir(id), filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil {
		return nil, err
	}
	thumb := s.thumbPath(id, rel, info, thumbSize)
	if _, err := os.Stat(thumb); err != nil {
		if scanVideo.MatchString(rel) {
			err = s.makeVideoThumb(full, thumb, thumbSize)
		} else {
			err = makeThumb(full, thumb, thumbSize)
		}
		if err != nil {
			return nil, err
		}
	}
	f, err := os.Open(thumb)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(f)
	f.Close()
	if err != nil {
		return nil, err
	}
	if b := img.Bounds(); b.Dx() == 0 || b.Dy() == 0 {
		return nil, errors.New("empty image")
	}
	return m.embedImage(img), nil
}

// ---------- searching ----------

// GET /viewer/api/devices/{id}/search?q=beach → the best matches, best
// first, and how far indexing has got. Without q, just the progress.
func (s *Server) handleSearch(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	d := s.findDevice(id)
	s.mu.Unlock()
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	search.mu.Lock()
	status := map[string]any{"indexed": 0, "total": 0, "running": false, "error": search.errText}
	if p := search.progress[id]; p != nil {
		status = map[string]any{"indexed": p.Done, "total": p.Total, "running": p.Running, "perMinute": p.PerMinute, "error": search.errText}
	}
	search.mu.Unlock()
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		writeJSON(w, 200, map[string]any{"status": status})
		return
	}
	if len(q) > 200 {
		q = q[:200]
	}
	m, err := s.clip()
	if err != nil {
		fail(w, 503, "Search isn't ready yet: "+err.Error())
		return
	}
	// CLIP was trained on captions, so a bare word does better as one.
	want := m.embedText("a photo of " + q)
	vecs := s.vectorsFor(id)
	type hit struct {
		P string  `json:"p"`
		S float32 `json:"s"`
	}
	search.mu.Lock()
	hits := make([]hit, 0, len(vecs))
	for p, v := range vecs {
		hits = append(hits, hit{p, dot(want, v)})
	}
	search.mu.Unlock()
	sort.Slice(hits, func(i, j int) bool { return hits[i].S > hits[j].S })
	// Keep the clear matches: close to the best one and above the level
	// where CLIP is only guessing, up to a few hundred.
	var out []hit
	for _, h := range hits {
		if len(out) >= 200 || h.S < 0.2 || (len(out) > 0 && h.S < hits[0].S-0.045) {
			break
		}
		out = append(out, h)
	}
	writeJSON(w, 200, map[string]any{"results": out, "status": status})
}
