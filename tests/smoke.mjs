// Smoke tests for index.html — runs the app's inline scripts in a sandboxed VM
// context with stubbed DOM, then exercises core data/rendering functions.
// Usage: node tests/smoke.mjs   (run from the repo root)

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const indexPath = path.join(repoRoot, 'index.html');

function fail(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

let html;
try {
  html = readFileSync(indexPath, 'utf8');
} catch (e) {
  fail(`Could not read index.html at ${indexPath}: ${e.message}`);
}

// Extract all <script>...</script> blocks, skipping any <script src=...> tags.
const scriptBlocks = [];
const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m;
while ((m = scriptRe.exec(html)) !== null) {
  const attrs = m[1] || '';
  const body = m[2];
  if (/\bsrc\s*=/.test(attrs)) continue; // external script, skip
  scriptBlocks.push(body);
}

if (scriptBlocks.length < 2) {
  fail(`Expected at least 2 inline <script> blocks, found ${scriptBlocks.length}`);
}

const block0 = scriptBlocks[0];
const block1 = scriptBlocks[1];

// ---- Stub DOM and run block 0 in a VM context ----
const mkEl = () => ({
  style: {},
  classList: { add(){}, remove(){} },
  dataset: {},
  innerHTML: '',
  textContent: '',
  appendChild(){},
  remove(){},
  querySelector(){ return mkEl(); },
});

const ctx = {
  window: { LIVE: false, SESSION: null, scrollTo(){} },
  document: {
    documentElement: { dataset: {} },
    getElementById: () => mkEl(),
    querySelector: () => mkEl(),
    createElement: () => mkEl(),
    body: { appendChild(){} },
  },
  localStorage: { getItem: () => null, setItem(){} },
  setTimeout,
  clearTimeout,
  console,
  URL,
  navigator: {},
  location: { origin: 'https://x', pathname: '/', href: 'https://x/' },
};
ctx.window.document = ctx.document;

vm.createContext(ctx);

// block0 declares its top-level bindings (SKILLS, state, PLANS, etc.) with
// const/let, which — unlike `var` or function declarations — do NOT attach as
// properties of the vm context object. Append a bridging snippet that copies
// the bindings we need onto `globalThis` (which vm.createContext maps to the
// context object) so the harness can read/mutate them from outside the VM.
const bridge = `
;globalThis.__SKILLS = SKILLS;
globalThis.__state = state;
globalThis.__PLANS = PLANS;
globalThis.__PLAN_TYPES = PLAN_TYPES;
`;

try {
  vm.runInContext(block0 + bridge, ctx);
} catch (e) {
  fail(`Block 0 threw while executing in the stubbed VM context: ${e.stack || e.message}`);
}

ctx.SKILLS = ctx.__SKILLS;
ctx.state = ctx.__state;
ctx.PLANS = ctx.__PLANS;
ctx.PLAN_TYPES = ctx.__PLAN_TYPES;

const results = [];
function group(name, fn) {
  try {
    fn();
    results.push(`✅ ${name}`);
  } catch (e) {
    fail(`${name} — ${e.message}`);
  }
}

// ---- Assertion group: SKILLS array shape ----
group('SKILLS array exists, has >20 products, none with type "mcp"', () => {
  const SKILLS = ctx.SKILLS;
  if (!Array.isArray(SKILLS)) throw new Error('SKILLS is not an array');
  if (!(SKILLS.length > 20)) throw new Error(`SKILLS.length is ${SKILLS.length}, expected >20`);
  const mcpItems = SKILLS.filter(s => s.type === 'mcp');
  if (mcpItems.length > 0) {
    throw new Error(`Found ${mcpItems.length} product(s) with type 'mcp': ${mcpItems.map(s=>s.id).join(', ')}`);
  }
});

// ---- Assertion group: credit pricing ----
group('credit pricing: skill=5, prompt=2, workflow=30', () => {
  const SKILLS = ctx.SKILLS;
  const skillItem = SKILLS.find(s => (s.type || 'skill') === 'skill' && s.credits === 5);
  if (!skillItem) throw new Error('No skill-type item found with credits===5');
  const promptItem = SKILLS.find(s => s.type === 'prompt' && s.credits === 2);
  if (!promptItem) throw new Error('No prompt-type item found with credits===2');
  const workflowItem = SKILLS.find(s => s.type === 'workflow' && s.credits === 30);
  if (!workflowItem) throw new Error('No workflow-type item found with credits===30');
});

// ---- Assertion group: canDownload gating ----
group('canDownload gating by plan', () => {
  const SKILLS = ctx.SKILLS;
  const state = ctx.state;
  const canDownload = ctx.canDownload;

  const avatarItem = SKILLS.find(s => s.type === 'avatar');
  if (!avatarItem) throw new Error('No avatar-type item found in SKILLS');
  const datasetItem = SKILLS.find(s => s.type === 'dataset');
  if (!datasetItem) throw new Error('No dataset-type item found in SKILLS');

  const prevPlan = state.plan;
  const prevSub = state.subActive;
  try {
    state.subActive = true;

    state.plan = 'basic';
    if (canDownload(avatarItem)) throw new Error('basic plan should NOT be able to download an avatar-type product');

    state.plan = 'pro';
    if (!canDownload(avatarItem)) throw new Error('pro plan SHOULD be able to download an avatar-type product');

    state.plan = 'developer';
    if (!canDownload(datasetItem)) throw new Error('developer plan SHOULD be able to download a dataset-type product');
  } finally {
    state.plan = prevPlan;
    state.subActive = prevSub;
  }
});

// ---- Assertion group: search does not throw ----
group('filteredSkills() with a search term does not throw and returns results', () => {
  const state = ctx.state;
  const filteredSkills = ctx.filteredSkills;

  const prev = { search: state.search, typeF: state.typeF, cat: state.cat, tierF: state.tierF, llmF: state.llmF };
  try {
    state.search = 'data';
    state.typeF = 'All';
    state.cat = 'All';
    state.tierF = 'All';
    state.llmF = 'All';
    const out = filteredSkills();
    if (!Array.isArray(out)) throw new Error('filteredSkills() did not return an array');
    if (!(out.length > 0)) throw new Error(`filteredSkills() returned ${out.length} results for search="data", expected >0`);
  } finally {
    state.search = prev.search;
    state.typeF = prev.typeF;
    state.cat = prev.cat;
    state.tierF = prev.tierF;
    state.llmF = prev.llmF;
  }
});

// ---- Assertion group: render* functions return clean strings ----
group('render*() functions return strings with no NaN / undefined', () => {
  const fns = ['renderHome', 'renderBrowse', 'renderPricing', 'renderBilling', 'renderDashboard'];
  for (const name of fns) {
    const fn = ctx[name];
    if (typeof fn !== 'function') throw new Error(`${name} is not defined as a function`);
    let out;
    try {
      out = fn();
    } catch (e) {
      throw new Error(`${name}() threw: ${e.message}`);
    }
    if (typeof out !== 'string') throw new Error(`${name}() did not return a string`);
    if (out.includes('NaN')) throw new Error(`${name}() output contains 'NaN'`);
    if (out.includes('undefined')) throw new Error(`${name}() output contains 'undefined'`);
  }
});

// ---- Assertion group: pricing copy ----
group('renderPricing() contains $15, $30, $60', () => {
  const out = ctx.renderPricing();
  for (const price of ['$15', '$30', '$60']) {
    if (!out.includes(price)) throw new Error(`renderPricing() output missing "${price}"`);
  }
});

// ---- Syntax-check block 1 via `node --check` ----
group('block 1 (live backend layer) is syntactically valid', () => {
  let nodeCheckAvailable = true;
  try {
    execFileSync(process.execPath, ['--check', '--input-type=module'], { input: '0', stdio: 'pipe' });
  } catch {
    nodeCheckAvailable = false;
  }

  if (!nodeCheckAvailable) {
    console.log('⚠️  node --check unavailable in this environment — skipping block 1 syntax check');
    return;
  }

  const tmpFile = path.join(os.tmpdir(), `skillz-smoke-block1-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(tmpFile, block1);
  try {
    execFileSync(process.execPath, ['--check', tmpFile], { stdio: 'pipe' });
  } catch (e) {
    throw new Error(`node --check reported a syntax error in block 1: ${e.stderr ? e.stderr.toString() : e.message}`);
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
});

console.log('');
results.forEach(r => console.log(r));
console.log(`\n${results.length} assertion group(s) passed.`);
process.exit(0);
