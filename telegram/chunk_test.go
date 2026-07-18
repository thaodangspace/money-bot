package telegram

import "testing"

func TestChunkTextRuneSafe(t *testing.T) {
	chunks := ChunkText("😀😀😀", 2)
	want := []string{"😀😀", "😀"}
	if len(chunks) != len(want) {
		t.Fatalf("chunks = %#v", chunks)
	}
	for i := range want {
		if chunks[i] != want[i] {
			t.Fatalf("chunks[%d] = %q, want %q", i, chunks[i], want[i])
		}
	}
}

func TestChunkTextEmpty(t *testing.T) {
	if got := ChunkText("", 10); got != nil {
		t.Fatalf("ChunkText(empty) = %#v", got)
	}
}
