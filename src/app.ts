import { z } from "zod";
import {
  base,
  admin,
  ensure,
  atomic,
  type Options,
  type User,
} from "./base.js";
import { randomUUID } from "node:crypto";
import PDFDocument from "pdfkit";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
export function createApp(options: Options = {}) {
  const { app, db, finish } = base(options);
  db.exec(`CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,org INTEGER NOT NULL,name TEXT NOT NULL,email TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,org INTEGER NOT NULL,client_id TEXT REFERENCES clients(id),number TEXT NOT NULL,description TEXT NOT NULL,total INTEGER NOT NULL,due TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,invoice_id TEXT REFERENCES invoices(id),org INTEGER NOT NULL,amount INTEGER NOT NULL,reference TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(org,reference));
 CREATE TABLE IF NOT EXISTS reminders(id TEXT PRIMARY KEY,invoice_id TEXT REFERENCES invoices(id),org INTEGER NOT NULL,day TEXT NOT NULL,balance INTEGER NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(invoice_id,day));`);
  const invoice = (id: string, org: number) =>
    db
      .prepare(
        "SELECT i.*,c.name AS client,c.email,COALESCE((SELECT SUM(amount) FROM payments p WHERE p.invoice_id=i.id),0) AS paid FROM invoices i JOIN clients c ON i.client_id=c.id WHERE i.id=? AND i.org=?",
      )
      .get(id, org);
  if (options.demo && !db.prepare("SELECT id FROM clients LIMIT 1").get()) {
    const c = randomUUID(),
      i = randomUUID();
    db.prepare("INSERT INTO clients VALUES(?,?,?,?)").run(
      c,
      1,
      "Northstar Studio",
      "billing@example.com",
    );
    db.prepare("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?)").run(
      i,
      1,
      c,
      "INV-DEMO-001",
      "Website design — milestone 1",
      12500000,
      new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
      Date.now(),
    );
    db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?)").run(
      randomUUID(),
      i,
      1,
      2500000,
      "DEMO-DEPOSIT",
      Date.now(),
    );
  }
  app.get("/api/dashboard", (_req, res) => {
    const u: User = res.locals.user;
    res.json({
      clients: db.prepare("SELECT * FROM clients WHERE org=?").all(u.org),
      invoices: db
        .prepare("SELECT id FROM invoices WHERE org=? ORDER BY created DESC")
        .all(u.org)
        .map((x) => invoice(x.id as string, u.org)),
      payments: db
        .prepare(
          "SELECT * FROM payments WHERE org=? ORDER BY created DESC LIMIT 100",
        )
        .all(u.org),
      reminders: db
        .prepare(
          "SELECT r.*,i.number FROM reminders r JOIN invoices i ON r.invoice_id=i.id WHERE r.org=? ORDER BY day DESC",
        )
        .all(u.org),
    });
  });
  app.post("/api/clients", admin, (req, res) => {
    const b = z
      .object({
        name: z.string().trim().min(2).max(100),
        email: z.email().max(200),
      })
      .parse(req.body);
    const id = randomUUID();
    db.prepare("INSERT INTO clients VALUES(?,?,?,?)").run(
      id,
      res.locals.user.org,
      b.name,
      b.email,
    );
    res.status(201).json({ id });
  });
  app.post("/api/invoices", admin, (req, res) => {
    const b = z
      .object({
        clientId: z.string().uuid(),
        description: z.string().trim().min(2).max(400),
        total: z.number().int().min(1).max(1000000000),
        due: date,
      })
      .parse(req.body);
    const u: User = res.locals.user;
    ensure(
      db
        .prepare("SELECT id FROM clients WHERE id=? AND org=?")
        .get(b.clientId, u.org),
      404,
      "Client not found",
    );
    const id = randomUUID(),
      number = "INV-" + id.slice(0, 8).toUpperCase();
    db.prepare("INSERT INTO invoices VALUES(?,?,?,?,?,?,?,?)").run(
      id,
      u.org,
      b.clientId,
      number,
      b.description,
      b.total,
      b.due,
      Date.now(),
    );
    res.status(201).json({ id, number });
  });
  app.post("/api/invoices/:id/payments", admin, (req, res) => {
    const b = z
      .object({
        amount: z.number().int().min(1).max(1000000000),
        reference: z.string().trim().min(3).max(100),
      })
      .parse(req.body);
    const u: User = res.locals.user;
    const result = atomic(db, () => {
      const inv = invoice(String(req.params.id), u.org);
      ensure(inv, 404, "Invoice not found");
      const prior = db
        .prepare("SELECT * FROM payments WHERE org=? AND reference=?")
        .get(u.org, b.reference);
      if (prior) {
        ensure(
          prior.invoice_id === inv.id && prior.amount === b.amount,
          409,
          "Reference already used for a different payment",
        );
        return prior;
      }
      ensure(
        b.amount <= Number(inv.total) - Number(inv.paid),
        400,
        "Payment exceeds outstanding balance",
      );
      const id = randomUUID();
      db.prepare("INSERT INTO payments VALUES(?,?,?,?,?,?)").run(
        id,
        inv.id as string,
        u.org,
        b.amount,
        b.reference,
        Date.now(),
      );
      db.prepare(
        "UPDATE reminders SET status='stale' WHERE invoice_id=? AND status IN ('draft','approved')",
      ).run(inv.id as string);
      return { id, amount: b.amount };
    });
    res.status(201).json(result);
  });
  app.post("/api/invoices/:id/reminders", admin, (req, res) => {
    const u: User = res.locals.user;
    const result = atomic(db, () => {
      const inv = invoice(String(req.params.id), u.org);
      ensure(inv, 404, "Invoice not found");
      const day = new Date().toISOString().slice(0, 10);
      ensure(String(inv.due) < day, 400, "Invoice is not overdue");
      const balance = Number(inv.total) - Number(inv.paid);
      ensure(balance > 0, 400, "Invoice is fully paid");
      const previous = db
        .prepare("SELECT * FROM reminders WHERE invoice_id=? AND day=?")
        .get(inv.id as string, day);
      if (previous && previous.status !== "stale") return previous;
      const id = (previous?.id as string) || randomUUID();
      const body = `Hello ${inv.client}, a friendly reminder that ${inv.number} has an outstanding balance of PKR ${(balance / 100).toFixed(2)}, due on ${inv.due}. Please let us know if you need any details. Thank you.`;
      if (previous)
        db.prepare(
          "UPDATE reminders SET balance=?,body=?,status='draft' WHERE id=?",
        ).run(balance, body, id);
      else
        db.prepare("INSERT INTO reminders VALUES(?,?,?,?,?,?,?)").run(
          id,
          inv.id as string,
          u.org,
          day,
          balance,
          body,
          "draft",
        );
      return { id, body, status: "draft" };
    });
    res.status(201).json(result);
  });
  app.post("/api/reminders/:id/approve", admin, (req, res) => {
    const u: User = res.locals.user;
    atomic(db, () => {
      const r = db
        .prepare("SELECT * FROM reminders WHERE id=? AND org=?")
        .get(String(req.params.id), u.org);
      ensure(r, 404, "Reminder not found");
      ensure(r.status === "draft", 409, "Only a current draft can be approved");
      const inv = invoice(r.invoice_id as string, u.org)!;
      ensure(
        Number(inv.total) - Number(inv.paid) === r.balance &&
          Number(r.balance) > 0,
        409,
        "Balance changed; regenerate reminder",
      );
      db.prepare("UPDATE reminders SET status='approved' WHERE id=?").run(
        r.id as string,
      );
    });
    res.json({
      ok: true,
      message: "Approved for manual sending; no email sent",
    });
  });
  app.get("/api/invoices/:id/pdf", (req, res) => {
    const inv = invoice(String(req.params.id), res.locals.user.org);
    ensure(inv, 404, "Invoice not found");
    res.type("application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${inv.number}.pdf"`,
    );
    const doc = new PDFDocument({ margin: 55 });
    doc.pipe(res);
    doc.fontSize(26).text("InvoicePilot");
    doc.moveDown().fontSize(18).text(String(inv.number));
    doc
      .moveDown()
      .fontSize(12)
      .text(`Bill to: ${inv.client}`)
      .text(String(inv.email))
      .text(`Due: ${inv.due}`)
      .moveDown()
      .text(String(inv.description));
    doc
      .moveDown()
      .text(`Invoice total: PKR ${(Number(inv.total) / 100).toFixed(2)}`)
      .text(`Paid: PKR ${(Number(inv.paid) / 100).toFixed(2)}`)
      .text(
        `Balance due: PKR ${((Number(inv.total) - Number(inv.paid)) / 100).toFixed(2)}`,
      );
    doc
      .moveDown(3)
      .fontSize(9)
      .text(
        "Generated by InvoicePilot. Payment is recorded manually; this document is not proof of bank settlement.",
      );
    doc.end();
  });
  finish();
  return { app, db };
}
