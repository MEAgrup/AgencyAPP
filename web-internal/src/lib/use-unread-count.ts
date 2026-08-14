'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { NotificationsResponse } from '@/lib/types';

const POLL_MS = 30_000;

/** Polls GET /notifications?unread=1 every 30s for the header bell badge. */
export function useUnreadCount(enabled: boolean) {
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<NotificationsResponse>('/notifications?unread=1');
      setUnreadCount(res.unread_count);
    } catch {
      // Non-fatal for the badge; keep last known value.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // P-1: the badge used to poll every 30s forever, including in tabs the user
    // left open in the background. Those requests travel the full
    // browser → web-internal → apps/api → pooler path and compete with the fetches
    // of whatever tab the user is ACTUALLY looking at. Poll only while the tab is
    // visible, and refresh once on the way back so the badge is never stale when
    // it is on screen.
    let interval: ReturnType<typeof setInterval> | undefined;

    const stop = () => {
      if (interval !== undefined) {
        clearInterval(interval);
        interval = undefined;
      }
    };

    const start = () => {
      if (interval === undefined) {
        interval = setInterval(refresh, POLL_MS);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }
      refresh();
      start();
    };

    refresh();
    if (document.visibilityState !== 'hidden') {
      start();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, refresh]);

  return { unreadCount, refresh };
}
