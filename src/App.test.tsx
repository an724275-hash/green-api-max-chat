import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const key = "fake-test-token-not-a-real-key";
const id = "3100000000";
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
function server(
  options: {
    failSend?: boolean;
    authDeferred?: boolean;
    incoming?: string;
    failPolling?: boolean;
  } = {},
) {
  let authResolve: ((response: Response) => void) | undefined;
  let receiveResolve: ((response: Response) => void) | undefined;
  let activePolls = 0,
    maxActivePolls = 0;
  const fetcher = vi.fn(
    async (url: string, init?: RequestInit): Promise<Response> => {
      const method = new URL(url).pathname.split("/")[2];
      if (method === "getStateInstance") {
        if (options.authDeferred)
          return new Promise((resolve) => {
            authResolve = resolve;
          });
        return response({ stateInstance: "authorized" });
      }
      if (method === "getSettings")
        return response({
          webhookUrl: "",
          incomingWebhook: options.incoming ?? "yes",
          outgoingAPIMessageWebhook: "yes",
          outgoingWebhook: "yes",
        });
      if (method === "checkAccount")
        return response({
          exist: true,
          chatId:
            JSON.parse(String(init?.body)).phoneNumber === 79991234567
              ? "10000000"
              : "20000000",
        });
      if (method === "sendMessage") {
        if (options.failSend) throw new TypeError("network down");
        return response({ idMessage: "server-message" });
      }
      if (method === "deleteNotification") return response({ result: true });
      if (method === "receiveNotification" && options.failPolling)
        return response({}, 401);
      if (method === "receiveNotification")
        return new Promise((resolve, reject) => {
          activePolls++;
          maxActivePolls = Math.max(maxActivePolls, activePolls);
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              activePolls--;
            }
          };
          receiveResolve = (value) => {
            finish();
            resolve(value);
          };
          init?.signal?.addEventListener(
            "abort",
            () => {
              finish();
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
      throw new Error("Unexpected API method");
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return {
    fetcher,
    polls: () => ({ activePolls, maxActivePolls }),
    resolveAuth: () => authResolve?.(response({ stateInstance: "authorized" })),
    event: (text: string) =>
      receiveResolve?.(
        response({
          receiptId: 1,
          body: {
            typeWebhook: "incomingMessageReceived",
            instanceData: { idInstance: Number(id), typeInstance: "v3" },
            idMessage: "incoming",
            timestamp: 1760000000,
            senderData: { chatId: "10000000" },
            messageData: {
              typeMessage: "textMessage",
              textMessageData: { textMessage: text },
            },
          },
        }),
      ),
  };
}
async function login(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("idInstance", { exact: true }), id);
  await user.type(
    screen.getByLabelText("apiTokenInstance", { exact: true }),
    key,
  );
  await user.click(screen.getByRole("button", { name: "Подключиться" }));
}
async function chat(
  user: ReturnType<typeof userEvent.setup>,
  phone = "+79991234567",
) {
  await user.clear(screen.getByLabelText("Новый чат по номеру"));
  await user.type(screen.getByLabelText("Новый чат по номеру"), phone);
  await user.click(screen.getByRole("button", { name: "Создать чат" }));
  await screen.findByRole("heading", { name: phone });
}
afterEach(() => vi.unstubAllGlobals());
describe("React integration with mocked HTTP", () => {
  it("connects, sends, receives safe text, caches phone, and clears all data on logout", async () => {
    const mock = server(),
      user = userEvent.setup();
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    await login(user);
    await chat(user);
    expect(mock.polls()).toEqual({ activePolls: 1, maxActivePolls: 1 });
    await user.type(
      screen.getByLabelText("Сообщение", { exact: true }),
      "Привет MAX",
    );
    await user.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );
    await screen.findByText("В очереди", { exact: true });
    expect(screen.getByLabelText("Сообщение", { exact: true })).toHaveValue("");
    act(() => mock.event("<img src=x onerror=alert(1)>"));
    await screen.findByText("<img src=x onerror=alert(1)>", { exact: true });
    expect(document.querySelector("article img")).toBeNull();
    await chat(user);
    expect(
      mock.fetcher.mock.calls.filter(([url]) => url.includes("/checkAccount/")),
    ).toHaveLength(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    await user.click(screen.getByRole("button", { name: "Отключиться" }));
    expect(
      screen.getByLabelText("apiTokenInstance", { exact: true }),
    ).toHaveValue("");
    expect(mock.polls().activePolls).toBe(0);
    await login(user);
    await chat(user, "+79997654321");
    expect(
      screen.queryByText("Привет MAX", { exact: true }),
    ).not.toBeInTheDocument();
  });
  it("cancels login and ignores its delayed successful result", async () => {
    const mock = server({ authDeferred: true }),
      user = userEvent.setup();
    render(<App />);
    await login(user);
    await user.click(
      screen.getByRole("button", { name: "Отменить подключение" }),
    );
    await act(async () => {
      mock.resolveAuth();
    });
    expect(
      screen.getByRole("heading", { name: "Подключить инстанс" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Сообщения" }),
    ).not.toBeInTheDocument();
  });
  it("blocks missing receive settings with actionable feedback", async () => {
    server({ incoming: "no" });
    const user = userEvent.setup();
    render(<App />);
    await login(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Включите");
  });
  it("never automatically retries an uncertain send", async () => {
    const mock = server({ failSend: true }),
      user = userEvent.setup();
    render(<App />);
    await login(user);
    await chat(user);
    await user.type(
      screen.getByLabelText("Сообщение", { exact: true }),
      "Один раз",
    );
    await user.click(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    );
    await screen.findByText("Статус неизвестен", { exact: true });
    expect(screen.getByText(/Неподтверждённая попытка/)).toBeInTheDocument();
    expect(
      mock.fetcher.mock.calls.filter(([url]) => url.includes("/sendMessage/")),
    ).toHaveLength(1);
  });
  it("disables empty and over-limit text; keeps drafts isolated between chats", async () => {
    server();
    const user = userEvent.setup();
    render(<App />);
    await login(user);
    await chat(user);
    const input = screen.getByLabelText("Сообщение", { exact: true });
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { value: "a".repeat(4001) } });
    expect(
      screen.getByRole("button", { name: "Отправить сообщение" }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { value: "Первый черновик" } });
    await chat(user, "+79997654321");
    expect(screen.getByLabelText("Сообщение", { exact: true })).toHaveValue("");
    await chat(user);
    expect(screen.getByLabelText("Сообщение", { exact: true })).toHaveValue(
      "Первый черновик",
    );
  });
  it("demo causes no external API calls", async () => {
    const mock = server(),
      user = userEvent.setup();
    render(<App />);
    await user.click(
      screen.getByRole("button", { name: "Посмотреть демо без ключей" }),
    );
    await chat(user);
    await waitFor(() =>
      expect(screen.getAllByText("Демо")[0]).toBeInTheDocument(),
    );
    expect(mock.fetcher).not.toHaveBeenCalled();
  });
  it("preserves the draft on Enter while polling is stopped", async () => {
    server({ failPolling: true });
    const user = userEvent.setup();
    render(<App />);
    await login(user);
    await chat(user);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Отправить сообщение" }),
      ).toBeDisabled(),
    );
    const input = screen.getByLabelText("Сообщение", { exact: true });
    await user.type(input, "Не терять");
    fireEvent.submit(input.closest("form")!);
    expect(input).toHaveValue("Не терять");
  });
});
