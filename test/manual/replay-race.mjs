// Proves (or disproves) the auth-replay race end to end.
//
//   npm run dev -- -p 3900
//   node test/manual/replay-race.mjs 20
//
// Targets the prediction control by data-testid ONLY. An earlier harness used
// nth() over button[aria-pressed], which also matched the method pills and the
// confidence stars — so a failure could not be told apart from the harness
// clicking the wrong thing. Every stage below is asserted, never inferred:
// located, enabled, which fight, clicked, API calls, and the control's own
// data-picked flag (deterministic wait, no sleep).

import { chromium, devices } from "@playwright/test";
const BASE="http://localhost:3900";
const RUNS = Number(process.argv[2] ?? 5);
const b=await chromium.launch();
const results=[];

for (let run=1; run<=RUNS; run++) {
  const ctx=await b.newContext({...devices["Pixel 7"],colorScheme:"dark"});
  await ctx.request.post(`${BASE}/api/auth/signup`,{data:{name:`R${run}`,email:`_smoke_r${run}_${Date.now()}@example.test`,password:"Str0ng!Passw0rd#2026",registryRole:"fan",ageConfirmed:true,termsAccepted:true}});
  const page=await ctx.newPage();

  // ── network evidence ──────────────────────────────────────────────────
  const pickCalls=[]; const meCalls=[];
  page.on("request", r => { if (/\/pick$/.test(r.url())) pickCalls.push({url:r.url(), body:r.postData()}); if (/auth\/me/.test(r.url())) meCalls.push(1); });
  const pickResponses=[];
  page.on("response", async r => { if (/\/pick$/.test(r.url())) pickResponses.push(r.status()); });

  const cdp=await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate",{rate:6});
  await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:400,downloadThroughput:400*1024/8,uploadThroughput:400*1024/8});

  const stage={};
  await page.goto(`${BASE}/events/glory-109`,{waitUntil:"domcontentloaded"});

  // ── the ONE unambiguous control ───────────────────────────────────────
  const pill = page.locator('[data-testid="corner-pick"][data-corner="RED"]').first();
  try {
    await pill.waitFor({state:"visible",timeout:30000});
    stage.located = true;
    stage.enabled = await pill.isEnabled();
    stage.fight = await pill.getAttribute("data-fight");
    stage.pickedBefore = await pill.getAttribute("data-picked");
    await pill.click({timeout:10000});
    stage.clicked = true;
  } catch(e){ stage.err = String(e).split("\n")[0].slice(0,70); }

  // Deterministic: wait for the control itself to report picked. No sleep.
  try {
    await page.locator('[data-testid="corner-pick"][data-corner="RED"][data-picked="true"]').first()
      .waitFor({state:"attached",timeout:20000});
    stage.pickedAfter = true;
  } catch { stage.pickedAfter = false; }

  const path=new URL(page.url()).pathname;
  results.push({run, redirected: path.startsWith("/account"), ...stage,
    pickRequests: pickCalls.length, pickStatuses: pickResponses.join(","), body: pickCalls[0]?.body?.slice(0,60)});
  console.log(`run ${run}:`, JSON.stringify(results.at(-1)));
  await ctx.close();
}
const ok=results.filter(r=>!r.redirected && r.pickedAfter && r.pickRequests===1).length;
console.log(`\nPASS ${ok}/${RUNS}  (no redirect + UI picked + exactly one API call)`);
await b.close();
