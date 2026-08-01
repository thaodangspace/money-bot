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

	"github.com/thaodangspace/money-bot/domain"
	"github.com/thaodangspace/money-bot/parser"
)

const (
	pendingImageTTL = 10 * time.Minute
	maxPendingImage = 16
)

type pendingImage struct {
	tx         domain.Transaction
	updateID   int
	expiresAt  time.Time
	confirming bool
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
	appendResult, err := s.ledger.AppendTransaction(ctx, tx)
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
	tx, err := s.ai.ParseImageTransaction(ctx, input.Caption, input.MIMEType, input.Data)
	if err != nil {
		return ImagePreparation{Text: "❌ Mình chưa đọc được giao dịch rõ ràng từ ảnh. Vui lòng gửi ảnh đầy đủ, rõ nét hoặc thêm chú thích."}, err
	}
	if err := tx.Validate(); err != nil {
		return ImagePreparation{Text: "❌ Mình chưa xác định được giao dịch hợp lệ từ ảnh. Vui lòng gửi ảnh rõ hơn."}, err
	}

	now := s.clock.Now()
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
	s.pendingImages[token] = pendingImage{tx: tx, updateID: updateID, expiresAt: now.Add(pendingImageTTL)}
	return ImagePreparation{Text: imagePreviewText(tx), Token: token}, nil
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

	tx := pending.tx
	tx.Date = now.In(s.location)
	tx.SourceUpdateID = pending.updateID
	appendResult, err := s.ledger.AppendTransaction(ctx, tx)
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
		return Result{Parsed: true, Duplicate: true, Text: duplicateText(tx)}, nil
	}
	return Result{Parsed: true, Text: successText(tx, false)}, nil
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
