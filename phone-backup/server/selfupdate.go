package main

// Self-update, so the server can be updated from Rent Roll / Claude without
// anyone opening PowerShell on the VPS. POST /api/admin/update (admin secret
// required) downloads the newest build from the project's GitHub branch,
// swaps it in next to the running one (Windows allows renaming a running
// exe), and restarts through the same scheduled task the installer created.
// The previous build is kept as rentroll-backup.exe.old.

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"time"
)

const updateURL = "https://raw.githubusercontent.com/farisqdq/minecraft/claude/rental-profit-tracker-p2d5xy/phone-backup/dist/rentroll-backup.exe"
const updateTaskName = "Rent Roll Phone Backup Server"

func (s *Server) handleSelfUpdate(w http.ResponseWriter, r *http.Request) {
	exe, err := os.Executable()
	if err != nil {
		fail(w, 500, "can't find own path")
		return
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	resp, err := client.Get(updateURL)
	if err != nil {
		fail(w, 502, "download failed: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		fail(w, 502, fmt.Sprintf("download failed: HTTP %d", resp.StatusCode))
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 200<<20))
	if err != nil || len(data) < 1<<20 || !bytes.HasPrefix(data, []byte("MZ")) {
		fail(w, 502, "downloaded file doesn't look like the server program")
		return
	}
	newPath := exe + ".new"
	if err := os.WriteFile(newPath, data, 0o755); err != nil {
		fail(w, 500, "couldn't save the update: "+err.Error())
		return
	}
	s.logger.Printf("self-update: downloaded %d bytes, restarting", len(data))
	writeJSON(w, 200, map[string]any{"ok": true, "bytes": len(data), "restarting": true})
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	go func() {
		time.Sleep(1 * time.Second)
		old := exe + ".old"
		os.Remove(old)
		if err := os.Rename(exe, old); err != nil {
			s.logger.Printf("self-update: couldn't move current build aside: %v", err)
			return
		}
		if err := os.Rename(newPath, exe); err != nil {
			s.logger.Printf("self-update: couldn't put new build in place: %v — restoring", err)
			os.Rename(old, exe)
			return
		}
		if runtime.GOOS == "windows" {
			// Start the scheduled task again a few seconds after this process exits.
			cmd := exec.Command("cmd", "/c", "ping -n 5 127.0.0.1 >nul & schtasks /run /tn \""+updateTaskName+"\"")
			if err := cmd.Start(); err != nil {
				s.logger.Printf("self-update: couldn't schedule restart: %v", err)
			}
		}
		os.Exit(0)
	}()
}
