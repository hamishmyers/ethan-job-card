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

    const prompt = `You are reading a UK car garage / mechanic invoice or job sheet. ` +
      `Extract the fields and respond with ONLY a JSON object (no prose, no markdown fences) with exactly these keys:\n` +
      `{"customer_name": string|null, "registration": string|null, "make": string|null, "model": string|null, ` +
      `"date": string|null, "work_done": string|null, "labour_charged": number|null, "parts_charged": number|null, "total": number|null}\n` +
      `Rules: date as ISO yyyy-mm-dd if you can determine it. labour_charged = the labour/service amount in GBP excluding VAT. ` +
      `parts_charged = total parts charged to the customer in GBP excluding VAT. total = final total including VAT. ` +
      `Numbers must be plain numbers with no currency symbol or commas. Use null for anything not clearly present.`;

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
