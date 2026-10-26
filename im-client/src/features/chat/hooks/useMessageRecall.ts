import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatBusinessServerFrame } from "../../chat-connection/types";
import { canRecallMessage, type MessageRecallStatus } from "../messageRecall";
import type { ChatData, ChatMessage } from "../types";

interface Options {
  owner: string;
  data: ChatData | null;
  canSend: boolean;
  sendRecall: (messageId: string, requestId: string) => void;
  mergeRecalls: (conversationId: number, statuses: MessageRecallStatus[]) => void;
}
interface Attempt { requestId: string; timer: ReturnType<typeof setTimeout> }

/** Own request lifecycle; message delivery status remains independent of recall failures. */
export function useMessageRecall(options: Options) {
  const latest = useRef(options); latest.current = options;
  const pending = useRef(new Map<string, Attempt>());
  const requestOwner = useRef(options.owner);
  const [feedback, setFeedback] = useState("");
  const [version, setVersion] = useState(0);
  const clear = useCallback((id: string) => {
    const attempt = pending.current.get(id);
    if (attempt) { clearTimeout(attempt.timer); pending.current.delete(id); setVersion((value) => value + 1); }
  }, []);
  useEffect(() => {
    if (requestOwner.current !== options.owner) { requestOwner.current = options.owner; setVersion((value) => value + 1); }
    setFeedback("");
    return () => { for (const attempt of pending.current.values()) clearTimeout(attempt.timer); pending.current.clear(); };
  }, [options.owner]);
  useEffect(() => {
    for (const conversation of Object.values(options.data?.conversations ?? {})) {
      for (const message of conversation.messages) if (message.messageId && message.recalledAt) clear(message.messageId);
    }
  }, [options.data, clear]);
  const recall = useCallback((message: ChatMessage) => {
    const current = latest.current;
    const actual = current.data?.conversations[message.conversationId]?.messages.find((item) => item.messageId === message.messageId);
    if (!actual || !canRecallMessage(actual, current.data!.self.userId) || !actual.messageId) return;
    const id = actual.messageId;
    if (pending.current.has(id)) return;
    if (!current.canSend) { setFeedback("连接未就绪，请重试撤回"); return; }
    const requestId = crypto.randomUUID();
    const owner = current.owner;
    const timer = setTimeout(() => {
      if (latest.current.owner !== owner || pending.current.get(id)?.requestId !== requestId) return;
      clear(id); setFeedback("撤回结果待确认，可再次撤回重试");
    }, 15_000);
    pending.current.set(id, { requestId, timer }); setVersion((value) => value + 1); setFeedback("");
    try { current.sendRecall(id, requestId); }
    catch { clear(id); setFeedback("撤回发送失败，请重试"); }
  }, [clear]);
  const handleFrame = useCallback((frame: ChatBusinessServerFrame): boolean => {
    if (frame.type === "recall_message_accepted" || frame.type === "message_recalled") {
      latest.current.mergeRecalls(frame.payload.conversation_id, [frame.payload]);
      clear(frame.payload.message_id); setFeedback(""); return true;
    }
    if (frame.type !== "recall_message_rejected") return false;
    const entry = [...pending.current].find(([, attempt]) => attempt.requestId === frame.request_id);
    if (entry) {
      clear(entry[0]);
      const recalled = Object.values(latest.current.data?.recalledMessages ?? {}).some((states) => Boolean(states[entry[0]]));
      if (!recalled) setFeedback(frame.payload.error_code === "message_not_owned" ? "只能撤回自己发送的消息"
        : frame.payload.error_code === "message_not_found" ? "消息不存在或已不可访问" : "撤回失败，请重试");
    }
    return true;
  }, [clear]);
  return { recall, handleFrame, feedback, pendingIds: new Set(pending.current.keys()), version };
}
