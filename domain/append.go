package domain

type AppendStatus string

const (
	AppendWritten   AppendStatus = "written"
	AppendDuplicate AppendStatus = "duplicate"
)

type AppendBatchResult struct {
	Status      AppendStatus
	TargetSheet string
}

func (r AppendBatchResult) Written() bool   { return r.Status == AppendWritten }
func (r AppendBatchResult) Duplicate() bool { return r.Status == AppendDuplicate }
