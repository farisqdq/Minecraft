package main

// The sensitive-photo detector, run on the server.
//
// It is the same model the viewer runs in the browser (NSFWJS's
// MobileNetV2, MIT licensed, nsfwmodel/), with the same verdict rule, so a
// photo comes out the same whichever side checks it. Running it here means
// photos are checked as they arrive, by the server's own CPU, with nobody
// needing to keep the gallery open — and a phone or old laptop no longer
// has to do the work.
//
// Pure Go: the network is a few layer types (convolutions, batch norm,
// ReLU6, adds, pooling, three dense layers) evaluated directly, so the
// server needs no extra runtime or DLL. One photo takes a fraction of a
// second on one core; the scanner (scan.go) runs a few at once.

import (
	"embed"
	"encoding/json"
	"fmt"
	"image"
	"math"
	"sync"
)

//go:embed nsfwmodel/model.json nsfwmodel/weights.bin
var nsfwFiles embed.FS

// NSFWJS's classes, in the model's output order.
var nsfwClasses = [5]string{"Drawing", "Hentai", "Neutral", "Porn", "Sexy"}

const nsfwInput = 224

type nsLayer struct {
	Class   string          `json:"class_name"`
	Name    string          `json:"name"`
	Config  json.RawMessage `json:"config"`
	Inbound []string        `json:"inbound"`

	// parsed
	kh, kw, stride int
	same           bool
	pad            [4]int // top, bottom, left, right (ZeroPadding2D)
	kernel, bias   []float32
	cin, cout      int
	scale, shift   []float32 // batch norm folded to y = x*scale + shift
	maxValue       float32
	act            string
	pool           int
}

type nsModel struct {
	layers []*nsLayer
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
	raw, err := nsfwFiles.ReadFile("nsfwmodel/model.json")
	if err != nil {
		return nil, err
	}
	bin, err := nsfwFiles.ReadFile("nsfwmodel/weights.bin")
	if err != nil {
		return nil, err
	}
	var def struct {
		Layers  []*nsLayer `json:"layers"`
		Weights []struct {
			Name  string `json:"name"`
			Shape []int  `json:"shape"`
			Quant struct {
				Min   float64 `json:"min"`
				Scale float64 `json:"scale"`
				Dtype string  `json:"dtype"`
			} `json:"quantization"`
		} `json:"weights"`
	}
	if err := json.Unmarshal(raw, &def); err != nil {
		return nil, err
	}
	// Weights are stored one after another, each value a byte: q*scale+min.
	weights := map[string][]float32{}
	shapes := map[string][]int{}
	off := 0
	for _, w := range def.Weights {
		if w.Quant.Dtype != "uint8" {
			return nil, fmt.Errorf("weight %s: unsupported %q", w.Name, w.Quant.Dtype)
		}
		n := 1
		for _, d := range w.Shape {
			n *= d
		}
		if off+n > len(bin) {
			return nil, fmt.Errorf("weights file too short at %s", w.Name)
		}
		vals := make([]float32, n)
		for i := 0; i < n; i++ {
			vals[i] = float32(float64(bin[off+i])*w.Quant.Scale + w.Quant.Min)
		}
		off += n
		weights[w.Name] = vals
		shapes[w.Name] = w.Shape
	}

	for _, l := range def.Layers {
		var c struct {
			KernelSize []int    `json:"kernel_size"`
			Strides    []int    `json:"strides"`
			Padding    any      `json:"padding"`
			Filters    int      `json:"filters"`
			Units      int      `json:"units"`
			Activation string   `json:"activation"`
			MaxValue   *float64 `json:"max_value"`
			Epsilon    float64  `json:"epsilon"`
			PoolSize   []int    `json:"pool_size"`
			UseBias    bool     `json:"use_bias"`
			DepthMul   int      `json:"depth_multiplier"`
		}
		if err := json.Unmarshal(l.Config, &c); err != nil {
			return nil, fmt.Errorf("layer %s: %w", l.Name, err)
		}
		l.act = c.Activation
		switch l.Class {
		case "InputLayer", "Add", "Flatten", "Dropout":
		case "ZeroPadding2D":
			p, ok := c.Padding.([]any)
			if !ok || len(p) != 2 {
				return nil, fmt.Errorf("layer %s: odd padding", l.Name)
			}
			for i := 0; i < 2; i++ {
				pair := p[i].([]any)
				l.pad[i*2] = int(pair[0].(float64))
				l.pad[i*2+1] = int(pair[1].(float64))
			}
		case "Conv2D", "DepthwiseConv2D":
			l.kh, l.kw, l.stride = c.KernelSize[0], c.KernelSize[1], c.Strides[0]
			l.same = c.Padding == "same"
			name := l.Name + "/kernel"
			if l.Class == "DepthwiseConv2D" {
				name = l.Name + "/depthwise_kernel"
				if c.DepthMul != 1 {
					return nil, fmt.Errorf("layer %s: depth multiplier %d", l.Name, c.DepthMul)
				}
			}
			l.kernel = weights[name]
			sh := shapes[name]
			if l.kernel == nil || len(sh) != 4 {
				return nil, fmt.Errorf("layer %s: no kernel", l.Name)
			}
			l.cin, l.cout = sh[2], sh[3]
			if c.UseBias {
				l.bias = weights[l.Name+"/bias"]
			}
		case "BatchNormalization":
			g, b := weights[l.Name+"/gamma"], weights[l.Name+"/beta"]
			m, v := weights[l.Name+"/moving_mean"], weights[l.Name+"/moving_variance"]
			if g == nil || b == nil || m == nil || v == nil {
				return nil, fmt.Errorf("layer %s: missing weights", l.Name)
			}
			l.scale, l.shift = make([]float32, len(g)), make([]float32, len(g))
			for i := range g {
				s := float64(g[i]) / math.Sqrt(float64(v[i])+c.Epsilon)
				l.scale[i] = float32(s)
				l.shift[i] = float32(float64(b[i]) - float64(m[i])*s)
			}
		case "ReLU":
			l.maxValue = float32(math.Inf(1))
			if c.MaxValue != nil {
				l.maxValue = float32(*c.MaxValue)
			}
		case "AveragePooling2D":
			l.pool = c.PoolSize[0]
		case "Dense":
			l.kernel, l.bias = weights[l.Name+"/kernel"], weights[l.Name+"/bias"]
			sh := shapes[l.Name+"/kernel"]
			if l.kernel == nil || len(sh) != 2 {
				return nil, fmt.Errorf("layer %s: no kernel", l.Name)
			}
			l.cin, l.cout = sh[0], sh[1]
		default:
			return nil, fmt.Errorf("layer %s: unsupported %s", l.Name, l.Class)
		}
	}
	return &nsModel{layers: def.Layers}, nil
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
	out := map[string]*tensor{}
	var last *tensor
	for _, l := range m.layers {
		var x *tensor
		if len(l.Inbound) > 0 {
			x = out[l.Inbound[0]]
			if x == nil {
				return probs, fmt.Errorf("layer %s: input %s not ready", l.Name, l.Inbound[0])
			}
		}
		var y *tensor
		switch l.Class {
		case "InputLayer":
			y = input
		case "ZeroPadding2D":
			y = newTensor(x.h+l.pad[0]+l.pad[1], x.w+l.pad[2]+l.pad[3], x.c)
			for r := 0; r < x.h; r++ {
				copy(y.d[((r+l.pad[0])*y.w+l.pad[2])*x.c:], x.d[r*x.w*x.c:(r+1)*x.w*x.c])
			}
		case "Conv2D":
			y = l.conv(x)
		case "DepthwiseConv2D":
			y = l.depthwise(x)
		case "BatchNormalization":
			y = newTensor(x.h, x.w, x.c)
			for i, v := range x.d {
				ch := i % x.c
				y.d[i] = v*l.scale[ch] + l.shift[ch]
			}
		case "ReLU":
			y = newTensor(x.h, x.w, x.c)
			for i, v := range x.d {
				y.d[i] = min(max(v, 0), l.maxValue)
			}
		case "Add":
			b := out[l.Inbound[1]]
			y = newTensor(x.h, x.w, x.c)
			for i := range x.d {
				y.d[i] = x.d[i] + b.d[i]
			}
		case "AveragePooling2D":
			// The model's pool covers the whole 7×7 map: a global average.
			if x.h != l.pool || x.w != l.pool {
				return probs, fmt.Errorf("pool %d over %dx%d", l.pool, x.h, x.w)
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
		case "Flatten", "Dropout":
			y = &tensor{1, 1, len(x.d), x.d}
		case "Dense":
			y = newTensor(1, 1, l.cout)
			copy(y.d, l.bias)
			for ci, v := range x.d {
				row := l.kernel[ci*l.cout : (ci+1)*l.cout]
				for co, k := range row {
					y.d[co] += v * k
				}
			}
			switch l.act {
			case "relu":
				for i, v := range y.d {
					y.d[i] = max(v, 0)
				}
			case "softmax":
				mx := y.d[0]
				for _, v := range y.d {
					mx = max(mx, v)
				}
				var sum float64
				for i, v := range y.d {
					e := math.Exp(float64(v - mx))
					y.d[i] = float32(e)
					sum += e
				}
				for i := range y.d {
					y.d[i] = float32(float64(y.d[i]) / sum)
				}
			}
		}
		out[l.Name] = y
		last = y
	}
	if last == nil || len(last.d) != 5 {
		return probs, fmt.Errorf("unexpected output")
	}
	copy(probs[:], last.d)
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
	m, err := nsfwModel()
	if err != nil {
		return [5]float32{}, err
	}
	return m.predict(nsfwInputFrom(img))
}
