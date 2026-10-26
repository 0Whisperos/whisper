import type { MessageRecallStatus } from "./messageRecall";
import { isOptionalRecallTimestamp } from "./messageRecall";

export async function loadMessageRecallStatuses(apiBaseUrl: string, accessToken: string, conversationId: number,
  messageIds: string[]): Promise<MessageRecallStatus[]> {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}/v1/conversations/${conversationId}/messages/statuses`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message_ids: [...new Set(messageIds)] }),
  });
  if (!response.ok) throw new Error("撤回状态校准失败，请重试");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("statuses" in value) || !Array.isArray(value.statuses)
    || !value.statuses.every((status: unknown) => status && typeof status === "object" && "message_id" in status
      && typeof status.message_id === "string" && "recalled_at" in status
      && isOptionalRecallTimestamp(status as Record<string, unknown>))) throw new Error("撤回状态响应无效");
  const requested = new Set(messageIds);
  return (value.statuses as MessageRecallStatus[]).filter((status) => requested.has(status.message_id));
}
