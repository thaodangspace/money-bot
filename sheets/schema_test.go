package sheets

import (
	"reflect"
	"testing"
	"time"
)

func TestMonthSheetAndQuoteSheet(t *testing.T) {
	if got := monthSheet(2026, time.July); got != "2026-07" {
		t.Fatalf("monthSheet() = %q", got)
	}
	if got := quoteSheet("Bob's Ledger"); got != "'Bob''s Ledger'" {
		t.Fatalf("quoteSheet() = %q", got)
	}
}

func TestMetadataHeadersAreVersioned(t *testing.T) {
	want := []string{"Schema Version", "Update ID", "Processed At", "Target Sheet", "Outcome"}
	if !reflect.DeepEqual(MetadataHeaders, want) {
		t.Fatalf("MetadataHeaders = %#v", MetadataHeaders)
	}
	if MetadataSchemaVersion != "1" {
		t.Fatalf("MetadataSchemaVersion = %q", MetadataSchemaVersion)
	}
}
