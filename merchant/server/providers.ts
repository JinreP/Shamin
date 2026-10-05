import "server-only";
import { GoogleGenAI, type GenerateContentConfig } from "@google/genai";
import type { MerchantEnv } from "./env";
import { z } from "zod";
export interface AIRequest {
  prompt: string;
  systemInstruction?: string;
  signal?: AbortSignal;
  responseMimeType?: "text/plain" | "application/json";
  responseJsonSchema?: unknown;
}
export interface AIResponse {
  text: string;
  provider: string;
  model: string;
}
export interface AIProvider {
  generate(request: AIRequest): Promise<AIResponse>;
}
export type GeminiGenerate = (request: AIRequest) => Promise<{ text?: string }>;
export type GeminiStructuredOutputMode = "json" | "schema";
export function geminiGenerateConfig(
  request: AIRequest,
  mode: GeminiStructuredOutputMode = "json",
): GenerateContentConfig {
  // The official SDK converts portable JSON-schema types to its native Schema
  // representation (including nullable:true). Use that documented conversion path;
  // responseJsonSchema bypasses it and the deployed model rejected our quote schema.
  return {
    systemInstruction: request.systemInstruction,
    abortSignal: request.signal,
    responseMimeType: request.responseMimeType,
    responseSchema: mode === "schema" ? request.responseJsonSchema : undefined,
    httpOptions: { timeout: 30000 },
  };
}
export function geminiPrompt(
  request: AIRequest,
  mode: GeminiStructuredOutputMode = "json",
): string {
  // Explicit JSON MIME compatibility mode avoids the deployed model's full-schema
  // HTTP 400. This is syntax-constrained JSON, with complete schema validation in Zod.
  // It does not claim the upstream model enforces every schema rule.
  return mode === "json" && request.responseJsonSchema
    ? `${request.prompt}\n\nХариуны JSON бүтэц. Бүх шаардлагатай талбарыг өг; дутуу утга null:\n${JSON.stringify(request.responseJsonSchema)}`
    : request.prompt;
}
export class GeminiProvider implements AIProvider {
  private readonly generateContent: GeminiGenerate;
  constructor(
    apiKey: string,
    private readonly model: string,
    generate?: GeminiGenerate,
    private readonly structuredOutputMode: GeminiStructuredOutputMode = "json",
  ) {
    if (!apiKey.trim() || !model.trim())
      throw new Error("Gemini credentials and model are required");
    const client = generate ? undefined : new GoogleGenAI({ apiKey });
    this.generateContent =
      generate ??
      ((request) =>
        client!.models.generateContent({
          model,
          contents: geminiPrompt(request, this.structuredOutputMode),
          config: geminiGenerateConfig(request, this.structuredOutputMode),
        }));
  }
  async generate(request: AIRequest): Promise<AIResponse> {
    if (!request.prompt.trim()) throw new Error("Prompt is required");
    request.signal?.throwIfAborted();
    const result = await this.generateContent(request);
    if (!result.text?.trim()) throw new Error("Gemini returned no text");
    return { text: result.text, provider: "gemini", model: this.model };
  }
}
export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`${provider} integration requires documented API and credentials`);
    this.name = "ProviderNotConfiguredError";
  }
}
export class OyuLLMProvider implements AIProvider {
  constructor(private readonly apiKey = process.env.OYU_API_KEY ?? "") {}

  async generate(request: AIRequest): Promise<AIResponse> {
    if (!this.apiKey.trim()) {
      throw new Error("OYU_API_KEY тохируулна уу.");
    }

    if (!request.prompt.trim()) {
      throw new Error("Prompt is required");
    }

    request.signal?.throwIfAborted();

    const wantsJson =
      request.responseMimeType === "application/json" ||
      request.responseJsonSchema !== undefined;

    const system = [
      request.systemInstruction,
      wantsJson
        ? "Зөвхөн хүчинтэй JSON буцаа. Markdown, тайлбар нэмэхгүй."
        : "",
      request.responseJsonSchema === undefined
        ? ""
        : `Дараах JSON schema-г дага. Мэдээллийг тааж нөхөхгүй:
${JSON.stringify(request.responseJsonSchema)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const messages: {
      role: "system" | "user";
      content: string;
    }[] = [];

    if (system) {
      messages.push({ role: "system", content: system });
    }

    messages.push({
      role: "user",
      content: request.prompt,
    });

    const timeout = AbortSignal.timeout(30_000);

    const response = await fetch("https://api.oyu.so/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "oyuLLM",
        messages,
      }),
      signal: request.signal
        ? AbortSignal.any([request.signal, timeout])
        : timeout,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`OyuLLM HTTP ${response.status}`);
    }

    const raw: unknown = await response.json();

    const result = z
      .object({
        choices: z
          .array(
            z.object({
              finish_reason: z.string().nullish(),
              message: z.object({
                content: z.string().min(1),
              }),
            }),
          )
          .min(1),
      })
      .safeParse(raw);

    if (!result.success) {
      throw new Error("OyuLLM хариуны бүтэц тохирохгүй байна.");
    }

    const choice = result.data.choices[0];

    if (choice.finish_reason && choice.finish_reason !== "stop") {
      throw new Error("OyuLLM бүрэн хариулт өгсөнгүй.");
    }

    let text = choice.message.content.trim();

    if (!text) {
      throw new Error("OyuLLM хоосон хариулт өглөө.");
    }

    if (wantsJson) {
      text = text.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1").trim();

      try {
        JSON.parse(text);
      } catch {
        throw new Error("OyuLLM хүчинтэй JSON өгсөнгүй.");
      }
    }
    console.info("[Merchant AI] OyuLLM API хариу амжилттай");
    return {
      text,
      provider: "oyullm",
      model: "oyuLLM",
    };
  }
}
export interface SpeechRequest {
  audio: Uint8Array;
  mimeType: string;
  language?: string;
  signal?: AbortSignal;
}
export interface SpeechResponse {
  text: string;
  language?: string;
  provider: string;
}
export interface SpeechProvider {
  transcribe(request: SpeechRequest): Promise<SpeechResponse>;
}
export class AnirSpeechProvider implements SpeechProvider {
  async transcribe(_request: SpeechRequest): Promise<SpeechResponse> {
    void _request;
    throw new ProviderNotConfiguredError("Anir STT");
  }
}
export class DisabledSpeechProvider implements SpeechProvider {
  async transcribe(_request: SpeechRequest): Promise<SpeechResponse> {
    void _request;
    throw new Error("Speech transcription is disabled");
  }
}
export function createAIProvider(env: MerchantEnv): AIProvider {
  if (env.MERCHANT_AI_PROVIDER === "oyullm") {
    console.info("[Merchant AI] OyuLLM сонгогдлоо");
    return new OyuLLMProvider();
  }

  console.info("[Merchant AI] Gemini сонгогдлоо");

  return new GeminiProvider(
    env.GEMINI_API_KEY ?? "",
    env.GEMINI_MODEL ?? "",
    undefined,
    env.GEMINI_STRUCTURED_OUTPUT_MODE,
  );
}
export function createSpeechProvider(env: MerchantEnv): SpeechProvider {
  return env.MERCHANT_SPEECH_PROVIDER === "anir"
    ? new AnirSpeechProvider()
    : new DisabledSpeechProvider();
}
