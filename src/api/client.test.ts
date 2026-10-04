import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createApi,
  normalizePhone,
  validateCredentials,
} from "./client";
const credentials = {
  idInstance: "3100000000",
  apiTokenInstance: "fake-test-token-not-a-real-key",
  apiUrl: "https://3100.api.green-api.com",
};
const signal = () => new AbortController().signal;
const response = (value: unknown, status = 200) =>
  new Response(typeof value === "string" ? value : JSON.stringify(value), {
    status,
  });
describe("validation", () => {
  it("normalizes supported international phones without silently changing country", () => {
    expect(normalizePhone("+7 (999) 123-45-67")).toBe("79991234567");
    expect(normalizePhone("+375 29 123-45-67")).toBe("375291234567");
    for (const phone of [
      "8 999 1234567",
      "+1 202 5550100",
      "abc79991234567",
      "++79991234567",
      "",
    ])
      expect(() => normalizePhone(phone)).toThrow();
  });
  it("rejects untrusted origins and URLs that could expose a token", () => {
    for (const apiUrl of [
      "https://api.green-api.com.evil.test",
      "http://api.green-api.com",
      "https://evil.test",
      "https://user@api.green-api.com",
      "https://api.green-api.com?q=1",
      "https://api.green-api.com:8443",
      "https://api.green-api.com/path",
    ])
      expect(() => validateCredentials({ ...credentials, apiUrl })).toThrow();
    expect(
      validateCredentials({ ...credentials, apiUrl: credentials.apiUrl + "/" })
        .apiUrl,
    ).toBe(credentials.apiUrl);
  });
});
describe("MAX API contract", () => {
  it("resolves phone to canonical chat ID and sends to that ID", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ exist: true, chatId: "10000000" }))
      .mockResolvedValueOnce(response({ idMessage: "server-id" }));
    const api = createApi(credentials, fetcher);
    const id = await api.checkAccount("+79991234567", signal());
    expect(id).toBe("10000000");
    expect(await api.sendMessage(id, "Привет 👋\nMAX", signal())).toBe(
      "server-id",
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      phoneNumber: 79991234567,
    });
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
      chatId: "10000000",
      message: "Привет 👋\nMAX",
    });
    expect(fetcher.mock.calls[1][0]).toContain(
      "/waInstance3100000000/sendMessage/",
    );
    expect(fetcher.mock.calls[1][1]).toMatchObject({
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
  });
  it("validates HTTP 200 logical failure and absent account", async () => {
    for (const value of [
      { exist: false },
      { status: false, reason: "private vendor detail" },
      { exist: true, chatId: 1000 },
    ]) {
      await expect(
        createApi(
          credentials,
          vi.fn().mockResolvedValue(response(value)),
        ).checkAccount("79991234567", signal()),
      ).rejects.toBeInstanceOf(ApiError);
    }
  });
  it("accepts empty/null response and uses DELETE for the receipt", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(""))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(
        response({ receiptId: 5, body: { typeWebhook: "ignored" } }),
      )
      .mockResolvedValueOnce(response({ result: true }));
    const api = createApi(credentials, fetcher);
    expect(await api.receive(signal())).toBeNull();
    expect(await api.receive(signal())).toBeNull();
    expect(await api.receive(signal())).toEqual({
      receiptId: 5,
      body: { typeWebhook: "ignored" },
    });
    await api.acknowledge(5, signal());
    expect(fetcher.mock.calls[0][0]).toContain("?receiveTimeout=25");
    expect(fetcher.mock.calls[3][0]).toMatch(/deleteNotification\/[^/]+\/5$/);
    expect(fetcher.mock.calls[3][1].method).toBe("DELETE");
  });
  it("rejects invalid receipt and exposes a negative acknowledgment for recovery", async () => {
    const api = createApi(
      credentials,
      vi
        .fn()
        .mockResolvedValueOnce(response({ receiptId: "5", body: {} }))
        .mockResolvedValueOnce(response({ result: false })),
    );
    await expect(api.receive(signal())).rejects.toThrow(
      "Некорректное уведомление",
    );
    await expect(api.acknowledge(5, signal())).resolves.toBe(false);
  });
  it("enforces whitespace and conservative UTF-16 character limit", async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ idMessage: "ok" })),
      api = createApi(credentials, fetcher);
    await expect(
      api.sendMessage("1", " ".repeat(3), signal()),
    ).rejects.toThrow();
    await expect(
      api.sendMessage("1", "a".repeat(4001), signal()),
    ).rejects.toThrow();
    await expect(
      api.sendMessage("1", "🙂".repeat(2001), signal()),
    ).rejects.toThrow();
    await expect(
      api.sendMessage("1", "a".repeat(4000), signal()),
    ).resolves.toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not expose raw HTTP/network responses or secret URLs", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValue(new Error(`failed ${credentials.apiTokenInstance}`));
    await expect(
      createApi(credentials, fetcher).getState(signal()),
    ).rejects.toThrow("Нет соединения");
    fetcher.mockResolvedValueOnce(response(credentials.apiTokenInstance, 401));
    await expect(
      createApi(credentials, fetcher).getState(signal()),
    ).rejects.toThrow("Нет доступа");
  });
  it("aborts fetch when session is disconnected", async () => {
    const fetcher = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          ),
        ),
    );
    const controller = new AbortController(),
      request = createApi(credentials, fetcher).receive(controller.signal);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
