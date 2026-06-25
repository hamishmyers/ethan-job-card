// Vercel Cron endpoint: emails Hamish a summary of the day's jobs + profit.
// Scheduled in vercel.json (Mon-Thu). Sends via Resend.
// Env vars required: RESEND_API_KEY, SUMMARY_EMAIL. Optional: CRON_SECRET.
const SUPA_URL = "https://gvyvjfldvbwdiexjyxzh.supabase.co";
const SUPA_KEY = "sb_publishable_qRVzjnqhCrUN6xxrKlWDtw_aSprTZ0T";

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers["authorization"] !== "Bearer " + secret) {
    res.status(401).json({ error: "unauthorized" }); return;
  }
  const RESEND = process.env.RESEND_API_KEY, TO = process.env.SUMMARY_EMAIL;
  if (!RESEND || !TO) { res.status(500).json({ error: "Set RESEND_API_KEY and SUMMARY_EMAIL in Vercel env vars." }); return; }

  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const url = `${SUPA_URL}/rest/v1/jobs?select=job_type,customer,reg,labour_charged,parts_charged,parts_cost,mot_cost_customer,mot_cost_us,closed,created_at&created_at=gte.${ymd}T00:00:00&order=created_at.desc`;

  let jobs = [];
  try {
    const r = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY } });
    jobs = await r.json(); if (!Array.isArray(jobs)) jobs = [];
  } catch (e) { jobs = []; }

  const gbp = n => "£" + (Math.round(n * 100) / 100).toFixed(2);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  let niceDate = ymd;
  try { niceDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" }).format(new Date(ymd + "T12:00:00")); } catch (e) {}
  const BRAND = "#0b1120", GREEN = "#16a34a", MUTED = "#6b7280", LINE = "#e5e7eb", BG = "#f4f5f7";
  const shell = inner => `<!doctype html><html><body style="margin:0;padding:0;background:${BG};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:14px;overflow:hidden;">
<tr><td style="background:${BRAND};padding:20px 24px;">
<div style="color:#ffffff;font-size:18px;font-weight:700;">🔧 Job Log — daily summary</div>
<div style="color:#9aa7bd;font-size:13px;margin-top:3px;">${niceDate}</div>
</td></tr>
${inner}
<tr><td style="padding:16px 24px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;">Automated summary · sent Monday to Thursday</td></tr>
</table></td></tr></table></body></html>`;

  let subject, html;
  if (!jobs.length) {
    subject = `Job Log — nothing logged today (${niceDate})`;
    html = shell(`<tr><td style="padding:28px 24px;color:#111111;font-size:15px;">No jobs logged today. 👍</td></tr>`);
  } else {
    let tCharged = 0, tProfit = 0;
    const rows = jobs.map(j => {
      const charged = (+j.labour_charged || 0) + (+j.parts_charged || 0) + (+j.mot_cost_customer || 0);
      const cost = (+j.parts_cost || 0) + (+j.mot_cost_us || 0);
      const profit = charged - cost; tCharged += charged; tProfit += profit;
      const openBadge = j.closed === false ? ` <span style="background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;padding:2px 7px;border-radius:6px;">OPEN</span>` : "";
      const sub = [j.customer || "no customer", j.reg || ""].filter(Boolean).map(esc).join(" · ");
      return `<tr>
<td style="padding:11px 0;border-top:1px solid ${LINE};">
<div style="font-weight:700;color:#111111;font-size:14px;">${esc(j.job_type || "Job")}${openBadge}</div>
<div style="color:${MUTED};font-size:12px;margin-top:1px;">${sub}</div>
</td>
<td style="padding:11px 0;border-top:1px solid ${LINE};text-align:right;white-space:nowrap;vertical-align:top;">
<div style="font-weight:800;color:${GREEN};font-size:15px;">${gbp(profit)}</div>
<div style="color:${MUTED};font-size:11px;">profit</div>
</td></tr>`;
    }).join("");
    subject = `Job Log — ${jobs.length} job${jobs.length > 1 ? "s" : ""}, ${gbp(tProfit)} profit (${niceDate})`;
    const metrics = `<tr><td style="padding:22px 24px 8px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td width="33%" style="text-align:center;"><div style="font-size:22px;font-weight:800;color:#111111;">${jobs.length}</div><div style="font-size:12px;color:${MUTED};">jobs</div></td>
<td width="33%" style="text-align:center;border-left:1px solid ${LINE};border-right:1px solid ${LINE};"><div style="font-size:22px;font-weight:800;color:#111111;">${gbp(tCharged)}</div><div style="font-size:12px;color:${MUTED};">charged</div></td>
<td width="33%" style="text-align:center;"><div style="font-size:22px;font-weight:800;color:${GREEN};">${gbp(tProfit)}</div><div style="font-size:12px;color:${MUTED};">profit</div></td>
</tr></table></td></tr>`;
    const list = `<tr><td style="padding:8px 24px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table></td></tr>`;
    html = shell(metrics + list);
  }

  try {
    const er = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + RESEND, "content-type": "application/json" },
      body: JSON.stringify({ from: "Job Log <onboarding@resend.dev>", to: [TO], subject, html })
    });
    const ed = await er.json();
    if (!er.ok) { res.status(502).json({ error: (ed && ed.message) || "email failed", detail: ed }); return; }
    res.status(200).json({ ok: true, jobs: jobs.length, date: ymd });
  } catch (e) { res.status(500).json({ error: String((e && e.message) || e) }); }
}
