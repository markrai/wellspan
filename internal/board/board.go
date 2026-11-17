package board

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"unicode/utf8"
)

const MaximumBytes = 2 * 1024 * 1024

var nutrientKeys = []string{"calories", "protein", "carbs", "fat", "satFat", "fiber", "sugars", "sodium", "cholesterol"}
var meals = []string{"breakfast", "lunch", "dinner"}

type Food struct {
	ID        string              `json:"id"`
	Name      string              `json:"name"`
	Nutrients map[string]*float64 `json:"nutrients"`
	Notes     string              `json:"notes"`
}

type Board struct {
	Version int                 `json:"version"`
	Foods   []Food              `json:"foods"`
	Meals   map[string][]string `json:"meals"`
}

func Decode(data []byte) ([]byte, error) {
	if len(data) > MaximumBytes {
		return nil, errors.New("board exceeds 2 MiB")
	}
	var board Board
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&board); err != nil {
		return nil, fmt.Errorf("invalid JSON: %w", err)
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		return nil, errors.New("expected exactly one JSON object")
	}
	if err := Validate(board); err != nil {
		return nil, err
	}
	return json.Marshal(board)
}

func Validate(b Board) error {
	if b.Version != 1 || b.Foods == nil || b.Meals == nil {
		return errors.New("expected Wellspan version 1 with foods and meals")
	}
	if len(b.Foods) > 5000 {
		return errors.New("too many foods")
	}
	if len(b.Meals) != len(meals) {
		return errors.New("expected exactly breakfast, lunch and dinner")
	}
	ids := make(map[string]struct{}, len(b.Foods))
	names := make(map[string]struct{}, len(b.Foods))
	for _, f := range b.Foods {
		name := strings.TrimSpace(f.Name)
		if name == "" || utf8.RuneCountInString(name) > 100 || len(f.ID) == 0 || len(f.ID) > 150 {
			return errors.New("invalid food name or identifier")
		}
		if _, exists := ids[f.ID]; exists {
			return errors.New("duplicate food identifier")
		}
		folded := strings.ToLower(name)
		if _, exists := names[folded]; exists {
			return errors.New("duplicate food name")
		}
		ids[f.ID] = struct{}{}
		names[folded] = struct{}{}
		if utf8.RuneCountInString(f.Notes) > 2000 {
			return errors.New("food notes exceed limit")
		}
		if len(f.Nutrients) != len(nutrientKeys) {
			return errors.New("missing or extra nutrient keys")
		}
		for _, key := range nutrientKeys {
			value, exists := f.Nutrients[key]
			if !exists {
				return fmt.Errorf("missing nutrient %q", key)
			}
			if value != nil && (math.IsNaN(*value) || math.IsInf(*value, 0) || *value < 0 || *value > 1_000_000) {
				return fmt.Errorf("invalid nutrient %q", key)
			}
		}
	}
	for _, meal := range meals {
		entries, ok := b.Meals[meal]
		if !ok || entries == nil || len(entries) > 5000 {
			return fmt.Errorf("invalid meal %q", meal)
		}
		seen := make(map[string]struct{}, len(entries))
		for _, id := range entries {
			if _, exists := ids[id]; !exists {
				return fmt.Errorf("unknown food in %s", meal)
			}
			if _, exists := seen[id]; exists {
				return fmt.Errorf("duplicate food in %s", meal)
			}
			seen[id] = struct{}{}
		}
	}
	return nil
}
