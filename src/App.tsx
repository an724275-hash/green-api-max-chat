import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ApiError, createApi, friendlyError } from "./api/client";
import type { ChatApi } from "./api/client";
import { createDemoApi } from "./api/demo";
import { useChat } from "./hooks/useChat";
import type { MessageStatus } from "./model/chat";
import "./styles.css";

type Session = { api: ChatApi; demo: boolean; note: string };
const Icon = ({
  name,
  ...props
}: {
  name: "send" | "chat" | "arrow" | "logout" | "plus" | "lock";
  className?: string;
}) => {
  const paths = {
    send: "m5 3 16 9-16 9 3-9-3-9Zm3 9h13",
    chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0ZM7 10h10M7 14h6",
    arrow: "m14 5-7 7 7 7",
    logout: "M9 4H4v16h5m6-13 5 5-5 5m-6-5h11",
    plus: "M12 5v14M5 12h14",
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Z",
  };
  return (
    <svg
      {...props}
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
};
function Logo() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Icon name="chat" />
      </span>
      <span>
        MAX <span className="brand-divider">/</span> <small>GREEN-API</small>
      </span>
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Connect({ onConnect }: { onConnect: (session: Session) => void }) {
  const [id, setId] = useState(""),
    [token, setToken] = useState(""),
    [url, setUrl] = useState("https://api.green-api.com");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  function cancel() {
    request.current?.abort();
    request.current = null;
    setBusy(false);
  }
  async function connect(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const api = createApi({
        idInstance: id,
        apiTokenInstance: token,
        apiUrl: url,
      });
      const state = await api.getState(controller.signal);
      if (state !== "authorized")
        throw new ApiError(
          "Инстанс не авторизован. Подключите MAX в кабинете GREEN-API, затем повторите вход.",
        );
      const settings = await api.getSettings(controller.signal);
      if (settings.typeInstance && settings.typeInstance !== "v3")
        throw new ApiError(
          "Выберите инстанс MAX. Этот клиент не предназначен для других мессенджеров.",
        );
      if (settings.webhookUrl)
        throw new ApiError(
          "У инстанса указан webhookUrl. Для HTTP-получения очистите его в кабинете GREEN-API и подождите около минуты.",
        );
      if (settings.incomingWebhook !== "yes")
        throw new ApiError(
          "Включите «Получать уведомления о входящих сообщениях и файлах» в кабинете GREEN-API.",
        );
      if (controller.signal.aborted) return;
      setToken("");
      onConnect({
        api,
        demo: false,
        note:
          settings.outgoingWebhook !== "yes" ||
          settings.outgoingAPIMessageWebhook !== "yes"
            ? "Статусы доставки могут не приходить. В кабинете включите уведомления о сообщениях через API и статусах отправки."
            : "",
      });
    } catch (error) {
      if (!controller.signal.aborted) setError(friendlyError(error));
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <main className="connect-page">
      <header className="landing-header">
        <Logo />
        <span className="outline-chip">Текстовый чат</span>
      </header>
      <section className="connect-card">
        <div className="connect-intro">
          <span className="eyebrow">ПРОСТО ОСТАВАЙТЕСЬ НА СВЯЗИ</span>
          <h1>
            Ваш MAX.
            <br />
            <span>В одном окне.</span>
          </h1>
          <p>
            Подключите инстанс GREEN-API,
            <br />
            чтобы отправлять сообщения
            <br />и видеть ответы собеседника.
          </p>
          <div className="intro-chat">
            <div className="sample-bubble">
              Привет! Как дела? <small>12:41</small>
            </div>
            <div className="sample-bubble sample-answer">
              Всё отлично, на связи 👋 <small>12:42</small>
            </div>
          </div>
          <div className="intro-foot">
            <span className="tiny-dot" /> React · HTTP API · MAX
          </div>
        </div>
        <form
          className="connect-form"
          onSubmit={(event) => void connect(event)}
        >
          <div>
            <h2>Подключить инстанс</h2>
            <p className="muted">
              Данные из{" "}
              <a
                href="https://console.green-api.com/"
                target="_blank"
                rel="noreferrer"
              >
                кабинета GREEN-API ↗
              </a>
            </p>
          </div>
          <Field label="idInstance">
            <input
              required
              inputMode="numeric"
              autoComplete="off"
              placeholder="Например, 3100000000"
              value={id}
              onChange={(event) => setId(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="apiTokenInstance">
            <input
              required
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Ключ доступа инстанса"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Field label="apiUrl">
            <input
              required
              type="url"
              autoComplete="off"
              spellCheck={false}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={busy}
            />
            <small>Сверьте с кабинетом: адрес может зависеть от инстанса</small>
          </Field>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          <button
            className="primary"
            disabled={busy || !id.trim() || !token.trim()}
          >
            {busy ? "Проверяем подключение…" : "Подключиться"}
            <span aria-hidden="true">→</span>
          </button>
          {busy ? (
            <button type="button" className="text-button" onClick={cancel}>
              Отменить подключение
            </button>
          ) : (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                onConnect({ api: createDemoApi(), demo: true, note: "" })
              }
            >
              Посмотреть демо без ключей
            </button>
          )}
          <p className="security-note">
            <Icon name="lock" />
            <span>
              Ключ хранится только в памяти вкладки. HTTP API подтверждает и
              удаляет уведомления из очереди: используйте отдельный тестовый
              инстанс, без других потребителей.
            </span>
          </p>
        </form>
      </section>
      <footer className="landing-footer">
        Учебный клиент на React · Неофициальный интерфейс MAX
      </footer>
    </main>
  );
}
const statuses: Record<MessageStatus, string> = {
  sending: "Отправляется…",
  queued: "В очереди",
  delivered: "Доставлено",
  read: "Прочитано",
  failed: "Не отправлено",
  noAccount: "Нет аккаунта MAX",
  notInGroup: "Нет доступа к чату",
  unknown: "Статус неизвестен",
};
const time = (timestamp: number) =>
  new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(
    timestamp,
  );
const date = (timestamp: number) =>
  new Intl.DateTimeFormat("ru", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(timestamp);

function Workspace({
  session,
  onDisconnect,
}: {
  session: Session;
  onDisconnect: () => void;
}) {
  const chat = useChat(session.api);
  const [phone, setPhone] = useState(""),
    [drafts, setDrafts] = useState<Record<string, string>>({});
  const bottom = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const selected = chat.selected ? chat.state.chats[chat.selected] : undefined;
  const messages = chat.selected
    ? (chat.state.messages[chat.selected] ?? [])
    : [];
  const draft = chat.selected ? (drafts[chat.selected] ?? "") : "";
  const setDraft = (text: string) => {
    if (chat.selected)
      setDrafts((current) => ({ ...current, [chat.selected!]: text }));
  };
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, chat.selected]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !draft.trim() ||
      draft.length > 4000 ||
      chat.sending ||
      chat.status.state === "stopped"
    )
      return;
    const value = draft;
    setDraft("");
    await chat.send(value);
    textarea.current?.focus();
  }
  return (
    <main className={`workspace ${selected ? "chat-open" : ""}`}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <Logo />
          <button
            className="icon-button"
            onClick={onDisconnect}
            aria-label="Отключиться"
            title="Отключиться и очистить эту сессию"
          >
            <Icon name="logout" />
          </button>
        </header>
        <div className="sidebar-heading">
          <h1>Сообщения</h1>
          <span>{Object.keys(chat.state.chats).length}</span>
        </div>
        <form
          className="new-chat"
          onSubmit={(event) => {
            event.preventDefault();
            void chat.createChat(phone);
          }}
        >
          <label htmlFor="phone">Новый чат по номеру</label>
          <div className="phone-row">
            <input
              id="phone"
              type="tel"
              placeholder="+7 (999) 123-45-67"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={chat.creating}
            />
            <button
              className="new-chat-button"
              aria-label="Создать чат"
              disabled={chat.creating || !phone.trim()}
              title="Создать чат"
            >
              {chat.creating ? "…" : <Icon name="plus" />}
            </button>
          </div>
          <small>MAX · номера +7 и +375</small>
        </form>
        <div className="mobile-feedback">
          {chat.error && (
            <div className="error" role="alert">
              {chat.error}
            </div>
          )}
          {chat.status.state === "stopped" && (
            <div className="error" role="status">
              {chat.status.message}
              <button className="text-button" onClick={chat.retry}>
                Повторить получение
              </button>
            </div>
          )}
        </div>
        <nav className="chat-list" aria-label="Список чатов">
          {Object.values(chat.state.chats).map((item) => {
            const list = chat.state.messages[item.id] ?? [],
              last = list.at(-1);
            return (
              <button
                key={item.id}
                className={`chat-item ${item.id === chat.selected ? "active" : ""}`}
                onClick={() => chat.select(item.id)}
              >
                <span className="avatar">
                  {item.phone ? item.phone.slice(-2) : item.label.slice(0, 1)}
                </span>
                <span className="chat-preview">
                  <strong>{item.label}</strong>
                  <span>
                    {last
                      ? `${last.direction === "out" ? "Вы: " : ""}${last.text}`
                      : "Напишите первое сообщение"}
                  </span>
                </span>
                {last && <time>{time(last.timestamp)}</time>}
              </button>
            );
          })}
          {!Object.keys(chat.state.chats).length && (
            <div className="list-empty">
              <Icon name="chat" />
              <p>Пока нет чатов</p>
              <small>Введите номер получателя выше</small>
            </div>
          )}
        </nav>
        <div className="session-info">
          <span className={`status-dot ${chat.status.state}`} />
          <span>
            {session.demo
              ? "Локальный демо-режим"
              : `Инстанс ${session.api.idInstance}`}
            <small>История хранится до выхода</small>
          </span>
        </div>
      </aside>
      <section className="conversation" aria-label="Переписка">
        <header className="conversation-header">
          <button
            className="icon-button back"
            onClick={() => chat.select(null)}
            aria-label="Назад к чатам"
          >
            <Icon name="arrow" />
          </button>
          {selected ? (
            <>
              <span className="avatar small">
                {selected.phone?.slice(-2) ?? selected.label.slice(0, 1)}
              </span>
              <div>
                <h2>{selected.label}</h2>
                <p>MAX · текстовые сообщения</p>
              </div>
            </>
          ) : (
            <div>
              <h2>Ваши сообщения</h2>
              <p>Через GREEN-API</p>
            </div>
          )}
          <span className="header-tag">{session.demo ? "ДЕМО" : "MAX"}</span>
        </header>
        {session.demo && (
          <div className="demo-banner">
            Демо: сообщения и ответы имитируются локально. Ничего не
            отправляется в MAX.
          </div>
        )}
        {session.note && <div className="notice">{session.note}</div>}
        <div role="status" className={`poll-status ${chat.status.state}`}>
          <span className={`status-dot ${chat.status.state}`} />
          {chat.status.message}
          {chat.status.state === "stopped" && (
            <button className="text-button" onClick={chat.retry}>
              Повторить получение
            </button>
          )}
        </div>
        {chat.error && (
          <div className="error workspace-error" role="alert">
            {chat.error}
          </div>
        )}
        {selected ? (
          <>
            <div
              className="messages"
              role="log"
              aria-live="polite"
              aria-label="Сообщения чата"
            >
              {!messages.length && (
                <div className="first-message">
                  <span className="empty-icon">
                    <Icon name="chat" />
                  </span>
                  <h3>Начните разговор</h3>
                  <p>
                    Напишите сообщение. Ответ из MAX
                    <br />
                    появится здесь автоматически.
                  </p>
                </div>
              )}
              {messages.map((message, index) => (
                <div key={message.id}>
                  {(!index ||
                    date(message.timestamp) !==
                      date(messages[index - 1].timestamp)) && (
                    <div className="date-divider">
                      {date(message.timestamp)}
                    </div>
                  )}
                  <div className={`bubble-row ${message.direction}`}>
                    <article
                      className={`message-bubble ${message.status === "unknown" || message.status === "failed" || message.status === "noAccount" || message.status === "notInGroup" ? "message-failed" : ""}`}
                    >
                      <>
                        {message.status === "unknown" && (
                          <strong className="attempt-label">
                            Неподтверждённая попытка · не подтверждение отправки
                          </strong>
                        )}
                      </>
                      <p>{message.text}</p>
                      <div className="message-meta">
                        <time>{time(message.timestamp)}</time>
                        {message.status && (
                          <span>
                            {statuses[message.status]}{" "}
                            {message.status === "read" ? "✓✓" : ""}
                          </span>
                        )}
                      </div>
                    </article>
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <form className="composer" onSubmit={(event) => void submit(event)}>
              <div className="composer-box">
                <textarea
                  ref={textarea}
                  aria-label="Сообщение"
                  placeholder="Напишите сообщение…"
                  rows={1}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                />
                <button
                  className="send-button"
                  aria-label="Отправить сообщение"
                  disabled={
                    chat.sending ||
                    !draft.trim() ||
                    draft.length > 4000 ||
                    chat.status.state === "stopped"
                  }
                >
                  <Icon name="send" />
                </button>
              </div>
              <div className="composer-help">
                <span>Enter — отправить · Shift + Enter — новая строка</span>
                <span className={draft.length > 4000 ? "over-limit" : ""}>
                  {draft.length} / 4000
                </span>
              </div>
            </form>
          </>
        ) : (
          <div className="empty-conversation">
            <span className="large-mark">
              <Icon name="chat" />
            </span>
            <h2>Ближе, чем кажется</h2>
            <p>
              Создайте чат по номеру телефона
              <br />и начните общение в MAX.
            </p>
            <span className="empty-label">Только текст. Всё необходимое.</span>
          </div>
        )}
      </section>
    </main>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  return session ? (
    <Workspace session={session} onDisconnect={() => setSession(null)} />
  ) : (
    <Connect onConnect={setSession} />
  );
}
