// The assistant consumes this small provider interface. Additional providers can
// implement configured() and structuredReply() without changing scenario rules.
export const openAiProvider = {
  name: "OpenAI Responses API",
  configured() {
    return Boolean(process.env.OPENAI_API_KEY?.trim() && !process.env.OPENAI_API_KEY.startsWith("your_"));
  },
  async structuredReply({ instructions, input, schema }) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(25_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL?.trim() || "gpt-5-mini", instructions, input,
        text: { format: { type: "json_schema", name: "airspace_assistant", strict: true, schema } },
        max_output_tokens: 900, store: false,
      }),
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 ? "The AI key was rejected. Check OPENAI_API_KEY in the server environment."
        : response.status === 429 ? "The AI provider is rate limited. Try again later."
          : "The AI provider is unavailable or this model is inaccessible. Check OPENAI_MODEL and your provider account.");
      error.providerStatus = response.status;
      throw error;
    }
    return response.json();
  },
};
