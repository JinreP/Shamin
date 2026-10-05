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


test("image-only reports send detected image MIME and retain structured JSON prompt guidance", async () => {
  const prior = { apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
  const originalFetch = globalThis.fetch;
  let requestBody: { contents: { parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[]; generationConfig: Record<string, unknown> } | undefined;
  try {
    process.env.GEMINI_API_KEY = "test-gemini-key";
    process.env.GEMINI_MODEL = "gemini-test-model";
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ error: { message: "Test upstream unavailable" } }, { status: 503 });
    };
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const form = new FormData();
    form.set("image", new File([bytes], "report.png", { type: "application/octet-stream" }));
    const response = await POST(new Request("http://localhost/api/buyer/parse-report", { method: "POST", body: form }));
    assert.equal(response.status, 502);
    assert.equal(requestBody?.contents[0].parts[1].inlineData?.mimeType, "image/png");
    assert.equal(requestBody?.contents[0].parts[1].inlineData?.data, Buffer.from(bytes).toString("base64"));
    assert.match(requestBody?.contents[0].parts[0].text ?? "", /damageItems/);
    assert.equal("responseJsonSchema" in (requestBody?.generationConfig ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prior.apiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prior.apiKey;
    if (prior.model === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = prior.model;
  }
});

test("report input rejects short text, forged image MIME and oversized uploads before Gemini", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected Gemini call"); };
  try {
    const short = await POST(new Request("http://localhost/api/buyer/parse-report", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ report: "short" }),
    }));
    assert.equal(short.status, 400);
    for (const [bytes, expected] of [[new Uint8Array([1, 2, 3]), 415], [new Uint8Array(8 * 1024 * 1024 + 1), 413]] as const) {
      const form = new FormData();
      form.set("image", new File([bytes], "forged.png", { type: "image/png" }));
      const response = await POST(new Request("http://localhost/api/buyer/parse-report", { method: "POST", body: form }));
      assert.equal(response.status, expected);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
