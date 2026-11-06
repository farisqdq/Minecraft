package main

// CLIP (OpenAI's ViT-B/32, MIT licensed) in pure Go, for searching photos by
// what's in them: each photo becomes a 512-number "meaning" vector once
// (photosearch.go), a search's words become one too, and the photos whose
// vectors point the same way come first. "beach" finds beaches, "dog in
// the snow" finds that, without anyone having labelled anything.
//
// The weights are the official checkpoint, fetched once and checked
// against a pinned SHA-256 (the same way as ffmpeg), and read with
// ptload.go. The tokenizer's vocabulary is embedded.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"image"
	"math"
	"regexp"
	"strings"
	"sync"
	"unicode/utf8"
)

//go:embed clipmodel/vocab.json
var clipVocabJSON []byte

//go:embed clipmodel/merges.txt
var clipMergesTxt string

const (
	clipModelURL = "https://huggingface.co/openai/clip-vit-base-patch32/resolve/3d74acf9a28c67741b2f4f2ea7635f0aaf6f0268/pytorch_model.bin"
	clipModelSHA = "a63082132ba4f97a80bea76823f544493bffa8082296d62d71581a4feff1576f"
	clipDim      = 512
	clipImage    = 224
	clipPatch    = 32
	clipMaxText  = 77
)

type clipLinear struct {
	w, b    []float32 // w is [out][in], as PyTorch stores it
	in, out int
}

type clipLayer struct {
	ln1w, ln1b, ln2w, ln2b []float32
	q, k, v, o             clipLinear
	fc1, fc2               clipLinear
}

type clipTower struct {
	layers []clipLayer
	heads  int
	width  int
	causal bool
}

type clipModel struct {
	// vision
	patchW   []float32 // [768][3*32*32]
	classEmb []float32
	visPos   []float32 // [50][768]
	preLnW   []float32
	preLnB   []float32
	vis      clipTower
	postLnW  []float32
	postLnB  []float32
	visProj  clipLinear // 768 -> 512, no bias
	// text
	tokEmb   []float32 // [49408][512]
	txtPos   []float32 // [77][512]
	txt      clipTower
	finalLnW []float32
	finalLnB []float32
	txtProj  clipLinear // 512 -> 512, no bias
	tok      *clipTokenizer
}

var (
	clipOnce sync.Once
	clipM    *clipModel
	clipErr  error
)

// loadCLIP reads the checkpoint at path. Loaded once per process.
func loadCLIP(path string) (*clipModel, error) {
	clipOnce.Do(func() { clipM, clipErr = readCLIP(path) })
	return clipM, clipErr
}

func readCLIP(path string) (*clipModel, error) {
	sd, err := loadPyTorch(path)
	if err != nil {
		return nil, err
	}
	var missing []string
	get := func(name string, size ...int) []float32 {
		t, ok := sd[name]
		if !ok {
			missing = append(missing, name)
			return nil
		}
		n := 1
		for _, d := range size {
			n *= d
		}
		if len(t.data) != n {
			missing = append(missing, fmt.Sprintf("%s (size %d, want %d)", name, len(t.data), n))
			return nil
		}
		return t.data
	}
	lin := func(prefix string, in, out int, bias bool) clipLinear {
		l := clipLinear{w: get(prefix+".weight", out, in), in: in, out: out}
		if bias {
			l.b = get(prefix+".bias", out)
		}
		return l
	}
	tower := func(prefix string, n, width, heads int, causal bool) clipTower {
		t := clipTower{heads: heads, width: width, causal: causal}
		for i := 0; i < n; i++ {
			p := fmt.Sprintf("%s.encoder.layers.%d.", prefix, i)
			t.layers = append(t.layers, clipLayer{
				ln1w: get(p+"layer_norm1.weight", width), ln1b: get(p+"layer_norm1.bias", width),
				ln2w: get(p+"layer_norm2.weight", width), ln2b: get(p+"layer_norm2.bias", width),
				q: lin(p+"self_attn.q_proj", width, width, true), k: lin(p+"self_attn.k_proj", width, width, true),
				v: lin(p+"self_attn.v_proj", width, width, true), o: lin(p+"self_attn.out_proj", width, width, true),
				fc1: lin(p+"mlp.fc1", width, 4*width, true), fc2: lin(p+"mlp.fc2", 4*width, width, true),
			})
		}
		return t
	}
	const vw, tw = 768, 512
	np := clipImage / clipPatch
	m := &clipModel{
		patchW:   get("vision_model.embeddings.patch_embedding.weight", vw, 3, clipPatch, clipPatch),
		classEmb: get("vision_model.embeddings.class_embedding", vw),
		visPos:   get("vision_model.embeddings.position_embedding.weight", np*np+1, vw),
		preLnW:   get("vision_model.pre_layrnorm.weight", vw),
		preLnB:   get("vision_model.pre_layrnorm.bias", vw),
		vis:      tower("vision_model", 12, vw, 12, false),
		postLnW:  get("vision_model.post_layernorm.weight", vw),
		postLnB:  get("vision_model.post_layernorm.bias", vw),
		visProj:  lin("visual_projection", vw, clipDim, false),
		tokEmb:   get("text_model.embeddings.token_embedding.weight", 49408, tw),
		txtPos:   get("text_model.embeddings.position_embedding.weight", clipMaxText, tw),
		txt:      tower("text_model", 12, tw, 8, true),
		finalLnW: get("text_model.final_layer_norm.weight", tw),
		finalLnB: get("text_model.final_layer_norm.bias", tw),
		txtProj:  lin("text_projection", tw, clipDim, false),
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("checkpoint is missing %s", strings.Join(missing[:min(3, len(missing))], ", "))
	}
	if m.tok, err = newCLIPTokenizer(); err != nil {
		return nil, err
	}
	return m, nil
}

// ---------- maths ----------

// apply: y[t] = W x[t] + b for every token row of x.
func (l clipLinear) apply(x []float32, tokens int) []float32 {
	y := make([]float32, tokens*l.out)
	for t := 0; t < tokens; t++ {
		xr := x[t*l.in : (t+1)*l.in]
		yr := y[t*l.out : (t+1)*l.out]
		for o := 0; o < l.out; o++ {
			yr[o] = dot(xr, l.w[o*l.in:(o+1)*l.in])
		}
		if l.b != nil {
			for o := range yr {
				yr[o] += l.b[o]
			}
		}
	}
	return y
}

func dot(a, b []float32) float32 {
	var s0, s1, s2, s3 float32
	n := len(a)
	b = b[:n]
	i := 0
	for ; i+4 <= n; i += 4 {
		s0 += a[i] * b[i]
		s1 += a[i+1] * b[i+1]
		s2 += a[i+2] * b[i+2]
		s3 += a[i+3] * b[i+3]
	}
	for ; i < n; i++ {
		s0 += a[i] * b[i]
	}
	return s0 + s1 + s2 + s3
}

func layerNorm(x []float32, tokens, width int, w, b []float32) []float32 {
	y := make([]float32, len(x))
	for t := 0; t < tokens; t++ {
		r := x[t*width : (t+1)*width]
		var mean float64
		for _, v := range r {
			mean += float64(v)
		}
		mean /= float64(width)
		var vr float64
		for _, v := range r {
			d := float64(v) - mean
			vr += d * d
		}
		inv := 1 / math.Sqrt(vr/float64(width)+1e-5)
		out := y[t*width : (t+1)*width]
		for i, v := range r {
			out[i] = float32((float64(v)-mean)*inv)*w[i] + b[i]
		}
	}
	return y
}

func (t clipTower) run(x []float32, tokens int) []float32 {
	w, hd := t.width, t.width/t.heads
	scale := float32(1 / math.Sqrt(float64(hd)))
	scores := make([]float32, tokens)
	for _, l := range t.layers {
		h := layerNorm(x, tokens, w, l.ln1w, l.ln1b)
		q, k, v := l.q.apply(h, tokens), l.k.apply(h, tokens), l.v.apply(h, tokens)
		att := make([]float32, tokens*w)
		for hh := 0; hh < t.heads; hh++ {
			off := hh * hd
			for i := 0; i < tokens; i++ {
				qi := q[i*w+off : i*w+off+hd]
				last := tokens
				if t.causal {
					last = i + 1
				}
				mx := float32(math.Inf(-1))
				for j := 0; j < last; j++ {
					scores[j] = dot(qi, k[j*w+off:j*w+off+hd]) * scale
					mx = max(mx, scores[j])
				}
				var sum float32
				for j := 0; j < last; j++ {
					scores[j] = float32(math.Exp(float64(scores[j] - mx)))
					sum += scores[j]
				}
				out := att[i*w+off : i*w+off+hd]
				for j := 0; j < last; j++ {
					p := scores[j] / sum
					vj := v[j*w+off : j*w+off+hd]
					for d := range out {
						out[d] += p * vj[d]
					}
				}
			}
		}
		o := l.o.apply(att, tokens)
		for i := range x {
			x[i] += o[i]
		}
		h = layerNorm(x, tokens, w, l.ln2w, l.ln2b)
		f := l.fc1.apply(h, tokens)
		for i, v := range f {
			f[i] = v / (1 + float32(math.Exp(float64(-1.702*v)))) // quick_gelu
		}
		f = l.fc2.apply(f, tokens)
		for i := range x {
			x[i] += f[i]
		}
	}
	return x
}

func normalize(v []float32) []float32 {
	var s float64
	for _, x := range v {
		s += float64(x) * float64(x)
	}
	n := float32(math.Sqrt(s))
	if n == 0 {
		return v
	}
	for i := range v {
		v[i] /= n
	}
	return v
}

// embedPixels gives the unit-length vector for a 3×224×224 input, already
// normalised with CLIP's mean and std (channels first, as CLIP expects).
func (m *clipModel) embedPixels(px []float32) []float32 {
	const w = 768
	g := clipImage / clipPatch
	tokens := g*g + 1
	x := make([]float32, tokens*w)
	copy(x, m.classEmb)
	patch := make([]float32, 3*clipPatch*clipPatch)
	for py := 0; py < g; py++ {
		for pxx := 0; pxx < g; pxx++ {
			i := 0
			for c := 0; c < 3; c++ {
				for y := 0; y < clipPatch; y++ {
					row := (c*clipImage+py*clipPatch+y)*clipImage + pxx*clipPatch
					copy(patch[i:i+clipPatch], px[row:row+clipPatch])
					i += clipPatch
				}
			}
			t := 1 + py*g + pxx
			out := x[t*w : (t+1)*w]
			for o := 0; o < w; o++ {
				out[o] = dot(patch, m.patchW[o*len(patch):(o+1)*len(patch)])
			}
		}
	}
	for i := range x {
		x[i] += m.visPos[i]
	}
	x = layerNorm(x, tokens, w, m.preLnW, m.preLnB)
	x = m.vis.run(x, tokens)
	cls := layerNorm(x[:w], 1, w, m.postLnW, m.postLnB)
	return normalize(m.visProj.apply(cls, 1))
}

var clipMean = [3]float32{0.48145466, 0.4578275, 0.40821073}
var clipStd = [3]float32{0.26862954, 0.26130258, 0.27577711}

// embedImage: centre square, scaled to 224 (bilinear), normalised, embedded.
func (m *clipModel) embedImage(img image.Image) []float32 {
	t := nsfwInputFrom(img) // 224×224×3 in 0..1, channels last
	px := make([]float32, 3*clipImage*clipImage)
	for y := 0; y < clipImage; y++ {
		for x := 0; x < clipImage; x++ {
			for c := 0; c < 3; c++ {
				px[(c*clipImage+y)*clipImage+x] = (t.d[(y*clipImage+x)*3+c] - clipMean[c]) / clipStd[c]
			}
		}
	}
	return m.embedPixels(px)
}

// embedTokens gives the unit-length vector for token ids that start with
// <|startoftext|> and end with <|endoftext|>.
func (m *clipModel) embedTokens(ids []int) []float32 {
	const w = 512
	n := len(ids)
	x := make([]float32, n*w)
	for t, id := range ids {
		copy(x[t*w:(t+1)*w], m.tokEmb[id*w:(id+1)*w])
		for i := 0; i < w; i++ {
			x[t*w+i] += m.txtPos[t*w+i]
		}
	}
	x = m.txt.run(x, n)
	last := layerNorm(x[(n-1)*w:], 1, w, m.finalLnW, m.finalLnB) // the <|endoftext|> token
	return normalize(m.txtProj.apply(last, 1))
}

func (m *clipModel) embedText(s string) []float32 {
	return m.embedTokens(m.tok.encode(s))
}

// ---------- tokenizer: CLIP's byte-level BPE ----------

type clipTokenizer struct {
	vocab   map[string]int
	ranks   map[[2]string]int
	byteEnc [256]string
	cache   sync.Map
}

var clipSplit = regexp.MustCompile(`(?i)<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+`)
var clipSpaces = regexp.MustCompile(`\s+`)

func newCLIPTokenizer() (*clipTokenizer, error) {
	t := &clipTokenizer{ranks: map[[2]string]int{}}
	if err := json.Unmarshal(clipVocabJSON, &t.vocab); err != nil {
		return nil, err
	}
	lines := strings.Split(strings.TrimSpace(clipMergesTxt), "\n")
	for i, l := range lines[1:] { // the first line is a version header
		p := strings.Fields(l)
		if len(p) == 2 {
			t.ranks[[2]string{p[0], p[1]}] = i
		}
	}
	// GPT-2's byte-to-character table: printable bytes stand for
	// themselves, the rest are moved up past 255.
	n := 0
	for b := 0; b < 256; b++ {
		if (b >= '!' && b <= '~') || (b >= 0xA1 && b <= 0xAC) || (b >= 0xAE && b <= 0xFF) {
			t.byteEnc[b] = string(rune(b))
		} else {
			t.byteEnc[b] = string(rune(256 + n))
			n++
		}
	}
	return t, nil
}

func (t *clipTokenizer) encode(text string) []int {
	text = strings.ToLower(strings.TrimSpace(clipSpaces.ReplaceAllString(text, " ")))
	ids := []int{49406}
	for _, word := range clipSplit.FindAllString(text, -1) {
		var enc strings.Builder
		for _, b := range []byte(word) {
			enc.WriteString(t.byteEnc[b])
		}
		for _, piece := range t.bpe(enc.String()) {
			if id, ok := t.vocab[piece]; ok {
				ids = append(ids, id)
			}
		}
		if len(ids) >= clipMaxText-1 {
			break
		}
	}
	if len(ids) > clipMaxText-1 {
		ids = ids[:clipMaxText-1]
	}
	return append(ids, 49407)
}

func (t *clipTokenizer) bpe(word string) []string {
	if v, ok := t.cache.Load(word); ok {
		return v.([]string)
	}
	var parts []string
	for rest := word; len(rest) > 0; {
		_, size := utf8.DecodeRuneInString(rest)
		parts = append(parts, rest[:size])
		rest = rest[size:]
	}
	if len(parts) == 0 {
		return nil
	}
	parts[len(parts)-1] += "</w>"
	for len(parts) > 1 {
		best, at := -1, -1
		for i := 0; i+1 < len(parts); i++ {
			if r, ok := t.ranks[[2]string{parts[i], parts[i+1]}]; ok && (best < 0 || r < best) {
				best, at = r, i
			}
		}
		if at < 0 {
			break
		}
		// Merge every occurrence of the best pair, left to right.
		a, b := parts[at], parts[at+1]
		var merged []string
		for i := 0; i < len(parts); i++ {
			if i+1 < len(parts) && parts[i] == a && parts[i+1] == b {
				merged = append(merged, a+b)
				i++
			} else {
				merged = append(merged, parts[i])
			}
		}
		parts = merged
	}
	t.cache.Store(word, parts)
	return parts
}
