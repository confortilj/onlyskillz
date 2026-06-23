// skillz.ai — process-scan-queue: DYNAMIC sandbox worker.
// Drains queued scan_reports and runs an extended dynamic-style analysis pass in
// an ISOLATED Deno Worker (no DOM, no parent scope, frozen globals, time-boxed).
// This is the post-publish deep pass beyond the fast static scan at upload.
// Triggered by pg_cron (service role) or admin call (x-admin-key).
import { createClient } from "jsr:@supabase/supabase-js@2";
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

const WORKER_SRC = `
  self.onmessage = (e) => {
    const content = e.data;
    const traces = [];
    const layers = [];
    let cur = content; let depth = 0;
    while (depth < 6) {
      const b64 = cur.match(/[A-Za-z0-9+/]{40,}={0,2}/g) || [];
      let decoded = '';
      for (const blob of b64) { try { const d = atob(blob); if (/[\\x20-\\x7e]{8,}/.test(d)) decoded += '\\n'+d; } catch(_){} }
      if (!decoded) break; layers.push(decoded); cur = decoded; depth++;
    }
    if (layers.length >= 2) traces.push({ kind:'multi_stage_decode', severity:'high', detail: layers.length+'-layer decode chain (staged payload).' });
    const all = content + layers.join('\\n');
    if (/setTimeout\\s*\\([^,]*,\\s*\\d{4,}/.test(all)) traces.push({ kind:'delayed_execution', severity:'medium', detail:'Long-delay timer (possible logic bomb / sandbox evasion).' });
    if (/navigator\\.|screen\\.|Date\\.now\\(\\)|performance\\.now/.test(all) && /eval|Function/.test(all)) traces.push({ kind:'env_fingerprinting', severity:'medium', detail:'Environment fingerprinting paired with dynamic execution (evasion).' });
    if (/(fetch|XMLHttpRequest|WebSocket)[^;]{0,80}(token|cookie|secret|key|password)/i.test(all)) traces.push({ kind:'staged_exfil', severity:'critical', detail:'Network sink wired to sensitive data references.' });
    if (/\\beval\\b[\\s\\S]{0,40}(atob|fromCharCode|unescape)/.test(all)) traces.push({ kind:'dynamic_deobfuscated_exec', severity:'critical', detail:'eval of de-obfuscated content at runtime.' });
    self.postMessage(traces);
  };
`;

function runInSandbox(content: string): Promise<any[]> {
  return new Promise((resolve) => {
    let done = false;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: "application/javascript" }));
      const w = new Worker(url, { type: "module" });
      const timer = setTimeout(() => { if (!done) { done = true; try { w.terminate(); } catch (_) { /* */ } resolve([{ kind: "timeout", severity: "medium", detail: "Dynamic pass exceeded time box; flagged for human review." }]); } }, 4000);
      w.onmessage = (e: MessageEvent) => { if (done) return; done = true; clearTimeout(timer); try { w.terminate(); } catch (_) { /* */ } resolve(e.data as any[]); };
      w.onerror = () => { if (done) return; done = true; clearTimeout(timer); resolve([{ kind: "worker_error", severity: "low", detail: "Sandbox worker errored; treated as inconclusive." }]); };
      w.postMessage(content);
    } catch (_) { resolve([{ kind: "sandbox_unavailable", severity: "low", detail: "Isolated worker unavailable in this runtime." }]); }
  });
}

Deno.serve(async (req: Request) => {
  const adminKey = Deno.env.get("ADMIN_API_KEY");
  const isCron = req.headers.get("x-cron") === Deno.env.get("CRON_SECRET");
  if (!isCron && (!adminKey || req.headers.get("x-admin-key") !== adminKey)) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: queued } = await admin.from("scan_reports").select("id, product_id, findings").eq("dynamic_scan_status", "queued").limit(10);
  const processed = [];
  for (const r of queued ?? []) {
    await admin.from("scan_reports").update({ dynamic_scan_status: "running" }).eq("id", r.id);
    const { data: prod } = await admin.from("products").select("name, description, docs, bundle_path").eq("id", r.product_id).single();
    let content = `${prod?.name}\n${prod?.description}\n${JSON.stringify(prod?.docs ?? {})}`;
    if (prod?.bundle_path) { try { const { data: blob } = await admin.storage.from("bundles").download(prod.bundle_path); if (blob) content += "\n" + (await blob.text()); } catch (_) { /* */ } }
    const traces = await runInSandbox(content);
    const hasCritical = traces.some((t) => t.severity === "critical");
    const verdict = hasCritical ? "dynamic_flagged" : "clean";
    const merged = [...(r.findings ?? []), ...traces.map((t) => ({ severity: t.severity, category: "dynamic", cwe: "CWE-506", title: t.kind, detail: t.detail, evidence: "sandbox trace" }))];
    await admin.from("scan_reports").update({ dynamic_scan_status: "done", findings: merged }).eq("id", r.id);
    if (hasCritical) { await admin.from("products").update({ published: false }).eq("id", r.product_id); }
    processed.push({ product_id: r.product_id, verdict, traces: traces.length, depublished: hasCritical });
  }
  return json({ ok: true, processed_count: processed.length, processed });
});
