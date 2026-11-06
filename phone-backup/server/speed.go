package main

// Upload speed for the site's live progress. The phone sends a "running"
// report every ~10 s with the bytes sent so far; the speed is the change
// between two of them, smoothed so one slow file doesn't make it jump. It's
// worked out here rather than on the phone so the phones already out there
// show it without an app update.

import "encoding/json"

// withSpeed returns cur with "bps" (bytes a second) added, from the change
// since prev. Anything that isn't two running reports of the same run passes
// through unchanged.
func withSpeed(prev, cur json.RawMessage) json.RawMessage {
	var c map[string]any
	if json.Unmarshal(cur, &c) != nil || c["running"] != true {
		return cur
	}
	var p map[string]any
	if json.Unmarshal(prev, &p) != nil || p["running"] != true {
		return cur
	}
	num := func(m map[string]any, k string) (float64, bool) {
		v, ok := m[k].(float64)
		return v, ok
	}
	cb, ok1 := num(c, "bytesDone")
	ca, ok2 := num(c, "at")
	pb, ok3 := num(p, "bytesDone")
	pa, ok4 := num(p, "at")
	if !ok1 || !ok2 || !ok3 || !ok4 || ca <= pa || cb < pb {
		return cur // a new run started, or the clock went backwards
	}
	bps := (cb - pb) / ((ca - pa) / 1000)
	if old, ok := num(p, "bps"); ok && old > 0 {
		bps = 0.5*bps + 0.5*old
	}
	c["bps"] = bps
	out, err := json.Marshal(c)
	if err != nil {
		return cur
	}
	return out
}
