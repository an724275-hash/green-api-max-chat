import { ApiError, friendlyError } from "./client";
import type { ChatApi, Notification } from "./client";
export type PollStatus = {
  state: "connecting" | "online" | "retrying" | "stopped";
  message: string;
};

export function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** One consumer, sequential receive → process → delete; retry GET/DELETE, never POST send. */
export async function pollNotifications(
  api: ChatApi,
  signal: AbortSignal,
  onNotification: (
    notification: Notification,
  ) => void | string | Promise<void | string>,
  onStatus: (status: PollStatus) => void,
  sleep = delay,
): Promise<void> {
  let failures = 0;
  let pendingReceipt: number | undefined;
  let rejectedReceipt: number | undefined;
  let stopReason: string | void = undefined;
  onStatus({ state: "connecting", message: "Подключаем получение…" });
  while (!signal.aborted) {
    try {
      if (pendingReceipt === undefined) {
        const notification = await api.receive(signal);
        if (signal.aborted) return;
        if (notification) {
          if (notification.receiptId === rejectedReceipt)
            throw new ApiError(
              "Очередь не подтверждает уведомление. Остановите другие потребители инстанса и подключитесь заново.",
              400,
            );
          stopReason = await onNotification(notification);
          if (signal.aborted) return;
          pendingReceipt = notification.receiptId;
        }
      }
      if (pendingReceipt !== undefined) {
        const removed = await api.acknowledge(pendingReceipt, signal);
        // A lost DELETE response can be retried after the receipt is already gone.
        // Re-read once; the same rejected receipt signals a genuine queue conflict.
        rejectedReceipt = removed ? undefined : pendingReceipt;
        pendingReceipt = undefined;
        if (stopReason) {
          onStatus({ state: "stopped", message: stopReason });
          return;
        }
      }
      if (signal.aborted) return;
      failures = 0;
      onStatus({ state: "online", message: "Получение включено" });
      // Also throttles a server returning null immediately: no hot loop, at most 1 GET/s.
      await sleep(1100, signal);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiError && error.permanent) {
        onStatus({ state: "stopped", message: friendlyError(error) });
        return;
      }
      const wait = Math.min(30_000, 2000 * 2 ** Math.min(failures++, 4));
      onStatus({
        state: "retrying",
        message: `${friendlyError(error)} Повтор через ${wait / 1000} с.`,
      });
      try {
        await sleep(wait, signal);
      } catch {
        return;
      }
    }
  }
}
