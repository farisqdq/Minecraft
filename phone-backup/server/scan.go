package main

// The background sensitive-photo scanner: checks every backed-up photo with
// the server's own copy of the detector (nsfw.go) and records the verdicts in
// the shared flags (flags.go), which every viewer reads. It walks each phone's
// Photos folder every few minutes, and straight away when someone opens the
// gallery, so new photos are checked soon after they're backed up without
// anyone keeping a browser open.
//
// It works from the same 360px thumbnail the gallery shows (making it if
// it's not cached yet, which also means the gallery's thumbnails are ready),
// so a photo gets the same verdict here as in the browser. It uses half the
// server's cores, leaving the rest for backups coming in.

import (
	"image"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
)

// The photos the viewer shows and checks (viewer.html's IMG and HEIC).
var scanPhoto = regexp.MustCompile(`(?i)\.(jpe?g|png|gif|webp|bmp|avif|heic|heif)$`)

// And the videos (viewer.html's VID), checked frame by frame (videoscan.go).
var scanVideo = regexp.MustCompile(`(?i)\.(mp4|mov|m4v|3gp|mkv|webm)$`)

const scanEvery = 5 * time.Minute

type scanProgress struct {
	Running   bool    `json:"running"`
	Total     int     `json:"total"`     // photos on the phone
	Done      int     `json:"done"`      // photos with a verdict
	Failed    int     `json:"failed"`    // photos that couldn't be read
	PerMinute float64 `json:"perMinute"` // this run's pace
	Error     string  `json:"error,omitempty"`
}

type scanner struct {
	mu       sync.Mutex
	progress map[string]*scanProgress
	failed   map[string]bool // device|path that couldn't be decoded; not retried until restart
	kick     chan struct{}
}

func (s *Server) startScanner() {
	s.scan = &scanner{progress: map[string]*scanProgress{}, failed: map[string]bool{}, kick: make(chan struct{}, 1)}
	go func() {
		// Let the server settle after a start or an update, unless someone
		// opens the gallery first.
		select {
		case <-time.After(30 * time.Second):
		case <-s.scan.kick:
		}
		for {
			s.scanAll()
			// Then a batch of photo-search indexing (photosearch.go). While
			// there's a backlog, go straight round again: the sensitive check
			// gets its turn between batches, so new photos aren't held up.
			if s.indexAll(clipBatch) {
				continue
			}
			select {
			case <-time.After(scanEvery):
			case <-s.scan.kick:
			}
		}
	}()
}

// kickScan asks for a pass now rather than at the next tick. Harmless while one runs.
func (s *Server) kickScan() {
	if s.scan == nil {
		return
	}
	select {
	case s.scan.kick <- struct{}{}:
	default:
	}
}

func (s *Server) scanStatus(id string) map[string]any {
	if s.scan == nil {
		return map[string]any{"enabled": false}
	}
	s.scan.mu.Lock()
	defer s.scan.mu.Unlock()
	p := s.scan.progress[id]
	if p == nil {
		return map[string]any{"enabled": true, "running": false, "pending": true}
	}
	return map[string]any{"enabled": true, "running": p.Running, "total": p.Total, "done": p.Done, "failed": p.Failed, "perMinute": p.PerMinute, "error": p.Error}
}

func (s *Server) scanAll() {
	if _, err := nsfwModel(); err != nil {
		s.logger.Printf("sensitive-photo scanner off: %v", err)
		return
	}
	s.mu.Lock()
	var ids []string
	for _, d := range s.devices {
		if d.TokenHash != "" {
			ids = append(ids, d.ID)
		}
	}
	s.mu.Unlock()
	for _, id := range ids {
		s.pregenVideoThumbs(id) // quick, and makes the gallery feel instant
		s.warmRatios(id)        // photo shapes for the gallery's list (thumb.go)
		s.scanDevice(id)
	}
}

func (s *Server) scanDevice(id string) {
	base := s.deviceDir(id)
	// Videos only when ffmpeg is there to read them; otherwise they wait
	// for a pass that has it, rather than counting as unreadable.
	_, ffErr := s.ffmpegPath()
	var photos, videos []string
	filepath.WalkDir(filepath.Join(base, "Photos"), func(p string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() || strings.HasSuffix(e.Name(), ".part") {
			return nil
		}
		rel, err := filepath.Rel(base, p)
		if err != nil {
			return nil
		}
		if scanPhoto.MatchString(e.Name()) {
			photos = append(photos, filepath.ToSlash(rel))
		} else if ffErr == nil && scanVideo.MatchString(e.Name()) {
			videos = append(videos, filepath.ToSlash(rel))
		}
		return nil
	})
	// Newest-looking first, so what just came in is checked before the
	// backlog; photos before videos, which take far longer each.
	sort.Sort(sort.Reverse(sort.StringSlice(photos)))
	sort.Sort(sort.Reverse(sort.StringSlice(videos)))
	photos = append(photos, videos...)

	flagsMu.Lock()
	known := s.readFlags(id)
	flagsMu.Unlock()
	var todo []string
	s.scan.mu.Lock()
	for _, p := range photos {
		if _, ok := known[p]; !ok && !s.scan.failed[id+"|"+p] {
			todo = append(todo, p)
		}
	}
	prog := &scanProgress{Running: len(todo) > 0, Total: len(photos), Done: len(photos) - len(todo)}
	if ffErr != nil {
		prog.Error = "Videos aren't being checked yet: " + ffErr.Error()
	}
	s.scan.progress[id] = prog
	s.scan.mu.Unlock()
	if len(todo) == 0 {
		return
	}
	s.logger.Printf("sensitive-photo scanner: %s has %d of %d photos to check", id, len(todo), len(photos))

	workers := max(1, runtime.NumCPU()/2)
	jobs := make(chan string)
	var (
		resMu   sync.Mutex
		pending = map[string]int{}
		// The detector's five scores per photo (scores.go), so the cut-off
		// can be judged and changed from numbers alone.
		pendingScores = map[string][5]float32{}
		wg            sync.WaitGroup
		start         = time.Now()
		checked       int
	)
	flush := func() {
		if len(pending) == 0 {
			return
		}
		batch, scores := pending, pendingScores
		pending, pendingScores = map[string]int{}, map[string][5]float32{}
		flagsMu.Lock()
		flags := s.readFlags(id)
		if mergeFlags(flags, batch) {
			s.writeFlags(id, flags)
		}
		s.saveScores(id, scores)
		flagsMu.Unlock()
	}
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for rel := range jobs {
				var sensitive bool
				var probs [5]float32
				var err error
				if scanVideo.MatchString(rel) {
					var frames int
					t0 := time.Now()
					sensitive, probs, frames, err = s.checkVideo(id, rel)
					s.logger.Printf("video check: %s: %d frames in %s, flagged %v, err %v", rel, frames, time.Since(t0).Round(time.Second), sensitive, err)
				} else {
					sensitive, probs, err = s.checkPhoto(id, rel)
				}
				resMu.Lock()
				s.scan.mu.Lock()
				if err != nil {
					s.scan.failed[id+"|"+rel] = true
					prog.Failed++
				} else {
					pending[rel] = map[bool]int{true: 1, false: 0}[sensitive]
					pendingScores[rel] = probs
					prog.Done++
					checked++
				}
				if mins := time.Since(start).Minutes(); mins > 0 {
					prog.PerMinute = float64(checked) / mins
				}
				s.scan.mu.Unlock()
				if len(pending) >= 25 {
					flush()
				}
				resMu.Unlock()
			}
		}()
	}
	for _, rel := range todo {
		jobs <- rel
	}
	close(jobs)
	wg.Wait()
	resMu.Lock()
	flush()
	resMu.Unlock()
	s.scan.mu.Lock()
	prog.Running = false
	s.scan.mu.Unlock()
	s.logger.Printf("sensitive-photo scanner: %s done, %d checked in %s", id, checked, time.Since(start).Round(time.Second))
	// Keep a copy of the finished list (lists.go), at most hourly.
	if checked > 0 {
		flagsMu.Lock()
		if names := s.listNames(id); len(names) == 0 || listAge(names[0]) > time.Hour {
			s.saveList(id, "after-scan")
		}
		flagsMu.Unlock()
	}
}

// checkPhoto makes (or reuses) the gallery thumbnail and runs the detector on it.
func (s *Server) checkPhoto(id, rel string) (bool, [5]float32, error) {
	var none [5]float32
	full := filepath.Join(s.deviceDir(id), filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil {
		return false, none, err
	}
	thumb := s.thumbPath(id, rel, info, thumbSize)
	if _, err := os.Stat(thumb); err != nil {
		if err := makeThumb(full, thumb, thumbSize); err != nil {
			return false, none, err
		}
	}
	f, err := os.Open(thumb)
	if err != nil {
		return false, none, err
	}
	img, _, err := image.Decode(f)
	f.Close()
	if err != nil {
		return false, none, err
	}
	p, err := classifyImage(img)
	if err != nil {
		return false, none, err
	}
	return nsfwVerdict(p), p, nil
}
