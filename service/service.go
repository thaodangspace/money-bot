package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/thaodangspace/money-bot/ai"
	"github.com/thaodangspace/money-bot/domain"
	"github.com/thaodangspace/money-bot/parser"
)

const (
	pendingImageTTL  = 10 * time.Minute
	maxPendingImage  = 16
	maxImageDateSkew = 48 * time.Hour
)

type pendingImage struct {
	transactions []domain.Transaction
	updateID     int
	expiresAt    time.Time
	confirming   bool
}

type Service struct {
	location *time.Location
	clock    Clock
	ledger   Ledger
	ai       AIParser
	comments Commentator

	pendingMu     sync.Mutex
	pendingImages map[string]pendingImage
}

func New(opts Options) (*Service, error) {
	if opts.Ledger == nil {
		return nil, errors.New("ledger is required")
	}
	if opts.AI == nil {
		return nil, errors.New("ai parser is required")
	}
	loc := opts.Location
	if loc == nil {
		loc = time.UTC
	}
	clock := opts.Clock
	if clock == nil {
		clock = ClockFunc(time.Now)
	}
	return &Service{location: loc, clock: clock, ledger: opts.Ledger, ai: opts.AI, comments: opts.Comments, pendingImages: make(map[string]pendingImage)}, nil
}

func (s *Service) IsSummaryIntent(text string) bool {
	return parser.DetectMonthlySummaryIntent(text)
}

func (s *Service) Record(ctx context.Context, updateID int, text string) (Result, error) {
	if updateID <= 0 {
		return Result{Text: "❌ Không thể lưu giao dịch vì thiếu mã cập nhật Telegram. Vui lòng thử lại."}, fmt.Errorf("telegram update ID is required")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return Result{Text: usageText()}, nil
	}
	now := s.clock.Now().In(s.location)
	tx, usedAI, ok := s.parseTransaction(ctx, text)
	if !ok {
		return Result{Text: usageText()}, nil
	}
	tx.Date = now
	tx.SourceUpdateID = updateID
	tx.OriginalMessage = text
	appendResult, err := s.appendTransactions(ctx, updateID, []domain.Transaction{tx})
	if err != nil {
		return Result{Parsed: true, UsedAI: usedAI, Text: "❌ Không lưu được giao dịch vào Google Sheet. Vui lòng thử lại sau."}, err
	}
	if appendResult.Status == AppendDuplicate {
		return Result{Parsed: true, UsedAI: usedAI, Duplicate: true, Text: duplicateText(tx)}, nil
	}
	out := successText(tx, usedAI)
	if s.comments != nil {
		if comment, err := s.comments.Confirmation(ctx, tx, usedAI); err == nil && strings.TrimSpace(comment) != "" {
			out += "\n" + boundText(strings.TrimSpace(comment), 240)
		}
	}
	return Result{Parsed: true, UsedAI: usedAI, Text: out}, nil
}

func (s *Service) PrepareImage(ctx context.Context, updateID int, input ImageInput) (ImagePreparation, error) {
	if updateID <= 0 {
		return ImagePreparation{Text: "❌ Không thể xử lý ảnh vì thiếu mã cập nhật Telegram. Vui lòng gửi lại ảnh."}, errors.New("telegram update ID is required")
	}
	if strings.TrimSpace(input.MIMEType) == "" || len(input.Data) == 0 {
		return ImagePreparation{Text: "❌ Ảnh không hợp lệ. Vui lòng gửi JPEG, PNG hoặc WebP rõ nét."}, errors.New("image input is required")
	}
	extraction, err := s.parseImageTransactions(ctx, input)
	if err != nil {
		return ImagePreparation{Text: "❌ Mình chưa đọc được giao dịch rõ ràng từ ảnh. Vui lòng gửi ảnh đầy đủ, rõ nét hoặc thêm chú thích."}, err
	}
	now := s.clock.Now().In(s.location)
	transactions := append([]domain.Transaction(nil), extraction.Transactions...)
	for i := range transactions {
		if transactions[i].Date.IsZero() {
			transactions[i].Date = now
		} else {
			transactions[i].Date = transactions[i].Date.In(s.location)
		}
	}
	extraction.Transactions = transactions
	if err := validateImageExtraction(extraction, now); err != nil {
		return ImagePreparation{Text: "❌ Ảnh có giao dịch chưa rõ hoặc chưa đọc đủ. Vui lòng gửi ảnh rõ hơn, cắt ảnh hoặc tách thành nhiều ảnh."}, err
	}
	for i := range transactions {
		transactions[i].SourceUpdateID = updateID
		transactions[i].OriginalMessage = ""
	}

	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	s.evictExpiredLocked(now)
	if len(s.pendingImages) >= maxPendingImage {
		return ImagePreparation{Text: "❌ Bạn đang có quá nhiều giao dịch ảnh chờ xác nhận. Hãy xác nhận hoặc hủy các mục trước."}, errors.New("pending image capacity reached")
	}
	token, err := newPendingToken()
	if err != nil {
		return ImagePreparation{Text: "❌ Không thể tạo xác nhận cho ảnh. Vui lòng gửi lại."}, err
	}
	s.pendingImages[token] = pendingImage{transactions: transactions, updateID: updateID, expiresAt: now.Add(pendingImageTTL)}
	return ImagePreparation{Text: imagePreviewTextBatch(transactions), Token: token}, nil
}

func (s *Service) ConfirmImage(ctx context.Context, token string) (Result, error) {
	now := s.clock.Now()
	s.pendingMu.Lock()
	s.evictExpiredLocked(now)
	pending, ok := s.pendingImages[token]
	if !ok || pending.confirming {
		s.pendingMu.Unlock()
		return Result{Text: imageConfirmationUnavailableText()}, nil
	}
	pending.confirming = true
	s.pendingImages[token] = pending
	s.pendingMu.Unlock()

	transactions := append([]domain.Transaction(nil), pending.transactions...)
	var appendResult AppendBatchResult
	var err error
	if ledger, ok := s.ledger.(batchLedger); ok {
		appendResult, err = ledger.AppendTransactions(ctx, pending.updateID, transactions)
	} else if ledger, ok := s.ledger.(singleLedger); ok && len(transactions) == 1 {
		appendResult, err = ledger.AppendTransaction(ctx, transactions[0])
	} else {
		err = errors.New("ledger does not support image batch append")
	}
	if err != nil {
		s.pendingMu.Lock()
		if current, exists := s.pendingImages[token]; exists {
			current.confirming = false
			s.pendingImages[token] = current
		}
		s.pendingMu.Unlock()
		return Result{Parsed: true, Text: "❌ Không lưu được giao dịch vào Google Sheet. Bạn có thể bấm xác nhận lại."}, err
	}

	if appendResult.Status != AppendWritten && appendResult.Status != AppendDuplicate {
		s.pendingMu.Lock()
		if current, exists := s.pendingImages[token]; exists {
			current.confirming = false
			s.pendingImages[token] = current
		}
		s.pendingMu.Unlock()
		return Result{Parsed: true, Text: "❌ Không xác nhận được kết quả lưu giao dịch. Bạn có thể bấm xác nhận lại."}, fmt.Errorf("unexpected append status %q", appendResult.Status)
	}
	s.pendingMu.Lock()
	delete(s.pendingImages, token)
	s.pendingMu.Unlock()
	if appendResult.Status == AppendDuplicate {
		return Result{Parsed: true, Duplicate: true, Text: duplicateBatchText(transactions)}, nil
	}
	return Result{Parsed: true, Text: successBatchText(transactions)}, nil
}

func (s *Service) CancelImage(token string) Result {
	s.pendingMu.Lock()
	defer s.pendingMu.Unlock()
	s.evictExpiredLocked(s.clock.Now())
	if _, ok := s.pendingImages[token]; !ok {
		return Result{Text: imageConfirmationUnavailableText()}
	}
	delete(s.pendingImages, token)
	return Result{Text: "✅ Đã hủy giao dịch từ ảnh."}
}

func (s *Service) evictExpiredLocked(now time.Time) {
	for token, pending := range s.pendingImages {
		if !pending.expiresAt.After(now) {
			delete(s.pendingImages, token)
		}
	}
}

func newPendingToken() (string, error) {
	bytes := make([]byte, 18)
	if _, err := rand.Read(bytes); err != nil {
		return "", fmt.Errorf("generate pending image token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}

func (s *Service) appendTransactions(ctx context.Context, updateID int, transactions []domain.Transaction) (AppendBatchResult, error) {
	if ledger, ok := s.ledger.(batchLedger); ok {
		return ledger.AppendTransactions(ctx, updateID, transactions)
	}
	if ledger, ok := s.ledger.(singleLedger); ok && len(transactions) == 1 {
		return ledger.AppendTransaction(ctx, transactions[0])
	}
	return AppendBatchResult{}, errors.New("ledger does not support transaction append")
}

func (s *Service) parseImageTransactions(ctx context.Context, input ImageInput) (ai.ImageTransactionExtraction, error) {
	if parser, ok := s.ai.(imageBatchParser); ok {
		return parser.ParseImageTransactions(ctx, input.Caption, input.MIMEType, input.Data)
	}
	if parser, ok := s.ai.(imageSingleParser); ok {
		tx, err := parser.ParseImageTransaction(ctx, input.Caption, input.MIMEType, input.Data)
		if err != nil {
			return ai.ImageTransactionExtraction{}, err
		}
		return ai.ImageTransactionExtraction{Kind: ai.ImageExtractionSingleReceipt, Detected: 1, Transactions: []domain.Transaction{tx}}, nil
	}
	return ai.ImageTransactionExtraction{}, errors.New("ai does not support image parsing")
}

func validateImageExtraction(extraction ai.ImageTransactionExtraction, now time.Time) error {
	if extraction.Detected <= 0 || extraction.Detected > ai.MaxImageTransactions || len(extraction.Transactions) == 0 || len(extraction.Transactions) > ai.MaxImageTransactions {
		return errors.New("invalid image extraction count")
	}
	switch extraction.Kind {
	case ai.ImageExtractionSingleReceipt, ai.ImageExtractionSingleTransfer:
		if extraction.Detected != 1 || len(extraction.Transactions) != 1 {
			return errors.New("invalid single image extraction")
		}
	case ai.ImageExtractionList:
		if extraction.Detected != len(extraction.Transactions) {
			return errors.New("incomplete image transaction list")
		}
	default:
		return errors.New("invalid image extraction kind")
	}
	seen := make(map[string]struct{}, len(extraction.Transactions))
	for _, tx := range extraction.Transactions {
		if err := tx.Validate(); err != nil {
			return err
		}
		if !tx.Date.IsZero() && tx.Date.After(now.Add(maxImageDateSkew)) {
			return errors.New("image transaction date is in the future")
		}
		key := fmt.Sprintf("%s\\x00%s\\x00%d\\x00%s\\x00%s", tx.Type, tx.Category, tx.Amount, tx.Note, tx.Date.Format("2006-01-02"))
		if _, ok := seen[key]; ok {
			return errors.New("duplicate image transaction")
		}
		seen[key] = struct{}{}
	}
	return nil
}

func (s *Service) parseTransaction(ctx context.Context, text string) (domain.Transaction, bool, bool) {
	if s.ai == nil {
		return domain.Transaction{}, false, false
	}
	tx, err := s.ai.ParseTransaction(ctx, text)
	if err != nil {
		return domain.Transaction{}, false, false
	}
	if err := tx.Validate(); err != nil {
		return domain.Transaction{}, false, false
	}
	return tx, true, true
}
