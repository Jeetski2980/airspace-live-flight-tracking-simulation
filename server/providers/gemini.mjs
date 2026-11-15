// Gemini API credentials are server-only. Never rename this to a VITE_ variable.
export const geminiProvider = {
  name: "Google AI Studio · Gemini API",
  configured() {
    const key = process.env.GEMINI_API_KEY?.trim();
    return Boolean(key && !key.startsWith("your_"));
  },
  async structuredReply({ instructions, input, schema }) {
    const model = process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY.trim(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: input }] }],
        generationConfig: {
          responseFormat: { text: { mimeType: "application/json", schema } },
          maxOutputTokens: 900,
          temperature: 0.2,
        },
      }),
    });
    if (!response.ok) {
      const error = new Error(response.status === 401 || response.status === 403
        ? "Google AI Studio rejected the key. Check GEMINI_API_KEY and that the key can use the Gemini API."
        : response.status === 429
          ? "Google AI Studio is rate limited. Try again later or check your Gemini API quota."
          : response.status === 400 || response.status === 404
            ? "Google AI Studio rejected the model request. Check GEMINI_MODEL and model access."
            : "Google AI Studio is unavailable. Check the Gemini API status and try again.");
      error.providerStatus = response.status;
      throw error;
    }
    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.filter(part => typeof part.text === "string").map(part => part.text).join("");
    if (!text || candidate.finishReason === "SAFETY" || candidate.finishReason === "RECITATION") {
      throw new Error("Gemini did not return a usable structured response.");
    }
    return text;
  },
};
