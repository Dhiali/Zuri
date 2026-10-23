"use client";

import { useCallback, useEffect, useState } from "react";

export type LinkedPosition = {
  symbol: string;
  quantity: number | null;
  side: string | null;
  avg_entry_price: number | null;
  current_price: number | null;
  market_value: number | null;
  unrealized_pl: number | null;
  unrealized_plpc: number | null;
};

export type LinkedAccount = {
  broker: string;
  broker_name: string;
  environment: "paper" | "live";
  account: { currency: string | null; equity: number | null; cash: number | null; buying_power: number | null; label: string | null };
  positions: LinkedPosition[];
};

export type LinkedAccountState = {
  status: "loading" | "none" | "ready" | "error";
  data: LinkedAccount | null;
  error: string;
  refresh: () => void;
};

export const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://127.0.0.1:8000";

export function useLinkedAccount(token: string): LinkedAccountState {
  const [state, setState] = useState<Omit<LinkedAccountState, "refresh">>({ status: "loading", data: null, error: "" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetch(`${backendUrl}/api/account`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (response.status === 404) setState({ status: "none", data: null, error: "" });
        else if (!response.ok) setState({ status: "error", data: null, error: typeof body.detail === "string" ? body.detail : "Unable to load your broker account." });
        else setState({ status: "ready", data: body as LinkedAccount, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", data: null, error: "Unable to reach the Zuri server." });
      });
    return () => {
      cancelled = true;
    };
  }, [token, tick]);

  const refresh = useCallback(() => setTick((value) => value + 1), []);
  return { ...state, refresh };
}

export function formatMoney(value: number | null | undefined, currency: string | null | undefined) {
  if (value === null || value === undefined) return "—";
  const symbol = currency === "USD" || !currency ? "$" : "";
  const formatted = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value < 0 ? "-" : ""}${symbol}${formatted}${symbol ? "" : ` ${currency}`}`;
}
