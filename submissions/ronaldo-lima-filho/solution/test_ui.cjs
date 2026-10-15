// Actual inline filtering functions tested against the supplied CRM snapshot.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const html = fs.readFileSync(__dirname + "/index.html", "utf8");
const script = html.split("<script>")[1].split("</script>")[0];
const workflowScript = fs.readFileSync(__dirname + "/workflow.js", "utf8");
function runApp(context) {
  vm.runInContext(workflowScript, context);
  vm.runInContext(script, context);
}
const functions = script.slice(
  script.indexOf("function operationalOrder("),
  script.indexOf("function limitation("),
);
const snapshot = JSON.parse(
  execFileSync(
    "python3",
    ["-B", "-c", "import json; from app import dataset; print(json.dumps(dataset()))"],
    { cwd: __dirname, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  ),
);
function fixture() {
  const fields = {
    agent: { value: "" },
    manager: { value: "" },
    region: { value: "" },
    stage: { value: "" },
    search: { value: "" },
    sort: { value: "urgency" },
    accountfilter: { value: "" },
    reviewfilter: { value: "" },
    layout: { value: "opportunities" },
  };
  const context = {
    rows: snapshot.rows,
    queue: "review",
    reviewed: new Set(),
    $: (id) => fields[id],
  };
  vm.createContext(context);
  vm.runInContext(functions, context);
  return { context, fields };
}
test("global investigation reaches all 500 unknown dates, independently of review ranking", () => {
  const { context } = fixture();
  assert.equal(context.filtered().length, 1589);
  context.queue = "qualify";
  assert.equal(context.filtered().length, 500);
  assert.ok(context.filtered().every((r) => r.age === null));
});
test("investigation preserves salesperson/manager/region intersections", () => {
  const { context, fields } = fixture();
  fields.agent.value = "Anna Snelling";
  fields.manager.value = "Dustin Brinkmann";
  fields.region.value = "Central";
  context.queue = "qualify";
  assert.equal(context.filtered().length, 55);
  assert.equal(fields.agent.value, "Anna Snelling");
  context.queue = "review";
  assert.equal(context.filtered().length, 57);
  fields.region.value = "West";
  assert.equal(context.filtered().length, 0);
});
test("unidentified opportunity remains recoverable by its ID", () => {
  const { context, fields } = fixture();
  fields.search.value = "HAXMC4IX";
  const rows = context.filtered();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account, "Conta não informada");
  assert.equal(rows[0].score, 65);
});

test("typing during initial loading preserves search without rendering incomplete state", () => {
  const fields = {};
  const field = (id) =>
    (fields[id] ??= {
      value: "",
      listeners: {},
      addEventListener(name, fn) {
        this.listeners[name] = fn;
      },
    });
  const context = {
    document: { getElementById: field },
    fetch: () => new Promise(() => {}),
    Intl,
    console,
  };
  vm.createContext(context);
  runApp(context);
  field("search").value = "HAXMC4IX";
  assert.doesNotThrow(() => field("search").listeners.input());
  assert.equal(field("search").value, "HAXMC4IX");
});

function fullUi(fetcher, protocol = "http:") {
  const fields = {};
  const defaults = { sort: "operational", view: "top10", jevmode: "disabled" };
  const field = (id) =>
    (fields[id] ??= {
      value: defaults[id] ?? "",
      options: [{}],
      listeners: {},
      textContent: "",
      innerHTML: "",
      checked: false,
      append(o) {
        this.options.push(o);
      },
      setAttribute() {},
      focus() {},
      addEventListener(name, fn) {
        this.listeners[name] = fn;
      },
    });
  const context = {
    document: { getElementById: field, createElement: () => ({}) },
    location: { protocol },
    fetch: fetcher,
    crypto: require("node:crypto").webcrypto,
    Intl,
    console,
  };
  vm.createContext(context);
  runApp(context);
  return { field, context };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("cards keep record-specific warnings and show readable timing while details retain the ratio", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  for (const r of snapshot.rows) {
    assert.doesNotMatch(context.limitation(r), /Último contato/);
  }
  const r = snapshot.rows.find((r) => r.age === 104 && r.operations.median_cycle_days === 57);
  assert.ok(r);
  const card = context.row(r).split('<details class="op-audit"')[0];
  assert.match(card, /Engajamento iniciado há 104 dias/);
  assert.match(card, /104 dias/);
  assert.match(card, /Faixa de atenção proposta: 57–114 dias/);
  assert.doesNotMatch(card, /1,82|1–2×|Último contato/);
  assert.match(context.audit(r), /1,82×/);
  assert.match(context.limitation(snapshot.rows.find((r) => !r.account_identified)), /Conta não identificada/);
  assert.match(html, /A base não contém a data do último contato/);
});

test("timing summary distinguishes missing age from an unavailable product cycle", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const qualify = { age: null, operations: { timing: "qualification", median_cycle_days: 57 } };
  assert.match(context.timingSummary(qualify), /sem data válida/);
  assert.match(context.timingSummary(qualify), /Qualificar necessidade/);
  const fallback = { age: 40, operations: { timing: "window", median_cycle_days: null } };
  assert.match(context.timingSummary(fallback), /30–90 dias \(alternativa\)/);
  assert.doesNotMatch(context.timingSummary(fallback), /undefined/);
  for (const timing of ["early", "overrun", "critical"]) {
    assert.doesNotMatch(context.timingSummary({ ...fallback, operations: { ...fallback.operations, timing } }), /undefined/);
  }
});
test("load failure disables actions and retry preserves pre-load search through successful rendering", async () => {
  let attempts = 0;
  const { field } = fullUi(() =>
    ++attempts === 1
      ? Promise.reject(Error("unavailable"))
      : Promise.resolve({ ok: true, json: async () => snapshot }),
  );
  field("search").value = "HAXMC4IX";
  field("cleanupqueue").onclick();
  field("search").listeners.input();
  assert.equal(field("apply").disabled, true);
  assert.doesNotThrow(() => field("simreset").onclick());
  await settle();
  assert.match(field("status").textContent, /Falha ao carregar/);
  assert.equal(field("server-help").hidden, false);
  assert.match(field("server-help-reason").textContent, /CSV/);
  assert.equal(field("retryload").hidden, false);
  field("retryload").onclick();
  await settle();
  assert.equal(field("search").value, "HAXMC4IX");
  assert.match(field("list").innerHTML, /HAXMC4IX/);
  assert.match(field("status").textContent, /1 de 1/);
  assert.equal(field("retryload").hidden, true);
  assert.equal(field("server-help").hidden, true);
  assert.equal(field("workspace").hidden, false);
});

test("opening the HTML as a file shows server instructions without requesting pipeline data", () => {
  let calls = 0;
  const { field } = fullUi(() => { calls++; return Promise.reject(Error("unexpected request")); }, "file:");
  assert.equal(calls, 0);
  assert.equal(field("workspace").hidden, true);
  assert.equal(field("server-help").hidden, false);
  assert.match(field("server-help-title").textContent, /servidor local/);
  assert.match(field("server-help-reason").textContent, /aberto diretamente/);
  assert.equal(field("retryload").hidden, true);
  assert.equal(field("apply").disabled, true);
  assert.match(html, /python3 -B app\.py/);
  assert.match(html, /id="open-local-app" href="http:\/\/127\.0\.0\.1:8765\/"/);
});
test("changing JEV mode invalidates delayed result without changing baseline list", async () => {
  let finish;
  const pending = new Promise((resolve) => (finish = resolve));
  const { field, context } = fullUi((url) =>
    url === "/api/pipeline" ? Promise.resolve({ ok: true, json: async () => snapshot }) : pending,
  );
  await settle();
  const before = field("list").innerHTML;
  assert.match(before, /decision-row/);
  vm.runInContext("jevDealId=filtered()[0].id", context);
  field("jevmode").value = "mock";
  field("jevmode").onchange();
  field("jevtext").value = "Synthetic next meeting.";
  const request = field("jevform").onsubmit({ preventDefault() {} });
  field("jevmode").value = "disabled";
  field("jevmode").onchange();
  finish({
    ok: true,
    json: async () => ({
      message: "stale",
      classification: { label: "stale" },
      source: "synthetic_fixture",
      status: "mock",
    }),
  });
  await request;
  assert.equal(field("jevresult").innerHTML, "");
  assert.match(field("jevstatus").textContent, /desativado/);
  assert.equal(field("list").innerHTML, before);
});

test("operational queues isolate the oldest deal and favor the cycle window", () => {
  const { context, fields } = fixture();
  context.queue = "conversion";
  fields.sort.value = "operational";
  const conversion = context.filtered();
  assert.equal(conversion.length, 212);
  assert.equal(conversion[0].operations.timing, "window");
  assert.ok(!conversion.some((r) => r.id === "HAXMC4IX"));
  assert.equal(conversion[0].account_identified, true);
  context.queue = "cleanup";
  assert.equal(context.filtered().length, 1377);
  assert.ok(context.filtered().some((r) => r.id === "HAXMC4IX"));
  context.queue = "qualify";
  fields.accountfilter.value = "identified";
  assert.equal(context.filtered().length, 163);
  fields.accountfilter.value = "missing";
  assert.equal(context.filtered().length, 337);
});
test("identified account breaks conversion timing ties without crossing windows or changing other queues", () => {
  const { context } = fixture();
  const deal = (id, age, identified, queue = "conversion", timing = "window") => ({
    id,
    age,
    account_identified: identified,
    operations: { queue, timing },
  });
  assert.ok(context.operationalOrder(deal("KNOWN", 70, true), deal("ORPHAN", 110, false)) < 0);
  assert.ok(context.operationalOrder(deal("ORPHAN", 70, false), deal("KNOWN", 110, true)) > 0);
  assert.ok(
    context.operationalOrder(
      deal("ORPHAN", 70, false),
      deal("EARLY", 10, true, "conversion", "early"),
    ) < 0,
  );
  assert.ok(
    context.operationalOrder(
      deal("KNOWN", 150, true, "cleanup", "critical"),
      deal("ORPHAN", 200, false, "cleanup", "critical"),
    ) > 0,
  );
  assert.ok(
    context.operationalOrder(
      deal("A", null, false, "qualify", "qualification"),
      deal("B", null, true, "qualify", "qualification"),
    ) < 0,
  );
});
test("all identified deals precede orphans within each conversion timing, with baseline order preserved", () => {
  const { context, fields } = fixture();
  context.queue = "conversion";
  fields.sort.value = "operational";
  const result = context.filtered();
  for (const timing of ["window", "overrun", "early"]) {
    const group = result.filter((r) => r.operations.timing === timing);
    const firstOrphan = group.findIndex((r) => !r.account_identified);
    if (firstOrphan >= 0) assert.ok(group.slice(firstOrphan).every((r) => !r.account_identified));
  }
  fields.sort.value = "urgency";
  context.queue = "review";
  assert.deepEqual(
    context.filtered().map((r) => r.id),
    snapshot.rows.filter((r) => r.age !== null).map((r) => r.id),
  );
});
test("review filters intersect selection without changing ranking or opportunities", () => {
  const { context, fields } = fixture();
  const first = context.filtered()[0];
  context.reviewed.add(first.id);
  fields.reviewfilter.value = "reviewed";
  assert.equal(context.filtered().length, 1);
  assert.equal(context.filtered()[0].id, first.id);
  fields.reviewfilter.value = "pending";
  assert.equal(context.filtered().length, 1588);
});
test("account grouping never merges unrelated orphan deals", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const groups = context.groupAccounts(snapshot.rows),
    orphans = groups.filter((g) => !g.identified);
  assert.equal(orphans.length, 1425);
  assert.ok(orphans.every((g) => g.rows.length === 1));
  assert.equal(
    groups.reduce((sum, g) => sum + g.rows.length, 0),
    2089,
  );
  const identified = groups.find((g) => g.identified);
  assert.equal(
    identified.catalog,
    identified.rows.reduce((sum, r) => sum + r.catalog_price, 0),
  );
});
test("exports include all filtered rows, reviewed state and formula-safe CSV cells", async () => {
  const { field, context } = fullUi(() =>
    Promise.resolve({ ok: true, json: async () => snapshot }),
  );
  await settle();
  const data = context.filtered();
  assert.equal(data.length, 212);
  const csv = context.csvExport(data);
  assert.equal(csv.split("\r\n").length, 213);
  assert.ok(csv.startsWith("\ufeff"));
  for (const input of ['=HYPERLINK("bad")', "  +1", "@SUM(A1)", "-1", "\tvalue"])
    assert.ok(context.csvCell(input).startsWith("\"'"));
  assert.equal(context.csvCell('ACME, "A"'), '"ACME, ""A"""');
  const md = context.summaryExport(data);
  assert.equal((md.match(/^- /gm) || []).length, 212);
  assert.match(md, /2017-12-31/);
  assert.equal(field("view").value, "top10");
});
test("tactical actions combine category with cleanup and qualification context", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const cleanup = snapshot.rows.find((r) => r.operations.queue === "cleanup"),
    qualify = snapshot.rows.find((r) => r.operations.queue === "qualify"),
    conversion = snapshot.rows.find((r) => r.operations.queue === "conversion");
  assert.match(context.tacticalAction(cleanup, "explicit_next_step"), /ainda é válido/);
  assert.match(context.tacticalAction(qualify, "explicit_objection"), /qualificação/);
  assert.match(context.tacticalAction(conversion, "explicit_objection"), /Esclarecer a objeção/);
});

test("empty conversion offers other queues without clearing region or salesperson", async () => {
  const { field, context } = fullUi(() =>
    Promise.resolve({ ok: true, json: async () => snapshot }),
  );
  await settle();
  field("region").value = "Central";
  field("agent").value = "Anna Snelling";
  vm.runInContext("render()", context);
  assert.match(field("status").textContent, /Troque de fila mantendo/);
  assert.match(field("list").innerHTML, /data-queue="cleanup"/);
  assert.match(field("list").innerHTML, /57 oportunidades/);
  assert.match(field("list").innerHTML, /55 oportunidades/);
  field("list").listeners.click({
    target: {
      closest: (selector) =>
        selector === "button[data-queue]" ? { dataset: { queue: "cleanup" } } : null,
    },
  });
  assert.equal(field("region").value, "Central");
  assert.equal(field("agent").value, "Anna Snelling");
  assert.match(field("status").textContent, /57 oportunidades/);
});

test("central empty queue differs from filters with no matching opportunities", async () => {
  const { field, context } = fullUi(() =>
    Promise.resolve({ ok: true, json: async () => snapshot }),
  );
  await settle();
  field("region").value = "Central";
  vm.runInContext("render()", context);
  assert.match(field("list").innerHTML, /408 oportunidades/);
  assert.match(field("list").innerHTML, /500 oportunidades/);
  field("search").value = "no-such-id";
  vm.runInContext("render()", context);
  assert.match(field("status").textContent, /Nenhuma oportunidade corresponde/);
  assert.doesNotMatch(field("list").innerHTML, /data-queue=/);
});

test("cards emphasize the next step and retain the original index only in details", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const deal = snapshot.rows.find((r) => r.id === "HAXMC4IX");
  const card = context.row(deal);
  const actionCell = card.match(/<div class="cell action-cell">([\s\S]*?)<\/div>/)[1];
  assert.doesNotMatch(actionCell, /65\/80|Índice heurístico/);
  assert.match(context.audit(deal), /65 de 80 pontos/);
});

test("comparison rows expose four aligned cells and keep history and review controls in details", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const r = snapshot.rows.find((r) => r.account_identified);
  const card = context.row(r).split('<details class="op-audit"')[0];
  assert.equal((card.match(/<div class="cell[ "]/g) || []).length, 4);
  assert.match(card, /data-open=/);
  assert.doesNotMatch(card, /data-review=|funcionários|negócios perdidos|class="pill|Catálogo unitário/);
  assert.match(context.audit(r), /data-review=/);
  assert.match(context.audit(r), /não atualiza o CRM/);
  assert.match(context.audit(r), /mesmo início e finais diferentes/);
  assert.equal(field("status").textContent, "Mostrando 10 de 212 oportunidades.");
  field("layout").value = "accounts";
  field("layout").listeners.change();
  assert.match(field("status").textContent, /grupos · \d+ oportunidades com conta nesta fila/);
});

test("grouping offers separate exhaustive paths and exports only the chosen work", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  field("investigate").onclick();
  field("layout").value = "accounts";
  field("layout").listeners.change();
  assert.match(field("groupidentified").textContent, /73 contas · 163 oportunidades/);
  assert.match(field("groupmissing").textContent, /337 oportunidades sem vínculo/);
  const identified = context.filtered();
  assert.equal(identified.length, 163);
  assert.ok(identified.every((r) => r.account_identified));
  const groups = context.groupAccounts(identified);
  assert.equal(groups.length, 73);
  assert.equal(groups[0].rows.length, 5);
  for (let i = 1; i < groups.length; i++) assert.ok(groups[i - 1].rows.length >= groups[i].rows.length);
  field("groupmissing").onclick();
  const missing = context.filtered();
  assert.equal(missing.length, 337);
  assert.ok(missing.every((r) => !r.account_identified));
  assert.doesNotMatch(field("list").innerHTML, /class="account-group"/);
  assert.match(field("list").innerHTML, /00400B1S/);
  assert.equal(context.csvExport(missing).split("\r\n").length, 338);
  assert.equal(new Set([...identified, ...missing].map((r) => r.id)).size, 500);
  field("layout").value = "opportunities";
  field("layout").listeners.change();
  assert.equal(context.filtered().length, 500);
});

test("group paths replace a conflicting account filter, retain other filters and explain empty paths", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  field("region").value = "Central";
  field("agent").value = "Anna Snelling";
  field("investigate").onclick();
  field("accountfilter").value = "identified";
  field("layout").value = "accounts";
  field("layout").listeners.change();
  field("groupmissing").onclick();
  assert.equal(field("accountfilter").value, "");
  assert.equal(field("region").value, "Central");
  assert.equal(field("agent").value, "Anna Snelling");
  assert.ok(context.filtered().length > 0);
  assert.ok(context.filtered().every((r) => !r.account_identified));
  field("search").value = "00400B1S";
  field("agent").value = "";
  field("groupidentified").onclick();
  assert.match(field("status").textContent, /Nenhuma oportunidade neste caminho/);
  assert.match(field("groupmissing").textContent, /1 oportunidades sem vínculo/);
  field("groupmissing").onclick();
  assert.equal(context.filtered()[0].id, "00400B1S");
});

test("manager cards expose disjoint queue counts and window subset independently of filters", async () => {
  const { field, context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  field("manager").value = "Dustin Brinkmann";
  context.managerSummary();
  const before = field("team-panel").innerHTML;
  const anna = before.split('data-team-agent="Anna Snelling"')[1].split('</dl>')[0];
  assert.match(anna, /112 abertas/);
  assert.match(anna, /Ação de conversão<\/button><\/dt><dd>0 .*\(0 na janela de atenção\)/);
  assert.match(anna, /Saneamento<\/button><\/dt><dd>57/);
  assert.match(anna, /Qualificação<\/button><\/dt><dd>55/);
  assert.match(anna, /51% acima de 90 dias/);
  field("agent").value = "Anna Snelling";
  field("search").value = "HAXMC4IX";
  field("accountfilter").value = "missing";
  field("reviewfilter").value = "reviewed";
  vm.runInContext('queue = "qualify"', context);
  context.managerSummary();
  assert.equal(field("team-panel").innerHTML, before);
  const empty = snapshot.teams.find((t) => !snapshot.rows.some((r) => r.agent === t.agent));
  assert.ok(empty);
  field("manager").value = empty.manager;
  context.managerSummary();
  assert.match(field("team-panel").innerHTML, /0 abertas · sem carteira aberta/);
  for (const manager of ['Melvin Marxen', 'Summer Sewald', 'Celia Rouche']) {
    field('manager').value = manager;
    context.managerSummary();
    const team = snapshot.rows.filter(r => r.manager === manager);
    for (const agent of new Set(team.map(r => r.agent))) {
      const card = field('team-panel').innerHTML.split(`data-team-agent="${agent}"`)[1].split('</dl>')[0];
      for (const [q, label] of [['conversion', 'Ação de conversão'], ['cleanup', 'Saneamento'], ['qualify', 'Qualificação']]) {
        const count = team.filter(r => r.agent === agent && r.operations.queue === q).length;
        assert.match(card, new RegExp(`${label}</button></dt><dd>${count}(?: |<)`));
      }
    }
  }
});

test("index simulation explains unchanged operational order and offers explicit comparison", async () => {
  const simulated = structuredClone(snapshot);
  simulated.rules_hash = "different";
  const deal = simulated.rows.find((r) => r.id === "HAXMC4IX");
  deal.score = 35;
  const { context, field } = fullUi((url) => Promise.resolve({ ok: true, json: async () => url.includes("?rules=") ? simulated : snapshot }));
  await settle();
  const before = context.filtered().map((r) => r.id);
  const counts = JSON.stringify(snapshot.queue_counts);
  await field("simform").onsubmit({ preventDefault() {} });
  assert.deepEqual(context.filtered().map((r) => r.id), before);
  assert.match(field("simulation-impact").textContent, /1 de 2.089 oportunidades com índice diferente/);
  assert.match(field("simulation-impact").textContent, /ordem operacional permanece igual/);
  assert.match(field("simstatus").textContent, /filas e limites operacionais preservados/);
  field("comparesimulation").onclick();
  assert.equal(field("sort").value, "score");
  assert.equal(field("comparesimulation").hidden, true);
  assert.match(field("simulation-impact").textContent, /ordenada pelo índice simulado/);
  field("simreset").onclick();
  assert.equal(field("simulation-banner").hidden, true);
  assert.equal(JSON.stringify(snapshot.queue_counts), counts);
  assert.equal(snapshot.rows.find((r) => r.id === "HAXMC4IX").score, 65);
});

test("review marking and undo report their session-only effect and preserve the source", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const r = snapshot.rows[0];
  const before = JSON.stringify(snapshot.rows);
  const box = { dataset: { review: r.id }, checked: true };
  const event = { target: { closest: () => box } };
  field("list").listeners.change(event);
  assert.match(field("reviewstatus").textContent, /marcada como revisada nesta sessão/);
  assert.match(context.row(r), /review-state complete/);
  box.checked = false;
  field("list").listeners.change(event);
  assert.match(field("reviewstatus").textContent, /revisão desmarcada/);
  assert.doesNotMatch(context.row(r), /review-state complete/);
  assert.match(field("reviewstatus").textContent, /Nenhum dado foi alterado no CRM/);
  assert.equal(JSON.stringify(snapshot.rows), before);
});

test("review context labels Won as opportunities and keeps unavailable account values unknown", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const bioplex = snapshot.rows.find((r) => r.account === "Bioplex" && r.product === "GTX Basic" && r.age === 117);
  assert.equal(bioplex.evidence.previous_won_n, 911);
  assert.equal(bioplex.evidence.previous_won_period.latest_close_date, "2017-12-30");
  const facts = context.contextFacts(bioplex);
  assert.match(facts, /Oportunidades ganhas<\/dt><dd>31/);
  assert.match(facts, /US\$ 326,82 milhões/);
  assert.doesNotMatch(facts, /compra\(s\)|Catálogo/);
  const orphan = snapshot.rows.find((r) => !r.account_identified);
  assert.match(context.contextFacts(orphan), /Oportunidades ganhas<\/dt><dd>Não disponível/);
  const decision = context.audit(bioplex).split('<details class="criteria-explanation"')[0];
  assert.doesNotMatch(decision, /1,92×|close_date|55\/80/);
  assert.equal((context.audit(bioplex).match(/class="recommendation"/g) || []).length, 1);
});

test("copy confirmation clears when filters change without clearing the selection", async () => {
  const { field, context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  context.navigator = { clipboard: { writeText: async () => {} } };
  await field("copysummary").onclick();
  assert.match(field("workflowstatus").textContent, /212 oportunidades copiadas/);
  field("region").value = "Central";
  field("region").listeners.change();
  assert.equal(field("workflowstatus").textContent, "");
  assert.equal(field("region").value, "Central");
});

test("late clipboard success or failure does not restore a message for an old selection", async () => {
  for (const fail of [false, true]) {
    const { field, context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
    await settle();
    let finish, reject;
    context.navigator = {
      clipboard: { writeText: () => new Promise((resolve, fail) => { finish = resolve; reject = fail; }) },
    };
    const copying = field("copysummary").onclick();
    field("search").value = "HAXMC4IX";
    field("search").listeners.input();
    if (fail) reject(Error("clipboard unavailable")); else finish();
    await copying;
    assert.equal(field("workflowstatus").textContent, "");
    assert.equal(field("search").value, "HAXMC4IX");
  }
});

test("policy laboratory reproduces all backend scenarios on original rows without changing workflow", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const before = JSON.stringify(snapshot);
  const analysis = JSON.parse(execFileSync('python3', ['-B', 'analyze_policy.py'], { cwd: __dirname, encoding: 'utf8' }));
  for (const s of analysis.scenarios) {
    const result = context.evaluatePolicyScenario(s.cleanup_days_exclusive, s.cleanup_cycle_ratio_exclusive);
    assert.deepEqual(JSON.parse(JSON.stringify(result.counts)), s.counts);
    assert.equal(result.changed, s.changed_queue_count);
  }
  const baseResult = context.evaluatePolicyScenario(120, 2.5);
  assert.equal(baseResult.centralConversion, 0);
  assert.equal(baseResult.conversionAgents, 17);
  assert.equal(baseResult.activeAgents, 27);
  const daysOnly = context.evaluatePolicyScenario(180, null);
  assert.equal(daysOnly.centralConversion, 408);
  assert.equal(daysOnly.centralAdded, 408);
  assert.equal(daysOnly.addedAgents, 10);
  field('region').value = 'Central';
  field('search').value = 'HAXMC4IX';
  const selected = context.filtered().map(r => r.id);
  field('policydays').value = '180'; field('policyratio').value = '2.5';
  field('policydayonly').checked = true;
  field('policyform').onsubmit({ preventDefault() {} });
  assert.match(field('policystatus').textContent, /408 em conversão/);
  assert.match(field('policystatus').textContent, /2.089 abertas/);
  assert.equal(field('region').value, 'Central');
  assert.deepEqual(context.filtered().map(r => r.id), selected);
  field('policyreset').onclick();
  assert.match(field('policystatus').textContent, /0 reclassificadas/);
  assert.equal(field('policydayonly').checked, false);
  assert.equal(JSON.stringify(snapshot), before);
});

test("policy boundaries, missing dates and invalid inputs never silently replace results", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const original = snapshot.rows;
  const template = original[0];
  context.__testRows = [
    { ...template, id: 'BOUND', age: 120, stage: 'Engaging', operations: { queue: 'conversion', cycle_ratio: 2.5 } },
    { ...template, id: 'DAY', age: 121, stage: 'Engaging', operations: { queue: 'cleanup', cycle_ratio: 2 } },
    { ...template, id: 'REL', age: 119, stage: 'Engaging', operations: { queue: 'cleanup', cycle_ratio: 2.6 } },
    { ...template, id: 'ZERO', age: 100, stage: 'Engaging', operations: { queue: 'conversion', cycle_ratio: null } },
    { ...template, id: 'UNKNOWN', age: null, stage: 'Engaging', operations: { queue: 'qualify', cycle_ratio: null } },
    { ...template, id: 'PROSPECT', age: 200, stage: 'Prospecting', operations: { queue: 'qualify', cycle_ratio: 4 } },
  ];
  vm.runInContext('base = { ...base, rows: __testRows }', context);
  assert.equal(context.evaluatePolicyScenario(120, 2.5).changed, 0);
  assert.equal(context.evaluatePolicyScenario(120, null).changed, 1);
  assert.equal(context.evaluatePolicyScenario(120, null).counts.qualify, 2);
  for (const [days, ratio] of [[0, 2.5], [120.5, 2.5], [NaN, 2.5], [Infinity, 2.5], [120, NaN], [120, Infinity], [120, 0], [120, '2.5'], [3651, null]])
    assert.throws(() => context.evaluatePolicyScenario(days, ratio));
  field('policydays').value = ''; field('policyratio').value = '2.5';
  field('policyform').onsubmit({ preventDefault() {} });
  assert.match(field('policyerror').textContent, /dias inteiros/);
  assert.match(field('policystatus').textContent, /Nenhum resultado válido/);
  field('policydays').listeners.input();
  assert.match(field('policystatus').textContent, /Limites alterados/);
});

test("policy case identities match the boundary cohort in both directions without mutating the snapshot", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const before = JSON.stringify(snapshot);
  const relaxed = context.evaluatePolicyScenario(144, 2.5);
  const expected = snapshot.rows.filter(r => r.operations.queue === 'cleanup' && r.age <= 144 && r.operations.cycle_ratio <= 2.5);
  assert.equal(relaxed.changed, 113);
  assert.deepEqual([...relaxed.changes.map(r => r.id)].sort(), expected.map(r => r.id).sort());
  assert.ok(relaxed.changes.every(r => r.from_queue === 'cleanup' && r.to_queue === 'conversion'));
  const strict = context.evaluatePolicyScenario(96, 2.5);
  assert.equal(strict.changes.length, 84);
  assert.ok(strict.changes.every(r => r.from_queue === 'conversion' && r.to_queue === 'cleanup'));
  const relative = context.evaluatePolicyScenario(120, null);
  assert.deepEqual([...relative.changes.map(r => r.id)], ['KXR63BV7']);
  assert.equal(JSON.stringify(snapshot), before);
});

test("policy CSV exports the complete cohort with provenance while pagination and filters affect only the view", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const originalExport = context.csvExport(context.filtered());
  field('policydays').value = '144'; field('policyratio').value = '2.5';
  field('policyform').onsubmit({ preventDefault() {} });
  assert.equal((field('policycases').innerHTML.match(/data-policy-id=/g) || []).length, 30);
  assert.match(field('policycasepage').textContent, /Página 1 de 4/);
  for (let i = 0; i < 3; i++) field('policynext').onclick();
  assert.equal((field('policycases').innerHTML.match(/data-policy-id=/g) || []).length, 23);
  assert.equal(field('policynext').disabled, true);
  const scenario = context.evaluatePolicyScenario(144, 2.5), csv = context.policyCasesCsv(scenario);
  assert.equal(csv.split('\r\n').length, 114);
  assert.match(csv, /fila_base.*fila_cenario.*referencia.*dataset_hash/);
  assert.match(csv, /cenario_hipotetico_nao_aplicado/);
  assert.ok(csv.includes(snapshot.dataset_hash));
  assert.match(context.policyCaseReason(scenario.changes.find(r => r.age === 144), scenario), /144 dias: >120 na base e ≤144 no cenário/);
  assert.equal(context.csvExport(context.filtered()), originalExport);
});

test("editing policy inputs and restoring the base invalidate old case exports", async () => {
  const { field, context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  field('policydays').value = '144'; field('policyratio').value = '2.5';
  field('policyform').onsubmit({ preventDefault() {} });
  assert.equal(field('exportpolicy').disabled, false);
  field('policydays').value = '';
  field('policydays').listeners.input();
  assert.equal(field('exportpolicy').disabled, true);
  assert.equal(field('policychanges').hidden, true);
  assert.equal(field('policycases').innerHTML, '');
  assert.throws(() => context.policyCasesCsv(null));
  field('policyreset').onclick();
  assert.equal(field('policychanges').hidden, true);
  assert.equal(field('exportpolicy').disabled, true);
});

test("same-account context uses all original open rows, excludes self and never joins unidentified accounts", async () => {
  const { context, field } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const deal = snapshot.rows.find(r => r.account === 'Iselectrics');
  field('agent').value = deal.agent;
  field('region').value = deal.region;
  field('search').value = deal.id;
  const others = context.sameAccountOpportunities(deal);
  assert.equal(others.length, 12);
  assert.ok(others.some(r => r.agent !== deal.agent));
  assert.ok(others.every(r => r.account === deal.account && r.id !== deal.id));
  const expected = snapshot.rows.filter(r => r.account === deal.account && r.id !== deal.id);
  assert.deepEqual([...others.map(r => r.id)].sort(), expected.map(r => r.id).sort());
  assert.match(context.accountOpportunities(deal), /Outras 12 oportunidades/);
  assert.match(context.accountOpportunities(deal), /Não comprova contatos simultâneos/);
  const orphan = snapshot.rows.find(r => !r.account_identified);
  assert.equal(context.sameAccountOpportunities(orphan).length, 0);
  assert.equal(context.accountOpportunities(orphan), '');
  assert.equal(field('search').value, deal.id);
});

test("account peer content is escaped and remains bound to the exact identified account", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const deal = { ...snapshot.rows[0], id: 'origin', account: 'Exact', account_identified: true };
  context.__peerRows = [deal, { ...deal, id: 'peer', agent: '<img src=x onerror=alert(1)>', product: '<script>bad</script>' }, { ...deal, id: 'other', account: 'Exact suffix' }];
  vm.runInContext('base = { ...base, rows: __peerRows }', context);
  const content = context.accountOpportunities(deal);
  assert.match(content, /Outras 1 oportunidades/);
  assert.doesNotMatch(content, /<img|<script|data-related-id="other"/);
  assert.match(content, /&lt;img/);
});

test("manager queue shortcuts select both dimensions and preserve the remaining filters and source", async () => {
  const { field, context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  field('manager').value = 'Dustin Brinkmann'; field('region').value = 'Central';
  const before = JSON.stringify(snapshot);
  for (const [queue, count] of [['cleanup', 57], ['qualify', 55], ['conversion', 0]]) {
    const button = { dataset: { agent: 'Anna Snelling', agentQueue: queue } };
    field('team-panel').listeners.click({ target: { closest: () => button } });
    assert.equal(field('agent').value, 'Anna Snelling');
    assert.equal(field('manager').value, 'Dustin Brinkmann');
    assert.equal(field('region').value, 'Central');
    assert.equal(context.filtered().length, count);
    assert.equal(vm.runInContext('queue', context), queue);
  }
  assert.equal(JSON.stringify(snapshot), before);
});

test("JEV selected example sends only mock category, resets late results and stays separate", async () => {
  let response, sent;
  const { context, field } = fullUi((url, options) => {
    if (url === '/api/jev/classify') { sent = JSON.parse(options.body); return new Promise(resolve => response = resolve); }
    return Promise.resolve({ ok: true, json: async () => snapshot });
  });
  await settle();
  const baseline = JSON.stringify(snapshot);
  vm.runInContext('jevDealId = rows[0].id', context);
  field('jevfixture').value = 'explicit_next_step'; field('jevmode').value = 'mock';
  await field('jevmode').onchange();
  assert.equal(field('jevfixturecontrol').hidden, false);
  assert.match(field('jevtext').value, /Exemplo sintético/);
  const pending = field('jevform').onsubmit({ preventDefault() {} });
  assert.equal(sent.mock_category, 'explicit_next_step');
  assert.equal(sent.mode, 'mock');
  assert.equal(sent.allow_transmission, false);
  assert.ok(!('id' in sent) && !('account' in sent));
  field('jevfixture').value = 'explicit_objection'; field('jevfixture').onchange();
  response({ ok: true, json: async () => ({ status: 'mock', source: 'synthetic_fixture', classification: { category: 'explicit_next_step', label: 'Stale next step' } }) });
  await pending;
  assert.equal(field('jevresult').textContent, '');
  assert.match(field('jevtext').value, /objeção/);
  context.clearDealJev();
  assert.equal(field('jevfixture').value, 'insufficient_context');
  assert.equal(field('jevmode').value, 'disabled');
  assert.equal(field('jevtext').value, '');
  assert.equal(field('jevfixturecontrol').hidden, true);
  assert.equal(JSON.stringify(snapshot), baseline);
});

test("group ordering is reproducible by count, catalog and name, preserving orphan identities", async () => {
  const { context } = fullUi(() => Promise.resolve({ ok: true, json: async () => snapshot }));
  await settle();
  const template = snapshot.rows[0];
  const input = ['Zulu', 'Alpha', 'Big'].map((account, i) => ({ ...template, id: String(i), account, account_identified: true, catalog_price: i === 2 ? 20 : 10 }));
  const a = context.groupAccounts(input).map(g => g.account);
  const b = context.groupAccounts([...input].reverse()).map(g => g.account);
  assert.deepEqual(a, b);
  assert.deepEqual([...a], ['Big', 'Alpha', 'Zulu']);
  assert.equal(context.groupAccounts(snapshot.rows).filter(g => !g.identified).length, 1425);
  const parent = snapshot.rows.find(r => r.account_context.subsidiary_of);
  assert.ok(parent);
  assert.match(context.contextFacts(parent), /Controladora declarada/);
  assert.match(context.contextFacts(parent), /sem informação sobre consolidação/);
});

async function serviceUi(classify) {
  const calls = [];
  const headers = [];
  const ui = fullUi((url, options) => {
    if (url === '/api/jev/classify') {
      calls.push(JSON.parse(options.body));
      headers.push(options.headers);
      return classify(calls.length);
    }
    if (url === '/api/jev/status') return Promise.resolve({ ok: true, json: async () => ({ service_ready: true }) });
    return Promise.resolve({ ok: true, json: async () => snapshot });
  });
  await settle();
  vm.runInContext('jevDealId = rows[0].id', ui.context);
  ui.field('jevmode').value = 'service';
  await ui.field('jevmode').onchange();
  ui.field('jevtext').value = 'Synthetic test note.';
  ui.field('jevdata').value = 'synthetic';
  const consent = () => {
    ui.field('jevconsent').checked = true;
    ui.field('jevcost').checked = true;
  };
  const submit = () => ui.field('jevform').onsubmit({ preventDefault() {} });
  return { ...ui, calls, headers, consent, submit };
}
const serviceSuccess = () => ({ ok: true, json: async () => ({ status: 'ok', message: 'Synthetic result', source: 'test_stub', model: 'test', classification: { label: 'Next step', category: 'explicit_next_step', confidence: 0.5 } }) });
test('JEV explicit submissions send distinct UUID idempotency headers and no key in the text payload', async () => {
  const { calls, headers, consent, submit } = await serviceUi(async () => serviceSuccess());
  consent(); await submit();
  consent(); await submit();
  assert.equal(headers.length, 2);
  for (const header of headers) assert.match(header['Idempotency-Key'], /^[a-f0-9-]{36}$/);
  assert.notEqual(headers[0]['Idempotency-Key'], headers[1]['Idempotency-Key']);
  assert.equal(calls[0].text, 'Synthetic test note.');
  assert.equal(calls[0]['Idempotency-Key'], undefined);
});
for (const [outcome, response] of [
  ['success', async () => serviceSuccess()],
  ['network/timeout', async () => { throw Error('Synthetic timeout'); }],
  ['HTTP error', async () => ({ ok: false })],
  ['unavailable', async () => ({ ok: true, json: async () => ({ status: 'unavailable', message: 'Synthetic unavailable', classification: null }) })],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw SyntaxError('Synthetic invalid JSON'); } })],
  ['invalid response', async () => ({ ok: true, json: async () => null })],
]) {
  test(`JEV service consumes both confirmations after ${outcome}; each repeat requires both again`, async () => {
    const { field, calls, consent, submit } = await serviceUi(response);
    const before = field('list').innerHTML;
    consent();
    await submit();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].allow_transmission, true);
    assert.equal(calls[0].confirm_cost, true);
    assert.equal(field('jevconsent').checked, false);
    assert.equal(field('jevcost').checked, false);
    assert.equal(field('jevsubmit').disabled, false);
    if (outcome === 'success') assert.match(field('jevresult').innerHTML, /Next step/);
    await submit();
    field('jevconsent').checked = true;
    await submit();
    field('jevconsent').checked = false;
    field('jevcost').checked = true;
    await submit();
    assert.equal(calls.length, 1);
    consent();
    await submit();
    assert.equal(calls.length, 2);
    assert.equal(field('list').innerHTML, before);
  });
}

test('JEV service rejects concurrent submit while preserving the current attempt and base list', async () => {
  let finish;
  const { field, context, calls, consent, submit } = await serviceUi(() => new Promise(resolve => finish = resolve));
  const before = field('list').innerHTML;
  consent();
  const pending = submit();
  const token = vm.runInContext('jevRequest', context);
  assert.equal(field('jevsubmit').disabled, true);
  await submit();
  assert.equal(calls.length, 1);
  assert.equal(vm.runInContext('jevRequest', context), token);
  finish(serviceSuccess());
  await pending;
  assert.equal(field('jevsubmit').disabled, false);
  assert.equal(field('jevconsent').checked, false);
  assert.equal(field('jevcost').checked, false);
  assert.equal(field('list').innerHTML, before);
});

for (const interaction of ['text', 'mode', 'deal']) {
  for (const outcome of ['success', 'error']) {
    test(`late JEV ${outcome} after new ${interaction} preserves new confirmations and in-flight lock`, async () => {
      const pending = [];
      const { field, context, calls, consent, submit } = await serviceUi(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
      const before = field('list').innerHTML;
      consent();
      const old = submit();
      if (interaction === 'text') {
        field('jevtext').value = 'New synthetic note.';
        await field('jevtext').oninput();
      } else if (interaction === 'mode') {
        field('jevmode').value = 'mock'; await field('jevmode').onchange();
        field('jevmode').value = 'service'; await field('jevmode').onchange();
      } else {
        context.clearDealJev();
        vm.runInContext('jevDealId = rows[1].id', context);
        field('jevmode').value = 'service'; await field('jevmode').onchange();
      }
      field('jevtext').value = 'New synthetic note.';
      consent();
      if (outcome === 'error') pending[0].reject(Error('Synthetic stale timeout'));
      else pending[0].resolve(serviceSuccess());
      await old;
      assert.equal(field('jevconsent').checked, true);
      assert.equal(field('jevcost').checked, true);
      assert.equal(field('jevsubmit').disabled, false);
      const current = submit();
      assert.equal(calls.length, 2);
      assert.equal(field('jevsubmit').disabled, true);
      pending[1].resolve(serviceSuccess());
      await current;
      assert.equal(field('jevconsent').checked, false);
      assert.equal(field('jevcost').checked, false);
      assert.equal(field('list').innerHTML, before);
    });
  }
}

test('late service finally cannot unlock a new request or consume its confirmations', async () => {
  const pending = [];
  const { field, calls, consent, submit } = await serviceUi(() => new Promise(resolve => pending.push(resolve)));
  consent(); const old = submit();
  field('jevtext').value = 'New synthetic note.';
  await field('jevtext').oninput();
  consent(); const current = submit();
  pending[0](serviceSuccess()); await old;
  assert.equal(field('jevconsent').checked, true);
  assert.equal(field('jevcost').checked, true);
  assert.equal(field('jevsubmit').disabled, true);
  await submit(); assert.equal(calls.length, 2);
  pending[1](serviceSuccess()); await current;
  assert.equal(field('jevconsent').checked, false);
  assert.equal(field('jevcost').checked, false);
  assert.equal(field('jevsubmit').disabled, false);
});

test('JEV disabled makes no request and mock repeats remain local without confirmations', async () => {
  const { field, calls, submit } = await serviceUi(async () => ({ ok: true, json: async () => ({ status: 'mock', message: 'Local fixture', classification: null }) }));
  const before = field('list').innerHTML;
  field('jevmode').value = 'disabled'; await field('jevmode').onchange();
  await submit(); assert.equal(calls.length, 0);
  field('jevfixture').value = 'explicit_next_step';
  field('jevmode').value = 'mock'; await field('jevmode').onchange();
  await submit(); await submit();
  assert.equal(calls.length, 2);
  assert.ok(calls.every(body => body.mode === 'mock' && body.allow_transmission === false && body.confirm_cost === false));
  assert.equal(field('list').innerHTML, before);
});
