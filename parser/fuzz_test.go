package parser

import "testing"

func FuzzParseAmount(f *testing.F) {
	for _, seed := range []string{"150k", "1,5tr", "2k5", "144tr300", "abc"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		amount, err := ParseAmount(input)
		if err == nil && amount <= 0 {
			t.Fatalf("ParseAmount(%q) = %d, nil error", input, amount)
		}
	})
}

func FuzzParseTransaction(f *testing.F) {
	for _, seed := range []string{"ăn tối 150k pizza", "thu lương 20tr", "bad"} {
		f.Add(seed)
	}
	f.Fuzz(func(t *testing.T, input string) {
		tx, err := ParseTransaction(input)
		if err == nil {
			if tx.Amount <= 0 || tx.Category == "" || !tx.Type.Valid() {
				t.Fatalf("ParseTransaction(%q) = %#v", input, tx)
			}
		}
	})
}
