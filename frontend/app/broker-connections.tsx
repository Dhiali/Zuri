"use client";

import { useCallback, useEffect, useState } from "react";
import { useZuriAuth } from "./auth";

import { backendUrl, formatMoney } from "./linked-account";

type Environment = "paper" | "live";

type BrokerInfo = {
  id: string;
  name: string;
  fields: string[];
  environments: Environment[];
  asset_class: string;
  linked: { environment: Environment; account_label: string | null } | null;
};

type BrokerAccount = {
  environment: Environment;
  account: { currency: string | null; equity: number | null; cash: number | null; buying_power: number | null; label: string | null };
  positions: { symbol: string; quantity: number | null; market_value: number | null }[];
};

const fieldLabels: Record<string, string> = {
  api_key: "API key ID",
  api_secret: "API secret key",
  api_token: "API token",
  access_token: "Access token",
  account_id: "Account ID",
};

export function BrokerConnections({ onChange }: { onChange?: () => void }) {
  const { session } = useZuriAuth();
  const token = session?.access_token ?? "";
  const [brokers, setBrokers] = useState<BrokerInfo[]>([]);
  const [livePhrase, setLivePhrase] = useState("CONFIRM LIVE");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [linking, setLinking] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Record<string, BrokerAccount>>({});
  const [orderBroker, setOrderBroker] = useState<string | null>(null);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(`${backendUrl}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...init?.headers },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : "Request failed.");
    return body;
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      const data = await call("/api/brokers");
      setBrokers(data.brokers);
      setLivePhrase(data.live_confirmation_phrase);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unable to load brokers.");
    }
  }, [call]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void call("/api/brokers").then((data) => {
      if (cancelled) return;
      setBrokers(data.brokers);
      setLivePhrase(data.live_confirmation_phrase);
      setLoadError("");
    }).catch((e: unknown) => {
      if (!cancelled) setLoadError(e instanceof Error ? e.message : "Unable to load brokers.");
    });
    return () => {
      cancelled = true;
    };
  }, [token, call]);

  async function handleLink(event: React.FormEvent<HTMLFormElement>, broker: BrokerInfo) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const credentials = Object.fromEntries(broker.fields.map((field) => [field, String(form.get(field) ?? "")]));
    setBusy(broker.id);
    setError("");
    setMessage("");
    try {
      await call("/api/brokers/link", {
        method: "POST",
        body: JSON.stringify({ broker: broker.id, environment: String(form.get("environment")), credentials }),
      });
      setMessage(`${broker.name} linked.`);
      setLinking(null);
      await refresh();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to link broker.");
    } finally {
      setBusy("");
    }
  }

  async function handleUnlink(broker: BrokerInfo) {
    if (!window.confirm(`Disconnect ${broker.name}? Zuri will delete the stored credentials.`)) return;
    setBusy(broker.id);
    setError("");
    try {
      await call(`/api/brokers/${broker.id}`, { method: "DELETE" });
      setAccounts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== broker.id)));
      setMessage(`${broker.name} disconnected.`);
      await refresh();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to disconnect broker.");
    } finally {
      setBusy("");
    }
  }

  async function handleLoadAccount(broker: BrokerInfo) {
    setBusy(broker.id);
    setError("");
    try {
      const data: BrokerAccount = await call(`/api/brokers/${broker.id}/account`);
      setAccounts((current) => ({ ...current, [broker.id]: data }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load account.");
    } finally {
      setBusy("");
    }
  }

  async function handleOrder(event: React.FormEvent<HTMLFormElement>, broker: BrokerInfo) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      symbol: String(form.get("symbol") ?? "").trim(),
      side: String(form.get("side")),
      quantity: Number(form.get("quantity")),
      confirmed: form.get("confirmed") === "on",
      confirmation_phrase: String(form.get("phrase") ?? ""),
    };
    setBusy(broker.id);
    setError("");
    setMessage("");
    try {
      const result = await call(`/api/brokers/${broker.id}/orders`, { method: "POST", body: JSON.stringify(body) });
      setMessage(`${result.environment === "live" ? "LIVE" : "Paper"} order sent to ${broker.name}: ${result.status ?? "submitted"}.`);
      setOrderBroker(null);
      onChange?.();
      await handleLoadAccount(broker);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Order failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="settings-section">
      <span className="small-label">LIVE BROKER ACCOUNTS</span>
      <h3>Linked brokers</h3>
      <div data-zuri-target="broker-list">
      <p className="auth-message">Credentials are encrypted on the Zuri server and never returned to the browser. Use API keys with trading permissions only; never enable withdrawals.</p>
      {loadError && <p className="auth-error" role="alert">{loadError}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p className="auth-message" role="status">{message}</p>}
      {brokers.map((broker) => {
        const account = accounts[broker.id];
        const isBusy = busy === broker.id;
        return (
          <div className="setting-row broker-card" key={broker.id}>
            <div>
              <b>{broker.name}</b>
              <small>
                {broker.asset_class} • {broker.linked ? `${broker.linked.environment === "live" ? "LIVE" : "Paper"} account ${broker.linked.account_label ?? ""}` : "Not linked"}
              </small>
              {account && (
                <small>
                  Equity {formatMoney(account.account.equity, account.account.currency)} • Cash {formatMoney(account.account.cash, account.account.currency)} • {account.positions.length} open position(s)
                  {account.positions.map((position) => ` ${position.symbol} ${position.quantity ?? ""}`).join(",")}
                </small>
              )}
            </div>
            <div className="account-edit-actions">
              {broker.linked ? (
                <>
                  <button type="button" className="account-edit-button" disabled={isBusy} onClick={() => void handleLoadAccount(broker)}>Refresh</button>
                  <button type="button" className="account-edit-button" disabled={isBusy} onClick={() => setOrderBroker(orderBroker === broker.id ? null : broker.id)}>Trade</button>
                  <button type="button" className="account-edit-button" disabled={isBusy} onClick={() => void handleUnlink(broker)}>Disconnect</button>
                </>
              ) : (
                <button type="button" className="account-edit-button" disabled={isBusy} onClick={() => setLinking(linking === broker.id ? null : broker.id)}>Link account</button>
              )}
            </div>
            {linking === broker.id && (
              <form className="broker-form" data-zuri-target="broker-form" onSubmit={(event) => void handleLink(event, broker)} autoComplete="off">
                {broker.fields.map((field) => (
                  <label key={field}>{fieldLabels[field] ?? field}
                    <input name={field} type="password" required autoComplete="off" maxLength={512} />
                  </label>
                ))}
                <label>Environment
                  <select name="environment" defaultValue="paper">
                    {broker.environments.map((env) => <option key={env} value={env}>{env === "live" ? "Live (real money)" : "Paper / practice"}</option>)}
                  </select>
                </label>
                <button type="submit" className="account-edit-button" disabled={isBusy}>{isBusy ? "Verifying…" : "Verify and link"}</button>
              </form>
            )}
            {orderBroker === broker.id && broker.linked && (
              <form className="broker-form" onSubmit={(event) => void handleOrder(event, broker)}>
                <label>Symbol<input name="symbol" required maxLength={20} placeholder={broker.id === "oanda" ? "EUR_USD" : "AAPL"} /></label>
                <label>Side<select name="side" defaultValue="buy"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
                <label>Quantity<input name="quantity" type="number" min="0" step="any" required /></label>
                {broker.linked.environment === "live" && (
                  <label>Type {livePhrase} to place a real-money order<input name="phrase" autoComplete="off" /></label>
                )}
                <label><input name="confirmed" type="checkbox" required /> I confirm this {broker.linked.environment === "live" ? "LIVE market" : "paper market"} order</label>
                <button type="submit" className="account-edit-button" disabled={isBusy}>{isBusy ? "Sending…" : "Place order"}</button>
              </form>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
