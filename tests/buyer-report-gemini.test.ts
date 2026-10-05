import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/buyer/parse-report/route";

test("report parsing uses Gemini JSON compatibility mode without responseJsonSchema", async () => {
  const prior = { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key-not-a-real-secret";
    process.env.GEMINI_MODEL = "gemini-test-model";
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ error: { message: "Request contains an invalid argument.", status: "INVALID_ARGUMENT" } }, { status: 400 });
    };

    const response = await POST(new Request("http://localhost/api/buyer/parse-report", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report: "Toyota Prius 30: урд бампер хагарсан." }),
    }));
    const body = await response.json() as { error: string };
    const generationConfig = requestBody?.generationConfig as Record<string, unknown>;
    const contents = requestBody?.contents as { parts: { text: string }[] }[];

    assert.equal(response.status, 502);
    assert.match(body.error, /Gemini key, model эсвэл API тохиргоо/);
    assert.equal(generationConfig.responseMimeType, "application/json");
    assert.equal("responseJsonSchema" in generationConfig, false);
    assert.match(contents[0].parts[0].text, /damageItems/);
  } finally {
    globalThis.fetch = originalFetch;
    if (prior.apiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prior.apiKey;
    if (prior.model === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prior.model;
  }
});