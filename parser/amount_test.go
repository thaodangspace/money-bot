package parser

import "testing"

func TestParseAmountValid(t *testing.T) {
	tests := map[string]int64{
		"150000":    150000,
		"150.000":   150000,
		"150,000":   150000,
		"150k":      150000,
		"150K":      150000,
		"1,5tr":     1500000,
		"1.5tr":     1500000,
		"1.25m":     1250000,
		"2k5":       2500,
		"2k05":      2050,
		"144tr300":  144300000,
		"20tr":      20000000,
		"1.000đ":    1000,
		"1,000d":    1000,
		"1.500k":    1500000,
		"999999999": 999999999,
		" 150 k ":   150000,
	}
	for input, want := range tests {
		got, err := ParseAmount(input)
		if err != nil {
			t.Fatalf("ParseAmount(%q) error = %v", input, err)
		}
		if got != want {
			t.Fatalf("ParseAmount(%q) = %d, want %d", input, got, want)
		}
	}
}

func TestParseAmountInvalid(t *testing.T) {
	for _, input := range []string{
		"", "0", "-1", "abc", "1,,000", "1.000,000", "1,5", "1,5đ", "2d5", "2k1234", "999999999999999999999999tr",
	} {
		if got, err := ParseAmount(input); err == nil {
			t.Fatalf("ParseAmount(%q) = %d, nil error", input, got)
		}
	}
}
