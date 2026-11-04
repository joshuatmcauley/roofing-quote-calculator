// Cloudflare Pages Function: POST /api/send-quote
// Emails a quote to B&C McKeown through Resend. The quote itself is a PDF built in
// the browser and attached here; the email body is just a one-line cover note. The API key stays server-side.
//
// Settings (Cloudflare dashboard > Pages project > Settings > Variables and Secrets):
//   RESEND_API_KEY   (secret, required)
//   QUOTE_TO_EMAIL   (required) who receives the quote, e.g. michael@bcmckeownltd.com
//   QUOTE_FROM_EMAIL (optional) defaults to Resend's test sender "onboarding@resend.dev";
//                    set e.g. "B&C McKeown Quotes <quotes@bcmckeown.net>" once the
//                    domain is verified in Resend.

const str = (v, max = 500) => String(v ?? "").slice(0, max);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function clean(b) {
  if (!b || typeof b !== "object" || !Array.isArray(b.lines) || !b.totals) return null;
  const cust = b.customer || {};
  const pdf = typeof b.pdf === "string" && /^[A-Za-z0-9+/=]+$/.test(b.pdf) && b.pdf.length < 6_000_000 ? b.pdf : "";
  if (!pdf) return null;
  return {
    pdf,
    pdfName: (str(b.pdfName, 80).replace(/[^A-Za-z0-9._-]/g, "") || "Quote.pdf"),
    company: { name: str(b.company && b.company.name, 120) || "B&C McKeown", phone: str(b.company && b.company.phone, 60), email: str(b.company && b.company.email, 200) },
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
      text: `Quote${q.ref ? " " + q.ref : ""}${who} attached.`,
      attachments: [{ filename: q.pdfName, content: q.pdf }],
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
