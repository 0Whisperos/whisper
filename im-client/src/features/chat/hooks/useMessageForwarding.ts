import { useEffect, useRef, useState } from "react";
import { canForwardMessage, forwardMessageBody, prepareForwardMessage } from "../messageForwarding";
import type { ForwardMessageBody, ForwardMessageDraft } from "../messageForwarding";
import type { ChatData, ChatMessage } from "../types";
import { uploadDraftImages } from "./uploadDraftImages";

type ForwardPhase = "choosing" | "downloading" | "uploading" | "sending" | "failed";
interface ForwardingOptions {
  data: ChatData;
  apiBaseUrl: string;
  accessToken: string;
  canSendMessages: boolean;
  sendMessage: (conversationId: number, body: ForwardMessageBody) => string | null;
  retryMessage: (clientMessageId: string) => void;
}
interface ForwardTask {
  owner: string;
  source: ChatMessage;
  selectedConversationId: number | null;
  phase: ForwardPhase;
  error: string;
  submitted: boolean;
  busy: boolean;
  attempt: number;
  draft?: ForwardMessageDraft;
  clientMessageId?: string;
}

/** A forwarding task owns its downloaded Files and upload metadata, independently of every editor. */
export function useMessageForwarding(options: ForwardingOptions) {
  const latest = useRef(options);
  latest.current = options;
  const owner = `${options.apiBaseUrl.replace(/\/+$/, "")}:${options.data.self.userId}`;
  const [view, setView] = useState<ForwardTask | null>(null);
  const [feedback, setFeedback] = useState("");
  const taskRef = useRef<ForwardTask | null>(null);
  const mounted = useRef(true);
  const currentOwner = () => `${latest.current.apiBaseUrl.replace(/\/+$/, "")}:${latest.current.data.self.userId}`;
  const isActive = (task: ForwardTask) => mounted.current && taskRef.current === task && task.owner === currentOwner();
  const publish = (task: ForwardTask) => { if (isActive(task)) setView({ ...task }); };
  const close = () => { taskRef.current = null; if (mounted.current) setView(null); };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; taskRef.current = null; };
  }, []);
  useEffect(() => { close(); setFeedback(""); }, [owner]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 3_000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const assertActive = (task: ForwardTask) => {
    if (!isActive(task)) throw new Error("转发已取消");
    if (!task.draft) {
      const current = latest.current.data.conversations[task.source.conversationId];
      const source = current?.messages.find((message) => message.messageId === task.source.messageId);
      if (!current || !source || !canForwardMessage(source)) throw new Error("原消息已不可用");
    }
    const target = latest.current.data.conversations[task.selectedConversationId!];
    if (!target || target.type !== "direct") throw new Error("目标会话已不可用");
  };

  useEffect(() => {
    const task = taskRef.current;
    if (!task || !isActive(task)) return;
    if (!task.submitted && !task.draft) {
      const source = options.data.conversations[task.source.conversationId]?.messages
        .find((message) => message.messageId === task.source.messageId);
      if (!source || !canForwardMessage(source)) {
        task.attempt += 1;
        task.busy = false; task.phase = "failed"; task.error = "原消息已不可用"; publish(task);
      }
      return;
    }
    if (!task.submitted) return;
    const target = options.data.conversations[task.selectedConversationId!];
    if (!target || target.type !== "direct") {
      task.busy = false; task.phase = "failed";
      task.error = "目标会话已不可用，发送结果待确认"; publish(task);
      return;
    }
    const sent = target.messages.find((message) =>
      message.senderUserId === options.data.self.userId && message.clientMessageId === task.clientMessageId);
    if (sent?.localStatus === "accepted") {
      close(); setFeedback("转发成功");
    } else if (sent?.localStatus === "failed") {
      task.busy = false; task.phase = "failed";
      task.error = sent.errorCode === "acknowledgement_timeout" ? "发送结果待确认，请重试" : "转发发送失败，请重试";
      publish(task);
    }
  }, [options.data, owner]);

  const open = (message: ChatMessage) => {
    if (!canForwardMessage(message)) return;
    const task: ForwardTask = { owner: currentOwner(), source: message, selectedConversationId: null,
      phase: "choosing", error: "", submitted: false, busy: false, attempt: 0 };
    taskRef.current = task; setFeedback(""); publish(task);
  };
  const selectTarget = (id: number) => {
    const task = taskRef.current;
    if (!task || !isActive(task) || task.phase !== "choosing" || task.busy) return;
    if (latest.current.data.conversations[id]?.type !== "direct") return;
    task.selectedConversationId = id; publish(task);
  };
  const run = async (task: ForwardTask) => {
    if (!isActive(task) || task.busy || !task.selectedConversationId) return;
    const attempt = ++task.attempt;
    const check = () => {
      if (task.attempt !== attempt) throw new Error("转发已取消");
      assertActive(task);
    };
    task.busy = true; task.error = "";
    try {
      if (!latest.current.canSendMessages) throw new Error("连接未就绪，请重试");
      if (task.submitted && task.clientMessageId) {
        const target = latest.current.data.conversations[task.selectedConversationId];
        if (!target || target.type !== "direct") throw new Error("目标会话已不可用，发送结果待确认");
        task.phase = "sending"; publish(task);
        latest.current.retryMessage(task.clientMessageId);
        return;
      }
      check();
      if (!task.draft) {
        task.phase = "downloading"; publish(task);
        const prepared = await prepareForwardMessage(task.source, latest.current.apiBaseUrl,
          () => latest.current.accessToken, check);
        check();
        task.draft = prepared;
      }
      if (task.draft.blocks.some((block) => block.type === "image")) {
        task.phase = "uploading"; publish(task);
        const uploaded = await uploadDraftImages(latest.current.apiBaseUrl, latest.current.accessToken,
          task.selectedConversationId, task.draft.blocks, (blocks) => {
            check();
            task.draft = { ...task.draft!, blocks };
          }, { getAccessToken: () => latest.current.accessToken, assertActive: check });
        check();
        task.draft.blocks = uploaded;
      }
      check();
      if (!latest.current.canSendMessages) throw new Error("连接未就绪，请重试");
      const body = forwardMessageBody(task.draft);
      const id = latest.current.sendMessage(task.selectedConversationId, body);
      if (!id) throw new Error("转发发送失败，请重试");
      task.clientMessageId = id; task.submitted = true; task.phase = "sending"; publish(task);
    } catch (error) {
      if (!isActive(task) || task.attempt !== attempt) return;
      task.busy = false; task.phase = "failed";
      task.error = error instanceof Error ? error.message : "转发失败，请重试"; publish(task);
    }
  };
  const submit = () => {
    const task = taskRef.current;
    if (task?.phase === "choosing") void run(task);
  };
  const retry = () => {
    const task = taskRef.current;
    if (task?.phase === "failed") void run(task);
  };
  const visible = view?.owner === owner ? view : null;
  return { source: visible?.source ?? null, selectedConversationId: visible?.selectedConversationId ?? null,
    phase: visible?.phase ?? "choosing" as ForwardPhase, error: visible?.error ?? "", submitted: visible?.submitted ?? false,
    feedback, open, close, selectTarget, submit, retry };
}
