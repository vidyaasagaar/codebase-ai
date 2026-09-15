// Minimal provider abstraction over any OpenAI-compatible Chat Completions endpoint
// (OpenRouter, Gemini, Groq, OpenAI, Ollama, ...). Configure via .env.local.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function llmConfigured() {
  return Boolean(process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL);
}

export function llmModelName() {
  return process.env.LLM_MODEL ?? "not configured";
}

export async function* streamChat(messages: ChatMessage[]): AsyncGenerator<string> {
  const base = process.env.LLM_BASE_URL!.replace(/\/$/, "");
  // OpenRouter-only: LLM_FALLBACK_MODELS="a,b" → automatic fallback when the primary model errors or is rate limited.
  const fallbacks = (process.env.LLM_FALLBACK_MODELS ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LLM_API_KEY}`,
      "X-Title": "Codebase AI",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      ...(fallbacks.length ? { models: [process.env.LLM_MODEL, ...fallbacks] } : {}),
      messages,
      stream: true,
      temperature: 0.1,
      max_tokens: Number(process.env.LLM_MAX_TOKENS) || 2000,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        if (json.error) throw new Error(`LLM stream error: ${json.error.message ?? JSON.stringify(json.error)}`);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("LLM stream error")) throw err;
        // partial / keep-alive line
      }
    }
  }
}
