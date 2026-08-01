package telegram

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
)

var (
	ErrImageTooLarge    = errors.New("telegram image exceeds size limit")
	ErrUnsupportedImage = errors.New("unsupported image content")
)

type TelegramFileURLer interface {
	GetFileDirectURL(fileID string) (string, error)
}

type FetchedImage struct {
	MIMEType string
	Data     []byte
}

type ImageFetcher interface {
	FetchImage(ctx context.Context, ref ImageReference) (FetchedImage, error)
}

type TelegramImageFetcher struct {
	urler TelegramFileURLer
	http  interface {
		Do(*http.Request) (*http.Response, error)
	}
	maxBytes int64
}

func NewTelegramImageFetcherForBot(bot TelegramFileURLer, maxBytes int64) (*TelegramImageFetcher, error) {
	return NewTelegramImageFetcher(bot, newTelegramHTTPClient(), maxBytes)
}

func NewTelegramImageFetcher(urler TelegramFileURLer, httpClient interface {
	Do(*http.Request) (*http.Response, error)
}, maxBytes int64) (*TelegramImageFetcher, error) {
	if urler == nil {
		return nil, errors.New("telegram file URLer is required")
	}
	if httpClient == nil {
		return nil, errors.New("telegram image HTTP client is required")
	}
	if maxBytes <= 0 {
		return nil, errors.New("telegram image size limit must be positive")
	}
	return &TelegramImageFetcher{urler: urler, http: httpClient, maxBytes: maxBytes}, nil
}

func (f *TelegramImageFetcher) FetchImage(ctx context.Context, ref ImageReference) (FetchedImage, error) {
	if f == nil || f.urler == nil || f.http == nil {
		return FetchedImage{}, errors.New("telegram image fetcher unavailable")
	}
	if ref.FileID == "" {
		return FetchedImage{}, errors.New("telegram image file ID is required")
	}
	if ref.DeclaredSize > f.maxBytes {
		return FetchedImage{}, ErrImageTooLarge
	}
	url, err := f.urler.GetFileDirectURL(ref.FileID)
	if err != nil {
		return FetchedImage{}, errors.New("resolve telegram image failed")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return FetchedImage{}, errors.New("create telegram image download request failed")
	}
	resp, err := f.http.Do(req)
	if err != nil {
		return FetchedImage{}, errors.New("download telegram image failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return FetchedImage{}, fmt.Errorf("telegram image download returned HTTP status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, f.maxBytes+1))
	if err != nil {
		return FetchedImage{}, errors.New("read telegram image failed")
	}
	if int64(len(data)) > f.maxBytes {
		return FetchedImage{}, ErrImageTooLarge
	}
	mimeType, ok := DetectImageMIME(data)
	if !ok {
		return FetchedImage{}, ErrUnsupportedImage
	}
	return FetchedImage{MIMEType: mimeType, Data: data}, nil
}

func DetectImageMIME(data []byte) (string, bool) {
	switch http.DetectContentType(data) {
	case "image/jpeg":
		return "image/jpeg", true
	case "image/png":
		return "image/png", true
	}
	if len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP")) {
		return "image/webp", true
	}
	return "", false
}
