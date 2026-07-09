package money

import "testing"

func TestParseAndDecimal(t *testing.T) {
	cases := []struct {
		in    string
		minor Money
		dec   string
	}{
		{"9000000.00", 900000000, "9000000.00"},
		{"6000000.00", 600000000, "6000000.00"},
		{"6900000.00", 690000000, "6900000.00"},
		{"20000000", 2000000000, "20000000.00"},
		{"0", 0, "0.00"},
		{"0.5", 50, "0.50"},
		{"1234567.89", 123456789, "1234567.89"},
		{"-45000000.00", -4500000000, "-45000000.00"},
	}
	for _, c := range cases {
		got, err := Parse(c.in)
		if err != nil {
			t.Fatalf("Parse(%q) error: %v", c.in, err)
		}
		if got != c.minor {
			t.Errorf("Parse(%q) = %d, want %d", c.in, got, c.minor)
		}
		if d := got.Decimal(); d != c.dec {
			t.Errorf("Decimal(%q) = %q, want %q", c.in, d, c.dec)
		}
	}
}

func TestParseRejects(t *testing.T) {
	// Includes bare sign/dot strings that must NOT silently parse as 0.
	for _, in := range []string{"", "abc", "1.234", "1..2", "1,000", "Rp5", "-", "+", ".", "-.", "+."} {
		if _, err := Parse(in); err == nil {
			t.Errorf("Parse(%q) should have failed", in)
		}
	}
}

func TestFormat(t *testing.T) {
	cases := []struct {
		minor Money
		want  string
	}{
		{900000000, "Rp. 9.000.000,00"},
		{690000000, "Rp. 6.900.000,00"},
		{2190000000, "Rp. 21.900.000,00"}, // Alpha Digital deal total
		{4500000000, "Rp. 45.000.000,00"},
		{50000000, "Rp. 500.000,00"},
		{0, "Rp. 0,00"},
		{100000, "Rp. 1.000,00"},
		{99900000, "Rp. 999.000,00"},
		{-4500000000, "-Rp. 45.000.000,00"},
	}
	for _, c := range cases {
		if got := c.minor.Format(); got != c.want {
			t.Errorf("Format(%d) = %q, want %q", c.minor, got, c.want)
		}
	}
}

func TestPercentOf(t *testing.T) {
	rp := func(s string) Money { m, _ := Parse(s); return m }
	cases := []struct {
		name  string
		base  Money
		num   int64
		scale int
		want  Money
	}{
		{"5% of 9.000.000", rp("9000000.00"), 5, 0, rp("450000.00")},
		{"4% of 7.500.000", rp("7500000.00"), 4, 0, rp("300000.00")},
		{"2.5% of 1.000.000", rp("1000000.00"), 25, 1, rp("25000.00")},
		{"10% of 21.900.000", rp("21900000.00"), 10, 0, rp("2190000.00")},
		// Half-up rounding to whole rupiah: 1% of 12.345.678 = 123456.78 -> 123457.
		{"1% of 12.345.678 rounds half-up", rp("12345678.00"), 1, 0, rp("123457.00")},
		// Exactly .5 rounds away from zero: 0.5% of 12.345.700 = 61728.5 -> 61729.
		{"0.5 rounds up", rp("12345700.00"), 5, 1, rp("61729.00")},
	}
	for _, c := range cases {
		got, err := PercentOf(c.base, c.num, c.scale)
		if err != nil {
			t.Errorf("%s: PercentOf error: %v", c.name, err)
			continue
		}
		if got != c.want {
			t.Errorf("%s: PercentOf = %s, want %s", c.name, got.Format(), c.want.Format())
		}
	}
}

func TestPercentOfOverflow(t *testing.T) {
	// An absurd percentage whose result cannot fit int64 minor units must error,
	// not silently wrap to a negative amount.
	base, _ := Parse("9999999999999.99")
	if _, err := PercentOf(base, 9000000000000000000, 0); err == nil {
		t.Error("PercentOf with overflowing result should return an error")
	}
}
