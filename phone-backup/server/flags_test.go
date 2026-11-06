package main

import (
	"encoding/json"
	"testing"
)

func TestMergeFlags(t *testing.T) {
	stored := map[string]int{"a.jpg": 1, "b.jpg": 2, "c.jpg": 0}
	changed := mergeFlags(stored, map[string]int{
		"a.jpg": 2, // cleared by someone: taken
		"b.jpg": 1, // already cleared: a stale flag never brings the blur back
		"c.jpg": 0, // same: no change
		"d.jpg": 1, // new
		"e.jpg": 7, // nonsense: ignored
		"":      1, // no path: ignored
	})
	if !changed {
		t.Fatal("expected a change")
	}
	want := map[string]int{"a.jpg": 2, "b.jpg": 2, "c.jpg": 0, "d.jpg": 1}
	if len(stored) != len(want) {
		t.Fatalf("got %v", stored)
	}
	for k, v := range want {
		if stored[k] != v {
			t.Fatalf("%s: got %d want %d", k, stored[k], v)
		}
	}
	if mergeFlags(stored, map[string]int{"b.jpg": 0, "c.jpg": 0}) {
		t.Fatal("nothing should have changed")
	}
}

func TestWithSpeed(t *testing.T) {
	prev := []byte(`{"running":true,"at":1000,"bytesDone":0}`)
	cur := []byte(`{"running":true,"at":11000,"bytesDone":20000000}`)
	var got map[string]any
	json.Unmarshal(withSpeed(prev, cur), &got)
	if got["bps"] != 2e6 {
		t.Fatalf("bps = %v, want 2e6", got["bps"])
	}
	// Smoothed with the previous speed.
	next := []byte(`{"running":true,"at":21000,"bytesDone":60000000}`)
	json.Unmarshal(withSpeed(withSpeed(prev, cur), next), &got)
	if got["bps"] != 3e6 {
		t.Fatalf("smoothed bps = %v, want 3e6", got["bps"])
	}
	// A finished run's report, or a new run starting over, isn't touched.
	done := []byte(`{"at":30000,"sentFiles":3}`)
	if string(withSpeed(cur, done)) != string(done) {
		t.Fatal("final report changed")
	}
	restart := []byte(`{"running":true,"at":40000,"bytesDone":5}`)
	if string(withSpeed(cur, restart)) != string(restart) {
		t.Fatal("restart got a speed")
	}
}
