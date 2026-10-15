package main

// Small previews for the galleries. A phone photo is ~3 MB / 12 MP; the grid
// only needs a few hundred pixels, so /thumb serves a ~30 KB JPEG made once
// and kept on disk (data\thumbs\<device>\<hash>.jpg). The link is signed the
// same way as /dl.

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"image"
	"image/gif"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jdeng/goheif"
	"github.com/jdeng/goheif/heif"
	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

const thumbSize = 360    // grid tiles: longest side, px
const previewSize = 1600 // full-screen view of photos browsers can't open (HEIC)

// At most a few big decodes at once so the VPS stays responsive.
var thumbSlots = make(chan struct{}, 3)

func (s *Server) handleThumb(w http.ResponseWriter, r *http.Request) {
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
		http.Error(w, "This link has expired.", 410)
		return
	}
	rel := cleanPath(p, true)
	if rel == "" || strings.ContainsAny(dev, `/\.`) {
		http.Error(w, "bad path", 400)
		return
	}
	full := filepath.Join(s.deviceDir(dev), filepath.FromSlash(rel))
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		http.Error(w, "That file isn't on the server anymore.", 404)
		return
	}

	size := thumbSize
	if q.Get("w") == "1600" {
		size = previewSize
	}
	h := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d|%d", rel, info.Size(), info.ModTime().UnixNano(), size)))
	cache := filepath.Join(s.cfg.DataDir, "thumbs", dev, hex.EncodeToString(h[:12])+".jpg")

	if _, err := os.Stat(cache); err != nil {
		thumbSlots <- struct{}{}
		err = makeThumb(full, cache, size)
		<-thumbSlots
		if err != nil {
			// Can't decode (HEIC, odd format): send the original instead.
			http.Redirect(w, r, "/dl?"+r.URL.RawQuery, http.StatusFound)
			return
		}
	}
	f, err := os.Open(cache)
	if err != nil {
		http.Error(w, "thumbnail unavailable", 500)
		return
	}
	defer f.Close()
	st, _ := f.Stat()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	http.ServeContent(w, r, "thumb.jpg", st.ModTime(), f)
}

func makeThumb(src, dst string, size int) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()
	head := make([]byte, 128<<10)
	n, _ := io.ReadFull(f, head)
	head = head[:n]
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	img, format, err := image.Decode(f)
	if err != nil {
		return err
	}
	orient := 1
	switch format {
	case "jpeg":
		orient = exifOrientation(head)
	case "heic":
		orient = heicOrientation(f)
	}

	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w == 0 || h == 0 {
		return fmt.Errorf("empty image")
	}
	scale := float64(size) / float64(max(w, h))
	if scale > 1 {
		scale = 1
	}
	tw, th := max(1, int(float64(w)*scale)), max(1, int(float64(h)*scale))
	small := image.NewRGBA(image.Rect(0, 0, tw, th))
	draw.ApproxBiLinear.Scale(small, small.Bounds(), img, b, draw.Src, nil)
	out := orientImage(small, orient)

	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 78}); err != nil {
		return err
	}
	tmp := dst + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

// heicOrientation: HEIC stores rotation as an "irot" box (counter-clockwise
// quarter turns), which the decoder doesn't apply; some phones use an EXIF
// orientation instead. Returned as an EXIF-style value for orientImage.
func heicOrientation(ra io.ReaderAt) int {
	hf := heif.Open(ra)
	if it, err := hf.PrimaryItem(); err == nil {
		switch it.Rotations() % 4 {
		case 1:
			return 8
		case 2:
			return 3
		case 3:
			return 6
		}
	}
	if ex, err := hf.EXIF(); err == nil {
		for _, sig := range []string{"II*\x00", "MM\x00*"} {
			if i := bytes.Index(ex, []byte(sig)); i >= 0 {
				return tiffOrientation(ex[i:])
			}
		}
	}
	return 1
}

var _ = goheif.Decode // registers the "heic" image format

// Keep the decoders registered even if nothing else references them.
var _ = gif.Decode
var _ = png.Decode

// exifOrientation reads the EXIF orientation tag (1–8) from the start of a
// JPEG, or 1 if there isn't one. Phones store most photos sideways + a tag.
func exifOrientation(b []byte) int {
	if len(b) < 4 || b[0] != 0xFF || b[1] != 0xD8 {
		return 1
	}
	i := 2
	for i+4 <= len(b) {
		if b[i] != 0xFF {
			return 1
		}
		marker := b[i+1]
		size := int(binary.BigEndian.Uint16(b[i+2:]))
		if marker == 0xDA || size < 2 {
			return 1
		}
		seg := i + 4
		end := i + 2 + size
		if end > len(b) {
			return 1
		}
		if marker == 0xE1 && end-seg > 14 && string(b[seg:seg+6]) == "Exif\x00\x00" {
			return tiffOrientation(b[seg+6 : end])
		}
		i = end
	}
	return 1
}

func tiffOrientation(t []byte) int {
	if len(t) < 8 {
		return 1
	}
	var bo binary.ByteOrder
	switch string(t[:2]) {
	case "II":
		bo = binary.LittleEndian
	case "MM":
		bo = binary.BigEndian
	default:
		return 1
	}
	off := int(bo.Uint32(t[4:]))
	if off+2 > len(t) {
		return 1
	}
	count := int(bo.Uint16(t[off:]))
	for k := 0; k < count; k++ {
		e := off + 2 + k*12
		if e+12 > len(t) {
			return 1
		}
		if bo.Uint16(t[e:]) == 0x0112 {
			v := int(bo.Uint16(t[e+8:]))
			if v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}

// orientImage applies an EXIF orientation so the thumbnail is upright.
func orientImage(src *image.RGBA, o int) image.Image {
	if o <= 1 || o > 8 {
		return src
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	swap := o >= 5
	dw, dh := w, h
	if swap {
		dw, dh = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var nx, ny int
			switch o {
			case 2:
				nx, ny = w-1-x, y
			case 3:
				nx, ny = w-1-x, h-1-y
			case 4:
				nx, ny = x, h-1-y
			case 5:
				nx, ny = y, x
			case 6:
				nx, ny = h-1-y, x
			case 7:
				nx, ny = h-1-y, w-1-x
			case 8:
				nx, ny = y, w-1-x
			}
			dst.SetRGBA(nx, ny, src.RGBAAt(x, y))
		}
	}
	return dst
}
