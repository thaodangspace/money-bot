package sheets

import (
	"errors"
	"testing"

	"google.golang.org/api/googleapi"
)

func TestMapValuesErrorMissingSheet(t *testing.T) {
	err := mapValuesError(&googleapi.Error{Code: 400, Message: "Unable to parse range: 2026-07!A:D"})
	if !errors.Is(err, ErrSheetNotFound) {
		t.Fatalf("mapValuesError() = %v, want ErrSheetNotFound", err)
	}
}

func TestMapValuesErrorPreservesOtherErrors(t *testing.T) {
	input := &googleapi.Error{Code: 403, Message: "denied"}
	if got := mapValuesError(input); got != input {
		t.Fatalf("mapValuesError() = %v, want original", got)
	}
}
