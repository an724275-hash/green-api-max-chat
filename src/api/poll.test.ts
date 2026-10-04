import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./client";
import type { ChatApi } from "./client";
import { pollNotifications, delay } from "./poll";
const envelope = { receiptId: 1, body: { value: "message" } };
const mockApi = () =>
  ({
    idInstance: "1",
    receive: vi.fn<ChatApi["receive"]>().mockResolvedValue(envelope),
    acknowledge: vi.fn().mockResolvedValue(true),
    getState: vi.fn(),
    getSettings: vi.fn(),
    checkAccount: vi.fn(),
    sendMessage: vi.fn(),
  }) satisfies ChatApi;
describe("sequential polling", () => {
  it("processes then acknowledges, with minimum polling delay", async () => {
    const api = mockApi(),
      controller = new AbortController(),
      calls: string[] = [];
    api.receive.mockImplementation(async () => {
      calls.push("receive");
      return envelope;
    });
    api.acknowledge.mockImplementation(async () => {
      calls.push("ack");
      return true;
    });
    const sleep = vi.fn(async (ms: number) => {
      expect(ms).toBe(1100);
      controller.abort();
    });
    await pollNotifications(
      api,
      controller.signal,
      () => {
        calls.push("process");
      },
      vi.fn(),
      sleep,
    );
    expect(calls).toEqual(["receive", "process", "ack"]);
  });
  it("retries a failed acknowledgment without processing or receiving again", async () => {
    const api = mockApi(),
      controller = new AbortController(),
      process = vi.fn(),
      status = vi.fn();
    api.acknowledge
      .mockRejectedValueOnce(new ApiError("offline"))
      .mockResolvedValueOnce(true);
    const waits: number[] = [];
    await pollNotifications(
      api,
      controller.signal,
      process,
      status,
      async (ms) => {
        waits.push(ms);
        if (ms === 1100) controller.abort();
      },
    );
    expect(waits).toEqual([2000, 1100]);
    expect(process).toHaveBeenCalledTimes(1);
    expect(api.receive).toHaveBeenCalledTimes(1);
    expect(api.acknowledge).toHaveBeenCalledTimes(2);
    expect(status.mock.calls.at(-1)?.[0].state).toBe("online");
  });
  it("backs off a network/429 failure and recovers", async () => {
    const api = mockApi(),
      controller = new AbortController(),
      waits: number[] = [],
      status = vi.fn();
    api.receive
      .mockRejectedValueOnce(new ApiError("network"))
      .mockRejectedValueOnce(new ApiError("rate", 429))
      .mockResolvedValueOnce(null);
    await pollNotifications(
      api,
      controller.signal,
      vi.fn(),
      status,
      async (ms) => {
        waits.push(ms);
        if (ms === 1100) controller.abort();
      },
    );
    expect(waits).toEqual([2000, 4000, 1100]);
    expect(api.acknowledge).not.toHaveBeenCalled();
    expect(status.mock.calls.at(-1)?.[0].state).toBe("online");
  });
  it("stops for bad credentials without an infinite retry loop", async () => {
    const api = mockApi(),
      status = vi.fn(),
      sleep = vi.fn();
    api.receive.mockRejectedValueOnce(new ApiError("credentials", 401));
    await pollNotifications(
      api,
      new AbortController().signal,
      vi.fn(),
      status,
      sleep,
    );
    expect(status.mock.calls.at(-1)?.[0].state).toBe("stopped");
    expect(sleep).not.toHaveBeenCalled();
  });
  it("does not acknowledge an event rejected by processing", async () => {
    const api = mockApi();
    await pollNotifications(
      api,
      new AbortController().signal,
      () => {
        throw new ApiError("wrong instance", 400);
      },
      vi.fn(),
    );
    expect(api.acknowledge).not.toHaveBeenCalled();
  });
  it("cancels waiting promptly", async () => {
    const controller = new AbortController(),
      waiting = delay(60_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("acknowledgment recovery", () => {
  it("recovers when a lost DELETE response is followed by an already-removed receipt", async () => {
    const api = mockApi(),
      controller = new AbortController(),
      process = vi.fn();
    api.receive.mockResolvedValueOnce(envelope).mockResolvedValueOnce(null);
    api.acknowledge
      .mockRejectedValueOnce(new ApiError("lost response"))
      .mockResolvedValueOnce(false);
    let normalWaits = 0;
    await pollNotifications(
      api,
      controller.signal,
      process,
      vi.fn(),
      async (ms) => {
        if (ms === 1100 && ++normalWaits === 2) controller.abort();
      },
    );
    expect(api.receive).toHaveBeenCalledTimes(2);
    expect(process).toHaveBeenCalledTimes(1);
  });
  it("stops if the supposedly removed receipt appears again", async () => {
    const api = mockApi(),
      status = vi.fn();
    api.acknowledge.mockResolvedValue(false);
    await pollNotifications(
      api,
      new AbortController().signal,
      vi.fn(),
      status,
      async () => {},
    );
    expect(api.receive).toHaveBeenCalledTimes(2);
    expect(api.acknowledge).toHaveBeenCalledTimes(1);
    expect(status.mock.calls.at(-1)?.[0].state).toBe("stopped");
  });
  it("acknowledges a valid terminal state event before stopping", async () => {
    const api = mockApi(),
      status = vi.fn();
    await pollNotifications(
      api,
      new AbortController().signal,
      () => "Please reconnect",
      status,
    );
    expect(api.acknowledge).toHaveBeenCalledWith(1, expect.any(AbortSignal));
    expect(status.mock.calls.at(-1)?.[0]).toEqual({
      state: "stopped",
      message: "Please reconnect",
    });
  });
});
