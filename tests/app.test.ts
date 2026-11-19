import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./helper.js";
test("Authentication and protected writes require session and request header", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call("/dashboard")).status, 401);
  assert.equal((await f.call("/clients", {}, f.cookie, false)).status, 403);
  assert.equal(
    (await f.call("/login", { email: "admin@demo.local", password: "wrong" }))
      .status,
    401,
  );
});
test("Viewer can read invoices but cannot record payment", async (t) => {
  const f = await fixture(t);
  const c = await f.login("viewer@demo.local");
  const inv = (await f.call("/dashboard", undefined, c)).data.invoices[0];
  assert.equal(
    (
      await f.call(
        "/invoices/" + inv.id + "/payments",
        { amount: 100, reference: "TEST" },
        c,
      )
    ).status,
    403,
  );
});
test("Cross-tenant reads and writes cannot access invoice data", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const other = await f.login("other@demo.local");
  assert.equal(
    (await f.call("/dashboard", undefined, other)).data.invoices.length,
    0,
  );
  assert.equal(
    (await f.call("/invoices/" + inv.id + "/pdf", undefined, other)).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "/invoices/" + inv.id + "/payments",
        { amount: 100, reference: "TEST" },
        other,
      )
    ).status,
    404,
  );
});
test("Create client and invoice with validated date and integer money", async (t) => {
  const f = await fixture(t);
  const c = await f.call(
    "/clients",
    { name: "Acme", email: "acme@example.com" },
    f.cookie,
  );
  assert.equal(c.status, 201);
  const b = {
    clientId: c.data.id,
    description: "Milestone one",
    total: 10000,
    due: "2026-02-30",
  };
  assert.equal((await f.call("/invoices", b, f.cookie)).status, 400);
  assert.equal(
    (
      await f.call(
        "/invoices",
        { ...b, due: "2026-12-20", total: 1.5 },
        f.cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.call("/invoices", { ...b, due: "2026-12-20" }, f.cookie)).status,
    201,
  );
});
test("Partial payment changes balance and replay is idempotent", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const b = { amount: 50000, reference: "BANK-001" };
  const p = await f.call("/invoices/" + inv.id + "/payments", b, f.cookie);
  const p2 = await f.call("/invoices/" + inv.id + "/payments", b, f.cookie);
  assert.equal(p.data.id, p2.data.id);
  const updated = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  assert.equal(updated.paid, inv.paid + b.amount);
});
test("Overpayments, negative payments and reference conflicts are rejected", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const path = "/invoices/" + inv.id + "/payments";
  assert.equal(
    (await f.call(path, { amount: inv.total, reference: "TOO-MUCH" }, f.cookie))
      .status,
    400,
  );
  assert.equal(
    (await f.call(path, { amount: -10, reference: "NEGATIVE" }, f.cookie))
      .status,
    400,
  );
  await f.call(path, { amount: 100, reference: "BANK-001" }, f.cookie);
  assert.equal(
    (await f.call(path, { amount: 200, reference: "BANK-001" }, f.cookie))
      .status,
    409,
  );
});
test("Reminders deduplicate per UTC day and require approval", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const r = await f.call("/invoices/" + inv.id + "/reminders", {}, f.cookie);
  const r2 = await f.call("/invoices/" + inv.id + "/reminders", {}, f.cookie);
  assert.equal(r.data.id, r2.data.id);
  assert.equal(r.data.status, "draft");
  assert.match(r.data.body, /100000.00/);
  assert.equal(
    (await f.call("/reminders/" + r.data.id + "/approve", {}, f.cookie)).status,
    200,
  );
  assert.equal(
    (await f.call("/reminders/" + r.data.id + "/approve", {}, f.cookie)).status,
    409,
  );
});
test("Payment invalidates draft and regeneration uses current balance", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const r = await f.call("/invoices/" + inv.id + "/reminders", {}, f.cookie);
  await f.call(
    "/invoices/" + inv.id + "/payments",
    { amount: 10000, reference: "NEW-PAYMENT" },
    f.cookie,
  );
  assert.equal(
    (await f.call("/reminders/" + r.data.id + "/approve", {}, f.cookie)).status,
    409,
  );
  const fresh = await f.call(
    "/invoices/" + inv.id + "/reminders",
    {},
    f.cookie,
  );
  assert.match(fresh.data.body, /99900.00/);
  assert.equal(
    (await f.call("/reminders/" + fresh.data.id + "/approve", {}, f.cookie))
      .status,
    200,
  );
});
test("Fully paid invoices cannot generate reminders", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  await f.call(
    "/invoices/" + inv.id + "/payments",
    { amount: inv.total - inv.paid, reference: "FINAL" },
    f.cookie,
  );
  assert.equal(
    (await f.call("/invoices/" + inv.id + "/reminders", {}, f.cookie)).status,
    400,
  );
});
test("Future-due invoices cannot generate overdue reminders", async (t) => {
  const f = await fixture(t);
  const d = (await f.call("/dashboard", undefined, f.cookie)).data;
  const i = await f.call(
    "/invoices",
    {
      clientId: d.clients[0].id,
      description: "Future milestone",
      total: 100,
      due: "2099-01-01",
    },
    f.cookie,
  );
  assert.equal(
    (await f.call("/invoices/" + i.data.id + "/reminders", {}, f.cookie))
      .status,
    400,
  );
});
test("PDF export returns a real PDF and logout revokes session", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const pdf = await f.call("/invoices/" + inv.id + "/pdf", undefined, f.cookie);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.data.subarray(0, 5).toString(), "%PDF-");
  await f.call("/logout", {}, f.cookie);
  assert.equal((await f.call("/dashboard", undefined, f.cookie)).status, 401);
});
test("New payment invalidates an already approved reminder", async (t) => {
  const f = await fixture(t);
  const inv = (await f.call("/dashboard", undefined, f.cookie)).data
    .invoices[0];
  const r = await f.call("/invoices/" + inv.id + "/reminders", {}, f.cookie);
  await f.call("/reminders/" + r.data.id + "/approve", {}, f.cookie);
  await f.call(
    "/invoices/" + inv.id + "/payments",
    { amount: 100, reference: "AFTER-APPROVAL" },
    f.cookie,
  );
  const d = (await f.call("/dashboard", undefined, f.cookie)).data;
  assert.equal(d.reminders[0].status, "stale");
});
