"use client";

import { useEffect, useState } from "react";
import { backendUrl } from "./linked-account";

export type MarketStatus = { available: boolean; is_open?: boolean; next_open?: string | null; next_close?: string | null; queues?: boolean; market?: string; always_open?: boolean; broker?: string };

export function formatOpenTime(target: string | null | undefined) {
  return target ? new Date(target).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

function untilText(target: string | null | undefined, now: number) {
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

export function useMarketStatus(token: string, enabled: boolean, symbol?: string) {
  const [status, setStatus] = useState<MarketStatus | null>(null);
  const cleanSymbol = (symbol ?? "").trim();

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    async function load() {
      try {
        const query = cleanSymbol && /^[A-Za-z0-9_./-]{1,20}$/.test(cleanSymbol) ? `?symbol=${encodeURIComponent(cleanSymbol)}` : "";
        const response = await fetch(`${backendUrl}/api/market-status${query}`, { headers: { Authorization: `Bearer ${token}` } });
        if (response.ok && !cancelled) setStatus(await response.json());
      } catch {
        // The clock is a convenience; a failed refresh keeps the last known state.
      }
    }
    const delay = window.setTimeout(() => void load(), symbol === undefined ? 0 : 500);
    const refresh = window.setInterval(() => void load(), 5 * 60000);
    return () => { cancelled = true; window.clearTimeout(delay); window.clearInterval(refresh); };
  }, [enabled, token, cleanSymbol, symbol]);

  return status;
}

export function MarketClock({ token, enabled }: { token: string; enabled: boolean }) {
  const status = useMarketStatus(token, enabled);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(tick);
  }, []);

  if (!enabled || !status?.available) return null;
  const target = status.is_open ? status.next_close : status.next_open;
  const left = untilText(target, now);
  const when = formatOpenTime(target);
  const stale = target && new Date(target).getTime() < now;
  const label = (status.market ?? "US stock market").replace(/ stock/i, "").toUpperCase();
  return (
    <span className={status.is_open ? "market-clock open" : "market-clock closed"} title={when ? `${status.is_open ? "Closes" : "Opens"} ${when} (your time)` : undefined}>
      <i aria-hidden="true" />
      {label} {status.is_open ? "OPEN" : "CLOSED"}
      {left && !stale ? ` · ${status.is_open ? "closes" : "opens"} in ${left}` : ""}
    </span>
  );
}
