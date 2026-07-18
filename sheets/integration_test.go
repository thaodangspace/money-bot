package sheets

import (
	"os"
	"testing"
)

func TestIntegrationSheetsSkippedByDefault(t *testing.T) {
	if os.Getenv("MONEY_BOT_SHEETS_INTEGRATION") != "1" {
		t.Skip("set MONEY_BOT_SHEETS_INTEGRATION=1 with an explicit test spreadsheet to run live Sheets integration tests")
	}
	if os.Getenv("MONEY_BOT_TEST_SPREADSHEET_ID") == "" || os.Getenv("MONEY_BOT_CONFIRM_LIVE_SHEETS_WRITE") != "1" {
		t.Skip("live Sheets integration requires MONEY_BOT_TEST_SPREADSHEET_ID and MONEY_BOT_CONFIRM_LIVE_SHEETS_WRITE=1")
	}
	// Live write/read coverage will be added when operator-provided test credentials are available.
}
