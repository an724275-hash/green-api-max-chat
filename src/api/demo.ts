import type { ChatApi, Notification } from "./client";
import { delay } from "./poll";
/** Fully local simulation: never uses fetch or a real phone/account. */
export function createDemoApi(): ChatApi {
  const idInstance = "0000000000";
  let sequence = 1;
  const queue: Notification[] = [];
  const add = (body: Record<string, unknown>) =>
    queue.push({
      receiptId: sequence++,
      body: {
        ...body,
        instanceData: { idInstance, typeInstance: "v3" },
        timestamp: Date.now() / 1000,
      },
    });
  return {
    idInstance,
    async getState() {
      return "authorized";
    },
    async getSettings() {
      return { incomingWebhook: "yes" };
    },
    async checkAccount(phone, signal) {
      await delay(250, signal);
      return `10${phone}`;
    },
    async sendMessage(chatId, message, signal) {
      await delay(350, signal);
      const id = `demo-${sequence++}`;
      add({
        typeWebhook: "outgoingAPIMessageReceived",
        idMessage: id,
        senderData: { chatId },
        messageData: {
          typeMessage: "textMessage",
          textMessageData: { textMessage: message },
        },
      });
      add({
        typeWebhook: "outgoingMessageStatus",
        chatId,
        idMessage: id,
        status: "read",
      });
      add({
        typeWebhook: "incomingMessageReceived",
        idMessage: `demo-${sequence++}`,
        senderData: { chatId, chatName: "Демо-собеседник" },
        messageData: {
          typeMessage: "textMessage",
          textMessageData: {
            textMessage: "Привет! Сообщение вижу.",
          },
        },
      });
      return id;
    },
    async receive(signal) {
      await delay(600, signal);
      return queue[0] ?? null;
    },
    async acknowledge(receiptId) {
      if (queue[0]?.receiptId === receiptId) queue.shift();
      return true;
    },
  };
}
