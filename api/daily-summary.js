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
  let subject, html;
  if (!jobs.length) {
    subject = `Job Log — nothing logged today (${ymd})`;
    html = `<p>Ethan hasn't logged anything today (${ymd}).</p>`;
  } else {
    let tCharged = 0, tProfit = 0;
    const rows = jobs.map(j => {
      const charged = (+j.labour_charged || 0) + (+j.parts_charged || 0) + (+j.mot_cost_customer || 0);
      const cost = (+j.parts_cost || 0) + (+j.mot_cost_us || 0);
      const profit = charged - cost; tCharged += charged; tProfit += profit;
      return `<li><b>${j.job_type || "Job"}</b> — ${j.customer || "no customer"} ${j.reg || ""} · ${gbp(profit)} profit${j.closed === false ? " <i>(open)</i>" : ""}</li>`;
    }).join("");
    subject = `Job Log — ${jobs.length} job${jobs.length > 1 ? "s" : ""}, ${gbp(tProfit)} profit (${ymd})`;
    html = `<h3>${ymd}</h3><p>${jobs.length} job${jobs.length > 1 ? "s" : ""} logged · ${gbp(tCharged)} charged · <b>${gbp(tProfit)} profit</b></p><ul>${rows}</ul>`;
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
