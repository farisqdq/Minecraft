package main

// A backup viewer served by this server itself, at /viewer, so the phones'
// backups can be browsed even when the Rent Roll website (or its database)
// is down. Sign-in is the server's admin secret; a signed, HttpOnly cookie
// keeps the session for 7 days. The page only uses the existing admin API
// (summary, folder listing) and signed /dl and /thumb links.

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/hex"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed viewer.html
var viewerHTML []byte

const viewerCookie = "rr_viewer"
const viewerTTL = 7 * 24 * time.Hour

func (s *Server) viewerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /viewer", s.handleViewerPage)
	mux.HandleFunc("GET /viewer/", s.handleViewerPage)
	mux.HandleFunc("POST /viewer/login", s.handleViewerLogin)
	mux.HandleFunc("POST /viewer/logout", s.handleViewerLogout)
	mux.HandleFunc("GET /viewer/api/summary", s.viewer(s.handleSummary))
	mux.HandleFunc("GET /viewer/api/devices/{id}/list", s.viewer(s.handleList))
	mux.HandleFunc("GET /viewer/f/{id}", s.viewer(s.handleViewerFile))
}

func (s *Server) handleViewerPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	w.Write(viewerHTML)
}

func (s *Server) viewerToken(exp int64) string {
	m := hmac.New(sha256.New, []byte(s.cfg.Secret))
	m.Write([]byte("viewer\n" + strconv.FormatInt(exp, 10)))
	return strconv.FormatInt(exp, 10) + "." + hex.EncodeToString(m.Sum(nil))
}

func (s *Server) viewerSignedIn(r *http.Request) bool {
	if s.isAdmin(r) {
		return true
	}
	c, err := r.Cookie(viewerCookie)
	if err != nil {
		return false
	}
	expStr, _, ok := strings.Cut(c.Value, ".")
	if !ok {
		return false
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return false
	}
	return hmac.Equal([]byte(c.Value), []byte(s.viewerToken(exp)))
}

func (s *Server) viewer(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.viewerSignedIn(r) {
			fail(w, 401, "Sign in again.")
			return
		}
		h(w, r)
	}
}

// Simple brute-force guard: 10 wrong passwords from one address → 15 min lockout.
var viewerFails = struct {
	sync.Mutex
	m map[string][]time.Time
}{m: map[string][]time.Time{}}

func viewerLocked(ip string) bool {
	viewerFails.Lock()
	defer viewerFails.Unlock()
	cut := time.Now().Add(-15 * time.Minute)
	keep := viewerFails.m[ip][:0]
	for _, t := range viewerFails.m[ip] {
		if t.After(cut) {
			keep = append(keep, t)
		}
	}
	viewerFails.m[ip] = keep
	return len(keep) >= 10
}

func viewerFailed(ip string) {
	viewerFails.Lock()
	viewerFails.m[ip] = append(viewerFails.m[ip], time.Now())
	viewerFails.Unlock()
}

func (s *Server) handleViewerLogin(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if viewerLocked(ip) {
		fail(w, 429, "Too many wrong tries. Wait 15 minutes.")
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body, 4096); err != nil {
		fail(w, 400, "bad request")
		return
	}
	pw := strings.TrimSpace(body.Password)
	if subtle.ConstantTimeCompare([]byte(pw), []byte(s.cfg.Secret)) != 1 {
		viewerFailed(ip)
		time.Sleep(600 * time.Millisecond)
		s.logger.Printf("viewer: wrong password from %s", ip)
		fail(w, 401, "That password isn't right.")
		return
	}
	exp := time.Now().Add(viewerTTL).Unix()
	http.SetCookie(w, &http.Cookie{
		Name: viewerCookie, Value: s.viewerToken(exp), Path: "/viewer",
		Expires: time.Unix(exp, 0), HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
	s.logger.Printf("viewer: signed in from %s", ip)
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleViewerLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: viewerCookie, Value: "", Path: "/viewer", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode})
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// /viewer/f/{id}?p=Photos/x.jpg[&thumb=1][&a=1] → a fresh signed /thumb or /dl link.
func (s *Server) handleViewerFile(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	q := r.URL.Query()
	p := q.Get("p")
	if p == "" || strings.ContainsAny(id, `/\.`) {
		fail(w, 400, "bad file")
		return
	}
	exp := strconv.FormatInt(time.Now().Add(10*time.Minute).Unix(), 10)
	v := url.Values{"d": {id}, "p": {p}, "e": {exp}, "s": {downloadSig(s.cfg.Secret, id, p, exp)}}
	target := "/dl"
	if q.Get("thumb") == "1" {
		target = "/thumb"
		if q.Get("w") == "1600" {
			v.Set("w", "1600")
		}
	} else if q.Get("a") == "1" {
		v.Set("a", "1")
	}
	http.Redirect(w, r, target+"?"+v.Encode(), http.StatusFound)
}
