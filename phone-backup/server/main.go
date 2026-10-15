// Rent Roll phone backup server.
//
// One small program that runs on the VPS and receives backups from the
// company phones (the Rent Roll Android app). Files land in
// <dataDir>/devices/<deviceId>/{Photos,Files,Contacts,Calls,Texts,Apps}/...
//
// Who may talk to it:
//   - Rent Roll's server, with the shared secret (Authorization: Bearer <secret>):
//     adds phones, lists them, browses their files.
//   - A phone, with the token it got by entering a setup code from Rent Roll.
//   - Anyone holding a download link Rent Roll signed with the secret; links
//     expire.
//
// It serves HTTPS itself (Let's Encrypt, via autocert) when a domain is set.
package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

const version = "1.0.0"

// Top-level folders a phone may write into.
var topFolders = map[string]bool{
	"Photos": true, "Files": true, "Contacts": true, "Calls": true, "Texts": true, "Apps": true,
}

// Snapshot folders keep only their newest files; photos and files are kept forever.
var snapshotFolders = map[string]bool{"Contacts": true, "Calls": true, "Texts": true, "Apps": true}

const snapshotsKept = 30

type Config struct {
	Domain    string  `json:"domain"`
	Secret    string  `json:"secret"`
	DataDir   string  `json:"dataDir"`
	MinFreeGB float64 `json:"minFreeGB"`
	// Plain-HTTP listen address, used when Domain is empty (testing).
	Listen string `json:"listen"`
}

type Device struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	CreatedAt   time.Time       `json:"createdAt"`
	TokenHash   string          `json:"tokenHash,omitempty"`
	PairCode    string          `json:"pairCode,omitempty"`
	PairExpires time.Time       `json:"pairExpires,omitempty"`
	PairedAt    *time.Time      `json:"pairedAt,omitempty"`
	Model       string          `json:"model,omitempty"`
	LastSeen    *time.Time      `json:"lastSeen,omitempty"`
	Report      json.RawMessage `json:"report,omitempty"`
	// Set when Rent Roll asks this phone to back up; the phone clears it by
	// starting a run the next time it checks in.
	BackupRequested bool       `json:"backupRequested,omitempty"`
	RequestedAt     *time.Time `json:"requestedAt,omitempty"`
	// The app version, read from the User-Agent on the phone's requests.
	AppVersion string `json:"appVersion,omitempty"`
	// A pending remote command for the phone: "lock", "wipe" or "locate".
	// Handed to the phone once, on its next check-in.
	Command   string     `json:"command,omitempty"`
	CommandAt *time.Time `json:"commandAt,omitempty"`
	// Last known location the phone reported (from a "locate" command).
	Loc *Location `json:"loc,omitempty"`
	// Anti-theft capabilities the phone reports ("admin=1;loc=always").
	Caps string `json:"caps,omitempty"`
	// The last remote command handed to the phone, and when.
	LastCmd   string     `json:"lastCmd,omitempty"`
	LastCmdAt *time.Time `json:"lastCmdAt,omitempty"`
}

type Location struct {
	Lat float64   `json:"lat"`
	Lng float64   `json:"lng"`
	Acc float64   `json:"acc"`
	At  time.Time `json:"at"`
}

// appVersionFromUA pulls "1.4.0" out of a "RentRollAndroid/1.4.0" User-Agent.
func appVersionFromUA(ua string) string {
	const p = "RentRollAndroid/"
	i := strings.Index(ua, p)
	if i < 0 {
		return ""
	}
	v := ua[i+len(p):]
	if j := strings.IndexAny(v, " \t;"); j >= 0 {
		v = v[:j]
	}
	if len(v) > 20 {
		v = v[:20]
	}
	return v
}

type Server struct {
	cfg     Config
	mu      sync.Mutex
	devices []*Device
	sizes   map[string]*usage // per device
	locks   sync.Map          // path -> *sync.Mutex
	logger  *log.Logger
}

type usage struct {
	Bytes int64 `json:"bytes"`
	Files int64 `json:"files"`
}

func main() {
	cfgPath := flag.String("config", defaultConfigPath(), "path to config.json")
	flag.Parse()

	raw, err := os.ReadFile(*cfgPath)
	if err != nil {
		log.Fatalf("read config: %v", err)
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		log.Fatalf("parse config: %v", err)
	}
	if len(cfg.Secret) < 32 {
		log.Fatal("config: secret must be at least 32 characters")
	}
	if cfg.DataDir == "" {
		cfg.DataDir = filepath.Dir(*cfgPath)
	}
	if cfg.MinFreeGB <= 0 {
		cfg.MinFreeGB = 10
	}

	s, err := newServer(cfg)
	if err != nil {
		log.Fatal(err)
	}
	s.logger.Printf("phone backup server %s starting, data in %s", version, cfg.DataDir)

	if cfg.Domain == "" {
		addr := cfg.Listen
		if addr == "" {
			addr = ":8080"
		}
		s.logger.Printf("no domain set; plain HTTP on %s", addr)
		log.Fatal(newHTTPServer(addr, s.routes()).ListenAndServe())
	}

	m := &autocert.Manager{
		Prompt:     autocert.AcceptTOS,
		HostPolicy: autocert.HostWhitelist(cfg.Domain),
		Cache:      autocert.DirCache(filepath.Join(cfg.DataDir, "certs")),
	}
	go func() {
		// Port 80 answers Let's Encrypt's checks and sends everything else to HTTPS.
		srv := newHTTPServer(":80", m.HTTPHandler(nil))
		s.logger.Fatal(srv.ListenAndServe())
	}()
	srv := newHTTPServer(":443", s.routes())
	srv.TLSConfig = &tls.Config{GetCertificate: m.GetCertificate, MinVersion: tls.VersionTLS12, NextProtos: []string{"h2", "http/1.1"}}
	s.logger.Printf("HTTPS on %s", cfg.Domain)
	s.logger.Fatal(srv.ListenAndServeTLS("", ""))
}

func defaultConfigPath() string {
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), "config.json")
	}
	return "config.json"
}

func newHTTPServer(addr string, h http.Handler) *http.Server {
	return &http.Server{
		Addr:              addr,
		Handler:           h,
		ReadHeaderTimeout: 20 * time.Second,
		// Uploads and video downloads are long; only idle connections time out.
		IdleTimeout: 2 * time.Minute,
	}
}

func newServer(cfg Config) (*Server, error) {
	if err := os.MkdirAll(filepath.Join(cfg.DataDir, "devices"), 0o755); err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, sizes: map[string]*usage{}}
	s.logger = log.New(newRotatingLog(filepath.Join(cfg.DataDir, "server.log")), "", log.LstdFlags)
	if err := s.load(); err != nil {
		return nil, err
	}
	for _, d := range s.devices {
		s.sizes[d.ID] = &usage{}
	}
	go s.measureAll()
	return s, nil
}

// ---------- persistence ----------

func (s *Server) devicesFile() string { return filepath.Join(s.cfg.DataDir, "devices.json") }

func (s *Server) load() error {
	raw, err := os.ReadFile(s.devicesFile())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, &s.devices)
}

// save writes devices.json atomically. Caller holds s.mu.
func (s *Server) save() error {
	raw, err := json.MarshalIndent(s.devices, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.devicesFile() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.devicesFile())
}

func (s *Server) deviceDir(id string) string { return filepath.Join(s.cfg.DataDir, "devices", id) }

func (s *Server) measureAll() {
	s.mu.Lock()
	ids := make([]string, 0, len(s.devices))
	for _, d := range s.devices {
		ids = append(ids, d.ID)
	}
	s.mu.Unlock()
	for _, id := range ids {
		u := &usage{}
		filepath.WalkDir(s.deviceDir(id), func(p string, e os.DirEntry, err error) error {
			if err != nil || e.IsDir() || strings.HasSuffix(p, ".part") {
				return nil
			}
			if info, err := e.Info(); err == nil {
				u.Bytes += info.Size()
				u.Files++
			}
			return nil
		})
		s.mu.Lock()
		s.sizes[id] = u
		s.mu.Unlock()
	}
}

func (s *Server) addUsage(id string, bytes, files int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.sizes[id]
	if u == nil {
		u = &usage{}
		s.sizes[id] = u
	}
	u.Bytes += bytes
	u.Files += files
}

// ---------- helpers ----------

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

// Setup codes avoid look-alike characters (0/O, 1/I/L) since people type them.
const codeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

func randomCode() string {
	var b strings.Builder
	for i := 0; i < 8; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeAlphabet))))
		if err != nil {
			panic(err)
		}
		b.WriteByte(codeAlphabet[n.Int64()])
	}
	return b.String()
}

func hashToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func readJSON(r *http.Request, v any, limit int64) error {
	return json.NewDecoder(io.LimitReader(r.Body, limit)).Decode(v)
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if strings.HasPrefix(h, "Bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return ""
}

func (s *Server) isAdmin(r *http.Request) bool {
	t := bearer(r)
	return t != "" && subtle.ConstantTimeCompare([]byte(t), []byte(s.cfg.Secret)) == 1
}

func (s *Server) deviceFor(r *http.Request) *Device {
	t := bearer(r)
	if t == "" {
		return nil
	}
	h := hashToken(t)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range s.devices {
		if d.TokenHash != "" && subtle.ConstantTimeCompare([]byte(d.TokenHash), []byte(h)) == 1 {
			return d
		}
	}
	return nil
}

func (s *Server) findDevice(id string) *Device {
	for _, d := range s.devices {
		if d.ID == id {
			return d
		}
	}
	return nil
}

var reservedNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true, "COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true, "LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

// cleanSegment makes one path part safe as a Windows file name. It is
// idempotent, so a path the server listed comes back to the same file.
func cleanSegment(seg string) string {
	var b strings.Builder
	for _, r := range seg {
		if r < 32 || strings.ContainsRune(`<>:"\|?*`, r) {
			b.WriteRune('_')
		} else {
			b.WriteRune(r)
		}
	}
	out := strings.TrimRight(b.String(), ". ")
	if out == "" {
		out = "_"
	}
	base := strings.ToUpper(strings.SplitN(out, ".", 2)[0])
	if reservedNames[base] {
		out = "_" + out
	}
	if len(out) > 200 {
		ext := filepath.Ext(out)
		if len(ext) > 20 {
			ext = ""
		}
		out = out[:200-len(ext)] + ext
	}
	return out
}

// cleanPath turns a phone's "Photos/DCIM/Camera/x.jpg" into a safe relative
// path, or "" when it isn't allowed. requireTop demands a known top folder.
func cleanPath(p string, requireTop bool) string {
	p = strings.ReplaceAll(p, "\\", "/")
	parts := strings.Split(p, "/")
	out := make([]string, 0, len(parts))
	for _, seg := range parts {
		if seg == "" || seg == "." {
			continue
		}
		if seg == ".." {
			return ""
		}
		out = append(out, cleanSegment(seg))
	}
	if len(out) == 0 || len(out) > 40 {
		if len(out) == 0 && !requireTop {
			return "."
		}
		return ""
	}
	if requireTop && (!topFolders[out[0]] || len(out) < 2) {
		return ""
	}
	if !requireTop && !topFolders[out[0]] {
		return ""
	}
	return strings.Join(out, "/")
}

func (s *Server) pathLock(full string) *sync.Mutex {
	m, _ := s.locks.LoadOrStore(strings.ToLower(full), &sync.Mutex{})
	return m.(*sync.Mutex)
}

func (s *Server) lowOnSpace() bool {
	free, _, err := diskSpace(s.cfg.DataDir)
	if err != nil {
		return false
	}
	return float64(free) < s.cfg.MinFreeGB*(1<<30)
}

// ---------- routes ----------

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "version": version})
	})

	// Phone side.
	mux.HandleFunc("POST /api/pair", s.handlePair)
	mux.HandleFunc("POST /api/device/check", s.handleCheck)
	mux.HandleFunc("PUT /api/device/upload", s.handleUpload)
	mux.HandleFunc("POST /api/device/report", s.handleReport)
	mux.HandleFunc("POST /api/device/location", s.handleLocation)
	mux.HandleFunc("GET /api/device/me", s.handleMe)

	// Rent Roll side.
	mux.HandleFunc("GET /api/admin/summary", s.admin(s.handleSummary))
	mux.HandleFunc("POST /api/admin/devices", s.admin(s.handleCreate))
	mux.HandleFunc("POST /api/admin/devices/{id}/code", s.admin(s.handleNewCode))
	mux.HandleFunc("POST /api/admin/devices/{id}/request", s.admin(s.handleRequestBackup))
	mux.HandleFunc("POST /api/admin/devices/{id}/command", s.admin(s.handleCommand))
	mux.HandleFunc("PATCH /api/admin/devices/{id}", s.admin(s.handleRename))
	mux.HandleFunc("DELETE /api/admin/devices/{id}", s.admin(s.handleDelete))
	mux.HandleFunc("GET /api/admin/devices/{id}/list", s.admin(s.handleList))

	// Signed links.
	mux.HandleFunc("GET /dl", s.handleDownload)
	mux.HandleFunc("GET /thumb", s.handleThumb)
	s.viewerRoutes(mux)

	return logRequests(s.logger, mux)
}

func (s *Server) admin(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.isAdmin(r) {
			time.Sleep(300 * time.Millisecond)
			fail(w, 401, "not allowed")
			return
		}
		h(w, r)
	}
}

// ---------- phone handlers ----------

func (s *Server) handlePair(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code  string `json:"code"`
		Model string `json:"model"`
	}
	if err := readJSON(r, &body, 4096); err != nil {
		fail(w, 400, "bad request")
		return
	}
	code := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(body.Code), "-", ""))
	code = strings.ReplaceAll(code, " ", "")
	time.Sleep(500 * time.Millisecond) // slows guessing
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, d := range s.devices {
		if d.PairCode != "" && subtle.ConstantTimeCompare([]byte(d.PairCode), []byte(code)) == 1 {
			if time.Now().After(d.PairExpires) {
				fail(w, 410, "That setup code has expired. Make a new one on the Phones page in Rent Roll.")
				return
			}
			token := randomToken(32)
			now := time.Now().UTC()
			d.TokenHash = hashToken(token)
			d.PairCode = ""
			d.PairExpires = time.Time{}
			d.PairedAt = &now
			d.LastSeen = &now
			d.Model = strings.TrimSpace(body.Model)
			if len(d.Model) > 100 {
				d.Model = d.Model[:100]
			}
			if ver := appVersionFromUA(r.UserAgent()); ver != "" {
				d.AppVersion = ver
			}
			if err := s.save(); err != nil {
				fail(w, 500, "couldn't save")
				return
			}
			s.logger.Printf("paired device %s (%s) model=%q", d.ID, d.Name, d.Model)
			writeJSON(w, 200, map[string]string{"deviceId": d.ID, "name": d.Name, "token": token})
			return
		}
	}
	fail(w, 404, "That setup code isn't right. Check it on the Phones page in Rent Roll.")
}

func (s *Server) touch(d *Device) {
	s.mu.Lock()
	now := time.Now().UTC()
	d.LastSeen = &now
	s.mu.Unlock()
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	d := s.deviceFor(r)
	if d == nil {
		fail(w, 401, "This phone isn't set up for backup anymore. Enter a new setup code.")
		return
	}
	s.touch(d)
	// A pending "back up now" from Rent Roll is handed to the phone once, then cleared.
	ver := appVersionFromUA(r.UserAgent())
	s.mu.Lock()
	requested := d.BackupRequested
	changed := requested
	if requested {
		d.BackupRequested = false
		d.RequestedAt = nil
	}
	// A pending remote command is handed over once, then cleared.
	command := d.Command
	if command != "" {
		changed = true
		d.Command = ""
		d.CommandAt = nil
		now := time.Now().UTC()
		d.LastCmd = command
		d.LastCmdAt = &now
	}
	if caps := r.Header.Get("X-RR-Caps"); caps != "" && len(caps) < 120 && caps != d.Caps {
		d.Caps = caps
		changed = true
	}
	if ver != "" && ver != d.AppVersion {
		d.AppVersion = ver
		changed = true
	}
	if changed {
		s.save()
	}
	s.mu.Unlock()
	free, total, _ := diskSpace(s.cfg.DataDir)
	writeJSON(w, 200, map[string]any{"deviceId": d.ID, "name": d.Name, "serverFree": free, "serverTotal": total, "lowOnSpace": s.lowOnSpace(), "backupNow": requested, "command": command})
}

// handleLocation stores a location the phone reported after a "locate" command.
func (s *Server) handleLocation(w http.ResponseWriter, r *http.Request) {
	d := s.deviceFor(r)
	if d == nil {
		fail(w, 401, "not set up")
		return
	}
	var body struct {
		Lat float64 `json:"lat"`
		Lng float64 `json:"lng"`
		Acc float64 `json:"acc"`
	}
	if err := readJSON(r, &body, 4096); err != nil {
		fail(w, 400, "bad location")
		return
	}
	s.mu.Lock()
	d.Loc = &Location{Lat: body.Lat, Lng: body.Lng, Acc: body.Acc, At: time.Now().UTC()}
	err := s.save()
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// handleCommand queues a remote command (lock, wipe, locate) for a phone.
func (s *Server) handleCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Cmd string `json:"cmd"`
	}
	if err := readJSON(r, &body, 4096); err != nil {
		fail(w, 400, "bad request")
		return
	}
	if body.Cmd != "lock" && body.Cmd != "wipe" && body.Cmd != "locate" && body.Cmd != "cancel" {
		fail(w, 400, "unknown command")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.findDevice(r.PathValue("id"))
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	if d.TokenHash == "" {
		fail(w, 409, "This phone isn't set up, so it can't be sent a command.")
		return
	}
	now := time.Now().UTC()
	if body.Cmd == "cancel" {
		// Withdraw a command the phone hasn't picked up yet (e.g. a wipe sent by mistake).
		d.Command = ""
		d.CommandAt = nil
	} else {
		d.Command = body.Cmd
		d.CommandAt = &now
	}
	if err := s.save(); err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	s.logger.Printf("queued command %q for device %s (%s)", body.Cmd, d.ID, d.Name)
	writeJSON(w, 200, s.view(d))
}

type checkFile struct {
	P string `json:"p"`
	S int64  `json:"s"`
}

// handleCheck takes the phone's list of files and answers which still need
// uploading, and from which byte (a half-finished upload resumes).
func (s *Server) handleCheck(w http.ResponseWriter, r *http.Request) {
	d := s.deviceFor(r)
	if d == nil {
		fail(w, 401, "not set up")
		return
	}
	var body struct {
		Files []checkFile `json:"files"`
	}
	if err := readJSON(r, &body, 16<<20); err != nil {
		fail(w, 400, "bad request")
		return
	}
	if len(body.Files) > 5000 {
		fail(w, 400, "too many files in one check")
		return
	}
	type need struct {
		P    string `json:"p"`
		Have int64  `json:"have"`
	}
	needs := []need{}
	base := s.deviceDir(d.ID)
	for _, f := range body.Files {
		rel := cleanPath(f.P, true)
		if rel == "" {
			continue
		}
		full := filepath.Join(base, filepath.FromSlash(rel))
		if info, err := os.Stat(full); err == nil && !info.IsDir() && info.Size() == f.S {
			continue
		}
		var have int64
		if info, err := os.Stat(full + ".part"); err == nil && info.Size() <= f.S {
			have = info.Size()
		}
		needs = append(needs, need{P: f.P, Have: have})
	}
	s.touch(d)
	writeJSON(w, 200, map[string]any{"need": needs, "lowOnSpace": s.lowOnSpace()})
}

const maxChunk = 64 << 20

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	d := s.deviceFor(r)
	if d == nil {
		fail(w, 401, "not set up")
		return
	}
	q := r.URL.Query()
	rel := cleanPath(q.Get("p"), true)
	offset, err1 := strconv.ParseInt(q.Get("o"), 10, 64)
	total, err2 := strconv.ParseInt(q.Get("t"), 10, 64)
	if rel == "" || err1 != nil || err2 != nil || offset < 0 || total < 0 || offset > total {
		fail(w, 400, "bad upload")
		return
	}
	if s.lowOnSpace() {
		fail(w, 507, "The backup server is almost out of disk space.")
		return
	}
	full := filepath.Join(s.deviceDir(d.ID), filepath.FromSlash(rel))
	lock := s.pathLock(full)
	lock.Lock()
	defer lock.Unlock()

	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		fail(w, 500, "couldn't make folder")
		return
	}
	part := full + ".part"
	var have int64
	if info, err := os.Stat(part); err == nil {
		have = info.Size()
	}
	if offset != have && offset != 0 {
		writeJSON(w, 409, map[string]any{"error": "offset mismatch", "have": have})
		return
	}
	flags := os.O_CREATE | os.O_WRONLY
	if offset == 0 {
		flags |= os.O_TRUNC
	} else {
		flags |= os.O_APPEND
	}
	f, err := os.OpenFile(part, flags, 0o644)
	if err != nil {
		fail(w, 500, "couldn't open file")
		return
	}
	n, copyErr := io.Copy(f, io.LimitReader(r.Body, min(maxChunk, total-offset)))
	closeErr := f.Close()
	have = offset + n
	if copyErr != nil || closeErr != nil {
		// Keep what arrived; the phone resumes from `have`.
		writeJSON(w, 500, map[string]any{"error": "upload interrupted", "have": have})
		return
	}
	done := have == total
	if done {
		var oldSize, oldFiles int64
		if info, err := os.Stat(full); err == nil {
			oldSize, oldFiles = info.Size(), 1
		}
		os.Remove(full)
		if err := os.Rename(part, full); err != nil {
			fail(w, 500, "couldn't finish file")
			return
		}
		if ms, err := strconv.ParseInt(q.Get("m"), 10, 64); err == nil && ms > 0 {
			t := time.UnixMilli(ms)
			os.Chtimes(full, t, t)
		}
		s.addUsage(d.ID, total-oldSize, 1-oldFiles)
		top := strings.SplitN(rel, "/", 2)[0]
		// Prune only the dated snapshot files directly in the top folder
		// (Texts/texts-DATE.xml). Subfolder files (Texts/media/ attachments) stay.
		if snapshotFolders[top] && strings.Count(rel, "/") == 1 {
			s.pruneSnapshots(d.ID, filepath.Dir(full))
		}
	}
	s.touch(d)
	writeJSON(w, 200, map[string]any{"have": have, "done": done})
}

func (s *Server) pruneSnapshots(deviceID, dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type fi struct {
		name string
		mod  time.Time
		size int64
	}
	var files []fi
	for _, e := range entries {
		if e.IsDir() || strings.HasSuffix(e.Name(), ".part") {
			continue
		}
		if info, err := e.Info(); err == nil {
			files = append(files, fi{e.Name(), info.ModTime(), info.Size()})
		}
	}
	if len(files) <= snapshotsKept {
		return
	}
	sort.Slice(files, func(i, j int) bool { return files[i].name > files[j].name })
	for _, f := range files[snapshotsKept:] {
		if os.Remove(filepath.Join(dir, f.name)) == nil {
			s.addUsage(deviceID, -f.size, -1)
		}
	}
}

func (s *Server) handleReport(w http.ResponseWriter, r *http.Request) {
	d := s.deviceFor(r)
	if d == nil {
		fail(w, 401, "not set up")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil || !json.Valid(raw) {
		fail(w, 400, "bad report")
		return
	}
	s.mu.Lock()
	now := time.Now().UTC()
	d.Report = raw
	d.LastSeen = &now
	err = s.save()
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// ---------- admin handlers ----------

type deviceView struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	CreatedAt   time.Time       `json:"createdAt"`
	Paired      bool            `json:"paired"`
	PairCode    string          `json:"pairCode,omitempty"`
	PairExpires *time.Time      `json:"pairExpires,omitempty"`
	PairedAt    *time.Time      `json:"pairedAt,omitempty"`
	Model       string          `json:"model,omitempty"`
	LastSeen    *time.Time      `json:"lastSeen,omitempty"`
	Report      json.RawMessage `json:"report,omitempty"`
	Bytes       int64           `json:"bytes"`
	Files       int64           `json:"files"`
	BackupRequested bool        `json:"backupRequested"`
	RequestedAt     *time.Time  `json:"requestedAt,omitempty"`
	AppVersion      string      `json:"appVersion,omitempty"`
	Command         string      `json:"command,omitempty"`
	CommandAt       *time.Time  `json:"commandAt,omitempty"`
	Loc             *Location   `json:"loc,omitempty"`
	Caps            string      `json:"caps,omitempty"`
	LastCmd         string      `json:"lastCmd,omitempty"`
	LastCmdAt       *time.Time  `json:"lastCmdAt,omitempty"`
}

func (s *Server) view(d *Device) deviceView {
	v := deviceView{ID: d.ID, Name: d.Name, CreatedAt: d.CreatedAt, Paired: d.TokenHash != "", PairedAt: d.PairedAt, Model: d.Model, LastSeen: d.LastSeen, Report: d.Report, BackupRequested: d.BackupRequested, RequestedAt: d.RequestedAt, AppVersion: d.AppVersion, Command: d.Command, CommandAt: d.CommandAt, Loc: d.Loc, Caps: d.Caps, LastCmd: d.LastCmd, LastCmdAt: d.LastCmdAt}
	if d.PairCode != "" && time.Now().Before(d.PairExpires) {
		v.PairCode = d.PairCode
		t := d.PairExpires
		v.PairExpires = &t
	}
	if u := s.sizes[d.ID]; u != nil {
		v.Bytes, v.Files = u.Bytes, u.Files
	}
	return v
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request) {
	free, total, _ := diskSpace(s.cfg.DataDir)
	s.mu.Lock()
	views := make([]deviceView, 0, len(s.devices))
	for _, d := range s.devices {
		views = append(views, s.view(d))
	}
	s.mu.Unlock()
	writeJSON(w, 200, map[string]any{
		"version": version,
		"disk":    map[string]any{"free": free, "total": total, "minFree": int64(s.cfg.MinFreeGB * (1 << 30))},
		"devices": views,
	})
}

func cleanName(n string) string {
	n = strings.TrimSpace(n)
	if len(n) > 60 {
		n = n[:60]
	}
	return n
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body, 4096); err != nil || cleanName(body.Name) == "" {
		fail(w, 400, "Give the phone a name.")
		return
	}
	d := &Device{
		ID:          randomToken(8),
		Name:        cleanName(body.Name),
		CreatedAt:   time.Now().UTC(),
		PairCode:    randomCode(),
		PairExpires: time.Now().Add(7 * 24 * time.Hour).UTC(),
	}
	s.mu.Lock()
	s.devices = append(s.devices, d)
	s.sizes[d.ID] = &usage{}
	err := s.save()
	v := s.view(d)
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	s.logger.Printf("added device %s (%s)", d.ID, d.Name)
	writeJSON(w, 200, v)
}

// handleNewCode gives a phone a fresh setup code — for a replacement phone,
// or one whose app was reinstalled. The old phone stops being able to upload.
func (s *Server) handleNewCode(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.findDevice(r.PathValue("id"))
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	d.PairCode = randomCode()
	d.PairExpires = time.Now().Add(7 * 24 * time.Hour).UTC()
	d.TokenHash = ""
	if err := s.save(); err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	writeJSON(w, 200, s.view(d))
}

// handleRequestBackup flags a phone to run a backup the next time it checks in.
func (s *Server) handleRequestBackup(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.findDevice(r.PathValue("id"))
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	if d.TokenHash == "" {
		fail(w, 409, "This phone hasn't been set up yet, so it can't be asked to back up.")
		return
	}
	now := time.Now().UTC()
	d.BackupRequested = true
	d.RequestedAt = &now
	if err := s.save(); err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	writeJSON(w, 200, s.view(d))
}

func (s *Server) handleRename(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body, 4096); err != nil || cleanName(body.Name) == "" {
		fail(w, 400, "Give the phone a name.")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	d := s.findDevice(r.PathValue("id"))
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	d.Name = cleanName(body.Name)
	if err := s.save(); err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	writeJSON(w, 200, s.view(d))
}

// handleDelete removes a phone. Its backed-up files stay unless ?files=1.
func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	idx := -1
	for i, d := range s.devices {
		if d.ID == id {
			idx = i
		}
	}
	if idx < 0 {
		s.mu.Unlock()
		fail(w, 404, "no such phone")
		return
	}
	removed := s.devices[idx]
	s.devices = append(s.devices[:idx], s.devices[idx+1:]...)
	err := s.save()
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, "couldn't save")
		return
	}
	dir := s.deviceDir(id)
	if r.URL.Query().Get("files") == "1" {
		os.RemoveAll(dir)
	} else if _, err := os.Stat(dir); err == nil {
		// Keep the files, under a name that says whose they were.
		os.Rename(dir, filepath.Join(s.cfg.DataDir, "devices", "removed-"+id+"-"+cleanSegment(removed.Name)))
	}
	s.logger.Printf("removed device %s (%s) files=%s", id, removed.Name, r.URL.Query().Get("files"))
	writeJSON(w, 200, map[string]bool{"ok": true})
}

type entry struct {
	Name  string    `json:"name"`
	Path  string    `json:"path"`
	Dir   bool      `json:"dir"`
	Size  int64     `json:"size"`
	Mtime time.Time `json:"mtime"`
	Count int       `json:"count,omitempty"`
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	s.mu.Lock()
	d := s.findDevice(id)
	s.mu.Unlock()
	if d == nil {
		fail(w, 404, "no such phone")
		return
	}
	dirParam := r.URL.Query().Get("dir")
	base := s.deviceDir(id)
	var rel string
	if strings.Trim(dirParam, "/") == "" {
		rel = "."
	} else {
		rel = cleanPath(dirParam, false)
		if rel == "" {
			fail(w, 400, "bad folder")
			return
		}
	}
	full := filepath.Join(base, filepath.FromSlash(rel))
	items, err := os.ReadDir(full)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, 200, map[string]any{"dir": rel, "entries": []entry{}})
		return
	}
	if err != nil {
		fail(w, 500, "couldn't read folder")
		return
	}
	out := []entry{}
	for _, it := range items {
		if strings.HasSuffix(it.Name(), ".part") {
			continue
		}
		info, err := it.Info()
		if err != nil {
			continue
		}
		p := it.Name()
		if rel != "." {
			p = rel + "/" + it.Name()
		}
		e := entry{Name: it.Name(), Path: p, Dir: it.IsDir(), Size: info.Size(), Mtime: info.ModTime().UTC()}
		if it.IsDir() {
			e.Size = 0
			if sub, err := os.ReadDir(filepath.Join(full, it.Name())); err == nil {
				e.Count = len(sub)
			}
		}
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Dir != out[j].Dir {
			return out[i].Dir
		}
		if out[i].Dir {
			return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
		}
		return out[i].Mtime.After(out[j].Mtime) // newest files first
	})
	writeJSON(w, 200, map[string]any{"dir": rel, "entries": out})
}

// ---------- signed downloads ----------

// downloadSig must match lib/phone-backup.ts in Rent Roll.
func downloadSig(secret, device, path, exp string) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("dl\n" + device + "\n" + path + "\n" + exp))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	// Let Rent Roll's pages read the pixels of a photo (crossorigin images) so
	// the browser can check it for sensitive content before showing it. The
	// link itself is the permission (signed, 10 minutes), and no cookies are
	// involved, so any origin is fine.
	w.Header().Set("Access-Control-Allow-Origin", "*")
	q := r.URL.Query()
	dev, p, exp, sig := q.Get("d"), q.Get("p"), q.Get("e"), q.Get("s")
	expAt, err := strconv.ParseInt(exp, 10, 64)
	want := downloadSig(s.cfg.Secret, dev, p, exp)
	if err != nil || !hmac.Equal([]byte(want), []byte(sig)) {
		http.Error(w, "This link isn't valid.", 403)
		return
	}
	if time.Now().Unix() > expAt {
		http.Error(w, "This link has expired. Open the file again from Rent Roll.", 410)
		return
	}
	rel := cleanPath(p, true)
	if rel == "" || strings.ContainsAny(dev, `/\.`) {
		http.Error(w, "bad path", 400)
		return
	}
	full := filepath.Join(s.deviceDir(dev), filepath.FromSlash(rel))
	f, err := os.Open(full)
	if err != nil {
		http.Error(w, "That file isn't on the server anymore.", 404)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.Error(w, "not a file", 404)
		return
	}
	disp := "inline"
	if q.Get("a") == "1" {
		disp = "attachment"
	}
	name := filepath.Base(full)
	w.Header().Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disp, urlEscape(name)))
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	// Files from phones are shown, never run as pages on this domain.
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'")
	http.ServeContent(w, r, name, info.ModTime(), f)
}

func urlEscape(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || strings.IndexByte("-._~", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

// ---------- logging ----------

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(c int) { w.status = c; w.ResponseWriter.WriteHeader(c) }

func logRequests(l *log.Logger, h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: 200}
		h.ServeHTTP(sw, r)
		// Upload paths are noisy and private; log only problems and admin calls.
		if sw.status >= 400 || strings.HasPrefix(r.URL.Path, "/api/admin") || r.URL.Path == "/api/pair" {
			l.Printf("%s %s %d %s %s", r.Method, r.URL.Path, sw.status, time.Since(start).Round(time.Millisecond), clientIP(r))
		}
	})
}

func clientIP(r *http.Request) string {
	if i := strings.LastIndex(r.RemoteAddr, ":"); i > 0 {
		return r.RemoteAddr[:i]
	}
	return r.RemoteAddr
}

type rotatingLog struct {
	mu   sync.Mutex
	path string
	f    *os.File
}

func newRotatingLog(path string) *rotatingLog {
	f, _ := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	return &rotatingLog{path: path, f: f}
}

func (l *rotatingLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	os.Stdout.Write(p)
	if l.f == nil {
		return len(p), nil
	}
	if info, err := l.f.Stat(); err == nil && info.Size() > 10<<20 {
		l.f.Close()
		os.Remove(l.path + ".old")
		os.Rename(l.path, l.path+".old")
		l.f, _ = os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
		if l.f == nil {
			return len(p), nil
		}
	}
	return l.f.Write(p)
}

