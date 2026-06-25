// Vercel serverless function: reads a UK garage invoice photo with a vision model
// and returns structured fields as JSON. Requires env var ANTHROPIC_API_KEY.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Scanner not set up yet. Add ANTHROPIC_API_KEY in Vercel project settings." }); return; }
  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const image = body && body.image;
    const mediaType = (body && body.media_type) || "image/jpeg";
    if (!image) { res.status(400).json({ error: "No image provided" }); return; }

    const mode = body && body.mode;
    const partsPrompt = `You are reading a UK supplier PARTS invoice or receipt (parts a garage has bought from a supplier). ` +
      `Respond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys:\n` +
      `{"supplier": string|null, "date": string|null, "net": number|null, "vat": number|null, "gross": number|null, "description": string|null}\n` +
      `Rules: date as ISO yyyy-mm-dd if you can determine it. net = total EXCLUDING VAT in GBP. vat = the VAT amount in GBP. gross = total INCLUDING VAT in GBP. ` +
      `description = a brief summary of the items bought. Numbers must be plain numbers with no currency symbol or commas. Use null for anything not clearly present.`;
    const invoicePrompt = `You are reading a UK car garage document: either a mechanic's invoice/job sheet OR an MOT test certificate/failure sheet. ` +
      `Figure out which it is and extract the fields. Respond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys:\n` +
      `{"document_type": "invoice"|"mot"|null, "customer_name": string|null, "registration": string|null, "make": string|null, "model": string|null, ` +
      `"odometer": number|null, "date": string|null, "total": number|null, "mot_result": "pass"|"fail"|null, "mot_work_needed": string|null, ` +
      `"jobs": [ {"description": string, "job_type": string|null, "labour_charged": number|null, "parts_charged": number|null} ]}\n` +
      `Rules: date as ISO yyyy-mm-dd if you can determine it. odometer = the mileage/odometer reading as a plain number if shown. total = final total including VAT. ` +
      `"jobs" is an array of the DISTINCT jobs/services on the document. Most invoices are a single job (one visit) even if they list several parts or labour lines — in that case return ONE element whose description summarises the work and whose labour_charged/parts_charged are the whole invoice's labour and parts (excluding VAT). ` +
      `Only return multiple elements when the document clearly covers genuinely separate jobs (e.g. a service AND unrelated brake work). job_type = a short category like Service, Brakes, Clutch, Cambelt/Timing, Diagnostics, Suspension, Exhaust, Tyres, Battery/Electrical, Aircon, MOT, Engine, Welding, or null. ` +
      `For an MOT sheet: set document_type "mot", mot_result to pass or fail, mot_work_needed to a concise list of failure items and advisories, and jobs to an empty array. ` +
      `Numbers must be plain numbers with no currency symbol or commas. Use null for anything not clearly present.`;

    const prompt = mode === "parts" ? partsPrompt : invoicePrompt;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
            { type: "text", text: prompt }
          ]
        }]
      })
    });
    const data = await r.json();
    if (!r.ok) { res.status(502).json({ error: (data && data.error && data.error.message) || "Vision API error" }); return; }
    const text = (data.content && data.content[0] && data.content[0].text) || "";
    const m = text.match(/\{[\s\S]*\}/);
    let parsed = {};
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e) { parsed = {}; } }
    res.status(200).json(parsed);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
}
