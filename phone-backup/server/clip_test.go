package main

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// With CLIP_REF=<dir holding pytorch_model.bin, ref.json and img.f32 from
// the official model>, checks the Go CLIP against it.
func TestCLIPMatchesReference(t *testing.T) {
	dir := os.Getenv("CLIP_REF")
	if dir == "" {
		t.Skip("set CLIP_REF to compare against the official CLIP")
	}
	start := time.Now()
	m, err := loadCLIP(filepath.Join(dir, "pytorch_model.bin"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("loaded in %v", time.Since(start))
	var ref struct {
		Image []float32 `json:"image"`
		Texts map[string]struct {
			IDs []int     `json:"ids"`
			Emb []float32 `json:"emb"`
		} `json:"texts"`
	}
	b, _ := os.ReadFile(filepath.Join(dir, "ref.json"))
	if err := json.Unmarshal(b, &ref); err != nil {
		t.Fatal(err)
	}
	cos := func(a, b []float32) float64 {
		var d, na, nb float64
		for i := range a {
			d += float64(a[i]) * float64(b[i])
			na += float64(a[i]) * float64(a[i])
			nb += float64(b[i]) * float64(b[i])
		}
		return d / math.Sqrt(na*nb)
	}
	for text, want := range ref.Texts {
		ids := m.tok.encode(text)
		if len(ids) != len(want.IDs) {
			t.Errorf("%q: tokens %v, want %v", text, ids, want.IDs)
			continue
		}
		for i := range ids {
			if ids[i] != want.IDs[i] {
				t.Errorf("%q: tokens %v, want %v", text, ids, want.IDs)
				break
			}
		}
		ts := time.Now()
		got := m.embedTokens(want.IDs)
		if c := cos(got, want.Emb); c < 0.9999 {
			t.Errorf("%q: cosine with reference %.6f", text, c)
		} else {
			t.Logf("%q: cosine %.7f (%v)", text, c, time.Since(ts))
		}
	}
	raw, err := os.ReadFile(filepath.Join(dir, "img.f32"))
	if err != nil {
		t.Fatal(err)
	}
	px := make([]float32, len(raw)/4)
	for i := range px {
		px[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[i*4:]))
	}
	ts := time.Now()
	got := m.embedPixels(px)
	if c := cos(got, ref.Image); c < 0.9999 {
		t.Errorf("image: cosine with reference %.6f", c)
	} else {
		t.Logf("image: cosine %.7f (%v)", c, time.Since(ts))
	}
}
