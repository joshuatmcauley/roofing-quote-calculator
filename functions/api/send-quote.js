// Cloudflare Pages Function: POST /api/send-quote
// Emails a quote to B&C McKeown through Resend. The API key stays server-side.
//
// Settings (Cloudflare dashboard > Pages project > Settings > Variables and Secrets):
//   RESEND_API_KEY   (secret, required)
//   QUOTE_TO_EMAIL   (required) who receives the quote, e.g. michael@bcmckeownltd.com
//   QUOTE_FROM_EMAIL (optional) defaults to Resend's test sender "onboarding@resend.dev";
//                    set e.g. "B&C McKeown Quotes <quotes@bcmckeown.net>" once the
//                    domain is verified in Resend.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const str = (v, max = 500) => String(v ?? "").slice(0, max);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function renderEmail(q) {
  const rows = q.lines.map((l) => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7e4;vertical-align:top">
        <div style="font-weight:600;color:#1b1f1c">${esc(l.name)}</div>
        ${l.detail ? `<div style="font-size:12px;color:#6b726d;margin-top:2px">${esc(l.detail)}</div>` : ""}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7e4;vertical-align:top;white-space:nowrap;color:#1b1f1c">${esc(l.qty)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7e4;vertical-align:top;text-align:right;white-space:nowrap;color:#1b1f1c">${esc(l.unit)}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #e5e7e4;vertical-align:top;text-align:right;white-space:nowrap;font-weight:600;color:#1b1f1c">${esc(l.total)}</td>
    </tr>`).join("");
  const c = q.customer;
  const customer = [c.name && `<strong>${esc(c.name)}</strong>`, c.email && `<a href="mailto:${esc(c.email)}" style="color:#2f7d3b">${esc(c.email)}</a>`, c.phone && esc(c.phone)].filter(Boolean).join("<br>");
  const overview = q.overview.length ? `<p style="margin:0 0 16px;color:#6b726d;font-size:13px">${q.overview.map(esc).join(" &middot; ")}</p>` : "";
  const notes = q.notes ? `<div style="margin-top:20px;padding:12px 14px;background:#f4f6f3;border-radius:8px"><div style="font-weight:600;margin-bottom:4px">Notes</div><div style="white-space:pre-wrap">${esc(q.notes)}</div></div>` : "";
  return `<!doctype html><html><body style="margin:0;background:#f4f6f3;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1f1c">
  <div style="max-width:680px;margin:0 auto;padding:24px 12px">
    <div style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7e4">
      <div style="background:#1f6b32;color:#ffffff;padding:20px 24px">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.85">New quote</div>
        <div style="font-size:22px;font-weight:600;margin-top:2px">${esc(q.headline)}</div>
        <div style="font-size:13px;margin-top:4px;opacity:.9">${q.ref ? `Reference ${esc(q.ref)} &middot; ` : ""}${esc(q.date)}</div>
      </div>
      <div style="padding:24px">
        ${customer ? `<div style="margin-bottom:18px;line-height:1.5"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#6b726d">Customer</div>${customer}</div>` : ""}
        ${overview}
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;font-size:14px">
          <thead><tr style="text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b726d">
            <th style="padding:8px;border-bottom:2px solid #1f6b32">Item</th>
            <th style="padding:8px;border-bottom:2px solid #1f6b32">Qty</th>
            <th style="padding:8px;border-bottom:2px solid #1f6b32;text-align:right">Unit</th>
            <th style="padding:8px;border-bottom:2px solid #1f6b32;text-align:right">Total</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="4" style="padding:12px 8px;color:#6b726d">No materials yet.</td></tr>`}</tbody>
        </table>
        <table role="presentation" align="right" cellspacing="0" cellpadding="0" style="margin-top:16px;font-size:14px;min-width:260px">
          <tr><td style="padding:4px 8px;color:#6b726d">Subtotal (ex. VAT)</td><td style="padding:4px 8px;text-align:right">${esc(q.totals.exVat)}</td></tr>
          <tr><td style="padding:4px 8px;color:#6b726d">VAT (${esc(q.totals.vatPercent)}%)</td><td style="padding:4px 8px;text-align:right">${esc(q.totals.vat)}</td></tr>
          <tr><td style="padding:8px;border-top:2px solid #1f6b32;font-weight:700;font-size:16px">Total (inc. VAT)</td><td style="padding:8px;border-top:2px solid #1f6b32;text-align:right;font-weight:700;font-size:16px">${esc(q.totals.incVat)}</td></tr>
        </table>
        <div style="clear:both"></div>
        ${notes}
        <p style="margin:24px 0 0;font-size:12px;color:#6b726d">${esc(q.disclaimer)}</p>
      </div>
    </div>
  </div></body></html>`;
}

function renderText(q) {
  const out = [q.headline, q.ref ? `Reference: ${q.ref}` : "", q.date, ""];
  const c = q.customer;
  if (c.name) out.push(`Name: ${c.name}`);
  if (c.email) out.push(`Email: ${c.email}`);
  if (c.phone) out.push(`Phone: ${c.phone}`);
  if (q.overview.length) out.push("", ...q.overview);
  out.push("");
  q.lines.forEach((l) => out.push(`${l.qty} x ${l.unit} = ${l.total}`, l.name, ...(l.detail ? [l.detail] : []), ""));
  out.push(`Subtotal (ex. VAT): ${q.totals.exVat}`, `VAT (${q.totals.vatPercent}%): ${q.totals.vat}`, `Total (inc. VAT): ${q.totals.incVat}`);
  if (q.notes) out.push("", "Notes:", q.notes);
  return out.filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
}

function clean(b) {
  if (!b || typeof b !== "object" || !Array.isArray(b.lines) || !b.totals) return null;
  const cust = b.customer || {};
  return {
    headline: str(b.headline, 120) || "Roofing quote",
    ref: str(b.ref, 60),
    date: str(b.date, 60),
    disclaimer: str(b.disclaimer, 600),
    notes: str(b.notes, 3000).trim(),
    overview: (Array.isArray(b.overview) ? b.overview : []).slice(0, 30).map((x) => str(x, 200)),
    customer: { name: str(cust.name, 120), email: str(cust.email, 200), phone: str(cust.phone, 60) },
    totals: { exVat: str(b.totals.exVat, 30), vat: str(b.totals.vat, 30), incVat: str(b.totals.incVat, 30), vatPercent: str(b.totals.vatPercent, 10) },
    lines: b.lines.slice(0, 200).map((l) => ({
      name: str(l && l.name, 300), detail: str(l && l.detail, 500),
      qty: str(l && l.qty, 80), unit: str(l && l.unit, 30), total: str(l && l.total, 30),
    })),
  };
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_API_KEY || !env.QUOTE_TO_EMAIL) return json({ error: "Email is not set up on the server yet." }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const q = clean(body);
  if (!q) return json({ error: "Bad request." }, 400);

  const who = q.customer.name ? ` for ${q.customer.name}` : "";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.QUOTE_FROM_EMAIL || "B&C McKeown Quotes <onboarding@resend.dev>",
      to: [env.QUOTE_TO_EMAIL],
      ...(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q.customer.email) ? { reply_to: q.customer.email } : {}),
      subject: `Quote${q.ref ? " " + q.ref : ""}${who} - ${q.totals.incVat}`,
      html: renderEmail(q),
      text: renderText(q),
    }),
  });
  if (!res.ok) {
    // Pass Resend's own reason back (e.g. "domain not verified") so a failure is diagnosable.
    let why = "";
    try { why = (await res.json()).message || ""; } catch {}
    return json({ error: `Could not send the email.${why ? " Resend says: " + str(why, 300) : " Please try again."}` }, 502);
  }
  return json({ ok: true });
}
