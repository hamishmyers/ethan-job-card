// Pitwall admin aggregation endpoint.
// Uses the service key SERVER-SIDE only (bypasses RLS), gated by an admin email
// allowlist. Caller sends their Supabase access token as a Bearer token; we verify
// it, confirm the email is an admin, then return aggregate stats.
const SUPA_URL = "https://gvyvjfldvbwdiexjyxzh.supabase.co";
const SUPA_PUBLISHABLE = "sb_publishable_qRVzjnqhCrUN6xxrKlWDtw_aSprTZ0T";
const DEFAULT_ADMINS = ["hamish.myers@32co.com", "hamishmyers1@gmail.com"];

export default async function handler(req, res) {
  try {
    const auth = req.headers["authorization"] || "";
    if (!auth.toLowerCase().startsWith("bearer ")) { res.status(401).json({ error: "Not signed in." }); return; }

    const who = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_PUBLISHABLE, Authorization: auth } });
    if (!who.ok) { res.status(401).json({ error: "Session invalid — sign in again." }); return; }
    const me = await who.json();
    const email = String((me && me.email) || "").toLowerCase();
    const admins = (process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(",") : DEFAULT_ADMINS).map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!admins.includes(email)) { res.status(403).json({ error: "This account isn't an admin." }); return; }

    const KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!KEY) { res.status(500).json({ error: "SUPABASE_SERVICE_KEY not set in Vercel." }); return; }
    const svc = { apikey: KEY, Authorization: "Bearer " + KEY };
    const rest = async (path) => { const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { headers: svc }); return r.ok ? r.json() : []; };

    let users = [];
    try { const ur = await fetch(`${SUPA_URL}/auth/v1/admin/users?per_page=1000`, { headers: svc }); const ud = await ur.json(); users = Array.isArray(ud) ? ud : (ud.users || []); } catch (e) { users = []; }

    const jobs = await rest("jobs?select=user_id,job_type,make,model,actual_mins,labour_charged,parts_charged,parts_cost,mot_cost_customer,mot_cost_us,mot_result,comeback,closed,created_at&limit=100000");
    const customers = await rest("customers?select=user_id,created_at&limit=100000");
    const purchases = await rest("purchases?select=user_id,gross,net,vat,created_at&limit=100000");

    const num = v => Number(v) || 0;
    const charged = j => num(j.labour_charged) + num(j.parts_charged) + num(j.mot_cost_customer);
    const cost = j => num(j.parts_cost) + num(j.mot_cost_us);
    const isClosed = j => j.closed === true;

    const U = {};
    users.forEach(u => { U[u.id] = { id: u.id, email: u.email || "(no email)", joined: u.created_at, lastActive: u.last_sign_in_at || null, jobs: 0, closed: 0, profit: 0, charged: 0, mins: 0, customers: 0, purchases: 0 }; });
    const bucket = id => (U[id] = U[id] || { id, email: "(unknown)", joined: null, lastActive: null, jobs: 0, closed: 0, profit: 0, charged: 0, mins: 0, customers: 0, purchases: 0 });

    jobs.forEach(j => { const u = bucket(j.user_id); u.jobs++; if (isClosed(j)) { u.closed++; u.profit += charged(j) - cost(j); u.charged += charged(j); u.mins += num(j.actual_mins); } });
    customers.forEach(c => { bucket(c.user_id).customers++; });
    purchases.forEach(p => { bucket(p.user_id).purchases++; });

    const userRows = Object.values(U).sort((a, b) => b.profit - a.profit).map(u => ({
      email: u.email, joined: u.joined, lastActive: u.lastActive,
      jobs: u.jobs, closed: u.closed, customers: u.customers, purchases: u.purchases,
      profit: Math.round(u.profit), charged: Math.round(u.charged), hours: Math.round(u.mins / 60 * 10) / 10,
      gph: u.mins > 0 ? Math.round(u.profit / (u.mins / 60)) : 0
    }));

    const closedJobs = jobs.filter(isClosed);
    const timed = closedJobs.filter(j => num(j.actual_mins) > 0);
    const totProfit = closedJobs.reduce((a, j) => a + charged(j) - cost(j), 0);
    const totCharged = closedJobs.reduce((a, j) => a + charged(j), 0);
    const totMins = timed.reduce((a, j) => a + num(j.actual_mins), 0);
    const timedProfit = timed.reduce((a, j) => a + charged(j) - cost(j), 0);
    const activeUsers = userRows.filter(u => u.jobs > 0).length;

    const byType = {};
    timed.forEach(j => {
      const types = String(j.job_type || "").split(" + ").map(s => s.trim()).filter(Boolean);
      const n = types.length || 1; const p = (charged(j) - cost(j)) / n; const h = num(j.actual_mins) / 60 / n;
      types.forEach(t => { (byType[t] = byType[t] || { profit: 0, hours: 0, n: 0 }); byType[t].profit += p; byType[t].hours += h; byType[t].n++; });
    });
    const typeRows = Object.entries(byType).map(([t, v]) => ({ type: t, gph: v.hours > 0 ? Math.round(v.profit / v.hours) : 0, n: v.n })).sort((a, b) => b.gph - a.gph).slice(0, 8);

    const makeCount = {};
    jobs.forEach(j => { const m = (j.make || "").trim(); if (m) makeCount[m] = (makeCount[m] || 0) + 1; });
    const topMakes = Object.entries(makeCount).map(([make, n]) => ({ make, n })).sort((a, b) => b.n - a.n).slice(0, 6);

    const motJobs = jobs.filter(j => j.mot_result === "pass" || j.mot_result === "fail");
    const motPass = motJobs.length ? Math.round(motJobs.filter(j => j.mot_result === "pass").length / motJobs.length * 100) : null;
    const comebacks = jobs.length ? Math.round(jobs.filter(j => j.comeback === true).length / jobs.length * 100) : 0;
    const labourJobs = jobs.filter(j => num(j.labour_charged) > 0);
    const avgLabour = labourJobs.length ? Math.round(labourJobs.reduce((a, j) => a + num(j.labour_charged), 0) / labourJobs.length) : 0;
    const avgJobValue = closedJobs.length ? Math.round(totCharged / closedJobs.length) : 0;

    const weekStart = d => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - day); return x; };
    const cur = weekStart(new Date()); const weeks = [];
    for (let i = 7; i >= 0; i--) { const ws = new Date(cur); ws.setUTCDate(ws.getUTCDate() - i * 7); const key = ws.toISOString().slice(0, 10); weeks.push({ key, label: ws.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }), count: 0 }); }
    const wmap = Object.fromEntries(weeks.map(w => [w.key, w]));
    jobs.forEach(j => { if (!j.created_at) return; const k = weekStart(new Date(j.created_at)).toISOString().slice(0, 10); if (wmap[k]) wmap[k].count++; });

    res.status(200).json({
      ok: true, generatedAt: new Date().toISOString(),
      totals: { users: users.length, activeUsers, jobs: jobs.length, closed: closedJobs.length, customers: customers.length, purchases: purchases.length, profit: Math.round(totProfit), charged: Math.round(totCharged), hours: Math.round(totMins / 60 * 10) / 10, avgGph: totMins > 0 ? Math.round(timedProfit / (totMins / 60)) : 0 },
      insights: { typeRows, topMakes, motPass, comebacks, avgLabour, avgJobValue },
      users: userRows, weekly: weeks
    });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
