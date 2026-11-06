package main

import (
	"encoding/binary"
	"encoding/json"
	"image"
	_ "image/jpeg"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNSFWModelLoads(t *testing.T) {
	m, err := nsfwModel()
	if err != nil {
		t.Fatal(err)
	}
	// A flat grey square: any valid run gives five probabilities summing to 1.
	in := newTensor(nsfwInput, nsfwInput, 3)
	for i := range in.d {
		in.d[i] = 0.5
	}
	start := time.Now()
	p, err := m.predict(in)
	if err != nil {
		t.Fatal(err)
	}
	var sum float32
	for _, v := range p {
		if v < 0 || v > 1 || math.IsNaN(float64(v)) {
			t.Fatalf("bad probability %v", p)
		}
		sum += v
	}
	if math.Abs(float64(sum)-1) > 1e-4 {
		t.Fatalf("probabilities sum to %v", sum)
	}
	t.Logf("one photo: %v, %v", time.Since(start), p)
}

func TestNSFWVerdictRule(t *testing.T) {
	cases := []struct {
		p    [5]float32
		want bool
	}{
		{[5]float32{0, 0, 0.1, 0.85, 0.05}, true},     // confident porn
		{[5]float32{0, 0.81, 0.19, 0, 0}, true},       // confident hentai
		{[5]float32{0, 0.45, 0.05, 0.46, 0.04}, true}, // together over 0.9
		{[5]float32{0, 0.1, 0.1, 0.1, 0.7}, false},    // "sexy" alone never flags
		{[5]float32{0, 0, 0.3, 0.7, 0}, false},
	}
	for _, c := range cases {
		if got := nsfwVerdict(c.p); got != c.want {
			t.Errorf("%v: got %v", c.p, got)
		}
	}
}

// With NSFW_DUMP=<dir of .jpg>, writes each photo's model input and
// probabilities next to it, for comparing against the JavaScript model.
func TestNSFWDump(t *testing.T) {
	dir := os.Getenv("NSFW_DUMP")
	if dir == "" {
		t.Skip("set NSFW_DUMP to compare against NSFWJS")
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.jpg"))
	m, err := nsfwModel()
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][5]float32{}
	for _, f := range files {
		fh, _ := os.Open(f)
		img, _, err := image.Decode(fh)
		fh.Close()
		if err != nil {
			t.Fatal(f, err)
		}
		in := nsfwInputFrom(img)
		buf := make([]byte, len(in.d)*4)
		for i, v := range in.d {
			binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(v))
		}
		os.WriteFile(f+".in", buf, 0o644)
		p, err := m.predict(in)
		if err != nil {
			t.Fatal(err)
		}
		out[filepath.Base(f)] = p
	}
	b, _ := json.Marshal(out)
	os.WriteFile(filepath.Join(dir, "go.json"), b, 0o644)
}

func TestSmallModelLoads(t *testing.T) {
	m, err := smallModel()
	if err != nil {
		t.Fatal(err)
	}
	in := newTensor(nsfwInput, nsfwInput, 3)
	for i := range in.d {
		in.d[i] = 0.5
	}
	start := time.Now()
	p, err := m.predict(in)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("small model, one photo: %v, %v", time.Since(start), p)
}
