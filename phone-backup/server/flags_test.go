package main

import "testing"

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
