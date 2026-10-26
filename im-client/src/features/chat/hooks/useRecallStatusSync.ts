import { useCallback, useEffect, useRef, useState } from "react";
import { loadMessageRecallStatuses } from "../messageRecallApi";
import type { MessageRecallStatus } from "../messageRecall";
import type { ChatData } from "../types";

export interface RecallTarget { conversationId: number; messageId: string }
interface Options {
  apiBaseUrl: string; userId: number; accessToken: string; connectionId: string | null;
  data: ChatData | null; draftTargets: RecallTarget[];
  mergeRecalls: (conversationId: number, statuses: MessageRecallStatus[]) => void;
}
interface Cycle { key: string; seen: Set<string>; pending: Set<string>; failed: Set<string> }

export function collectRecallTargets(data: ChatData, draftTargets: RecallTarget[] = []): RecallTarget[] {
  const targets = [...draftTargets];
  for (const conversation of Object.values(data.conversations)) for (const message of conversation.messages) {
    if (message.messageId) targets.push({ conversationId: conversation.conversationId, messageId: message.messageId });
    const id = message.replyToMessageId ?? message.replyTo?.messageId;
    if (id) targets.push({ conversationId: conversation.conversationId, messageId: id });
  }
  return [...new Map(targets.map((target) => [`${target.conversationId}:${target.messageId}`, target])).values()];
}

/** Query only loaded state, once per actual authenticated connection and newly discovered ID. */
export function useRecallStatusSync(options: Options) {
  const latest = useRef(options); latest.current = options;
  const cycle = useRef<Cycle | null>(null);
  const mounted = useRef(true);
  const [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cycle.current = null; }; }, []);
  const scan = useCallback(() => {
    const current = latest.current;
    const key = `${current.apiBaseUrl.replace(/\/+$/, "")}:${current.userId}:${current.connectionId}`;
    if (!current.connectionId) { cycle.current = null; return; }
    if (cycle.current?.key !== key) { cycle.current = { key, seen: new Set(), pending: new Set(), failed: new Set() }; setError(""); }
    const run = cycle.current;
    if (!current.data) return;
    const targets = collectRecallTargets(current.data, current.draftTargets);
    const groups = new Map<number, string[]>();
    for (const target of targets) {
      const id = `${target.conversationId}:${target.messageId}`;
      if (run.seen.has(id) || run.pending.has(id) || run.failed.has(id)) continue;
      const ids = groups.get(target.conversationId) ?? []; ids.push(target.messageId); groups.set(target.conversationId, ids);
    }
    for (const [conversationId, ids] of groups) for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const keys = batch.map((id) => `${conversationId}:${id}`);
      const isCurrent = () => mounted.current && cycle.current === run
        && `${latest.current.apiBaseUrl.replace(/\/+$/, "")}:${latest.current.userId}:${latest.current.connectionId}` === key;
      keys.forEach((id) => run.pending.add(id));
      void loadMessageRecallStatuses(current.apiBaseUrl, current.accessToken, conversationId, batch).then((statuses) => {
        if (!isCurrent()) return;
        latest.current.mergeRecalls(conversationId, statuses); keys.forEach((id) => run.seen.add(id));
      }).catch(() => {
        if (!isCurrent()) return;
        keys.forEach((id) => run.failed.add(id)); setError("撤回状态校准失败");
      }).finally(() => { keys.forEach((id) => run.pending.delete(id)); });
    }
  }, []);
  useEffect(scan, [scan, options.connectionId, options.data, options.draftTargets, options.apiBaseUrl, options.userId, options.accessToken]);
  const retry = useCallback(() => {
    if (cycle.current) { cycle.current.failed.clear(); cycle.current.seen.clear(); }
    setError(""); scan();
  }, [scan]);
  return { error, retry };
}
