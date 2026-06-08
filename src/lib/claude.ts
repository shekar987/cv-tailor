import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Models: haiku for cheap dev/testing, sonnet for production quality
export const MODELS = {
  fast: "claude-haiku-4-5-20251001",
  quality: "claude-sonnet-4-6",
};

type CallOptions = {
  system: string;       // the prompt/instructions for this step
  userInput: string;    // the input (JD, previous step output, etc.)
  model?: string;       // defaults to fast
  maxTokens?: number;   // defaults to 2000
  expectJson?: boolean; // if true, strip fences + validate JSON
};

/**
 * Calls Claude with a system prompt and user input.
 * Returns clean text, or parsed JSON if expectJson is true.
 */
export async function callClaude(options: CallOptions) {
  const {
    system,
    userInput,
    model = MODELS.fast,
    maxTokens = 2000,
    expectJson = false,
  } = options;

  const message = await anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: userInput }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  let text = textBlock && "text" in textBlock ? textBlock.text : "";

  // Always strip markdown fences defensively
  text = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  if (expectJson) {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Model returned invalid JSON: " + text.slice(0, 200));
    }
  }

  return text;
}