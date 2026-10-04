import { describe, expect, it } from "vitest";
import { chatReducer, initialChatState, parseEvent } from "./chat";
import type { Message } from "./chat";
const message: Message = {
  id: "server",
  chatId: "100",
  text: "Hello",
  timestamp: 100,
  direction: "out",
  status: "queued",
};
const event = {
  typeWebhook: "incomingMessageReceived",
  instanceData: { idInstance: 3100000000, typeInstance: "v3" },
  idMessage: "server",
  timestamp: 1760000000,
  senderData: { chatId: "100", chatName: "Name" },
  messageData: {
    typeMessage: "textMessage",
    textMessageData: { textMessage: "Hello" },
  },
};
describe("chat reducer", () => {
  it("deduplicates redelivery and isolates chats", () => {
    let state = chatReducer(initialChatState, { type: "message", message });
    state = chatReducer(state, { type: "message", message });
    state = chatReducer(state, {
      type: "message",
      message: { ...message, chatId: "200" },
    });
    expect(state.messages["100"]).toHaveLength(1);
    expect(state.messages["200"]).toHaveLength(1);
  });
  it("merges API echo before POST resolves and removes the temporary bubble", () => {
    let state = chatReducer(initialChatState, {
      type: "message",
      message: { ...message, id: "local", status: "sending" },
    });
    state = chatReducer(state, { type: "message", message });
    state = chatReducer(state, {
      type: "message",
      message,
      replaceId: "local",
    });
    expect(state.messages["100"]).toHaveLength(1);
  });
  it("keeps early statuses and never regresses read to delivered/queued", () => {
    let state = chatReducer(initialChatState, {
      type: "status",
      chatId: "100",
      id: "server",
      status: "read",
    });
    state = chatReducer(state, { type: "message", message });
    state = chatReducer(state, {
      type: "status",
      chatId: "100",
      id: "server",
      status: "delivered",
    });
    state = chatReducer(state, { type: "message", message });
    expect(state.messages["100"][0].status).toBe("read");
  });
  it("handles asynchronous failure and uncertain POST outcome", () => {
    let state = chatReducer(initialChatState, {
      type: "message",
      message: { ...message, status: "sending" },
    });
    state = chatReducer(state, {
      type: "status",
      chatId: "100",
      id: "server",
      status: "unknown",
    });
    expect(state.messages["100"][0].status).toBe("unknown");
    state = chatReducer(state, {
      type: "status",
      chatId: "100",
      id: "server",
      status: "noAccount",
    });
    expect(state.messages["100"][0].status).toBe("noAccount");
  });
});
describe("event normalization", () => {
  it("supports plain and URL text for incoming and outgoing messages", () => {
    expect(parseEvent(event, "3100000000")).toMatchObject({
      type: "message",
      message: {
        direction: "in",
        chatId: "100",
        text: "Hello",
        timestamp: 1760000000000,
      },
    });
    expect(
      parseEvent(
        {
          ...event,
          typeWebhook: "outgoingAPIMessageReceived",
          messageData: {
            typeMessage: "extendedTextMessage",
            extendedTextMessageData: { text: "https://example.test" },
          },
        },
        "3100000000",
      ),
    ).toMatchObject({
      message: { direction: "out", text: "https://example.test" },
    });
  });
  it("ignores other instances/messengers and unsupported media safely", () => {
    expect(parseEvent(event, "different")).toBeNull();
    expect(
      parseEvent(
        {
          ...event,
          instanceData: { idInstance: 3100000000, typeInstance: "whatsapp" },
        },
        "3100000000",
      ),
    ).toBeNull();
    expect(
      parseEvent(
        { ...event, messageData: { typeMessage: "imageMessage" } },
        "3100000000",
      ),
    ).toBeNull();
  });
});
