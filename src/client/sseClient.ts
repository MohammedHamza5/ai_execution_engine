export async function* parseSSEStream<T>(response: Response): AsyncGenerator<T, void, unknown> {
  if (!response.body) {
    throw new Error("SSE Stream response has no readable body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;

        if (trimmed.startsWith("data:")) {
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === "[DONE]") {
            return;
          }
          try {
            const parsed = JSON.parse(dataStr) as T;
            yield parsed;
          } catch {
            // Non-JSON SSE payload yielded as raw string if compatible
            yield dataStr as unknown as T;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
