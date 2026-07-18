package sheets

import "errors"

type AmbiguousError struct {
	Err error
}

func (e AmbiguousError) Error() string {
	if e.Err == nil {
		return "ambiguous sheets write"
	}
	return "ambiguous sheets write: " + e.Err.Error()
}

func (e AmbiguousError) Unwrap() error { return e.Err }

func IsAmbiguous(err error) bool {
	var ambiguous AmbiguousError
	return errors.As(err, &ambiguous)
}
