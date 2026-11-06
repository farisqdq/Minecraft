package main

// A reader for PyTorch's zip checkpoint format (torch.save), just enough to
// load CLIP's float32 weights (clip.go) without Python. The checkpoint is a
// zip of a pickle that names each tensor's storage, offset, shape and
// strides, plus one raw little-endian file per storage. The pickle uses a
// small set of opcodes; anything else is an error rather than a guess.

import (
	"archive/zip"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"strings"
)

type pkGlobal struct{ mod, name string }
type pkMark struct{}
type pkStorage struct {
	dtype, key string
}
type pkTensor struct {
	st     pkStorage
	offset int
	shape  []int
	stride []int
}

// ptTensor is a loaded float32 tensor, row-major.
type ptTensor struct {
	shape []int
	data  []float32
}

func loadPyTorch(path string) (map[string]ptTensor, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	files := map[string]*zip.File{}
	var pklName string
	for _, f := range zr.File {
		files[f.Name] = f
		if strings.HasSuffix(f.Name, "/data.pkl") {
			pklName = f.Name
		}
	}
	if pklName == "" {
		return nil, fmt.Errorf("no data.pkl in checkpoint")
	}
	prefix := strings.TrimSuffix(pklName, "data.pkl")
	pkl, err := readZipFile(files[pklName])
	if err != nil {
		return nil, err
	}
	root, err := unpickle(pkl)
	if err != nil {
		return nil, err
	}
	dict, ok := root.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("checkpoint isn't a dict of tensors")
	}
	storages := map[string][]byte{}
	out := map[string]ptTensor{}
	for name, v := range dict {
		t, ok := v.(pkTensor)
		if !ok {
			continue
		}
		if t.st.dtype != "FloatStorage" {
			continue // e.g. position_ids, which CLIP rebuilds itself
		}
		raw, ok := storages[t.st.key]
		if !ok {
			f := files[prefix+"data/"+t.st.key]
			if f == nil {
				return nil, fmt.Errorf("%s: storage %s missing", name, t.st.key)
			}
			if raw, err = readZipFile(f); err != nil {
				return nil, err
			}
			storages[t.st.key] = raw
		}
		n := 1
		for _, d := range t.shape {
			n *= d
		}
		// Read element by element through the strides, so a tensor saved
		// as a transposed view comes out row-major like the rest.
		maxIdx := t.offset
		for i, d := range t.shape {
			if d > 0 {
				maxIdx += (d - 1) * t.stride[i]
			}
		}
		if n > 0 && (maxIdx+1)*4 > len(raw) {
			return nil, fmt.Errorf("%s: storage too short", name)
		}
		data := make([]float32, n)
		idx := make([]int, len(t.shape))
		for i := range data {
			at := t.offset
			for k, v := range idx {
				at += v * t.stride[k]
			}
			data[i] = math.Float32frombits(binary.LittleEndian.Uint32(raw[at*4:]))
			for k := len(idx) - 1; k >= 0; k-- {
				idx[k]++
				if idx[k] < t.shape[k] {
					break
				}
				idx[k] = 0
			}
		}
		out[name] = ptTensor{shape: t.shape, data: data}
	}
	return out, nil
}

func readZipFile(f *zip.File) ([]byte, error) {
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	return io.ReadAll(rc)
}

// unpickle runs the opcodes a torch.save state dict uses.
func unpickle(b []byte) (any, error) {
	var stack []any
	memo := map[int]any{}
	pos := 0
	need := func(n int) ([]byte, error) {
		if pos+n > len(b) {
			return nil, fmt.Errorf("pickle ends early")
		}
		s := b[pos : pos+n]
		pos += n
		return s, nil
	}
	pop := func() any { v := stack[len(stack)-1]; stack = stack[:len(stack)-1]; return v }
	popMark := func() []any {
		for i := len(stack) - 1; i >= 0; i-- {
			if _, ok := stack[i].(pkMark); ok {
				items := append([]any(nil), stack[i+1:]...)
				stack = stack[:i]
				return items
			}
		}
		return nil
	}
	ints := func(v any) []int {
		t, _ := v.([]any)
		out := make([]int, len(t))
		for i, x := range t {
			out[i], _ = x.(int)
		}
		return out
	}
	for pos < len(b) {
		op := b[pos]
		pos++
		switch op {
		case 0x80: // PROTO
			if _, err := need(1); err != nil {
				return nil, err
			}
		case 'c': // GLOBAL "module\nname\n"
			i := strings.IndexByte(string(b[pos:]), '\n')
			j := strings.IndexByte(string(b[pos+i+1:]), '\n')
			if i < 0 || j < 0 {
				return nil, fmt.Errorf("bad GLOBAL")
			}
			stack = append(stack, pkGlobal{string(b[pos : pos+i]), string(b[pos+i+1 : pos+i+1+j])})
			pos += i + 1 + j + 1
		case 'q': // BINPUT
			s, err := need(1)
			if err != nil {
				return nil, err
			}
			memo[int(s[0])] = stack[len(stack)-1]
		case 'r': // LONG_BINPUT
			s, err := need(4)
			if err != nil {
				return nil, err
			}
			memo[int(binary.LittleEndian.Uint32(s))] = stack[len(stack)-1]
		case 'h': // BINGET
			s, err := need(1)
			if err != nil {
				return nil, err
			}
			stack = append(stack, memo[int(s[0])])
		case 'j': // LONG_BINGET
			s, err := need(4)
			if err != nil {
				return nil, err
			}
			stack = append(stack, memo[int(binary.LittleEndian.Uint32(s))])
		case '(': // MARK
			stack = append(stack, pkMark{})
		case ')': // EMPTY_TUPLE
			stack = append(stack, []any{})
		case 't': // TUPLE
			stack = append(stack, popMark())
		case 0x85: // TUPLE1
			stack = append(stack, []any{pop()})
		case 0x86: // TUPLE2
			b2 := pop()
			stack = append(stack, []any{pop(), b2})
		case 0x87: // TUPLE3
			c3 := pop()
			b3 := pop()
			stack = append(stack, []any{pop(), b3, c3})
		case 'X': // BINUNICODE
			s, err := need(4)
			if err != nil {
				return nil, err
			}
			str, err := need(int(binary.LittleEndian.Uint32(s)))
			if err != nil {
				return nil, err
			}
			stack = append(stack, string(str))
		case 'K': // BININT1
			s, err := need(1)
			if err != nil {
				return nil, err
			}
			stack = append(stack, int(s[0]))
		case 'M': // BININT2
			s, err := need(2)
			if err != nil {
				return nil, err
			}
			stack = append(stack, int(binary.LittleEndian.Uint16(s)))
		case 'J': // BININT
			s, err := need(4)
			if err != nil {
				return nil, err
			}
			stack = append(stack, int(int32(binary.LittleEndian.Uint32(s))))
		case 0x88: // NEWTRUE
			stack = append(stack, true)
		case 0x89: // NEWFALSE
			stack = append(stack, false)
		case 'N': // NONE
			stack = append(stack, nil)
		case '}': // EMPTY_DICT
			stack = append(stack, map[string]any{})
		case 'Q': // BINPERSID: ('storage', torch.XStorage, key, location, numel)
			t, _ := pop().([]any)
			if len(t) < 3 {
				return nil, fmt.Errorf("odd persistent id")
			}
			g, _ := t[1].(pkGlobal)
			key, _ := t[2].(string)
			stack = append(stack, pkStorage{dtype: g.name, key: key})
		case 'R': // REDUCE
			args, _ := pop().([]any)
			fn, _ := pop().(pkGlobal)
			switch fn.mod + "." + fn.name {
			case "collections.OrderedDict":
				stack = append(stack, map[string]any{})
			case "torch._utils._rebuild_tensor_v2":
				if len(args) < 4 {
					return nil, fmt.Errorf("odd tensor")
				}
				st, _ := args[0].(pkStorage)
				off, _ := args[1].(int)
				stack = append(stack, pkTensor{st: st, offset: off, shape: ints(args[2]), stride: ints(args[3])})
			default:
				return nil, fmt.Errorf("pickle calls %s.%s", fn.mod, fn.name)
			}
		case 's': // SETITEM
			v := pop()
			k, _ := pop().(string)
			if d, ok := stack[len(stack)-1].(map[string]any); ok {
				d[k] = v
			}
		case 'u': // SETITEMS
			items := popMark()
			d, ok := stack[len(stack)-1].(map[string]any)
			for i := 0; ok && i+1 < len(items); i += 2 {
				k, _ := items[i].(string)
				d[k] = items[i+1]
			}
		case 'b': // BUILD: state for the OrderedDict (its _metadata); not needed
			pop()
		case '.': // STOP
			if len(stack) != 1 {
				return nil, fmt.Errorf("pickle left %d values", len(stack))
			}
			return stack[0], nil
		default:
			return nil, fmt.Errorf("unsupported pickle opcode 0x%02x at %d", op, pos-1)
		}
	}
	return nil, fmt.Errorf("pickle has no STOP")
}
