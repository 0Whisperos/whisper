import type { ChatRecallAcceptedFrame, ChatRecallRejectedFrame, ChatMessageRecalledFrame } from "./types";

export function isRecallServerFrame(value: unknown): value is ChatRecallAcceptedFrame | ChatRecallRejectedFrame | ChatMessageRecalledFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as Record<string, unknown>;
  if (!frame.payload || typeof frame.payload !== "object") return false;
  const payload = frame.payload as Record<string, unknown>;
  if (frame.type === "recall_message_rejected") return typeof frame.request_id === "string"
    && typeof payload.error_code === "string" && typeof payload.message === "string"
    && (payload.message_id === undefined || typeof payload.message_id === "string");
  if (frame.type !== "recall_message_accepted" && frame.type !== "message_recalled") return false;
  return (frame.type === "message_recalled" ? typeof payload.event_id === "string" : typeof frame.request_id === "string")
    && typeof payload.message_id === "string" && Boolean(payload.message_id)
    && [payload.conversation_id, payload.conversation_seq, payload.sender_user_id]
      .every((value) => typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    && typeof payload.recalled_at === "string" && Number.isFinite(Date.parse(payload.recalled_at));
}
