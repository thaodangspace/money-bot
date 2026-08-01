package telegram

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeFileURLer struct {
	url   string
	err   error
	calls int
}

func (f *fakeFileURLer) GetFileDirectURL(string) (string, error) {
	f.calls++
	return f.url, f.err
}

func TestDetectImageMIME(t *testing.T) {
	for _, test := range []struct {
		name string
		data []byte
		want string
	}{
		{"jpeg", []byte{0xff, 0xd8, 0xff, 0x00}, "image/jpeg"},
		{"png", []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}, "image/png"},
		{"webp", []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), "image/webp"},
		{"gif", []byte("GIF89a"), ""},
		{"pdf", []byte("%PDF-1.7"), ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := DetectImageMIME(test.data)
			if got != test.want || ok != (test.want != "") {
				t.Fatalf("DetectImageMIME() = %q, %v", got, ok)
			}
		})
	}
}

func TestTelegramImageFetcherFetchesVerifiedBoundedImage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Context().Err() != nil {
			t.Fatal("request context unexpectedly cancelled")
		}
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write([]byte{0xff, 0xd8, 0xff, 0x00})
	}))
	defer server.Close()
	urler := &fakeFileURLer{url: server.URL}
	fetcher, err := NewTelegramImageFetcher(urler, server.Client(), 5)
	if err != nil {
		t.Fatal(err)
	}
	image, err := fetcher.FetchImage(context.Background(), ImageReference{FileID: "file", DeclaredMIME: "application/pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if urler.calls != 1 || image.MIMEType != "image/jpeg" || len(image.Data) != 4 {
		t.Fatalf("calls=%d image=%#v", urler.calls, image)
	}
}

func TestTelegramImageFetcherRejectsOversizeBeforeURLLookupAndWhileReading(t *testing.T) {
	urler := &fakeFileURLer{url: "http://unused"}
	fetcher, err := NewTelegramImageFetcher(urler, http.DefaultClient, 3)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fetcher.FetchImage(context.Background(), ImageReference{FileID: "file", DeclaredSize: 4})
	if !errors.Is(err, ErrImageTooLarge) || urler.calls != 0 {
		t.Fatalf("error=%v URL calls=%d", err, urler.calls)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte{0xff, 0xd8, 0xff, 0x00})
	}))
	defer server.Close()
	fetcher, err = NewTelegramImageFetcher(&fakeFileURLer{url: server.URL}, server.Client(), 3)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fetcher.FetchImage(context.Background(), ImageReference{FileID: "file"})
	if !errors.Is(err, ErrImageTooLarge) {
		t.Fatalf("FetchImage() error=%v", err)
	}
}

func TestTelegramImageFetcherRejectsBadStatusAndUnsupportedBytes(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   []byte
		want   error
	}{
		{"status", http.StatusBadGateway, nil, nil},
		{"gif", http.StatusOK, []byte("GIF89a"), ErrUnsupportedImage},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = w.Write(test.body)
			}))
			defer server.Close()
			fetcher, err := NewTelegramImageFetcher(&fakeFileURLer{url: server.URL}, server.Client(), 100)
			if err != nil {
				t.Fatal(err)
			}
			_, err = fetcher.FetchImage(context.Background(), ImageReference{FileID: "file"})
			if err == nil || (test.want != nil && !errors.Is(err, test.want)) {
				t.Fatalf("FetchImage() error=%v", err)
			}
		})
	}
}

func TestTelegramImageFetcherRedactsTokenBearingFailures(t *testing.T) {
	const secret = "123:telegram-secret"
	fetcher, err := NewTelegramImageFetcher(&fakeFileURLer{err: errors.New("https://api.telegram.org/file/bot" + secret + "/receipt")}, http.DefaultClient, 100)
	if err != nil {
		t.Fatal(err)
	}
	_, err = fetcher.FetchImage(context.Background(), ImageReference{FileID: "file"})
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked token: %v", err)
	}
}
