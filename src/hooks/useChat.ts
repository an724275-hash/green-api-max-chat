import { useEffect, useReducer, useRef, useState } from "react";
import { ApiError, friendlyError, normalizePhone, record } from "../api/client";
import type { ChatApi } from "../api/client";
import { pollNotifications } from "../api/poll";
import type { PollStatus } from "../api/poll";
import { chatReducer, initialChatState, parseEvent } from "../model/chat";

export function useChat(api: ChatApi) {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [selected, select] = useState<string | null>(null);
  const [status, setStatus] = useState<PollStatus>({
    state: "connecting",
    message: "Подключаем получение…",
  });
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [restart, setRestart] = useState(0);
  const life = useRef<AbortController | null>(null);
  // Refs block duplicate submits before React commits the busy state.
  const busy = useRef({ creating: false, sending: false });
  const phoneCache = useRef(new Map<string, string>());

  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const cache = phoneCache.current;
    return () => {
      controller.abort();
      life.current = null;
      cache.clear();
    };
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    void pollNotifications(
      api,
      controller.signal,
      async (notification) => {
        const event = notification.body;
        if (String(record(event.instanceData).idInstance) !== api.idInstance)
          throw new ApiError(
            "Уведомление другого инстанса. Получение остановлено без подтверждения.",
            400,
          );
        if (
          event.typeWebhook === "stateInstanceChanged" &&
          event.stateInstance !== "authorized"
        ) {
          const currentState = await api.getState(controller.signal);
          if (currentState !== "authorized")
            return "Инстанс потерял авторизацию. Войдите в MAX через кабинет GREEN-API и подключитесь заново.";
        }
        const action = parseEvent(event, api.idInstance);
        if (action) dispatch(action);
      },
      setStatus,
    );
    return () => controller.abort();
  }, [api, restart]);

  async function createChat(rawPhone: string) {
    if (busy.current.creating || !life.current) return;
    const signal = life.current.signal;
    busy.current.creating = true;
    setCreating(true);
    setError("");
    try {
      const phone = normalizePhone(rawPhone);
      // MAX chatId is resolved by CheckAccount, not derived from the phone number.
      const id =
        phoneCache.current.get(phone) ??
        (await api.checkAccount(phone, signal));
      if (signal.aborted) return;
      phoneCache.current.set(phone, id);
      dispatch({ type: "chat", chat: { id, phone, label: `+${phone}` } });
      select(id);
    } catch (error) {
      if (!signal.aborted) setError(friendlyError(error));
    } finally {
      if (!signal.aborted) {
        busy.current.creating = false;
        setCreating(false);
      }
    }
  }

  async function send(text: string) {
    if (
      busy.current.sending ||
      !selected ||
      !text.trim() ||
      text.length > 4000 ||
      !life.current ||
      status.state === "stopped"
    )
      return false;
    const signal = life.current.signal,
      chatId = selected,
      localId = `local-${crypto.randomUUID()}`,
      timestamp = Date.now();
    busy.current.sending = true;
    setSending(true);
    setError("");
    dispatch({
      type: "message",
      message: {
        id: localId,
        chatId,
        text,
        timestamp,
        direction: "out",
        status: "sending",
      },
    });
    try {
      const id = await api.sendMessage(chatId, text, signal);
      if (signal.aborted) return false;
      dispatch({
        type: "message",
        replaceId: localId,
        message: {
          id,
          chatId,
          text,
          timestamp,
          direction: "out",
          status: "queued",
        },
      });
      return true;
    } catch (error) {
      if (!signal.aborted) {
        dispatch({
          type: "status",
          chatId,
          id: localId,
          status:
            error instanceof ApiError &&
            error.status >= 400 &&
            error.status < 500
              ? "failed"
              : "unknown",
        });
        setError(
          `${friendlyError(error)} Автоматического повтора нет. Перед новой отправкой проверьте чат в MAX: сообщение могло уже уйти.`,
        );
      }
      return false;
    } finally {
      if (!signal.aborted) {
        busy.current.sending = false;
        setSending(false);
      }
    }
  }
  return {
    state,
    selected,
    select,
    status,
    error,
    creating,
    sending,
    createChat,
    send,
    retry: () => setRestart((value) => value + 1),
  };
}
