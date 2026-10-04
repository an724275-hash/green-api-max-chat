import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
const key = "fake-test-token-not-a-real-key";
const idInstance = "3100000000";
const note = (
  id: string,
  text: string,
  chatId = "10000000",
  type = "incomingMessageReceived",
) => ({
  receiptId: Number(id),
  body: {
    typeWebhook: type,
    instanceData: { idInstance, typeInstance: "v3" },
    idMessage: id,
    timestamp: Math.floor(Date.now() / 1000),
    senderData: { chatId, chatName: "Тестовый собеседник" },
    messageData: {
      typeMessage: "textMessage",
      textMessageData: { textMessage: text },
    },
  },
});
async function mockApi(
  page: Page,
  options: {
    failSend?: boolean;
    failPolling?: boolean;
    noAccount?: boolean;
    state?: string;
    settings?: Record<string, unknown>;
  } = {},
) {
  let queue: ReturnType<typeof note>[] = [];
  let receipt = 1,
    sendCount = 0,
    checkCount = 0,
    authCount = 0;
  await page.route("https://**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!url.hostname.endsWith("api.green-api.com")) {
      await route.abort();
      return;
    }
    const method = url.pathname.split("/")[2];
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        json: body,
        status,
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,DELETE",
          "Access-Control-Allow-Headers": "content-type",
        },
      });
      return;
    }
    if (method === "getStateInstance") {
      authCount++;
      await json({ stateInstance: options.state ?? "authorized" });
      return;
    }
    if (method === "getSettings") {
      await json({
        webhookUrl: "",
        incomingWebhook: "yes",
        outgoingAPIMessageWebhook: "yes",
        outgoingWebhook: "yes",
        ...options.settings,
      });
      return;
    }
    if (method === "checkAccount") {
      checkCount++;
      const phone = request.postDataJSON().phoneNumber;
      await json({
        exist: !options.noAccount,
        chatId: phone === 79991234567 ? "10000000" : "20000000",
      });
      return;
    }
    if (method === "sendMessage") {
      sendCount++;
      const { chatId, message } = request.postDataJSON();
      expect(chatId).toMatch(/^(10000000|20000000)$/);
      if (options.failSend) {
        await route.abort("failed");
        return;
      }
      const id = String(receipt++);
      // Duplicate event deliveries must yield exactly one visible message.
      queue.push(note(id, message, chatId, "outgoingAPIMessageReceived"));
      const reply = note(String(receipt++), "Ответ из MAX (mock)", chatId);
      queue.push(reply, { ...reply, receiptId: receipt++ });
      await json({ idMessage: id });
      return;
    }
    if (method === "receiveNotification") {
      if (options.failPolling) {
        await json({ error: "unauthorized" }, 401);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      await json(queue[0] ?? null);
      return;
    }
    if (method === "deleteNotification") {
      const current = Number(url.pathname.split("/").at(-1));
      queue = queue.filter((event) => event.receiptId !== current);
      await json({ result: true });
      return;
    }
    await json({}, 404);
  });
  return {
    counts: () => ({ sendCount, checkCount, authCount }),
    enqueue: (event: ReturnType<typeof note>) => queue.push(event),
    resumePolling: () => { options.failPolling = false; },
  };
}
async function connect(page: Page) {
  await page.goto("/");
  await page.getByLabel("idInstance", { exact: true }).fill(idInstance);
  await page.getByLabel("apiTokenInstance", { exact: true }).fill(key);
  await page.getByRole("button", { name: "Подключиться", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Сообщения", exact: true }),
  ).toBeVisible();
}
async function createChat(page: Page, phone = "+79991234567") {
  await page.getByLabel("Новый чат по номеру").fill(phone);
  await page.getByRole("button", { name: "Создать чат", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: phone, exact: true }),
  ).toBeVisible();
}
test("real adapter contract via mocks: send, reply, dedupe, no secret storage, logout and second session", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const mock = await mockApi(page);
  await connect(page);
  await createChat(page);
  await expect(
    page.getByRole("button", { name: "Отправить сообщение" }),
  ).toBeDisabled();
  await page.getByLabel("Сообщение", { exact: true }).fill("Привет, MAX!");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(
    page.getByRole("log").getByText("Ответ из MAX (mock)", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(2800);
  await expect(
    page.getByRole("log").getByText("Привет, MAX!", { exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("log").getByText("Ответ из MAX (mock)", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("");
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      url: location.href,
    })),
  ).toEqual({ local: 0, session: 0, url: "http://127.0.0.1:5178/" });
  await createChat(page);
  expect(mock.counts().checkCount).toBe(1);
  await page.getByRole("button", { name: "Отключиться", exact: true }).click();
  await expect(
    page.getByLabel("apiTokenInstance", { exact: true }),
  ).toHaveValue("");
  await connect(page);
  await createChat(page, "+79997654321");
  await expect(
    page.getByRole("log").getByText("Привет, MAX!", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("uncertain send is shown once and never retried automatically", async ({
  page,
}) => {
  const mock = await mockApi(page, { failSend: true });
  await connect(page);
  await createChat(page);
  await page.getByLabel("Сообщение", { exact: true }).fill("Важный текст");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(
    page.getByText("Статус неизвестен", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Неподтверждённая попытка/)).toBeVisible();
  await page.waitForTimeout(2500);
  expect(mock.counts().sendCount).toBe(1);
});
test("stopped polling does not erase draft on Enter", async ({ page }) => {
  await mockApi(page, { failPolling: true });
  await connect(page);
  await createChat(page);
  await expect(
    page.getByRole("button", { name: "Повторить получение" }).last(),
  ).toBeVisible();
  const input = page.getByLabel("Сообщение", { exact: true });
  await input.fill("Оставить в редакторе");
  await input.press("Enter");
  await expect(input).toHaveValue("Оставить в редакторе");
});
test("mobile invalid phone/account errors stay visible before first chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, { noAccount: true });
  await connect(page);
  await page.getByLabel("Новый чат по номеру").fill("123");
  await page.getByRole("button", { name: "Создать чат" }).click();
  await expect(
    page.getByText(/MAX CheckAccount поддерживает/).first(),
  ).toBeVisible();
  await page.getByLabel("Новый чат по номеру").fill("+79991234567");
  await page.getByRole("button", { name: "Создать чат" }).click();
  await expect(page.getByText(/Аккаунт MAX не найден/).first()).toBeVisible();
});
test("demo keeps phones with identical last eight digits in separate chats", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Посмотреть демо без ключей" }).click();
  await createChat(page, "+79991234567");
  await page.getByLabel("Сообщение", { exact: true }).fill("Черновик первого чата");
  await createChat(page, "+78891234567");
  await expect(page.getByRole("navigation", { name: "Список чатов" }).getByRole("button")).toHaveCount(2);
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("");
  await page.getByRole("navigation", { name: "Список чатов" }).getByRole("button", { name: /79991234567/ }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("Черновик первого чата");
});

test("untrusted apiUrl is rejected before any API call", async ({ page }) => {
  const mock = await mockApi(page);
  await page.goto("/");
  await page.getByLabel("idInstance", { exact: true }).fill(idInstance);
  await page.getByLabel("apiTokenInstance", { exact: true }).fill(key);
  await page.getByLabel(/^apiUrl/).fill("https://evil.test");
  await page.getByRole("button", { name: "Подключиться", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTPS apiUrl");
  expect(mock.counts().authCount).toBe(0);
});

test("login rejects unauthorized state, wrong messenger and webhook delivery", async ({ page }) => {
  for (const options of [
    { state: "notAuthorized" },
    { settings: { typeInstance: "whatsapp" } },
    { settings: { webhookUrl: "https://example.test/webhook" } },
  ]) {
    await page.unrouteAll({ behavior: "wait" });
    await mockApi(page, options);
    await page.goto("/");
    await page.getByLabel("idInstance", { exact: true }).fill(idInstance);
    await page.getByLabel("apiTokenInstance", { exact: true }).fill(key);
    await page.getByRole("button", { name: "Подключиться", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Подключить инстанс" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Сообщения", exact: true })).toHaveCount(0);
  }
});

test("polling can restart after access recovery without losing the draft", async ({ page }) => {
  const mock = await mockApi(page, { failPolling: true });
  await connect(page);
  await createChat(page);
  await expect(page.getByRole("button", { name: "Повторить получение" }).last()).toBeVisible();
  await page.getByLabel("Сообщение", { exact: true }).fill("Черновик после сбоя");
  mock.resumePolling();
  await page.getByRole("button", { name: "Повторить получение" }).last().click();
  await expect(page.getByText("Получение включено", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("Черновик после сбоя");
  await expect(page.getByRole("button", { name: "Отправить сообщение" })).toBeEnabled();
  expect(mock.counts().sendCount).toBe(0);
});

test("demo, accessible controls, responsive layout and screenshots", async ({
  page,
}) => {
  await page.goto("/");
  await page.screenshot({
    path: "docs/screenshots/01-connect-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Посмотреть демо без ключей" })
    .click();
  await createChat(page);
  await page
    .getByLabel("Сообщение", { exact: true })
    .fill("Привет! Проверяю текстовый чат на React 👋");
  await page.getByRole("button", { name: "Отправить сообщение" }).click();
  await expect(page.getByText(/Сообщение получено 👋/).last()).toBeVisible({
    timeout: 10000,
  });
  await expect(
    page.getByText("Прочитано", { exact: false }).last(),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/02-demo-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Назад к чатам" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  );
  await page.screenshot({
    path: "docs/screenshots/03-demo-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Назад к чатам" }).click();
  await expect(page.getByLabel("Новый чат по номеру")).toBeVisible();
  await page.getByRole("button", { name: "Отключиться", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Подключить инстанс" }),
  ).toBeVisible();
});
