package main

// Changing the server's secret (the viewer password and the key Rent Roll
// uses) without anyone at the server: POST /api/admin/secret
// {"secret": "<new, at least 32 characters>"}, authorised with the current
// one. It's written into config.json (keeping every other setting) and the
// server restarts through its scheduled task, as after a self-update, to
// pick it up. Every viewer session and every signed download link made with
// the old secret stops working, which is the point.

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

func (s *Server) handleChangeSecret(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		fail(w, 400, "bad request")
		return
	}
	body.Secret = strings.TrimSpace(body.Secret)
	if len(body.Secret) < 32 || body.Secret == s.cfg.Secret {
		fail(w, 400, "the new secret must be at least 32 characters and different from the current one")
		return
	}
	if s.cfgPath == "" {
		fail(w, 500, "config path unknown")
		return
	}
	raw, err := os.ReadFile(s.cfgPath)
	if err != nil {
		fail(w, 500, "couldn't read config")
		return
	}
	var cfg map[string]any // keep every setting, including ones this build doesn't know
	if err := json.Unmarshal(raw, &cfg); err != nil {
		fail(w, 500, "couldn't parse config")
		return
	}
	cfg["secret"] = body.Secret
	out, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		fail(w, 500, "couldn't write config")
		return
	}
	tmp := s.cfgPath + ".tmp"
	if err := os.WriteFile(tmp, out, 0o600); err != nil {
		fail(w, 500, "couldn't write config")
		return
	}
	os.Rename(s.cfgPath, s.cfgPath+".bak")
	if err := os.Rename(tmp, s.cfgPath); err != nil {
		os.Rename(s.cfgPath+".bak", s.cfgPath)
		fail(w, 500, "couldn't write config")
		return
	}
	os.Remove(s.cfgPath + ".bak") // it held the old secret
	s.logger.Printf("secret changed; restarting to use it")
	writeJSON(w, 200, map[string]any{"ok": true, "restarting": true})
	go func() {
		time.Sleep(1 * time.Second)
		if runtime.GOOS == "windows" {
			cmd := exec.Command("cmd", "/c", "ping -n 5 127.0.0.1 >nul & schtasks /run /tn \""+updateTaskName+"\"")
			if err := cmd.Start(); err != nil {
				s.logger.Printf("secret change: couldn't schedule restart: %v", err)
			}
		}
		os.Exit(0)
	}()
}
