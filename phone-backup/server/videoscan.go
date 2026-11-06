package main

// Sensitive-content check for videos: every 0.1 s of a video goes through
// the same detector as photos (nsfw.go), and the video is flagged as soon as
// one frame would have been. The scanner (scan.go) runs it in the
// background, after the photos in each pass.
//
// ffmpeg decodes the video and hands back each frame already cropped to its
// centre square and scaled to the model's 224×224, the way photos are
// prepared. On Windows the server fetches one pinned ffmpeg build the first
// time it's needed, checks its SHA-256 and keeps it under <data>/tools; on
// other systems it uses the ffmpeg on the PATH.

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	videoFPS = 10 // frames checked per second of video

	ffmpegZipURL  = "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip"
	ffmpegZipSHA  = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"
	ffmpegZipPath = "ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe"
)

var (
	ffmpegMu    sync.Mutex
	ffmpegFound string
	ffmpegErr   error
	ffmpegTried time.Time
)

// ffmpegPath finds or fetches ffmpeg. A failure is remembered for an hour,
// so a server without internet doesn't retry the download on every pass.
func (s *Server) ffmpegPath() (string, error) {
	ffmpegMu.Lock()
	defer ffmpegMu.Unlock()
	if ffmpegFound != "" {
		return ffmpegFound, nil
	}
	if ffmpegErr != nil && time.Since(ffmpegTried) < time.Hour {
		return "", ffmpegErr
	}
	ffmpegTried = time.Now()
	if runtime.GOOS != "windows" {
		ffmpegFound, ffmpegErr = exec.LookPath("ffmpeg")
		return ffmpegFound, ffmpegErr
	}
	exe := filepath.Join(s.cfg.DataDir, "tools", "ffmpeg-9.0.2.exe")
	if _, err := os.Stat(exe); err == nil {
		ffmpegFound, ffmpegErr = exe, nil
		return exe, nil
	}
	s.logger.Printf("video check: downloading ffmpeg")
	if err := fetchFFmpeg(exe); err != nil {
		ffmpegErr = fmt.Errorf("couldn't get ffmpeg: %w", err)
		s.logger.Printf("video check: %v", ffmpegErr)
		return "", ffmpegErr
	}
	s.logger.Printf("video check: ffmpeg ready")
	ffmpegFound, ffmpegErr = exe, nil
	return exe, nil
}

func fetchFFmpeg(dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	zipPath := dst + ".zip.part"
	defer os.Remove(zipPath)
	resp, err := (&http.Client{Timeout: 30 * time.Minute}).Get(ffmpegZipURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download: %s", resp.Status)
	}
	f, err := os.Create(zipPath)
	if err != nil {
		return err
	}
	h := sha256.New()
	_, err = io.Copy(io.MultiWriter(f, h), resp.Body)
	f.Close()
	if err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != ffmpegZipSHA {
		return fmt.Errorf("download didn't match the expected checksum (%s)", got)
	}
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer zr.Close()
	for _, zf := range zr.File {
		if zf.Name != ffmpegZipPath {
			continue
		}
		rc, err := zf.Open()
		if err != nil {
			return err
		}
		defer rc.Close()
		tmp := dst + ".part"
		out, err := os.Create(tmp)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, rc)
		out.Close()
		if err != nil {
			os.Remove(tmp)
			return err
		}
		return os.Rename(tmp, dst)
	}
	return errors.New("ffmpeg.exe not found in the download")
}

// checkVideo reports whether any 0.1 s frame of a video is flagged, the
// scores of its most explicit-looking frame, and how many frames it read.
func (s *Server) checkVideo(id, rel string) (bool, [5]float32, int, error) {
	var worst [5]float32
	ff, err := s.ffmpegPath()
	if err != nil {
		return false, worst, 0, err
	}
	full := filepath.Join(s.deviceDir(id), filepath.FromSlash(rel))
	cmd := exec.Command(ff, "-v", "error", "-nostdin", "-i", full,
		"-an", "-sn", "-dn",
		"-vf", fmt.Sprintf(`fps=%d,crop=min(iw\,ih):min(iw\,ih),scale=%d:%d:flags=bilinear`, videoFPS, nsfwInput, nsfwInput),
		"-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1")
	hideWindow(cmd)
	out, err := cmd.StdoutPipe()
	if err != nil {
		return false, worst, 0, err
	}
	if err := cmd.Start(); err != nil {
		return false, worst, 0, err
	}
	frame := make([]byte, nsfwInput*nsfwInput*3)
	in := newTensor(nsfwInput, nsfwInput, 3)
	frames := 0
	flagged := false
	for {
		if _, err := io.ReadFull(out, frame); err != nil {
			break // end of video (or ffmpeg gave up; Wait says which)
		}
		frames++
		for i, b := range frame {
			in.d[i] = float32(b) / 255
		}
		p, err := classifyInput(in) // small model first, large only if it flags
		if err != nil {
			cmd.Process.Kill()
			cmd.Wait()
			return false, worst, frames, err
		}
		if p[1]+p[3] >= worst[1]+worst[3] {
			worst = p
		}
		if nsfwVerdict(p) {
			flagged = true
			cmd.Process.Kill() // no need to look further
			break
		}
	}
	werr := cmd.Wait()
	if flagged {
		return true, worst, frames, nil
	}
	if frames == 0 {
		if werr == nil {
			werr = errors.New("no frames")
		}
		return false, worst, 0, fmt.Errorf("couldn't read the video: %w", werr)
	}
	return false, worst, frames, nil
}

// makeVideoThumb saves a frame from a video as its gallery thumbnail, the
// longest side `size` px like a photo's: one second in, past a fade from
// black, or the first frame of a clip shorter than that. ffmpeg turns it
// the right way up.
func (s *Server) makeVideoThumb(src, dst string, size int) error {
	ff, err := s.ffmpegPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".tmp.jpg"
	defer os.Remove(tmp)
	scale := fmt.Sprintf(`scale=if(gt(iw\,ih)\,%d\,-2):if(gt(iw\,ih)\,-2\,%d)`, size, size)
	// Quickest first: the keyframe nearest one second in (phones put one
	// about every second), so only that frame is decoded; then the first
	// keyframe; then an exact decode, for files the fast ways can't read.
	tries := [][]string{
		{"-skip_frame", "nokey", "-noaccurate_seek", "-ss", "1"},
		{"-skip_frame", "nokey"},
		{"-ss", "0"},
	}
	for _, seek := range tries {
		args := append([]string{"-v", "error", "-nostdin"}, seek...)
		args = append(args, "-i", src, "-frames:v", "1", "-vf", scale, "-q:v", "4", "-y", tmp)
		cmd := exec.Command(ff, args...)
		hideWindow(cmd)
		if cmd.Run() == nil {
			if st, err := os.Stat(tmp); err == nil && st.Size() > 0 {
				return os.Rename(tmp, dst)
			}
		}
	}
	return errors.New("couldn't take a frame from the video")
}

// pregenVideoThumbs makes the gallery thumbnail of every video that hasn't
// one yet, one at a time, so scrolling past videos shows a ready image
// instead of waiting for ffmpeg. Called at the start of each scanner pass.
func (s *Server) pregenVideoThumbs(id string) {
	if _, err := s.ffmpegPath(); err != nil {
		return
	}
	base := s.deviceDir(id)
	made := 0
	start := time.Now()
	filepath.WalkDir(filepath.Join(base, "Photos"), func(p string, e fs.DirEntry, err error) error {
		if err != nil || e.IsDir() || !scanVideo.MatchString(e.Name()) || strings.HasSuffix(e.Name(), ".part") {
			return nil
		}
		rel, err := filepath.Rel(base, p)
		if err != nil {
			return nil
		}
		info, err := e.Info()
		if err != nil {
			return nil
		}
		dst := s.thumbPath(id, filepath.ToSlash(rel), info, thumbSize)
		if _, err := os.Stat(dst); err == nil {
			return nil
		}
		thumbSlots <- struct{}{}
		if s.makeVideoThumb(p, dst, thumbSize) == nil {
			made++
		}
		<-thumbSlots
		return nil
	})
	if made > 0 {
		s.logger.Printf("video thumbnails: %s: made %d in %s", id, made, time.Since(start).Round(time.Second))
	}
}
