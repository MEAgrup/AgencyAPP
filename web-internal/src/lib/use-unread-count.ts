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
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [enabled, refresh]);

  return { unreadCount, refresh };
}
