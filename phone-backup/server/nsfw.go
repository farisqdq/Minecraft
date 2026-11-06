package main

// The sensitive-photo detector, run on the server.
//
// NSFWJS's "MobileNetV2Mid" model (MIT licensed, nsfwmodel/): a wider
// MobileNetV2 trained on more data than the small model the viewer runs in
// the browser, so it's fooled less often by ordinary photos (the small one
// flagged blurry close-ups of car seats). It still gives the same five
// scores, and the verdict rule is the viewer's.
//
// Pure Go: the network is a short list of fused convolutions, adds, a pool
// and a dense layer, evaluated directly, so the server needs no extra
// runtime or DLL. One photo takes about half a second on one core; the
// scanner (scan.go) runs a few at once.

import (
	"embed"
	"encoding/json"
	"fmt"
	"image"
	"math"
	"sync"
)

//go:embed nsfwmodel/mid.json nsfwmodel/mid.bin
var nsfwFiles embed.FS

// NSFWJS's classes, in the model's output order.
var nsfwClasses = [5]string{"Drawing", "Hentai", "Neutral", "Porn", "Sexy"}

const nsfwInput = 224

// nsLayer is one convolution: the shapes and weights conv and depthwise use.
type nsLayer struct {
	kh, kw, stride int
	same           bool
	kernel, bias   []float32
	cin, cout      int
}

// One step of the model's graph, with inputs by node id.
type nsNode struct {
	ID      int      `json:"id"`
	Op      string   `json:"op"`
	In      []int    `json:"in"`
	Stride  int      `json:"stride"`
	Padding string   `json:"padding"`
	Fused   []string `json:"fused"`
	Ksize   int      `json:"ksize"`

	layer nsLayer
	relu6 bool
}

type nsModel struct {
	input, output int
	nodes         []*nsNode
	consts        map[int][]float32
}

var (
	nsOnce   sync.Once
	nsModelV *nsModel
	nsErr    error
)

func nsfwModel() (*nsModel, error) {
	nsOnce.Do(func() { nsModelV, nsErr = loadNSFW() })
	return nsModelV, nsErr
}

func loadNSFW() (*nsModel, error) {
	raw, err := nsfwFiles.ReadFile("nsfwmodel/mid.json")
	if err != nil {
		return nil, err
	}
	bin, err := nsfwFiles.ReadFile("nsfwmodel/mid.bin")
	if err != nil {
		return nil, err
	}
	var def struct {
		Input   int       `json:"input"`
		Output  int       `json:"output"`
		Nodes   []*nsNode `json:"nodes"`
		Weights []struct {
			ID    int     `json:"id"`
			Shape []int   `json:"shape"`
			Min   float64 `json:"min"`
			Scale float64 `json:"scale"`
		} `json:"weights"`
	}
	if err := json.Unmarshal(raw, &def); err != nil {
		return nil, err
	}
	// Weights are stored one after another, each value a byte: q*scale+min.
	consts := map[int][]float32{}
	shapes := map[int][]int{}
	off := 0
	for _, w := range def.Weights {
		n := 1
		for _, d := range w.Shape {
			n *= d
		}
		if off+n > len(bin) {
			return nil, fmt.Errorf("weights file too short")
		}
		vals := make([]float32, n)
		for i := 0; i < n; i++ {
			vals[i] = float32(float64(bin[off+i])*w.Scale + w.Min)
		}
		off += n
		consts[w.ID] = vals
		shapes[w.ID] = w.Shape
	}
	if off != len(bin) {
		return nil, fmt.Errorf("weights file has %d bytes left over", len(bin)-off)
	}
	for _, n := range def.Nodes {
		switch n.Op {
		case "_FusedConv2D", "FusedDepthwiseConv2dNative", "_FusedMatMul":
			if len(n.In) != 3 {
				return nil, fmt.Errorf("node %d: %s with %d inputs", n.ID, n.Op, len(n.In))
			}
			k, b, sh := consts[n.In[1]], consts[n.In[2]], shapes[n.In[1]]
			if k == nil || b == nil {
				return nil, fmt.Errorf("node %d: missing weights", n.ID)
			}
			for _, f := range n.Fused {
				switch f {
				case "BiasAdd":
				case "Relu6":
					n.relu6 = true
				default:
					return nil, fmt.Errorf("node %d: unsupported fused op %s", n.ID, f)
				}
			}
			n.layer = nsLayer{kernel: k, bias: b, stride: max(n.Stride, 1), same: n.Padding == "SAME"}
			if n.Op == "_FusedMatMul" {
				n.layer.cin, n.layer.cout = sh[0], sh[1]
			} else {
				n.layer.kh, n.layer.kw, n.layer.cin, n.layer.cout = sh[0], sh[1], sh[2], sh[3]
				if n.Op == "FusedDepthwiseConv2dNative" && sh[3] != 1 {
					return nil, fmt.Errorf("node %d: depth multiplier %d", n.ID, sh[3])
				}
			}
		case "Mul", "Sub", "AddV2", "AvgPool", "Squeeze", "Softmax", "Placeholder":
		default:
			return nil, fmt.Errorf("node %d: unsupported op %s", n.ID, n.Op)
		}
	}
	return &nsModel{input: def.Input, output: def.Output, nodes: def.Nodes, consts: consts}, nil
}

// tensor is height × width × channels, channels last.
type tensor struct {
	h, w, c int
	d       []float32
}

func newTensor(h, w, c int) *tensor { return &tensor{h, w, c, make([]float32, h*w*c)} }

// samePad is TensorFlow's "same" padding before the first row/column.
func samePad(in, k, s int) (out, before int) {
	out = (in + s - 1) / s
	total := max((out-1)*s+k-in, 0)
	return out, total / 2
}

func (l *nsLayer) conv(x *tensor) *tensor {
	oh, ow, pt, pl := 0, 0, 0, 0
	if l.same {
		oh, pt = samePad(x.h, l.kh, l.stride)
		ow, pl = samePad(x.w, l.kw, l.stride)
	} else {
		oh, ow = (x.h-l.kh)/l.stride+1, (x.w-l.kw)/l.stride+1
	}
	y := newTensor(oh, ow, l.cout)
	if l.kh == 1 && l.kw == 1 && l.stride == 1 {
		// Pointwise: a matrix product, most of the network's work.
		for p := 0; p < oh*ow; p++ {
			in := x.d[p*x.c : (p+1)*x.c]
			out := y.d[p*l.cout : (p+1)*l.cout]
			for ci, v := range in {
				if v == 0 {
					continue // ReLU leaves many zeros
				}
				row := l.kernel[ci*l.cout : (ci+1)*l.cout]
				for co, k := range row {
					out[co] += v * k
				}
			}
		}
	} else {
		for oy := 0; oy < oh; oy++ {
			for ox := 0; ox < ow; ox++ {
				out := y.d[(oy*ow+ox)*l.cout : (oy*ow+ox+1)*l.cout]
				for ky := 0; ky < l.kh; ky++ {
					iy := oy*l.stride + ky - pt
					if iy < 0 || iy >= x.h {
						continue
					}
					for kx := 0; kx < l.kw; kx++ {
						ix := ox*l.stride + kx - pl
						if ix < 0 || ix >= x.w {
							continue
						}
						in := x.d[(iy*x.w+ix)*x.c : (iy*x.w+ix+1)*x.c]
						base := (ky*l.kw + kx) * l.cin * l.cout
						for ci, v := range in {
							row := l.kernel[base+ci*l.cout : base+(ci+1)*l.cout]
							for co, k := range row {
								out[co] += v * k
							}
						}
					}
				}
			}
		}
	}
	if l.bias != nil {
		for p := 0; p < oh*ow; p++ {
			for co := 0; co < l.cout; co++ {
				y.d[p*l.cout+co] += l.bias[co]
			}
		}
	}
	return y
}

func (l *nsLayer) depthwise(x *tensor) *tensor {
	oh, pt := samePad(x.h, l.kh, l.stride)
	ow, pl := samePad(x.w, l.kw, l.stride)
	if !l.same {
		oh, ow, pt, pl = (x.h-l.kh)/l.stride+1, (x.w-l.kw)/l.stride+1, 0, 0
	}
	c := x.c
	y := newTensor(oh, ow, c)
	for oy := 0; oy < oh; oy++ {
		for ox := 0; ox < ow; ox++ {
			out := y.d[(oy*ow+ox)*c : (oy*ow+ox+1)*c]
			for ky := 0; ky < l.kh; ky++ {
				iy := oy*l.stride + ky - pt
				if iy < 0 || iy >= x.h {
					continue
				}
				for kx := 0; kx < l.kw; kx++ {
					ix := ox*l.stride + kx - pl
					if ix < 0 || ix >= x.w {
						continue
					}
					in := x.d[(iy*x.w+ix)*c : (iy*x.w+ix+1)*c]
					k := l.kernel[(ky*l.kw+kx)*c : (ky*l.kw+kx+1)*c]
					for ch := range out {
						out[ch] += in[ch] * k[ch]
					}
				}
			}
		}
	}
	return y
}

// predict runs the network on a 224×224 RGB image scaled to 0..1 and
// returns the five class probabilities.
func (m *nsModel) predict(input *tensor) ([5]float32, error) {
	var probs [5]float32
	vals := map[int]*tensor{m.input: input}
	get := func(id int) (*tensor, error) {
		if t := vals[id]; t != nil {
			return t, nil
		}
		if c := m.consts[id]; c != nil {
			return &tensor{1, 1, len(c), c}, nil
		}
		return nil, fmt.Errorf("value %d not ready", id)
	}
	for _, n := range m.nodes {
		if n.Op == "Placeholder" {
			continue // the input, already in vals
		}
		x, err := get(n.In[0])
		if err != nil {
			return probs, err
		}
		var y *tensor
		switch n.Op {
		case "Mul", "Sub", "AddV2":
			b, err := get(n.In[1])
			if err != nil {
				return probs, err
			}
			// Either side may be a scalar or a per-channel row, broadcast
			// over the other: the input scaling is const*image.
			big := x
			if len(b.d) > len(x.d) {
				big = b
			}
			if len(big.d)%len(x.d) != 0 || len(big.d)%len(b.d) != 0 {
				return probs, fmt.Errorf("node %d: odd broadcast", n.ID)
			}
			y = newTensor(big.h, big.w, big.c)
			for i := range y.d {
				v, w := x.d[i%len(x.d)], b.d[i%len(b.d)]
				switch n.Op {
				case "Mul":
					y.d[i] = v * w
				case "Sub":
					y.d[i] = v - w
				default:
					y.d[i] = v + w
				}
			}
		case "_FusedConv2D":
			y = n.layer.conv(x)
		case "FusedDepthwiseConv2dNative":
			y = n.layer.depthwise(x)
			for p := 0; p < y.h*y.w; p++ {
				for ch := 0; ch < y.c; ch++ {
					y.d[p*y.c+ch] += n.layer.bias[ch]
				}
			}
		case "AvgPool":
			// The pool covers the whole 7×7 map: a global average.
			if x.h != n.Ksize || x.w != n.Ksize {
				return probs, fmt.Errorf("pool %d over %dx%d", n.Ksize, x.h, x.w)
			}
			y = newTensor(1, 1, x.c)
			for p := 0; p < x.h*x.w; p++ {
				for ch := 0; ch < x.c; ch++ {
					y.d[ch] += x.d[p*x.c+ch]
				}
			}
			for ch := range y.d {
				y.d[ch] /= float32(x.h * x.w)
			}
		case "Squeeze":
			y = &tensor{1, 1, len(x.d), x.d}
		case "_FusedMatMul":
			l := n.layer
			y = newTensor(1, 1, l.cout)
			copy(y.d, l.bias)
			for ci, v := range x.d {
				row := l.kernel[ci*l.cout : (ci+1)*l.cout]
				for co, k := range row {
					y.d[co] += v * k
				}
			}
		case "Softmax":
			y = newTensor(1, 1, len(x.d))
			mx := x.d[0]
			for _, v := range x.d {
				mx = max(mx, v)
			}
			var sum float64
			for i, v := range x.d {
				e := math.Exp(float64(v - mx))
				y.d[i] = float32(e)
				sum += e
			}
			for i := range y.d {
				y.d[i] = float32(float64(y.d[i]) / sum)
			}
		}
		if n.relu6 {
			for i, v := range y.d {
				y.d[i] = min(max(v, 0), 6)
			}
		}
		vals[n.ID] = y
	}
	out := vals[m.output]
	if out == nil || len(out.d) != 5 {
		return probs, fmt.Errorf("unexpected output")
	}
	copy(probs[:], out.d)
	return probs, nil
}

// nsfwInputFrom takes the centre square of an image and scales it to the
// model's 224×224, as the viewer does with a canvas before its check,
// using TensorFlow's bilinear resize with aligned corners.
func nsfwInputFrom(img image.Image) *tensor {
	b := img.Bounds()
	side := min(b.Dx(), b.Dy())
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	src := make([]float32, side*side*3)
	for y := 0; y < side; y++ {
		for x := 0; x < side; x++ {
			r, g, bl, _ := img.At(x0+x, y0+y).RGBA()
			i := (y*side + x) * 3
			src[i], src[i+1], src[i+2] = float32(r>>8)/255, float32(g>>8)/255, float32(bl>>8)/255
		}
	}
	t := newTensor(nsfwInput, nsfwInput, 3)
	scale := 0.0
	if side > 1 {
		scale = float64(side-1) / float64(nsfwInput-1)
	}
	for y := 0; y < nsfwInput; y++ {
		fy := float64(y) * scale
		y1 := int(fy)
		y2 := min(y1+1, side-1)
		dy := float32(fy - float64(y1))
		for x := 0; x < nsfwInput; x++ {
			fx := float64(x) * scale
			x1 := int(fx)
			x2 := min(x1+1, side-1)
			dx := float32(fx - float64(x1))
			for ch := 0; ch < 3; ch++ {
				a := src[(y1*side+x1)*3+ch]
				bb := src[(y1*side+x2)*3+ch]
				c := src[(y2*side+x1)*3+ch]
				d := src[(y2*side+x2)*3+ch]
				top := a + (bb-a)*dx
				bot := c + (d-c)*dx
				t.d[(y*nsfwInput+x)*3+ch] = top + (bot-top)*dy
			}
		}
	}
	return t
}

// nsfwVerdict is the viewer's rule: only confident "explicit" verdicts;
// "Sexy" alone flags ordinary photos of people.
func nsfwVerdict(p [5]float32) bool {
	porn, hentai := p[3], p[1]
	return max(porn, hentai) >= 0.8 || porn+hentai >= 0.9
}

// classifyImage gives the five probabilities for one decoded image.
func classifyImage(img image.Image) ([5]float32, error) {
	return classifyInput(nsfwInputFrom(img))
}

// classifyInput runs the small model (nsfw_small.go) alone. A two-step
// check, with this file's larger model confirming the small one's flags,
// cut false alarms but also missed real ones, and the owner would rather
// clear a few car seats than miss anything. The larger model stays here,
// unused, in case that changes.
func classifyInput(in *tensor) ([5]float32, error) {
	sm, err := smallModel()
	if err != nil {
		return [5]float32{}, err
	}
	return sm.predict(in)
}
