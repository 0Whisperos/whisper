import { useCallback, useEffect, useRef, useState } from "react";

import { ChatApiError } from "../api";
import { loadFriendRequests } from "../friendRequestsApi";
import type { FriendRequestDirection, FriendRequestDto } from "../types";

interface DirectionState {
  requests: FriendRequestDto[];
  cursor: string | null;
  hasMore: boolean;
}

const emptyDirection: DirectionState = { requests: [], cursor: null, hasMore: false };

export function useFriendRequests(apiBaseUrl: string, accessToken: string, authenticated: boolean) {
  const [incoming, setIncoming] = useState<DirectionState>(emptyDirection);
  const [outgoing, setOutgoing] = useState<DirectionState>(emptyDirection);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ChatApiError | null>(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    setError(null);
    try {
      const [received, sent] = await Promise.all([
        loadFriendRequests(apiBaseUrl, accessToken, "incoming"),
        loadFriendRequests(apiBaseUrl, accessToken, "outgoing"),
      ]);
      if (generation !== generationRef.current) return;
      setIncoming({ requests: received.requests, cursor: received.nextCursor, hasMore: received.hasMore });
      setOutgoing({ requests: sent.requests, cursor: sent.nextCursor, hasMore: sent.hasMore });
      setPendingCount(received.pendingCount);
    } catch (caught) {
      if (generation === generationRef.current) setError(caught instanceof ChatApiError ? caught : new ChatApiError("internal_error"));
    } finally {
      if (generation === generationRef.current) setLoading(false);
    }
  }, [accessToken, apiBaseUrl]);

  useEffect(() => {
    if (authenticated) void refresh();
  }, [authenticated, refresh]);

  const loadMore = useCallback(async (direction: FriendRequestDirection) => {
    const current = direction === "incoming" ? incoming : outgoing;
    if (!current.hasMore || !current.cursor) return;
    setLoading(true);
    setError(null);
    try {
      const page = await loadFriendRequests(apiBaseUrl, accessToken, direction, current.cursor);
      const update = (state: DirectionState): DirectionState => ({
        requests: [...state.requests, ...page.requests.filter((next) => !state.requests.some((prior) => prior.requestId === next.requestId))],
        cursor: page.nextCursor,
        hasMore: page.hasMore,
      });
      if (direction === "incoming") {
        setIncoming(update);
        setPendingCount(page.pendingCount);
      } else setOutgoing(update);
    } catch (caught) {
      setError(caught instanceof ChatApiError ? caught : new ChatApiError("internal_error"));
    } finally { setLoading(false); }
  }, [accessToken, apiBaseUrl, incoming, outgoing]);

  return { incoming: incoming.requests, outgoing: outgoing.requests, incomingHasMore: incoming.hasMore, outgoingHasMore: outgoing.hasMore, pendingCount, loading, error, refresh, loadMore };
}
