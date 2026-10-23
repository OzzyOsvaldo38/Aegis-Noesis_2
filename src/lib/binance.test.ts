import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithTimeout } from "./binance.ts";

const originalFetch = globalThis.fetch;

test("aborts a hanging fetch when its timeout expires", async () => {
  const requestSignals: AbortSignal[] = [];
  globalThis.fetch = (_input, init) => {
    if (init?.signal) {
      requestSignals.push(init.signal);
    }
    return new Promise<Response>(() => {});
  };

  try {
    await assert.rejects(
      fetchWithTimeout("https://example.test", {}, 10, async (response) => response),
      /timed out after 10ms/,
    );
    assert.equal(requestSignals[0]?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborts an in-flight fetch when its caller signal is aborted", async () => {
  const controller = new AbortController();
  const requestSignals: AbortSignal[] = [];
  globalThis.fetch = (_input, init) => {
    if (init?.signal) {
      requestSignals.push(init.signal);
    }
    return new Promise<Response>(() => {});
  };

  const request = fetchWithTimeout(
    "https://example.test",
    { signal: controller.signal },
    1_000,
    async (response) => response,
  );
  controller.abort();

  try {
    await assert.rejects(request, { name: "AbortError" });
    assert.equal(requestSignals[0]?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a subsequent fetch can succeed after a timed-out request", async () => {
  let attempts = 0;
  globalThis.fetch = () => {
    attempts += 1;
    if (attempts === 1) {
      return new Promise<Response>(() => {});
    }
    return Promise.resolve(new Response("ok"));
  };

  try {
    await assert.rejects(
      fetchWithTimeout("https://example.test", {}, 10, async (response) => response),
      /timed out after 10ms/,
    );
    const response = await fetchWithTimeout(
      "https://example.test",
      {},
      10_000,
      async (result) => result,
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("aborts a hanging response body and allows the next request to succeed", async () => {
  let attempts = 0;
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = (_input, init) => {
    attempts += 1;
    requestSignal = init?.signal ?? undefined;

    if (attempts === 1) {
      const response = new Response();
      Object.defineProperty(response, "json", {
        value: () => new Promise<never>(() => {}),
      });
      return Promise.resolve(response);
    }

    return Promise.resolve(
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
    );
  };

  try {
    await assert.rejects(
      fetchWithTimeout("https://example.test", {}, 10, (response) => response.json()),
      /timed out after 10ms/,
    );
    assert.equal(requestSignal?.aborted, true);

    const result = await fetchWithTimeout(
      "https://example.test",
      {},
      1_000,
      (response) => response.json() as Promise<{ ok: boolean }>,
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(attempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
