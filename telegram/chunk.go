package telegram

const DefaultMaxMessageRunes = 3900

func ChunkText(text string, maxRunes int) []string {
	if maxRunes <= 0 {
		maxRunes = DefaultMaxMessageRunes
	}
	runes := []rune(text)
	if len(runes) == 0 {
		return nil
	}
	chunks := make([]string, 0, len(runes)/maxRunes+1)
	for len(runes) > 0 {
		n := maxRunes
		if len(runes) < n {
			n = len(runes)
		}
		chunks = append(chunks, string(runes[:n]))
		runes = runes[n:]
	}
	return chunks
}
