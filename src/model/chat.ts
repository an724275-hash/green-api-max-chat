import { record } from "../api/client";
export type MessageStatus =
  | "sending"
  | "queued"
  | "delivered"
  | "read"
  | "failed"
  | "noAccount"
  | "notInGroup"
  | "unknown";
export interface Message {
  id: string;
  chatId: string;
  text: string;
  direction: "in" | "out";
  timestamp: number;
  status?: MessageStatus;
}
export interface Chat {
  id: string;
  label: string;
  phone?: string;
}
export interface ChatState {
  chats: Record<string, Chat>;
  messages: Record<string, Message[]>;
  statuses: Record<string, MessageStatus>;
}
export const initialChatState: ChatState = {
  chats: {},
  messages: {},
  statuses: {},
};
export type Action =
  | { type: "chat"; chat: Chat }
  | { type: "message"; message: Message; replaceId?: string; label?: string }
  | { type: "status"; chatId: string; id: string; status: MessageStatus };

const rank: Record<MessageStatus, number> = {
  sending: 0,
  unknown: 1,
  queued: 2,
  delivered: 3,
  read: 4,
  failed: 5,
  noAccount: 5,
  notInGroup: 5,
};
const newestStatus = (a?: MessageStatus, b?: MessageStatus) =>
  !a ? b : !b ? a : rank[b] > rank[a] ? b : a;
const statusKey = (chatId: string, id: string) => `${chatId}:${id}`;

export function chatReducer(state: ChatState, action: Action): ChatState {
  if (action.type === "chat")
    return {
      ...state,
      chats: {
        ...state.chats,
        [action.chat.id]: { ...state.chats[action.chat.id], ...action.chat },
      },
    };
  if (action.type === "status") {
    const key = statusKey(action.chatId, action.id);
    const status = newestStatus(state.statuses[key], action.status)!;
    return {
      ...state,
      statuses: { ...state.statuses, [key]: status },
      messages: {
        ...state.messages,
        [action.chatId]: (state.messages[action.chatId] ?? []).map((message) =>
          message.id === action.id
            ? { ...message, status: newestStatus(message.status, status) }
            : message,
        ),
      },
    };
  }
  const { message } = action;
  const messages = (state.messages[message.chatId] ?? []).filter(
    (item) => item.id !== action.replaceId,
  );
  const existing = messages.find((item) => item.id === message.id);
  const status = newestStatus(
    // Webhook status may arrive before the send response; do not downgrade it to queued.
    newestStatus(existing?.status, message.status),
    state.statuses[statusKey(message.chatId, message.id)],
  );
  const merged = { ...existing, ...message, ...(status && { status }) };
  const updated = existing
    ? messages.map((item) => (item.id === message.id ? merged : item))
    : [...messages, merged];
  const chat = state.chats[message.chatId] ?? {
    id: message.chatId,
    label: action.label || `Чат ${message.chatId}`,
  };
  return {
    ...state,
    chats: { ...state.chats, [message.chatId]: chat },
    messages: {
      ...state.messages,
      [message.chatId]: updated.sort((a, b) => a.timestamp - b.timestamp),
    },
  };
}

export function parseEvent(
  body: Record<string, unknown>,
  idInstance: string,
): Action | null {
  const instance = record(body.instanceData);
  if (
    String(instance.idInstance) !== idInstance ||
    (instance.typeInstance && instance.typeInstance !== "v3")
  )
    return null;
  const id = typeof body.idMessage === "string" ? body.idMessage : "";
  if (body.typeWebhook === "outgoingMessageStatus") {
    const allowed = ["delivered", "read", "failed", "noAccount", "notInGroup"];
    if (
      id &&
      typeof body.chatId === "string" &&
      /^-?\d+$/.test(body.chatId) &&
      typeof body.status === "string" &&
      allowed.includes(body.status)
    )
      return {
        type: "status",
        chatId: body.chatId,
        id,
        status: body.status as MessageStatus,
      };
    return null;
  }
  if (
    ![
      "incomingMessageReceived",
      "outgoingMessageReceived",
      "outgoingAPIMessageReceived",
    ].includes(String(body.typeWebhook))
  )
    return null;
  const sender = record(body.senderData),
    data = record(body.messageData);
  const text =
    data.typeMessage === "textMessage"
      ? record(data.textMessageData).textMessage
      : data.typeMessage === "extendedTextMessage"
        ? record(data.extendedTextMessageData).text
        : undefined;
  if (
    !id ||
    typeof sender.chatId !== "string" ||
    !/^-?\d+$/.test(sender.chatId) ||
    typeof text !== "string" ||
    typeof body.timestamp !== "number" ||
    !Number.isFinite(body.timestamp) ||
    !Number.isFinite(new Date(Number(body.timestamp) * 1000).getTime())
  )
    return null;
  const incoming = body.typeWebhook === "incomingMessageReceived";
  return {
    type: "message",
    label: typeof sender.chatName === "string" ? sender.chatName : undefined,
    message: {
      id,
      chatId: sender.chatId,
      text,
      direction: incoming ? "in" : "out",
      timestamp: body.timestamp * 1000,
      ...(!incoming && { status: "queued" }),
    },
  };
}
