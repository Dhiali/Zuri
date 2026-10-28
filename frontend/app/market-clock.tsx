"use client";

import { useEffect, useState } from "react";
import { backendUrl } from "./linked-account";

type Status = { available: boolean; is_open?: boolean; next_open?: string; next_close?: string };

function untilText(target: string | undefined, now: number) {
  const ms = target ? new Date(target).getTime() - now : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function MarketClock({ token, enabled }: { token: string; enabled: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${backendUrl}/api/market-status`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok && !cancelled) setStatus(await response.json());
      } catch {
        // The clock is a convenience; a failed refresh keeps the last known state.
      }
    }
    void load();
    const refresh = window.setInterval(() => void load(), 5 * 60000);
    return () => { cancelled = true; window.clearInterval(refresh); };
  }, [enabled, token]);

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  if (!enabled || !status?.available) return null;
  const target = status.is_open ? status.next_close : status.next_open;
  const left = untilText(target, now);
  const when = target ? new Date(target).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const stale = target && new Date(target).getTime() < now;
  return (
    <span className={status.is_open ? "market-clock open" : "market-clock closed"} title={when ? `${status.is_open ? "Closes" : "Opens"} ${when} (your time)` : undefined}>
      <i aria-hidden="true" />
      {status.is_open ? "US MARKET OPEN" : "US MARKET CLOSED"}
      {left && !stale ? ` · ${status.is_open ? "closes" : "opens"} in ${left}` : ""}
    </span>
  );
}
