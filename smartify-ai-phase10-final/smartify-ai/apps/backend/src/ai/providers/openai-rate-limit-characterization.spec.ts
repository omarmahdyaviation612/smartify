import { createInstrumentedOpenAI, retryAfterMs } from "./openai-request-diagnostics";
import { OpenAIProvider } from "./openai.provider";

jest.mock("@smartify/config", () => ({ loadBackendEnv: () => ({ OPENAI_API_KEY: "test-not-a-real-key" }) }));

// Real installed SDK, fake HTTP transport only. No provider network requests.
describe("current OpenAI retry behavior", () => {
  const request = { systemPrompt: "test", messages: [{ role: "user" as const, content: "test" }], maxOutputTokens: 4000 };
  const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 2 }, model: "gpt-4o-mini" }), { status: 200, headers: { "content-type": "application/json" } });
  const fail = (status: number, code: string) => new Response(JSON.stringify({ error: { message: "test failure", type: code, code } }), { status, headers: { "content-type": "application/json", "retry-after-ms": "1" } });
  function setup(fetch: jest.Mock) {
    const provider = new OpenAIProvider("gpt-4o-mini");
    (provider as any).client = createInstrumentedOpenAI("test-not-a-real-key", () => undefined, fetch as any);
    return provider;
  }
  it("succeeds with one HTTP attempt", async () => {
    const fetch = jest.fn().mockImplementation(async () => ok());
    expect((await setup(fetch).generate(request)).content).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retries a 429 then succeeds inside one generate call", async () => {
    const fetch = jest.fn().mockImplementationOnce(async () => fail(429, "rate_limit_exceeded")).mockImplementation(async () => ok());
    expect((await setup(fetch).generate(request)).content).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("bounds repeated 429s to three HTTP attempts and retains headers", async () => {
    const fetch = jest.fn().mockImplementation(async () => fail(429, "rate_limit_exceeded"));
    await expect(setup(fetch).generate(request)).rejects.toMatchObject({ status: 429, headers: { "retry-after-ms": "1" } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it("does not retry a 400", async () => {
    const fetch = jest.fn().mockImplementation(async () => fail(400, "invalid_request_error"));
    await expect(setup(fetch).generate(request)).rejects.toMatchObject({ status: 400 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry insufficient_quota", async () => {
    const fetch = jest.fn().mockImplementation(async () => fail(429, "insufficient_quota"));
    await expect(setup(fetch).generate(request)).rejects.toMatchObject({ code: "insufficient_quota" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("returns successful TPM headers and disables SDK retries when the caller owns pacing", async () => {
    const fetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { message: "TPM exhausted", code: "rate_limit_exceeded" } }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after-ms": "695", "x-ratelimit-limit-tokens": "200000", "x-ratelimit-remaining-tokens": "0", "x-ratelimit-reset-tokens": "79s" },
    }));
    const provider = setup(fetch);
    await expect(provider.generate({ ...request, transportRetryMode: "none" } as any)).rejects.toMatchObject({ status: 429 });
    expect(fetch).toHaveBeenCalledTimes(1);

    const successFetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 10, completion_tokens: 2 }, model: "gpt-4o-mini" }), {
      status: 200,
      headers: { "content-type": "application/json", "x-ratelimit-limit-tokens": "200000", "x-ratelimit-remaining-tokens": "52000", "x-ratelimit-reset-tokens": "1m19s" },
    }));
    const result: any = await setup(successFetch).generate({ ...request, transportRetryMode: "none" } as any);
    expect(result.rateLimit).toEqual(expect.objectContaining({ limitTokens: 200000, remainingTokens: 52000, resetTokensMs: 79000 }));
  });
  it("logs attempts and only allowlisted metadata, with no content or credentials", async () => {
    const log = jest.fn();
    const fetch = jest.fn().mockImplementationOnce(async () => new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "tokens per min; private prompt MUST_NOT_LOG" } }), { status: 429, headers: { "content-type": "application/json", "retry-after-ms": "1", "x-request-id": "req_test", "x-ratelimit-remaining-tokens": "0", authorization: "MUST_NOT_LOG" } })).mockImplementation(async () => ok());
    const provider = new OpenAIProvider("gpt-4o-mini");
    (provider as any).client = createInstrumentedOpenAI("MUST_NOT_LOG", log, fetch as any);
    await provider.generate({ ...request, systemPrompt: "MUST_NOT_LOG", diagnostics: { operation: "unit_grounding", unitId: "unit-1", pageStart: 5, pageEnd: 6 } });
    expect(log.mock.calls.filter(([entry]) => entry.event === "AI_REQUEST_STARTED").map(([entry]) => entry.attempt)).toEqual([1, 2]);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: "AI_RATE_LIMITED", limitType: "TPM", retryAfterMs: 1, attempt: 1, requestId: "req_test", pageStart: 5, pageEnd: 6 }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("MUST_NOT_LOG");
  });
  it("reads milliseconds, seconds and HTTP dates without a new retry layer", () => {
    expect(retryAfterMs(new Headers({ "retry-after-ms": "2531" }))).toBe(2531);
    expect(retryAfterMs(new Headers({ "retry-after": "2.531" }))).toBe(2531);
    const now = jest.spyOn(Date, "now").mockReturnValue(0);
    try { expect(retryAfterMs(new Headers({ "retry-after": "Thu, 01 Jan 1970 00:00:03 GMT" }))).toBe(3000); }
    finally { now.mockRestore(); }
  });
});
