import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { api, money } from "./api.js";
import "./style.css";
type User = { email: string; role: string };
function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [data, setData] = useState<any>(null);
  const refresh = async () => setData(await api("/dashboard"));
  useEffect(() => {
    api("/me")
      .then(async (u) => {
        setUser(u);
        await refresh();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  async function action(
    fn: () => Promise<unknown>,
    message = "Saved successfully",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading) return <div className="login">Loading workspace…</div>;
  if (!user)
    return (
      <div className="login">
        <div className="brand">
          InvoicePilot<span style={{ color: "#637b90" }}> /</span>
        </div>
        <h1>Welcome back.</h1>
        <p>From a finished milestone to a settled invoice.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const u = await api("/login", Object.fromEntries(f));
              setUser(u);
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Email
            <input
              type="email"
              name="email"
              placeholder="you@example.com"
              autoComplete="username"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              name="password"
              required
              autoComplete="current-password"
            />
          </label>
          <button disabled={busy}>
            {busy ? "Signing in…" : "Sign in to workspace"}
          </button>
        </form>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
      </div>
    );
  const readOnly = user.role !== "admin";
  return (
    <div className="layout">
      <aside>
        <div className="brand">
          InvoicePilot<span style={{ color: "#637b90" }}> /</span>
        </div>
        <div className="nav">
          <div>◈ &nbsp; Billing workspace</div>
        </div>
        <p className="aside-note">
          A focused workspace for freelancer invoicing, payment records and
          thoughtful follow-ups.
        </p>
        <p className="user">
          {user.email}
          <br />
          {user.role} workspace
        </p>
        <button
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/logout", {});
              setUser(null);
              setData(null);
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Sign out
        </button>
      </aside>
      <main>
        <div className="top">
          <div>
            <div className="eyebrow">Accounts receivable / overview</div>
            <h1>Clarity on every payment.</h1>
            <p style={{ margin: 0 }}>
              Track milestones, record deposits and follow up with confidence.
            </p>
          </div>
          <span className="pill">● PKR billing workspace</span>
        </div>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {notice && (
          <div role="status" className="notice">
            {notice}
          </div>
        )}
        {readOnly && (
          <p className="notice">
            Read-only access. An administrator can make changes.
          </p>
        )}
        {data ? (
          <>
            <div className="stats">
              <div className="stat">
                <span>Total invoiced · PKR</span>
                <strong>
                  {money(
                    data.invoices.reduce((s: number, i: any) => s + i.total, 0),
                  )}
                </strong>
              </div>
              <div className="stat">
                <span>Outstanding · PKR</span>
                <strong>
                  {money(
                    data.invoices.reduce(
                      (s: number, i: any) => s + i.total - i.paid,
                      0,
                    ),
                  )}
                </strong>
              </div>
              <div className="stat">
                <span>Overdue invoices</span>
                <strong>
                  {
                    data.invoices.filter(
                      (i: any) =>
                        i.paid < i.total &&
                        i.due < new Date().toISOString().slice(0, 10),
                    ).length
                  }
                </strong>
              </div>
            </div>
            <div className="grid">
              <section>
                <div className="panel">
                  <h2>Create a milestone invoice</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      action(
                        () =>
                          api("/invoices", {
                            clientId: f.get("clientId"),
                            description: f.get("description"),
                            total: Math.round(Number(f.get("total")) * 100),
                            due: f.get("due"),
                          }),
                        "Invoice created. Download the PDF from its card.",
                      );
                    }}
                  >
                    <label>
                      Client
                      <select name="clientId" required>
                        {data.clients.map((c: any) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Project / milestone
                      <input
                        name="description"
                        placeholder="Website development — milestone 2"
                        minLength={2}
                        maxLength={400}
                        required
                      />
                    </label>
                    <div className="row">
                      <label>
                        Total · PKR
                        <input
                          name="total"
                          type="number"
                          min="0.01"
                          max="10000000"
                          step="0.01"
                          required
                        />
                      </label>
                      <label>
                        Due date
                        <input name="due" type="date" required />
                      </label>
                    </div>
                    <button disabled={busy || readOnly || !data.clients.length}>
                      Create invoice
                    </button>
                  </form>
                </div>
                <div className="panel">
                  <h2>Add a client</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      action(() => api("/clients", Object.fromEntries(f)));
                    }}
                  >
                    <label>
                      Business / client name
                      <input
                        name="name"
                        minLength={2}
                        maxLength={100}
                        required
                      />
                    </label>
                    <label>
                      Billing email
                      <input type="email" name="email" required />
                    </label>
                    <button disabled={busy || readOnly} className="secondary">
                      Add client
                    </button>
                  </form>
                </div>
                <div className="panel">
                  <h2>Payment ledger</h2>
                  {data.payments.map((p: any) => (
                    <div
                      className="item"
                      style={{ marginBottom: 8 }}
                      key={p.id}
                    >
                      <div className="item-head">
                        <strong>{money(p.amount)}</strong>
                        <span className="tag">Recorded</span>
                      </div>
                      <p>
                        {p.reference}
                        <br />
                        {new Date(p.created).toLocaleString()}
                      </p>
                    </div>
                  ))}
                  {!data.payments.length && (
                    <p className="empty">Recorded payments will appear here.</p>
                  )}
                </div>
              </section>
              <section>
                <div className="panel">
                  <h2>Invoices & balances</h2>
                  <div className="list">
                    {!data.invoices.length && (
                      <p className="empty">
                        Create your first invoice to get started.
                      </p>
                    )}
                    {data.invoices.map((i: any) => {
                      const balance = i.total - i.paid,
                        overdue = i.due < new Date().toISOString().slice(0, 10);
                      return (
                        <div className="item" key={i.id}>
                          <div className="item-head">
                            <strong>{i.number}</strong>
                            <span
                              className={
                                "tag " + (balance && overdue ? "pending" : "")
                              }
                            >
                              {!balance ? "Paid" : overdue ? "Overdue" : "Open"}
                            </span>
                          </div>
                          <p>
                            {i.client} · {i.description}
                          </p>
                          <div className="item-head">
                            <strong>{money(balance)} due</strong>
                            <span className="muted">Due {i.due}</span>
                          </div>
                          <p>
                            Invoice {money(i.total)} · Paid {money(i.paid)}
                          </p>
                          <div className="actions">
                            <button
                              className="secondary"
                              onClick={() => {
                                window.open(
                                  "/api/invoices/" + i.id + "/pdf",
                                  "_blank",
                                  "noopener",
                                );
                              }}
                            >
                              Download PDF
                            </button>
                            {balance > 0 && overdue && (
                              <button
                                disabled={busy || readOnly}
                                onClick={() =>
                                  action(
                                    () =>
                                      api(
                                        "/invoices/" + i.id + "/reminders",
                                        {},
                                      ),
                                    "Reminder draft prepared. Review before approving.",
                                  )
                                }
                              >
                                Draft reminder
                              </button>
                            )}
                          </div>
                          {balance > 0 && !readOnly && (
                            <details style={{ marginTop: 14 }}>
                              <summary>Record a payment</summary>
                              <form
                                style={{ marginTop: 12 }}
                                onSubmit={(e) => {
                                  e.preventDefault();
                                  const f = new FormData(e.currentTarget);
                                  action(
                                    () =>
                                      api("/invoices/" + i.id + "/payments", {
                                        amount: Math.round(
                                          Number(f.get("amount")) * 100,
                                        ),
                                        reference: f.get("reference"),
                                      }),
                                    "Payment recorded; invoice balance updated.",
                                  );
                                }}
                              >
                                <div className="row">
                                  <label>
                                    Amount · PKR
                                    <input
                                      type="number"
                                      name="amount"
                                      min="0.01"
                                      max={balance / 100}
                                      step="0.01"
                                      required
                                    />
                                  </label>
                                  <label>
                                    Unique payment reference
                                    <input
                                      name="reference"
                                      minLength={3}
                                      maxLength={100}
                                      placeholder="BANK-001"
                                      required
                                    />
                                  </label>
                                </div>
                                <button disabled={busy}>Record payment</button>
                              </form>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="panel">
                  <h2>Reminder outbox</h2>
                  <p className="muted">
                    Draft, approve, then copy for manual sending. No emails are
                    sent by this MVP. Dates use UTC.
                  </p>
                  <div className="list">
                    {data.reminders.map((r: any) => (
                      <div className="item" key={r.id}>
                        <div className="item-head">
                          <strong>{r.number}</strong>
                          <span className={"tag " + r.status}>{r.status}</span>
                        </div>
                        <p>{r.body}</p>
                        <div className="actions">
                          {r.status === "draft" && (
                            <button
                              disabled={busy || readOnly}
                              onClick={() =>
                                action(
                                  () =>
                                    api("/reminders/" + r.id + "/approve", {}),
                                  "Approved for manual sending. No email sent.",
                                )
                              }
                            >
                              Approve draft
                            </button>
                          )}
                          {r.status === "approved" && (
                            <button
                              className="secondary"
                              onClick={() =>
                                action(
                                  () => navigator.clipboard.writeText(r.body),
                                  "Reminder copied. Send it through your preferred email app.",
                                )
                              }
                            >
                              Copy text
                            </button>
                          )}
                          {r.status === "stale" && (
                            <span className="muted">
                              Payment changed. Regenerate from the invoice.
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {!data.reminders.length && (
                      <p className="empty">
                        Overdue invoice reminders will appear here.
                      </p>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : (
          <p>Loading data…</p>
        )}
        <footer>
          Portfolio MVP · manual payment recording · no payment processor or
          email delivery
        </footer>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
