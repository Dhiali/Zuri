"use client";

import { useEffect, useState } from "react";
import { backendUrl } from "./linked-account";

type PendingOrder = { id: string; symbol: string; quantity: number | null; side: string | null; type: string | null; status: string | null; submitted_at?: string | null; order_class?: string | null };

const STATUS_TEXT: Record<string, string> = {
  new: "Waiting to fill",
  accepted: "Accepted, waiting for the market",
  pending_new: "Being sent to the market",
  partially_filled: "Partly filled",
  held: "Waiting for its entry to fill",
  accepted_for_bidding: "Accepted, waiting for the market",
};

export function PendingOrders({ token, enabled, refreshKey }: { token: string; enabled: boolean; refreshKey: number }) {
  const [orders, setOrders] = useState<PendingOrder[] | null>(null);
  const [error, setError] = useState("");
  const [marketClosed, setMarketClosed] = useState(false);
  const [reload, setReload] = useState(0);
  const [cancelling, setCancelling] = useState("");

  async function cancel(order: PendingOrder) {
    if (!window.confirm(`Cancel your ${order.side === "sell" ? "sell" : "buy"} order for ${order.quantity ?? ""} ${order.symbol}? Nothing has been traded yet.`)) return;
    setCancelling(order.id);
    setError("");
    try {
      const response = await fetch(`${backendUrl}/api/orders/${order.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The order could not be cancelled.");
      setOrders((current) => (current ?? []).filter((item) => item.id !== order.id));
      setReload((value) => value + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The order could not be cancelled.");
      setReload((value) => value + 1);
    } finally {
      setCancelling("");
    }
  }

  useEffect(() => {
    if (!enabled || !token) return;
    let cancelled = false;
    async function load() {
      try {
        const [response, status] = await Promise.all([
          fetch(`${backendUrl}/api/orders`, { headers: { Authorization: `Bearer ${token}` } }),
          fetch(`${backendUrl}/api/market-status`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Could not load your pending orders.");
        setOrders(body.orders ?? []);
        setMarketClosed(Boolean(status?.available && !status.is_open));
        setError("");
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load your pending orders.");
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [enabled, token, refreshKey, reload]);

  if (!enabled) return null;
  return (
    <section className="content-card pending-card" data-zuri-target="pending-orders">
      <div className="section-title"><div><span className="small-label">WAITING TO FILL</span><h2>Pending orders</h2></div><span className="muted">{orders ? `${orders.length} pending` : "Loading…"}</span></div>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {orders && orders.length === 0 && !error && <p className="muted">No pending orders. Orders you send while the market is closed wait here until it opens, then move to Open positions.</p>}
      {orders && orders.length > 0 && (
        <>
          {marketClosed && <p className="auth-message" role="note">The market is closed, so these will fill when it opens. They aren&apos;t positions yet.</p>}
          <div className="table-scroll"><table><thead><tr><th>SYMBOL</th><th>SIDE</th><th>QTY</th><th>TYPE</th><th>STATUS</th><th>SENT</th><th></th></tr></thead><tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td><b>{order.symbol}</b></td>
                <td><span className={order.side === "sell" ? "side-pill short" : "side-pill long"}>{order.side === "sell" ? "Sell" : "Buy"}</span></td>
                <td>{order.quantity ?? "—"}</td>
                <td>{order.order_class === "bracket" ? "Market + stop/target" : (order.type ?? "market")}</td>
                <td>{STATUS_TEXT[order.status ?? ""] ?? order.status ?? "Pending"}</td>
                <td>{order.submitted_at ? new Date(order.submitted_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                <td><button className="outline-button" disabled={cancelling === order.id} onClick={() => void cancel(order)}>{cancelling === order.id ? "Cancelling…" : "Cancel"}</button></td>
              </tr>
            ))}
          </tbody></table></div>
        </>
      )}
    </section>
  );
}
