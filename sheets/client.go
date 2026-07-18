package sheets

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"google.golang.org/api/googleapi"
	"google.golang.org/api/option"
	gsheets "google.golang.org/api/sheets/v4"
)

type Client struct {
	service *gsheets.Service
}

func NewClient(ctx context.Context, _ time.Duration, opts ...option.ClientOption) (*Client, error) {
	// Request deadlines are supplied by caller contexts. Do not install a raw
	// option.WithHTTPClient here, because that can override Google auth options
	// and accidentally create an unauthenticated service.
	service, err := gsheets.NewService(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("create google sheets service: %w", err)
	}
	return &Client{service: service}, nil
}

func (c *Client) GetSpreadsheet(ctx context.Context, spreadsheetID string) (Spreadsheet, error) {
	out, err := c.service.Spreadsheets.Get(spreadsheetID).IncludeGridData(false).Context(ctx).Do()
	if err != nil {
		return Spreadsheet{}, err
	}
	spreadsheet := Spreadsheet{Sheets: make([]Sheet, 0, len(out.Sheets))}
	for _, sheet := range out.Sheets {
		if sheet == nil || sheet.Properties == nil {
			continue
		}
		spreadsheet.Sheets = append(spreadsheet.Sheets, Sheet{ID: sheet.Properties.SheetId, Title: sheet.Properties.Title, Hidden: sheet.Properties.Hidden})
	}
	return spreadsheet, nil
}

func (c *Client) GetValues(ctx context.Context, spreadsheetID, readRange string) ([][]string, error) {
	out, err := c.service.Spreadsheets.Values.Get(spreadsheetID, readRange).Context(ctx).Do()
	if err != nil {
		return nil, mapValuesError(err)
	}
	rows := make([][]string, 0, len(out.Values))
	for _, row := range out.Values {
		converted := make([]string, len(row))
		for i, value := range row {
			converted[i] = fmt.Sprint(value)
		}
		rows = append(rows, converted)
	}
	return rows, nil
}

func mapValuesError(err error) error {
	var googleErr *googleapi.Error
	if errors.As(err, &googleErr) && googleErr.Code == httpStatusBadRequest && strings.Contains(strings.ToLower(googleErr.Message), "unable to parse range") {
		return ErrSheetNotFound
	}
	return err
}

const httpStatusBadRequest = 400

func (c *Client) BatchUpdate(ctx context.Context, spreadsheetID string, req BatchUpdateRequest) error {
	googleReq := &gsheets.BatchUpdateSpreadsheetRequest{Requests: make([]*gsheets.Request, 0, len(req.Requests))}
	for _, request := range req.Requests {
		googleReq.Requests = append(googleReq.Requests, toGoogleRequest(request))
	}
	_, err := c.service.Spreadsheets.BatchUpdate(spreadsheetID, googleReq).Context(ctx).Do()
	return err
}

func toGoogleRequest(request Request) *gsheets.Request {
	if request.AddSheet != nil {
		return &gsheets.Request{AddSheet: &gsheets.AddSheetRequest{Properties: &gsheets.SheetProperties{Title: request.AddSheet.Title, Hidden: request.AddSheet.Hidden}}}
	}
	if request.UpdateSheetProperties != nil {
		return &gsheets.Request{UpdateSheetProperties: &gsheets.UpdateSheetPropertiesRequest{Properties: &gsheets.SheetProperties{SheetId: request.UpdateSheetProperties.SheetID, Hidden: request.UpdateSheetProperties.Hidden}, Fields: "hidden"}}
	}
	if request.AppendCells != nil {
		return &gsheets.Request{AppendCells: &gsheets.AppendCellsRequest{SheetId: request.AppendCells.SheetID, Rows: toRows(request.AppendCells.Values), Fields: "userEnteredValue"}}
	}
	return &gsheets.Request{}
}

func toRows(values [][]string) []*gsheets.RowData {
	rows := make([]*gsheets.RowData, 0, len(values))
	for _, row := range values {
		cells := make([]*gsheets.CellData, 0, len(row))
		for _, value := range row {
			cells = append(cells, &gsheets.CellData{UserEnteredValue: &gsheets.ExtendedValue{StringValue: &value}})
		}
		rows = append(rows, &gsheets.RowData{Values: cells})
	}
	return rows
}
