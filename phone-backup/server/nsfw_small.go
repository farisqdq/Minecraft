package main

// The small sensitive-photo model (NSFWJS MobileNetV2, the one the viewer
// runs in the browser), kept as the fast first pass: it screens every photo
// and video frame, and only what it flags goes on to the larger, more
// careful model in nsfw.go for the final call. Screening everything with
// the large model was too slow; the small one alone flagged too much.

import (
	"embed"
	"encoding/json"
	"fmt"
	"math"
	"sync"
)

//go:embed nsfwmodel/small.json nsfwmodel/small.bin
var smallFiles embed.FS

type smLayer struct {
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

type smModel struct {
	layers []*smLayer
}

var (
	smOnce   sync.Once
	smModelV *smModel
	smErr    error
)

func smallModel() (*smModel, error) {
	smOnce.Do(func() { smModelV, smErr = loadSmall() })
	return smModelV, smErr
}

func loadSmall() (*smModel, error) {
	raw, err := smallFiles.ReadFile("nsfwmodel/small.json")
	if err != nil {
		return nil, err
	}
	bin, err := smallFiles.ReadFile("nsfwmodel/small.bin")
	if err != nil {
		return nil, err
	}
	var def struct {
		Layers  []*smLayer `json:"layers"`
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
	return &smModel{layers: def.Layers}, nil
}

// predict runs the network on a 224×224 RGB image scaled to 0..1 and
// returns the five class probabilities.
func (m *smModel) predict(input *tensor) ([5]float32, error) {
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
			y = l.asConv().conv(x)
		case "DepthwiseConv2D":
			y = l.asConv().depthwise(x)
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

// asConv gives the convolution's shapes and weights to the shared code.
func (l *smLayer) asConv() *nsLayer {
	return &nsLayer{kh: l.kh, kw: l.kw, stride: l.stride, same: l.same, kernel: l.kernel, bias: l.bias, cin: l.cin, cout: l.cout}
}
