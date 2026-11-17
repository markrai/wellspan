package board

import (
	"encoding/json"
	"strings"
	"testing"
)

func validBoard(t *testing.T) Board {
	t.Helper()
	var b Board
	data := []byte(`{"version":1,"foods":[{"id":"food-1","name":"Soy milk","nutrients":{"calories":80,"protein":7,"carbs":4,"fat":4,"satFat":0.5,"fiber":0,"sugars":1,"sodium":100,"cholesterol":0},"notes":"My usual glass"}],"meals":{"breakfast":["food-1"],"lunch":[],"dinner":[]}}`)
	if err := json.Unmarshal(data, &b); err != nil {
		t.Fatal(err)
	}
	return b
}

func TestRoundTripVersionOne(t *testing.T) {
	b := validBoard(t)
	data, err := json.Marshal(b)
	if err != nil {
		t.Fatal(err)
	}
	got, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	var restored Board
	if err := json.Unmarshal(got, &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Version != 1 || restored.Foods[0].Nutrients["satFat"] == nil || *restored.Foods[0].Nutrients["satFat"] != .5 {
		t.Fatal("version-1 data changed")
	}
}

func TestRejectsUnsafeState(t *testing.T) {
	tests := []struct {
		name string
		change func(*Board)
	}{
		{"unknown food reference", func(b *Board) { b.Meals["dinner"] = []string{"missing"} }},
		{"duplicate meal entry", func(b *Board) { b.Meals["breakfast"] = []string{"food-1", "food-1"} }},
		{"negative nutrient", func(b *Board) { value := -1.0; b.Foods[0].Nutrients["protein"] = &value }},
		{"extra nutrient", func(b *Board) { b.Foods[0].Nutrients["unknown"] = nil }},
		{"unknown meal", func(b *Board) { b.Meals["late-night"] = []string{} }},
		{"invalid version", func(b *Board) { b.Version = 2 }},
		{"duplicate identifier", func(b *Board) { b.Foods = append(b.Foods, b.Foods[0]) }},
		{"duplicate name", func(b *Board) { f := b.Foods[0]; f.ID = "food-2"; f.Name = "SOY MILK"; b.Foods = append(b.Foods, f) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b := validBoard(t)
			tc.change(&b)
			if err := Validate(b); err == nil {
				t.Fatal("invalid board was accepted")
			}
		})
	}
}

func TestNullIsNotZero(t *testing.T) {
	b := validBoard(t)
	b.Foods[0].Nutrients["fiber"] = nil
	data, _ := json.Marshal(b)
	got, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(got), `"fiber":null`) || !strings.Contains(string(got), `"cholesterol":0`) {
		t.Fatalf("null and zero were not preserved: %s", got)
	}
}

func TestRejectsExtraFields(t *testing.T) {
	b := validBoard(t)
	data, _ := json.Marshal(b)
	withUnknown := strings.Replace(string(data), `"version":1`, `"version":1,"unexpected":true`, 1)
	if _, err := Decode([]byte(withUnknown)); err == nil {
		t.Fatal("unknown fields were accepted")
	}
}
