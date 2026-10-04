export interface Credentials {
  idInstance: string;
  apiTokenInstance: string;
  apiUrl: string;
}
export interface Notification {
  receiptId: number;
  body: Record<string, unknown>;
}
export interface ChatApi {
  readonly idInstance: string;
  getState(signal: AbortSignal): Promise<string>;
  getSettings(signal: AbortSignal): Promise<Record<string, unknown>>;
  checkAccount(phone: string, signal: AbortSignal): Promise<string>;
  sendMessage(
    chatId: string,
    message: string,
    signal: AbortSignal,
  ): Promise<string>;
  receive(signal: AbortSignal): Promise<Notification | null>;
  acknowledge(receiptId: number, signal: AbortSignal): Promise<boolean>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get permanent() {
    return [400, 401, 403, 404].includes(this.status);
  }
}

export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function normalizePhone(value: string): string {
  if (!/^\+?[\d\s()-]+$/.test(value.trim()))
    throw new ApiError("Введите номер в международном формате: +7 или +375.");
  const phone = value.replace(/[\s()+-]/g, "");
  if (!/^(7\d{10}|375\d{9})$/.test(phone))
    throw new ApiError(
      "MAX CheckAccount поддерживает номера +7 (11 цифр) и +375 (12 цифр).",
    );
  return phone;
}

export function validateCredentials(input: Credentials): Credentials {
  const credentials = {
    idInstance: input.idInstance.trim(),
    apiTokenInstance: input.apiTokenInstance.trim(),
    apiUrl: input.apiUrl.trim().replace(/\/+$/, ""),
  };
  if (!/^\d{4,20}$/.test(credentials.idInstance))
    throw new ApiError("idInstance должен содержать от 4 до 20 цифр.");
  if (!/^[a-zA-Z0-9_-]{16,256}$/.test(credentials.apiTokenInstance))
    throw new ApiError(
      "Проверьте apiTokenInstance: вставьте ключ целиком, без пробелов.",
    );
  let url: URL;
  try {
    url = new URL(credentials.apiUrl);
  } catch {
    throw new ApiError("Скопируйте apiUrl из кабинета GREEN-API.");
  }
  if (
    url.protocol !== "https:" ||
    !/^(\d+\.)?api\.green-api\.com$/.test(url.hostname) ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/", "/v3", "/v3/"].includes(url.pathname)
  ) {
    throw new ApiError(
      "Разрешён только HTTPS apiUrl вида https://3100.api.green-api.com из кабинета GREEN-API.",
    );
  }
  credentials.apiUrl = url.origin;
  return credentials;
}

function httpMessage(status: number): string {
  if (status === 400)
    return "GREEN-API отклонил запрос (400). Проверьте настройки HTTP API, номер и параметры инстанса.";
  if (status === 401 || status === 403)
    return "Нет доступа к GREEN-API. Проверьте ключ, тариф и ограничения аккаунта.";
  if (status === 404)
    return "Инстанс не найден. Проверьте apiUrl и idInstance.";
  if (status === 469)
    return "MAX ограничил поиск контактов. Не повторяйте проверку номера как минимум 2 часа.";
  if (status === 429)
    return "Лимит GREEN-API. Получение сообщений возобновится после паузы.";
  return `GREEN-API временно недоступен (HTTP ${status}).`;
}

export function createApi(
  input: Credentials,
  fetcher: typeof fetch = fetch,
): ChatApi {
  const credentials = validateCredentials(input);
  // Tokens appear in the API path by vendor contract. Never log request URLs or raw errors.
  const request = async (
    method: string,
    name: string,
    signal: AbortSignal,
    body?: unknown,
    suffix = "",
  ): Promise<unknown> => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 40_000);
    const abort = () => timeout.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) timeout.abort();
    try {
      const url = `${credentials.apiUrl}/waInstance${credentials.idInstance}/${name}/${credentials.apiTokenInstance}${suffix}`;
      const response = await fetcher(url, {
        method,
        signal: timeout.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
        ...(body !== undefined && {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
      if (!response.ok)
        throw new ApiError(httpMessage(response.status), response.status);
      const raw = await response.text();
      if (!raw.trim()) return null;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        throw new ApiError("GREEN-API вернул некорректный JSON.");
      }
    } catch (error) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        timeout.signal.aborted
          ? "Время ожидания GREEN-API истекло."
          : "Нет соединения с GREEN-API. Проверьте сеть и доступ браузера (CORS).",
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
  return {
    idInstance: credentials.idInstance,
    async getState(signal) {
      const result = record(await request("GET", "getStateInstance", signal));
      if (typeof result.stateInstance !== "string")
        throw new ApiError("Не удалось прочитать состояние инстанса.");
      return result.stateInstance;
    },
    async getSettings(signal) {
      return record(await request("GET", "getSettings", signal));
    },
    async checkAccount(phone, signal) {
      const result = record(
        await request("POST", "checkAccount", signal, {
          phoneNumber: Number(normalizePhone(phone)),
        }),
      );
      if (result.exist === false)
        throw new ApiError(
          "Аккаунт MAX не найден. Проверьте номер и настройки приватности получателя.",
        );
      if (
        result.exist !== true ||
        typeof result.chatId !== "string" ||
        !/^\d+$/.test(result.chatId)
      )
        throw new ApiError(
          "Не удалось получить MAX chatId. Проверьте авторизацию, приватность и лимиты инстанса.",
        );
      return result.chatId;
    },
    async sendMessage(chatId, message, signal) {
      if (!message.trim() || message.length > 4000)
        throw new ApiError("Сообщение должно содержать от 1 до 4000 символов.");
      const result = record(
        await request("POST", "sendMessage", signal, { chatId, message }),
      );
      if (typeof result.idMessage !== "string" || !result.idMessage)
        throw new ApiError(
          "Не удалось подтвердить отправку. Проверьте чат MAX перед повтором.",
        );
      return result.idMessage;
    },
    async receive(signal) {
      const result = await request(
        "GET",
        "receiveNotification",
        signal,
        undefined,
        "?receiveTimeout=25",
      );
      if (result === null) return null;
      const envelope = record(result);
      if (
        !Number.isSafeInteger(envelope.receiptId) ||
        Number(envelope.receiptId) < 0 ||
        !envelope.body ||
        typeof envelope.body !== "object"
      )
        throw new ApiError(
          "Некорректное уведомление. Очередь не подтверждена, проверьте GREEN-API.",
          400,
        );
      return {
        receiptId: envelope.receiptId as number,
        body: record(envelope.body),
      };
    },
    async acknowledge(receiptId, signal) {
      const result = record(
        await request(
          "DELETE",
          "deleteNotification",
          signal,
          undefined,
          `/${receiptId}`,
        ),
      );
      if (typeof result.result !== "boolean")
        throw new ApiError("Некорректный ответ подтверждения уведомления.");
      return result.result;
    },
  };
}

export const friendlyError = (error: unknown): string =>
  error instanceof ApiError
    ? error.message
    : "Не удалось выполнить запрос. Попробуйте ещё раз.";
