/**
 * Minimal Server-Sent-Events line reader, shared by the claude/openai/gemini
 * adapters (all three stream SSE; only Ollama differs, using newline-
 * delimited JSON instead - see ollama.ts). Yields each event's `data:`
 * payload as a raw string; callers parse it as JSON themselves since the
 * three providers' payload shapes differ.
 */
export async function* readSseLines(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const payload = trimmed.slice(5).trim();
          if (payload && payload !== '[DONE]') yield payload;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
