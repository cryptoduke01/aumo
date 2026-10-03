// Per-client request budget for the public HTTP mode. Every tool call fans out to the X Layer RPC and the
// agent API, so an open endpoint must not let one caller turn it into a flooder. Fixed one-minute window.

export interface RateLimiter {
  /** True if this client may make another request now (and counts it). */
  take(client: string, now?: number): boolean;
}

export function createRateLimiter(perMinute: number, maxClients = 10_000): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(client, now = Date.now()) {
      const w = windows.get(client);
      if (!w || now - w.start >= 60_000) {
        if (!w && windows.size >= maxClients) {
          // Drop expired windows; if none expired, the table is full of live clients and this one waits.
          for (const [k, v] of windows) if (now - v.start >= 60_000) windows.delete(k);
          if (windows.size >= maxClients) return false;
        }
        windows.set(client, { start: now, count: 1 });
        return true;
      }
      if (w.count >= perMinute) return false;
      w.count++;
      return true;
    },
  };
}
