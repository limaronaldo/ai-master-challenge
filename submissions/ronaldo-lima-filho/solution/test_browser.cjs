// Optional end-to-end check: requires Playwright and a running local app.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const out = path.resolve(process.env.LEADSCORER_TEST_OUT || path.join(__dirname, "../docs/validation-v1.11.1"));
fs.mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage(),
    errors = [],
    externalRequests = [],
    checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === "127.0.0.1") return route.continue();
    externalRequests.push(host);
    return route.abort();
  });
  const url = process.env.LEADSCORER_URL || "http://127.0.0.1:8765";
  async function status(text) {
    await page.waitForFunction(
      (text) => document.querySelector("#status").textContent.includes(text),
      text,
    );
  }
  async function shot(name) {
    await page.screenshot({ path: path.join(out, name + ".png"), fullPage: false });
  }
  async function closePanel() {
    const dialog = page.locator(".review-drawer[open]");
    if (await dialog.count()) await dialog.locator("button[data-close]").first().click();
  }
  async function openCriteria() {
    const criteria = page.locator(".review-drawer[open] .criteria-explanation");
    if (!(await criteria.getAttribute("open"))) {
      // Empty-string open attributes are present; use the native property.
      if (!(await criteria.evaluate((n) => n.open))) await criteria.locator(":scope > summary").click();
    }
  }
  async function reset() {
    await closePanel();
    if (await page.locator("#reset").isVisible()) await page.locator("#reset").click();
    await status("212 oportunidades");
  }
  async function overflow() {
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
  }
  async function checkFileStartupAndBrowserRestart() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "leadscorer-startup-"));
    const destination = new URL(url).origin + "/";
    let persistent;
    async function launch() {
      persistent = await chromium.launchPersistentContext(profile, {
        channel: "chrome", headless: true, viewport: { width: 1440, height: 1000 },
      });
      await persistent.route("**/*", (route) => {
        const target = new URL(route.request().url());
        if (target.protocol === "file:" || target.origin === new URL(destination).origin)
          return route.continue();
        externalRequests.push(target.origin);
        return route.abort();
      });
      const tab = persistent.pages()[0] || await persistent.newPage();
      tab.on("pageerror", (error) => errors.push(error.message));
      return tab;
    }
    async function ready(tab) {
      await tab.waitForFunction(() => document.querySelector("#status").textContent.includes("212 oportunidades"), null, { timeout: 12000 });
    }
    async function openFirst(tab) {
      await tab.locator("article .detail-button").first().click();
      const panel = tab.locator(".review-drawer[open]");
      await panel.locator("[data-local-review] details > summary").first().click();
      return panel;
    }
    try {
      let tab = await launch(), fileApiCalls = 0;
      tab.on("request", (request) => { if (request.url().includes("/api/")) fileApiCalls++; });
      await tab.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
      assert.equal(await tab.locator("#server-help").isVisible(), true);
      assert.equal(await tab.locator("#workspace").isVisible(), false);
      assert.match(await tab.locator("#server-help").innerText(), /python3 -B app\.py/);
      assert.equal(fileApiCalls, 0);
      const entry = tab.locator("#open-local-app");
      assert.equal(await entry.getAttribute("href"), "http://127.0.0.1:8765/");
      await tab.screenshot({ path: path.join(out, "startup-file.png"), fullPage: true });
      // Preserve the documented URL assertion; target this run's isolated server when its port differs.
      if (destination !== "http://127.0.0.1:8765/")
        await entry.evaluate((link, value) => { link.href = value; }, destination);
      await entry.click(); await ready(tab);
      assert.equal(await tab.locator("article").count(), 10);
      await tab.screenshot({ path: path.join(out, "startup-recovered.png"), fullPage: false });
      checks.push("real file startup: guidance makes no API calls; documented link verified and clicked into the isolated server, reaching all 212 conversion opportunities within 12s");
      const dataBefore = await (await persistent.request.get(destination + "api/pipeline")).json();
      const id = await tab.locator("article").first().getAttribute("data-id");
      let panel = await openFirst(tab);
      await panel.locator('[name="nextStep"]').fill("EXEMPLO SINTÉTICO: contexto conferido; registrar o resultado da revisão.");
      await panel.locator('[name="stepStatus"]').selectOption("done");
      assert.equal(await panel.locator('[name="due"]').inputValue(), "");
      await panel.locator("[data-workflow-save]").click();
      assert.match(await panel.locator(".workflow-feedback").innerText(), /salvo neste navegador/);
      await panel.locator("input[data-review]").check();
      await persistent.close(); persistent = null;
      tab = await launch(); await tab.goto(destination); await ready(tab);
      assert.equal(await tab.locator("article").first().getAttribute("data-id"), id);
      panel = await openFirst(tab);
      assert.equal(await panel.locator('[name="stepStatus"]').inputValue(), "done");
      assert.match(await panel.locator('[name="nextStep"]').inputValue(), /EXEMPLO SINTÉTICO: contexto conferido/);
      assert.equal(await panel.locator('[name="due"]').inputValue(), "");
      assert.equal(await panel.locator("[data-answer]").first().inputValue(), "");
      assert.equal(await panel.locator("input[data-review]").isChecked(), false);
      assert.deepEqual(await (await persistent.request.get(destination + "api/pipeline")).json(), dataBefore);
      await panel.locator(".review-scroll").evaluate((scroller) => {
        const target = scroller.querySelector("[data-local-review]");
        scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      });
      await tab.screenshot({ path: path.join(out, "startup-restored-step.png"), fullPage: false });
      checks.push("full browser restart: saved completed step and blank optional fields persist in the same profile/origin; session review clears and original API stays unchanged");
      fs.writeFileSync(path.join(out, "startup-results.json"), JSON.stringify({
        file_url_exercised: true, file_api_calls: 0, documented_url: "http://127.0.0.1:8765/",
        test_server: destination, test_link_destination_adjusted: destination !== "http://127.0.0.1:8765/",
        full_browser_restart: true, api_unchanged: true, provider_calls: 0,
      }, null, 2) + "\n");
    } finally {
      if (persistent) await persistent.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
  try {
    const unavailable = (route) => route.fulfill({ status: 503, json: { error: "Synthetic local data failure" } });
    await page.route("**/api/pipeline", unavailable);
    await page.goto(url);
    await status("Falha ao carregar");
    assert.equal(await page.locator("#server-help").isVisible(), true);
    assert.match(await page.locator("#server-help").innerText(), /python3 -B app\.py/);
    assert.equal(await page.locator("#open-local-app").getAttribute("href"), "http://127.0.0.1:8765/");
    await page.locator("#search").fill("HAXMC4IX");
    await page.screenshot({ path: path.join(out, "startup-help.png"), fullPage: true });
    await page.unroute("**/api/pipeline", unavailable);
    await page.locator("#retryload").click();
    await page.waitForFunction(() => document.querySelector("#server-help").hidden);
    await page.waitForFunction(() => !document.querySelector("#agent").disabled);
    assert.equal(await page.locator("#search").inputValue(), "HAXMC4IX");
    checks.push("startup guidance explains server command and URL after synthetic HTTP failure; retry preserves search and recovers");
    await reset();
    await status("212 oportunidades");
    assert.match(await page.locator("#queuehint").innerText(), /135 na janela/);
    assert.equal(await page.locator("article.decision-row").count(), 10);
    const data = await (await context.request.get(url + "/api/pipeline")).json();
    const first = await page.locator("article").first().getAttribute("data-id");
    assert.equal(data.rows.find((r) => r.id === first).operations.timing, "window");
    assert.equal(data.rows.find((r) => r.id === first).account_identified, true);
    assert.doesNotMatch(await page.locator("article").first().innerText(), /Lost anteriores/);
    assert.equal(await page.locator(".decision-row > .cell").filter({ hasText: "Último contato indisponível" }).count(), 0);
    const timing = await page.locator("article .timing").first().innerText();
    assert.match(timing, /Engajamento iniciado há/);
    const firstRow = data.rows.find((r) => r.id === first);
    assert.ok(timing.includes(`Engajamento iniciado há ${firstRow.age} dias`));
    assert.doesNotMatch(timing, /×/);
    assert.ok((await page.locator("article > .cell").nth(2).innerText()).includes(`Faixa de atenção proposta: ${firstRow.operations.median_cycle_days}–${firstRow.operations.median_cycle_days * 2} dias`));
    await page.locator("article .detail-button").first().click();
    const ratio = new Intl.NumberFormat("pt-BR").format(Math.round(firstRow.operations.cycle_ratio * 100) / 100);
    const panel = page.locator(".review-drawer[open]");
    assert.equal((await panel.boundingBox()).width, 720);
    assert.equal(await panel.locator(".criteria-explanation").evaluate((n) => n.open), false);
    assert.equal(await panel.locator(".review-footer input[data-review]").isVisible(), true);
    assert.match(await panel.locator(".review-header").innerText(), /Bioplex|Oportunidade/);
    assert.match(await panel.locator(".review-header").innerText(), /31\/12\/2017/);
    assert.match(await panel.locator(".review-footer").innerText(), /Perdida ao recarregar; não atualiza o CRM/);
    assert.doesNotMatch(await panel.innerText(), /1,92×|55\/80|close_date/);
    assert.equal(await panel.locator(".recommendation").count(), 1);
    assert.match(await panel.locator(".context-grid").innerText(), /Oportunidades ganhas/);
    assert.doesNotMatch(await panel.locator(".context-grid").innerText(), /compra\(s\)|Soma|Catálogo/);
    await shot("desktop-review");
    checks.push("desktop review: 720px dialog, grouped factual context, single next step, visible date and temporary review, collapsed methodology");
    await openCriteria();
    assert.ok((await panel.innerText()).includes(`${ratio}×`));
    assert.match(await panel.innerText(), /911 oportunidades ganhas/);
    assert.match(await panel.innerText(), /01\/03\/2017 a 30\/12\/2017/);
    await closePanel();
    checks.push("compact comparison keeps record-specific warnings, factual age, explicit range and exact ratio in details");
    await overflow();
    await shot("desktop-conversion");
    checks.push(
      "default: 212 conversion, 135 window, identified account ranked first within window",
    );

    assert.equal(await page.locator("article").first().locator(":scope > .cell").count(), 4);
    assert.doesNotMatch(await page.locator("article").first().innerText(), /funcionários|negócios perdidos/);
    assert.equal(await page.locator("input[data-review]").first().isVisible(), false);
    await page.locator("article .detail-button").first().click();
    assert.equal(await page.locator("article .detail-button").first().getAttribute("aria-expanded"), "true");
    await page.locator("input[data-review]").first().check();
    assert.match(await page.locator("#reviewstatus").innerText(), /marcada como revisada nesta sessão/);
    assert.match(await page.locator("article .review-state").first().innerText(), /Revisada nesta sessão/);
    await page.locator("input[data-review]").first().uncheck();
    assert.match(await page.locator("#reviewstatus").innerText(), /revisão desmarcada/);
    assert.match(await page.locator("article .review-state").first().innerText(), /Revisão pendente/);
    assert.match(await page.locator("#reviewstatus").innerText(), /Nenhum dado foi alterado no CRM/);
    await closePanel();
    checks.push("review in details: immediate feedback, undo, compact row state and explicit CRM boundary");

    await page.locator("#filterpanel>summary").click();
    await page.locator("#region").selectOption("East");
    await page.locator("#sort").selectOption("urgency");
    await page.locator("#view").selectOption("all");
    await page.locator("#next").click();
    const ids = await page.locator("article").evaluateAll((nodes) => nodes.map((n) => n.dataset.id));
    const target = page.locator("article").nth(4);
    const targetId = ids[4];
    await target.locator(".detail-button").scrollIntoViewIfNeeded();
    const returnY = await page.evaluate(() => window.scrollY);
    await target.locator(".detail-button").click();
    await page.locator(`button[data-close="${targetId}"]`).first().click();
    assert.equal(await page.locator("#region").inputValue(), "East");
    assert.equal(await page.locator("#sort").inputValue(), "urgency");
    assert.match(await page.locator("#page").innerText(), /Página 2/);
    assert.deepEqual(await page.locator("article").evaluateAll((nodes) => nodes.map((n) => n.dataset.id)), ids);
    assert.ok(Math.abs(await page.evaluate(() => window.scrollY) - returnY) <= 2);
    assert.equal(await page.evaluate(() => document.activeElement.id), `open-${targetId}`);
    assert.equal(await page.locator(`#open-${targetId}`).getAttribute("aria-expanded"), "false");
    await target.locator(".detail-button").click();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => !!document.activeElement.closest("dialog[open]")), true);
    }
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".review-drawer[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), `open-${targetId}`);
    await target.locator(".detail-button").click();
    await page.mouse.click(10, 100);
    assert.equal(await page.locator(".review-drawer[open]").count(), 0);
    checks.push("native review dialog contains keyboard focus; Escape and backdrop close restore focus");
    checks.push("return from details preserves filters, ordering, page, list position and keyboard focus");
    await reset();

    await page.locator("#cleanupqueue").click();
    await page.locator("#search").fill("HAXMC4IX");
    await status("1 oportunidades");
    assert.match(await page.locator("#list").innerText(), /423 dias/);
    await page.locator(".detail-button").click();
    await openCriteria();
    assert.match(await page.locator(".audit-content").innerText(), /7,42×/);
    await page.locator("input[data-review]").check();
    await closePanel();
    await page.locator("#workflowtools>summary").click();
    await page.locator("#reviewfilter").selectOption("pending");
    await status("Nenhuma oportunidade");
    await page.locator("#reviewfilter").selectOption("reviewed");
    await status("1 oportunidades");
    assert.equal(await page.locator("input[data-review]").isChecked(), true);
    checks.push("cleanup: oldest deal, cycle ratio, reviewed/pending intersection");

    await reset();
    await page.locator("#investigate").click();
    if (!(await page.locator("#accountfilter").isVisible()))
      await page.locator("#filterpanel>summary").click();
    await page.locator("#accountfilter").selectOption("identified");
    await status("163 oportunidades");
    await page.locator("#layout").selectOption("accounts");
    assert.match(await page.locator("#groupidentified").innerText(), /73 contas · 163 oportunidades/);
    assert.match(await page.locator("#groupmissing").innerText(), /337 oportunidades sem vínculo/);
    assert.ok((await page.locator(".account-group").count()) > 0);
    await page.locator(".account-group>summary").first().click();
    assert.match(await page.locator(".account-group").first().innerText(), /soma catálogo/);
    assert.match(await page.locator(".account-group>summary").first().innerText(), /5 oportunidades nesta fila/);
    await shot("group-identified");
    await page.locator("#groupmissing").click();
    await status("337 oportunidades");
    assert.equal(await page.locator(".account-group").count(), 0);
    assert.match(await page.locator("#list").innerText(), /00400B1S/);
    await shot("group-missing");
    const missingDownload = page.waitForEvent("download");
    await page.locator("#exportcsv").click();
    const missingFile = path.join(out, "qualification-missing.csv");
    await (await missingDownload).saveAs(missingFile);
    assert.equal(fs.readFileSync(missingFile, "utf8").split("\r\n").length, 338);
    await page.locator("#search").fill("00400B1S");
    await page.locator("#groupidentified").click();
    await status("Nenhuma oportunidade neste caminho");
    await page.locator("#groupmissing").click();
    await status("1 oportunidades");
    assert.equal(await page.locator("#search").inputValue(), "00400B1S");
    checks.push("qualification grouped work: 73 accounts/163 opportunities ordered by count; 337 unlinked deals remain individual");
    checks.push("group path export contains all 337 unlinked opportunities; empty path and return retain search");

    await reset();
    if (!(await page.locator("#manager").isVisible()))
      await page.locator("#filterpanel>summary").click();
    await page.locator("#manager").selectOption("Dustin Brinkmann");
    const teamCount = await page.locator(".team-card").count();
    assert.equal(teamCount, data.teams.filter((r) => r.manager === "Dustin Brinkmann").length);
    const before = await page.locator("#team-panel").innerText();
    await page.locator("#agent").selectOption("Anna Snelling");
    assert.equal(await page.locator("#team-panel").innerText(), before);
    assert.match(before, /Anna Snelling/);
    assert.match(before, /112 abertas/);
    const annaCard = page.locator('.team-card[data-team-agent="Anna Snelling"]');
    assert.match(await annaCard.innerText(), /Ação de conversão\s+0\s+\(0 na janela de atenção\)/);
    assert.match(await annaCard.innerText(), /Saneamento\s+57/);
    assert.match(await annaCard.innerText(), /Qualificação\s+55/);
    assert.match(await annaCard.innerText(), /51% acima de 90 dias/);
    for (const card of await page.locator(".team-card").all()) {
      const name = await card.getAttribute("data-team-agent");
      const teamRows = data.rows.filter((r) => r.agent === name);
      const numbers = await card.locator("dd").allTextContents();
      assert.deepEqual(numbers.map((n) => parseInt(n, 10)), ["conversion", "cleanup", "qualify"].map((q) => teamRows.filter((r) => r.operations.queue === q).length));
    }
    await shot("manager");
    checks.push("manager: each card matches three queue counts/window; full-team denominator independent of salesperson filter");

    await reset();
    const download = page.waitForEvent("download");
    await page.locator("#exportcsv").click();
    const csvFile = path.join(out, "conversion.csv");
    await (await download).saveAs(csvFile);
    assert.equal(fs.readFileSync(csvFile, "utf8").split("\r\n").length, 213);
    const mdDownload = page.waitForEvent("download");
    await page.locator("#exportmd").click();
    const mdFile = path.join(out, "conversion.md");
    await (await mdDownload).saveAs(mdFile);
    assert.equal((fs.readFileSync(mdFile, "utf8").match(/^- /gm) || []).length, 212);
    await page.locator("#copysummary").click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /212 oportunidades/);
    checks.push("exports: actual CSV and Markdown downloads, all 212 rows, clipboard copy");

    // Exercise the real local mock endpoint in the selected opportunity.
    await page.locator("article .detail-button").first().click();
    await page.locator("button[data-analyze]").first().click();
    await page.locator("#jevmode").selectOption("mock");
    await page.locator("#jevtext").fill("Nota sintética: revisar proposta na próxima reunião.");
    await page.locator("#jevsubmit").click();
    await page.waitForFunction(() =>
      document.querySelector("#jevresult").textContent.includes("Próximo passo sugerido"),
    );
    assert.match(await page.locator("#jevresult").innerText(), new RegExp(first));
    await shot("deal-jev-mock");
    await page.locator("#jevmode").selectOption("service");
    await page.waitForFunction(() =>
      document.querySelector("#jevstatus").textContent.includes("indisponível"),
    );
    assert.equal(await page.locator("#jevsubmit").isDisabled(), true);
    checks.push("deal JEV: real local mock, tactical action, unavailable service");

    // A held response must not attach to a newly selected deal.
    await page.locator("#jevmode").selectOption("mock");
    await page.locator("#jevtext").fill("Nota sintética antiga.");
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const held = async (route) => {
      await gate;
      await route.fulfill({
        json: {
          status: "mock",
          message: "OLD RESPONSE",
          source: "synthetic_fixture",
          classification: { category: "explicit_next_step", label: "OLD RESULT" },
        },
      });
    };
    await page.route("**/api/jev/classify", held);
    await page.locator("#jevsubmit").click();
    const secondId = await page.locator("article").nth(1).getAttribute("data-id");
    await closePanel();
    await page.locator("article .detail-button").nth(1).click();
    await page.locator("button[data-analyze]").nth(1).click();
    release();
    await page.waitForTimeout(100);
    assert.match(await page.locator("#jevdeal").innerText(), new RegExp(secondId));
    assert.equal(await page.locator("#jevtext").inputValue(), "");
    assert.equal(await page.locator("#jevresult").innerText(), "");
    await page.unroute("**/api/jev/classify", held);
    checks.push("JEV: late result discarded after selecting another opportunity; note cleared");
    // All service outcomes below are intercepted synthetic responses, never a provider call.
    const readyStub = route => route.fulfill({ json: { service_ready: true } });
    await page.route('**/api/jev/status', readyStub);
    let serviceOutcome = 'success', serviceCalls = 0, hold = null;
    const serviceStub = async route => {
      serviceCalls++;
      const body = route.request().postDataJSON();
      assert.equal(body.mode, 'service');
      assert.equal(body.allow_transmission, true);
      assert.equal(body.confirm_cost, true);
      if (hold) await hold;
      if (serviceOutcome === 'network') return route.abort('timedout');
      if (serviceOutcome === 'HTTP error') return route.fulfill({ status: 503, json: {} });
      if (serviceOutcome === 'invalid JSON') return route.fulfill({ body: '{invalid', contentType: 'application/json' });
      if (serviceOutcome === 'invalid response') return route.fulfill({ json: null });
      return route.fulfill({ json: serviceOutcome === 'unavailable'
        ? { status: 'unavailable', message: 'Synthetic unavailable', classification: null }
        : { status: 'ok', message: 'Synthetic service result', source: 'browser_stub', model: 'test', classification: { label: 'Synthetic next step', category: 'explicit_next_step', confidence: 0.5 } } });
    };
    await page.route('**/api/jev/classify', serviceStub);
    await page.evaluate(() => {
      window.__g4OriginalJevSubmit = document.querySelector('#jevform').onsubmit;
      document.querySelector('#jevform').onsubmit = event => {
        window.__g4Attempt = window.__g4OriginalJevSubmit(event);
        return window.__g4Attempt;
      };
    });
    const confirmService = async () => {
      await page.locator('#jevconsent').check();
      await page.locator('#jevcost').check();
    };
    const awaitAttempt = () => page.evaluate(async () => { await window.__g4Attempt; });
    const submitDirect = () => page.evaluate(async () => { await document.querySelector('#jevform').onsubmit({ preventDefault() {} }); });
    try {
      for (const width of [1440, 375]) {
        await page.setViewportSize({ width, height: 1000 });
        const baseIds = await page.locator('article.decision-row').evaluateAll(nodes => nodes.map(n => n.dataset.id));
        for (const outcome of ['success', 'network', 'HTTP error', 'unavailable', 'invalid JSON', 'invalid response']) {
          serviceOutcome = outcome;
          await page.locator('#jevmode').selectOption('service');
          await page.waitForFunction(() => !document.querySelector('#jevsubmit').disabled);
          await page.locator('#jevtext').fill('Synthetic browser note.');
          await page.waitForFunction(() => !document.querySelector('#jevsubmit').disabled);
          await confirmService();
          const count = serviceCalls;
          await page.locator('#jevsubmit').click(); await awaitAttempt();
          assert.equal(serviceCalls, count + 1);
          assert.equal(await page.locator('#jevconsent').isChecked(), false);
          assert.equal(await page.locator('#jevcost').isChecked(), false);
          assert.equal(await page.locator('#jevsubmit').isDisabled(), false);
          if (outcome === 'success') assert.match(await page.locator('#jevresult').innerText(), /Synthetic next step/);
          await submitDirect();
          await page.locator('#jevconsent').check(); await submitDirect();
          await page.locator('#jevconsent').uncheck();
          await page.locator('#jevcost').check(); await submitDirect();
          assert.equal(serviceCalls, count + 1);
          await confirmService();
          await page.locator('#jevsubmit').click(); await awaitAttempt();
          assert.equal(serviceCalls, count + 2);
          assert.equal(await page.locator('#jevconsent').isChecked(), false);
          assert.equal(await page.locator('#jevcost').isChecked(), false);
          assert.deepEqual(await page.locator('article.decision-row').evaluateAll(nodes => nodes.map(n => n.dataset.id)), baseIds);
          checks.push(`JEV ${width}px ${outcome}: single-use consent, both required again, synthetic retry and unchanged base order`);
        }
        serviceOutcome = 'success';
        for (const interaction of ['text', 'mode', 'deal']) {
          await confirmService();
          let releaseService;
          hold = new Promise(resolve => releaseService = resolve);
          const count = serviceCalls;
          const incoming = page.waitForRequest("**/api/jev/classify");
          await page.evaluate(() => { window.__g4OldAttempt = document.querySelector('#jevform').onsubmit({ preventDefault() {} }); });
          await page.waitForFunction(() => document.querySelector('#jevsubmit').disabled);
          // Direct repeated form dispatch is also blocked while a request is in flight.
          await submitDirect();
          await incoming;
          assert.equal(serviceCalls, count + 1);
          if (interaction === 'text') await page.locator('#jevtext').fill('New synthetic browser note.');
          else if (interaction === 'mode') {
            await page.locator('#jevmode').selectOption('disabled');
            await page.locator('#jevmode').selectOption('service');
          } else {
            await closePanel();
            await page.locator('article .detail-button').first().click();
            await page.locator('button[data-analyze]').first().click();
            await page.locator('#jevmode').selectOption('service');
          }
          await page.waitForFunction(() => !document.querySelector('#jevsubmit').disabled);
          if (interaction === 'deal') {
            await page.locator('#jevtext').fill('New synthetic deal note.');
            await page.waitForFunction(() => !document.querySelector('#jevsubmit').disabled);
          }
          await confirmService();
          releaseService(); hold = null;
          await page.evaluate(async () => { await window.__g4OldAttempt; });
          assert.equal(await page.locator('#jevconsent').isChecked(), true);
          assert.equal(await page.locator('#jevcost').isChecked(), true);
          assert.equal(await page.locator('#jevsubmit').isDisabled(), false);
          assert.equal(await page.locator('#jevresult').innerText(), '');
          await page.locator('#jevsubmit').click(); await awaitAttempt();
          assert.equal(serviceCalls, count + 2);
          assert.equal(await page.locator('#jevconsent').isChecked(), false);
          assert.equal(await page.locator('#jevcost').isChecked(), false);
          checks.push(`JEV ${width}px late result after ${interaction}: concurrent send blocked; new consent preserved, current retry consumes it`);
        }
      }
      await shot('jev-single-use-consent-mobile');
    } finally {
      await page.unroute('**/api/jev/status', readyStub);
      await page.unroute('**/api/jev/classify', serviceStub);
      await page.evaluate(() => {
        document.querySelector('#jevform').onsubmit = window.__g4OriginalJevSubmit;
        delete window.__g4OriginalJevSubmit; delete window.__g4Attempt; delete window.__g4OldAttempt;
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
    }


    await reset();
    const operationalIds = await page.locator("article").evaluateAll((nodes) => nodes.map((n) => n.dataset.id));
    await page.locator("#simulator>summary").click();
    assert.match(await page.locator("#simulator>summary").innerText(), /Simular índice/);
    await page.locator("#rule_age_90").fill("0");
    await page.locator("#apply").click();
    await page.waitForFunction(() => !document.querySelector("#simulation-banner").hidden);
    assert.match(await page.locator("#simulation-impact").innerText(), /ordem operacional permanece igual/);
    assert.deepEqual(await page.locator("article").evaluateAll((nodes) => nodes.map((n) => n.dataset.id)), operationalIds);
    assert.match(await page.locator("#conversionqueue").innerText(), /212/);
    assert.match(await page.locator("#cleanupqueue").innerText(), /1.377|1377/);
    await page.locator("#comparesimulation").click();
    assert.equal(await page.locator("#sort").inputValue(), "score");
    assert.match(await page.locator("#simulation-impact").innerText(), /ordenada pelo índice simulado/);
    await shot("index-simulation");
    await page.locator("#restorevisible").click();
    assert.equal(await page.locator("#simulation-banner").isVisible(), false);
    checks.push("index simulation: unchanged operational list/queues, visible impact and explicit score comparison, restore");
    await reset();
    if (!(await page.locator("#reviewqueue").isVisible()))
      await page.locator("#filterpanel>summary").click();
    await page.locator("#reviewqueue").click();
    await page.locator("#search").fill("HAXMC4IX");
    await status("1 oportunidades");
    if (!(await page.locator("#rule_age_90").isVisible())) await page.locator("#simulator>summary").click();
    await page.locator("#rule_age_90").fill("0");
    await page.locator("#apply").click();
    await page.waitForFunction(() => !document.querySelector("#simulation-banner").hidden);
    await page.locator("article .detail-button").click();
    await openCriteria();
    assert.match(await page.locator(".score-explanation>summary").innerText(), /35\/80/);
    await page.locator(".score-explanation>summary").click();
    assert.match(await page.locator(".audit-content").innerText(), /35 de 80 pontos/);
    await closePanel();
    await page.locator("#restorevisible").click();
    await page.locator("article .detail-button").click();
    await openCriteria();
    assert.match(await page.locator(".score-explanation>summary").innerText(), /65\/80/);
    checks.push("baseline + simulation: HAX 65 to 35, restore preserves search");

    await reset();
    if (!(await page.locator("#copysummary").isVisible()))
      await page.locator("#workflowtools>summary").click();
    await page.locator("#copysummary").click();
    await page.waitForFunction(() =>
      document.querySelector("#workflowstatus").textContent.includes("212 oportunidades copiadas"),
    );
    assert.match(await page.locator("#workflowstatus").innerText(), /212 oportunidades copiadas/);
    if (!(await page.locator("#region").isVisible()))
      await page.locator("#filterpanel>summary").click();
    await page.locator("#region").selectOption("Central");
    await status("Troque de fila mantendo");
    assert.equal(await page.locator("#workflowstatus").innerText(), "");
    checks.push("copy confirmation cleared after selecting Central; historical losses translated");
    assert.match(await page.locator("#list").innerText(), /408 oportunidades/);
    assert.match(await page.locator("#list").innerText(), /500 oportunidades/);
    for (const panel of ["#filterpanel", "#workflowtools", "#simulator"])
      if ((await page.locator(panel).getAttribute("open")) !== null)
        await page.locator(panel + ">summary").click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(out, "central-empty.png"), fullPage: true });
    await page.locator('button[data-queue="cleanup"]').click();
    await status("408 oportunidades");
    assert.equal(await page.locator("#region").inputValue(), "Central");
    checks.push(
      "empty Central conversion offers 408 cleanup and 500 qualification, preserving region on navigation",
    );
    await page.locator("#conversionqueue").click();
    await page.locator("#agent").selectOption("Anna Snelling");
    await status("Troque de fila mantendo");
    await page.locator('button[data-queue="qualify"]').click();
    await status("55 oportunidades");
    assert.equal(await page.locator("#agent").inputValue(), "Anna Snelling");
    assert.equal(await page.locator("#region").inputValue(), "Central");
    checks.push(
      "empty salesperson conversion navigates to qualification without clearing salesperson or region",
    );
    await reset();
    await page.reload();
    await status("212 oportunidades");
    assert.match(await page.locator("#stats").innerText(), /0 revisadas/);
    await page.setViewportSize({ width: 375, height: 844 });
    await page.reload();
    await status("212 oportunidades");
    await page.evaluate(() => window.scrollTo(0, 0));
    await overflow();
    const mobileLayout = await page.evaluate(() => {
      const card = document.querySelector("article").getBoundingClientRect();
      const action = document.querySelector("article .detail-button").getBoundingClientRect();
      return {
        viewport: { width: innerWidth, height: innerHeight },
        first_card_top: card.top,
        first_action_bottom: action.bottom,
      };
    });
    assert.ok(mobileLayout.first_card_top < 844);
    assert.ok(mobileLayout.first_action_bottom <= 844, JSON.stringify(mobileLayout));
    fs.writeFileSync(
      path.join(out, "layout-results.json"),
      JSON.stringify(mobileLayout, null, 2) + "\n",
    );
    assert.doesNotMatch(
      await page.locator("article .action-cell").first().innerText(),
      /\/80|Índice/,
    );
    checks.push(
      "mobile first details command visible within 375x844; original index retained only in details",
    );
    await shot("mobile-conversion");
    assert.equal(await page.locator("#workflowtools").getAttribute("open"), null);
    await page.locator("article .detail-button").first().click();
    await overflow();
    const mobilePanel = page.locator(".review-drawer[open]");
    const mobileBounds = await mobilePanel.boundingBox();
    assert.equal(mobileBounds.width, 375);
    assert.equal(mobileBounds.height, 844);
    assert.equal(await mobilePanel.locator(".criteria-explanation").evaluate((n) => n.open), false);
    assert.equal(await mobilePanel.locator(".review-footer input").isVisible(), true);
    assert.equal(await mobilePanel.evaluate((n) => n.scrollWidth <= n.clientWidth), true);
    await shot("mobile-review");
    checks.push("mobile review: full viewport, grouped context, collapsed criteria and visible session-only footer without horizontal overflow");
    await page.locator("button[data-analyze]").first().click();
    await page.locator("#jevmode").selectOption("mock");
    await page.locator("#jevtext").fill("Nota pública sintética.");
    await page.locator("#jevsubmit").click();
    await page.waitForFunction(() =>
      document.querySelector("#jevresult").textContent.includes("Próximo passo sugerido"),
    );
    await overflow();
    await page.locator("#jevpanel").scrollIntoViewIfNeeded();
    await shot("mobile-deal-jev");
    checks.push(
      "mobile 375: list, details and JEV without horizontal overflow; reload clears reviews",
    );
    await reset();
    await page.locator("#investigate").click();
    await page.locator("#workflowtools>summary").click();
    await page.locator("#layout").selectOption("accounts");
    await overflow();
    await page.locator("#groupmissing").click();
    await status("337 oportunidades");
    await overflow();
    await page.locator("#group-paths").scrollIntoViewIfNeeded();
    await shot("mobile-grouping");
    await reset();
    await page.locator("#filterpanel>summary").click();
    await page.locator("#manager").selectOption("Dustin Brinkmann");
    await overflow();
    await page.locator("#team-panel").evaluate((n) => window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 12));
    await shot("mobile-manager");
    checks.push("mobile grouped paths and manager queue counts fit 375px without horizontal overflow");
    // Independent policy laboratory: real base rows and unchanged main workflow.
    await reset();
    const labCounts = (days, ratio) => {
      const counts = { conversion: 0, cleanup: 0, qualify: 0 };
      let changed = 0;
      for (const r of data.rows) {
        const q = r.stage === 'Prospecting' || r.age === null ? 'qualify' :
          r.age > days || (ratio !== null && r.operations.cycle_ratio !== null && r.operations.cycle_ratio > ratio) ? 'cleanup' : 'conversion';
        counts[q]++;
        if (q !== r.operations.queue) changed++;
      }
      return { counts, changed };
    };
    await page.locator('#policy-lab>summary').click();
    const listBeforeLab = await page.locator('article').evaluateAll(ns => ns.map(n => n.dataset.id));
    const queueBeforeLab = await page.locator('.queue-switch').innerText();
    for (const [days, ratio] of [[120, 2.5], [144, 2.5], [180, null], [96, 2.5], [120, 2.5]]) {
      await page.locator('#policydays').fill(String(days));
      await page.locator('#policydayonly').setChecked(ratio === null);
      if (ratio !== null) await page.locator('#policyratio').fill(String(ratio));
      await page.locator('#policyform button[type="submit"]').click();
      const s = labCounts(days, ratio);
      const text = await page.locator('#policystatus').innerText();
      for (const [q, label] of [['conversion', 'conversão'], ['cleanup', 'saneamento'], ['qualify', 'qualificação']])
        assert.ok(text.includes(`${new Intl.NumberFormat('pt-BR').format(s.counts[q])} ${label}`), text);
      assert.ok(text.includes(`${new Intl.NumberFormat('pt-BR').format(s.changed)} reclassificadas`), text);
      await overflow();
      assert.deepEqual(await page.locator('article').evaluateAll(ns => ns.map(n => n.dataset.id)), listBeforeLab);
      assert.equal(await page.locator('.queue-switch').innerText(), queueBeforeLab);
    }
    await page.locator('#policydays').fill('180');
    await page.locator('#policydayonly').check();
    await page.locator('#policyform button[type="submit"]').click();
    assert.match(await page.locator('#policystatus').innerText(), /Central: 408 em conversão \(408 acrescentadas\)/);
    assert.match(await page.locator('#policystatus').innerText(), /27 de 27 vendedores com conversão \(10 acrescentados\)/);
    await page.locator('#policy-lab').scrollIntoViewIfNeeded();
    await shot('mobile-policy-lab');
    await page.locator('#policydays').fill('');
    assert.match(await page.locator('#policystatus').innerText(), /Limites alterados/);
    await page.locator('#policyform button[type="submit"]').click();
    assert.equal(await page.locator('#policydays').evaluate(n => n.validity.valueMissing), true);
    await page.locator('#policyreset').click();
    assert.match(await page.locator('#policystatus').innerText(), /0 reclassificadas/);
    assert.equal(await page.locator('#policydayonly').isChecked(), false);
    await page.locator('#policy-lab>summary').click();
    checks.push('mobile 375 policy lab: real counts across five scenarios, repeated reset, native validation, Central and agents; main list/queues untouched');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#policy-lab>summary').click();
    await page.locator('#policydays').fill('144');
    await page.locator('#policyform button[type="submit"]').click();
    await page.locator('#policy-lab').scrollIntoViewIfNeeded();
    await overflow();
    await shot('desktop-policy-lab');
    await page.locator('#policyreset').click();
    await page.locator('#policy-lab>summary').click();
    const fixtureLabels = { insufficient_context: 'Contexto insuficiente ou ambíguo', explicit_next_step: 'Próximo passo explícito no texto', explicit_objection: 'Objeção explícita no texto' };
    for (const [q, button] of [['conversion', '#conversionqueue'], ['cleanup', '#cleanupqueue'], ['qualify', '#investigate']]) {
      await reset();
      await page.locator(button).click();
      await page.locator('article .detail-button').first().click();
      await page.locator('button[data-analyze]').first().click();
      assert.equal(await page.locator('#jevmode').inputValue(), 'disabled');
      await page.locator('#jevmode').selectOption('mock');
      const before = await page.locator('#queuehint').innerText();
      for (const category of Object.keys(fixtureLabels)) {
        await page.locator('#jevfixture').selectOption(category);
        await page.locator('#jevtext').fill('Texto livre sintético contraditório: não deve ser interpretado.');
        await page.locator('#jevsubmit').click();
        await page.waitForFunction(label => document.querySelector('#jevresult').textContent.includes(label), fixtureLabels[category]);
        assert.match(await page.locator('#jevstatus').innerText(), /exemplo sintético selecionado/);
        assert.match(await page.locator('#jevresult').innerText(), /synthetic_fixture/);
        assert.equal(await page.locator('#queuehint').innerText(), before);
      }
      if (q === 'cleanup') { await page.locator('#jevpanel').scrollIntoViewIfNeeded(); await shot('jev-three-fixtures'); }
      await closePanel();
      assert.equal(await page.locator('#jevtext').inputValue(), '');
      assert.equal(await page.locator('#jevfixture').inputValue(), 'insufficient_context');
    }
    checks.push('nine real local mock requests: three selected categories in each operational queue; text ignored, back clears fixture/text, queues unchanged');
    await reset();
    const member = data.rows.find(r => r.account_context.subsidiary_of && r.operations.queue === 'conversion');
    assert.ok(member);
    await page.locator('#search').fill(member.id);
    await status('1 oportunidades');
    await page.locator('article .detail-button').click();
    assert.ok((await page.locator('.context-grid').innerText()).includes(member.account_context.subsidiary_of));
    assert.match(await page.locator('.context-grid').innerText(), /sem informação sobre consolidação/);
    await shot('declared-parent-context');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#search').inputValue(), member.id);
    checks.push('declared parent context is literal with no consolidation claim; Escape preserves searched opportunity');
    // Exact reclassification cohort, separate export, and contextual detail return.
    await reset();
    const mainIds = await page.locator('article').evaluateAll(ns => ns.map(n => n.dataset.id));
    const mainCsv = await page.evaluate(() => csvExport(filtered()));
    await page.locator('#policy-lab>summary').click();
    await page.locator('#policydays').fill('144');
    await page.locator('#policyform button[type="submit"]').click();
    assert.match(await page.locator('#policychangessummary').innerText(), /113 oportunidades/);
    await page.locator('#policychanges>summary').click();
    const cohort = data.rows.filter(r => r.operations.queue === 'cleanup' && r.age <= 144 && r.operations.cycle_ratio <= 2.5);
    const displayed = [];
    for (let p = 0; p < 4; p++) {
      displayed.push(...await page.locator('[data-policy-id]').evaluateAll(ns => ns.map(n => n.dataset.policyId)));
      assert.match(await page.locator('#policycases').innerText(), /Saneamento → Ação de conversão/);
      if (p < 3) await page.locator('#policynext').click();
    }
    assert.deepEqual([...displayed].sort(), cohort.map(r => r.id).sort());
    assert.equal(new Set(displayed).size, 113);
    assert.equal(await page.locator('#policynext').isDisabled(), true);
    for (let p = 0; p < 3; p++) await page.locator('#policyprev').click();
    await page.locator('#policychangessummary').evaluate(n => window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 12));
    await shot('desktop-policy-cases');
    checks.push('policy cohort: all 113 exact IDs across four pages, correct transition and last-page boundary');
    const casesDownload = page.waitForEvent('download');
    await page.locator('#exportpolicy').click();
    const casesFile = path.join(out, 'policy-reclassified.csv');
    await (await casesDownload).saveAs(casesFile);
    const casesCsv = fs.readFileSync(casesFile, 'utf8');
    assert.equal(casesCsv.split('\r\n').length, 114);
    assert.ok(casesCsv.includes(data.dataset_hash));
    assert.match(casesCsv, /cenario_hipotetico_nao_aplicado/);
    assert.equal(await page.evaluate(() => csvExport(filtered())), mainCsv);
    assert.deepEqual(await page.locator('article').evaluateAll(ns => ns.map(n => n.dataset.id)), mainIds);
    checks.push('policy CSV: real download includes all 113 cases and provenance; main export and list unchanged');
    const policyTarget = await page.locator('[data-policy-open]').first().getAttribute('data-policy-open');
    await page.locator(`[data-policy-open="${policyTarget}"]`).click();
    let contextPanel = page.locator('.review-drawer[open]');
    assert.equal(await contextPanel.getAttribute('data-deal-id'), policyTarget);
    assert.match(await contextPanel.locator('.review-context-note').innerText(), /política-base/);
    await contextPanel.locator('input[data-review]').check();
    contextPanel = page.locator('.review-drawer[open]');
    assert.equal(await contextPanel.locator('input[data-review]').isChecked(), true);
    assert.equal(await contextPanel.getAttribute('data-deal-id'), policyTarget);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'policy-open-' + policyTarget);
    assert.equal(await page.locator('.context-details').count(), 0);
    assert.deepEqual(await page.locator('article').evaluateAll(ns => ns.map(n => n.dataset.id)), mainIds);
    checks.push('policy details: off-list opportunity opens without filtering, review survives render, Escape restores exact case focus');
    await page.locator('#policydays').fill('');
    assert.equal(await page.locator('#policychanges').isVisible(), false);
    assert.equal(await page.locator('#exportpolicy').isDisabled(), true);
    await page.locator('#policyreset').click();
    assert.equal(await page.locator('#policychanges').isVisible(), false);
    await page.locator('#policy-lab>summary').click();
    checks.push('policy edit/reset: old cohort hidden and export disabled, including empty input and zero-change base');

    // Cross-seller account context is independent of current salesperson/search/queue.
    await reset();
    const accountDeal = data.rows.find(r => r.account === 'Iselectrics' && r.operations.queue === 'conversion');
    const peers = data.rows.filter(r => r.account_identified && r.account === accountDeal.account && r.id !== accountDeal.id);
    const peer = peers.find(r => r.agent !== accountDeal.agent && r.operations.queue !== 'conversion');
    assert.ok(peer);
    await page.locator('#agent').selectOption(accountDeal.agent);
    await page.locator('#search').fill(accountDeal.id);
    await page.locator('article .detail-button').click();
    contextPanel = page.locator('.review-drawer[open]');
    await contextPanel.locator('.account-opportunities>summary').click();
    assert.deepEqual((await contextPanel.locator('[data-related-id]').evaluateAll(ns => ns.map(n => n.dataset.relatedId))).sort(), peers.map(r => r.id).sort());
    assert.match(await contextPanel.locator('.account-opportunities').innerText(), /Outras 12 oportunidades/);
    assert.match(await contextPanel.locator('.account-opportunities').innerText(), /Não comprova contatos simultâneos/);
    await contextPanel.locator('.account-opportunities').scrollIntoViewIfNeeded();
    await shot('desktop-account-opportunities');
    checks.push('account context: exact twelve peers across all sellers/queues, excludes self, historical scope explicit');
    const relatedButton = `related-open-${accountDeal.id}-${peer.id}`;
    await page.locator('#' + relatedButton).scrollIntoViewIfNeeded();
    const parentScroll = await contextPanel.locator('.review-scroll').evaluate(n => n.scrollTop);
    await page.locator('#' + relatedButton).click();
    contextPanel = page.locator('.review-drawer[open]');
    assert.equal(await contextPanel.getAttribute('data-deal-id'), peer.id);
    await contextPanel.locator('input[data-review]').check();
    contextPanel = page.locator('.review-drawer[open]');
    assert.equal(await contextPanel.locator('input[data-review]').isChecked(), true);
    await contextPanel.locator('.account-opportunities>summary').click();
    await contextPanel.locator(`[data-context-open="${accountDeal.id}"]`).click();
    assert.equal(await page.locator('.review-drawer[open]').getAttribute('data-deal-id'), accountDeal.id);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.review-drawer[open]').getAttribute('data-deal-id'), peer.id);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.review-drawer[open]').getAttribute('data-deal-id'), accountDeal.id);
    assert.equal(await page.evaluate(() => document.activeElement.id), relatedButton);
    assert.ok(Math.abs(await page.locator('.review-drawer[open] .review-scroll').evaluate(n => n.scrollTop) - parentScroll) <= 2);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#agent').inputValue(), accountDeal.agent);
    assert.equal(await page.locator('#search').inputValue(), accountDeal.id);
    assert.equal(await page.locator('.context-details').count(), 0);
    checks.push('account navigation: cross-queue detail and nested return preserve parent scroll/focus, reviews and original filters');
    // If the original row leaves a pending-only view during nested review, return to the visible status.
    await page.locator('#reviewfilter').selectOption('pending');
    await page.locator('article .detail-button').click();
    if (!(await page.locator('.review-drawer[open] .account-opportunities').evaluate(n => n.open)))
      await page.locator('.review-drawer[open] .account-opportunities>summary').click();
    await page.locator('#' + relatedButton).click();
    if (!(await page.locator('.review-drawer[open] .account-opportunities').evaluate(n => n.open)))
      await page.locator('.review-drawer[open] .account-opportunities>summary').click();
    await page.locator(`.review-drawer[open] [data-context-open="${accountDeal.id}"]`).click();
    await page.locator('.review-drawer[open] input[data-review]').check();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.review-drawer[open]').count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'status');
    assert.equal(await page.locator('.context-details').count(), 0);

    await reset();
    if (!(await page.locator('#manager').isVisible())) await page.locator('#filterpanel>summary').click();
    await page.locator('#manager').selectOption('Dustin Brinkmann');
    await page.locator('#region').selectOption('Central');
    for (const [q, count] of [['cleanup', 57], ['qualify', 55], ['conversion', 0]]) {
      await page.locator(`.team-card[data-team-agent="Anna Snelling"] [data-agent-queue="${q}"]`).click();
      assert.equal(await page.locator('#agent').inputValue(), 'Anna Snelling');
      assert.equal(await page.locator('#manager').inputValue(), 'Dustin Brinkmann');
      assert.equal(await page.locator('#region').inputValue(), 'Central');
      assert.equal(await page.evaluate(() => filtered().length), count);
      assert.equal(await page.evaluate(() => queue), q);
    }
    const managerLayouts = [];
    for (const width of [1440, 1024, 861, 375, 320]) {
      await page.setViewportSize({ width, height: width <= 375 ? 844 : 1000 });
      await page.evaluate(() => document.fonts.ready);
      const buttons = await page.locator('#team-panel [data-agent-queue="conversion"]').evaluateAll(nodes => nodes.map(button => {
        const text = button.firstChild, label = text.textContent;
        const wordLines = {};
        for (const word of label.split(/\s+/)) {
          const start = label.indexOf(word), tops = [];
          for (let i = start; i < start + word.length; i++) {
            const range = document.createRange(); range.setStart(text, i); range.setEnd(text, i + 1);
            tops.push(range.getBoundingClientRect().top);
          }
          wordLines[word] = new Set(tops).size;
        }
        return { agent: button.dataset.agent, label, width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height, word_lines: wordLines };
      }));
      assert.ok(buttons.length > 0);
      for (const button of buttons) {
        assert.ok(button.width > 0);
        assert.deepEqual(Object.values(button.word_lines), [1, 1, 1], JSON.stringify({ width, button }));
      }
      await overflow();
      managerLayouts.push({ viewport_width: width, buttons });
    }
    fs.writeFileSync(path.join(out, 'manager-label-layout.json'), JSON.stringify(managerLayouts, null, 2) + '\n');
    checks.push('manager conversion label: every word stays intact across all team cards at 1440/1024/861/375/320px; no horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#team-panel').scrollIntoViewIfNeeded();
    await shot('desktop-manager-shortcuts');
    checks.push('manager shortcuts: one click selects seller and cleanup/qualification/conversion with 57/55/0 and retains manager/region');

    await page.setViewportSize({ width: 375, height: 844 });
    await page.locator('.team-card[data-team-agent="Anna Snelling"] [data-agent-queue="qualify"]').click();
    assert.equal(await page.evaluate(() => filtered().length), 55);
    await overflow();
    await page.locator('.team-card[data-team-agent="Anna Snelling"]').scrollIntoViewIfNeeded();
    await shot('mobile-manager-shortcuts');
    checks.push('mobile manager shortcuts: target queue selected with no horizontal overflow at 375px');
    await reset();
    await page.locator('#agent').selectOption(accountDeal.agent);
    await page.locator('#search').fill(accountDeal.id);
    await page.locator('article .detail-button').click();
    contextPanel = page.locator('.review-drawer[open]');
    await contextPanel.locator('.account-opportunities>summary').click();
    await contextPanel.locator('.account-opportunities').scrollIntoViewIfNeeded();
    assert.equal(await contextPanel.evaluate(n => n.scrollWidth <= n.clientWidth), true);
    await shot('mobile-account-opportunities');
    await page.locator('#' + relatedButton).click();
    assert.equal(await page.locator('.review-drawer[open]').evaluate(n => n.scrollWidth <= n.clientWidth), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), relatedButton);
    await page.keyboard.press('Escape');
    checks.push('mobile account context: peers and off-list detail fit screen; Escape returns to originating peer button');
    await reset();
    await page.locator('#policy-lab>summary').click();
    await page.locator('#policydays').fill('144');
    await page.locator('#policyform button[type="submit"]').click();
    await page.locator('#policychanges>summary').click();
    await page.locator('#policychangessummary').evaluate(n => window.scrollTo(0, n.getBoundingClientRect().top + window.scrollY - 12));
    await overflow();
    await shot('mobile-policy-cases');
    await page.locator('[data-policy-open]').first().click();
    await page.keyboard.press('Escape');
    assert.match(await page.evaluate(() => document.activeElement.id), /^policy-open-/);
    checks.push('mobile policy cases: readable case cards, no horizontal overflow and contextual detail return');
    // Local review records never change historical data, ranking or JEV inputs.
    {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reset();
    const baseBefore = JSON.stringify(data.rows);
    const recordKey = `leadscorer:review:v1:${data.dataset_hash}:${data.as_of}`;
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), null);
    const queueRows = ['conversion', 'cleanup', 'qualify'].map(q => data.rows.find(r => r.operations.queue === q && r.account_identified));
    async function openReview(row) {
      await closePanel();
      await page.locator(row.operations.queue === 'qualify' ? '#investigate' : `#${row.operations.queue}queue`).click();
      await page.locator('#search').fill(row.id);
      await page.locator('article .detail-button').click();
      const panel = page.locator('.review-drawer[open]');
      if (!(await panel.locator('[data-local-review] details').first().evaluate(n => n.open)))
        await panel.locator('[data-local-review] details > summary').first().click();
      return panel;
    }
    for (const row of queueRows) {
      const panel = await openReview(row);
      const expected = { conversion: ['commitment', 'responsible'], cleanup: ['continuity', 'blocker'], qualify: ['need', 'decision'] }[row.operations.queue];
      assert.deepEqual(await panel.locator('[data-answer]').evaluateAll(ns => ns.map(n => n.dataset.answer)), expected);
      assert.equal(await panel.locator('[name="nextStep"]').inputValue(), '');
      assert.match(await panel.locator('[data-local-review]').innerText(), /Campos sem resposta continuam pendentes/);
    }
    const unidentified = data.rows.find(r => !r.account_identified);
    let panel = await openReview(unidentified);
    assert.equal(await panel.locator('[data-answer]').first().getAttribute('data-answer'), 'account');
    assert.equal(await panel.locator('[data-coordination]').count(), 0);
    checks.push('queue scripts: distinct conversion/cleanup/qualification prompts; unknown account adds confirmation without automatic answers or joining');
    const recordedRow = queueRows[0];
    async function alignPanel(selector) {
      await page.locator('.review-drawer[open] .review-scroll').evaluate((scroller, selector) => {
        const target = scroller.querySelector(selector);
        scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
      }, selector);
    }
    panel = await openReview(recordedRow);
    await panel.locator('[data-answer="commitment"]').fill('EXEMPLO SINTÉTICO: responsável confirmou revisão da proposta.');
    await panel.locator('[name="nextStep"]').fill('EXEMPLO SINTÉTICO: confirmar responsável pela revisão da proposta.');
    await panel.locator('[name="due"]').fill('2026-10-20');
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), null);
    await panel.locator('[data-workflow-save]').click();
    panel = page.locator('.review-drawer[open]');
    assert.match(await panel.locator('.workflow-feedback').innerText(), /salvo neste navegador/);
    assert.equal(await panel.locator('[data-local-review] details').first().evaluate(n => n.open), true);
    assert.match(await panel.locator('[data-saved-step]').innerText(), /20\/10\/2026/);
    await alignPanel('[data-local-review]');
    await shot('desktop-next-step');
    await panel.locator('[data-workflow-save]').scrollIntoViewIfNeeded();
    await shot('desktop-next-step-actions');
    await panel.locator('input[data-review]').check();
    await page.reload(); await status('212 oportunidades');
    panel = await openReview(recordedRow);
    assert.match(await panel.locator('[name="nextStep"]').inputValue(), /EXEMPLO SINTÉTICO/);
    assert.equal(await panel.locator('[name="due"]').inputValue(), '2026-10-20');
    assert.equal(await panel.locator('input[data-review]').isChecked(), false);
    assert.match(await panel.locator('[data-save-origin]').innerText(), /Salvo neste navegador/);
    checks.push('explicit save and reload: next step, answers and deadline persist under dataset hash/date; session review checkbox still clears');
    await panel.locator('[name="nextStep"]').fill('EXEMPLO SINTÉTICO: esclarecer pendência antes de retomar.');
    await panel.locator('[name="stepStatus"]').selectOption('deferred');
    await panel.locator('[data-workflow-save]').click();
    await page.reload(); await status('212 oportunidades');
    panel = await openReview(recordedRow);
    assert.equal(await panel.locator('[name="stepStatus"]').inputValue(), 'deferred');
    await panel.locator('[data-workflow-action="undo"]').click();
    assert.equal(await panel.locator('[name="stepStatus"]').inputValue(), 'planned');
    assert.match(await panel.locator('[name="nextStep"]').inputValue(), /confirmar responsável/);
    assert.match(await panel.locator('.workflow-feedback').innerText(), /desfeita/);
    checks.push('edit and undo: declared state changes persist; previous next step and state restore after reload');
    await panel.locator('[data-workflow-action="copy"]').click();
    await page.waitForFunction(() => document.querySelector('.review-drawer[open] .workflow-feedback').textContent.includes('Resumo copiado'));
    let copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /registro local salvo/); assert.match(copied, /Pendente de confirmação/);
    assert.ok(copied.includes(data.dataset_hash)); assert.ok(copied.includes(data.as_of));
    await panel.locator('[name="nextStep"]').fill('RASCUNHO SINTÉTICO NÃO SALVO');
    await panel.locator('[data-workflow-action="copy"]').click();
    await page.waitForFunction(() => document.querySelector('.review-drawer[open] .workflow-feedback').textContent.includes('Resumo copiado'));
    copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(copied, /rascunho desta aba, ainda não salvo/);
    const reviewDownload = page.waitForEvent('download');
    await panel.locator('[data-workflow-action="export"]').click();
    const reviewFile = path.join(out, 'synthetic-local-review.json');
    await (await reviewDownload).saveAs(reviewFile);
    const exportedReview = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
    assert.equal(exportedReview.datasetHash, data.dataset_hash);
    assert.equal(exportedReview.asOf, data.as_of);
    assert.match(exportedReview.records[recordedRow.id].nextStep, /confirmar responsável/);
    assert.equal(JSON.stringify(exportedReview).includes('RASCUNHO SINTÉTICO NÃO SALVO'), false);
    checks.push('copy and JSON download: pending answers explicit, historical provenance included, saved/draft origin truthful, unsaved draft excluded from backup');
    await closePanel();
    panel = await openReview(recordedRow);
    assert.equal(await panel.locator('[name="nextStep"]').inputValue(), 'RASCUNHO SINTÉTICO NÃO SALVO');
    await page.reload(); await status('212 oportunidades');
    panel = await openReview(recordedRow);
    assert.match(await panel.locator('[name="nextStep"]').inputValue(), /confirmar responsável/);
    checks.push('draft lifecycle: edits survive panel navigation in the tab but reload restores only the explicitly saved record');
    const hostile = '</textarea><img src=x onerror="window.reviewXss=true">';
    await panel.locator('[name="nextStep"]').fill(hostile);
    await panel.locator('[data-workflow-save]').click();
    await page.reload(); await status('212 oportunidades');
    panel = await openReview(recordedRow);
    assert.equal(await panel.locator('[name="nextStep"]').inputValue(), hostile);
    assert.equal(await panel.locator('[data-local-review] img').count(), 0);
    assert.equal(await page.evaluate(() => window.reviewXss === true), false);
    await panel.locator('[data-workflow-action="undo"]').click();
    checks.push('stored text is escaped in fields, summary and history; synthetic HTML does not execute after reload');
    await page.evaluate(() => { window.originalLocalSet = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException('Synthetic quota', 'QuotaExceededError'); }; });
    await panel.locator('[name="nextStep"]').fill('EXEMPLO SINTÉTICO: registro temporário por falha de armazenamento.');
    await panel.locator('[data-workflow-save]').click();
    assert.match(await panel.locator('.workflow-feedback').innerText(), /apenas nesta aba/);
    assert.match(await panel.locator('[data-save-origin]').innerText(), /Somente nesta aba/);
    await panel.locator('[data-local-review]').scrollIntoViewIfNeeded(); await shot('local-storage-warning');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalLocalSet; delete window.originalLocalSet; });
    await page.reload(); await status('212 oportunidades');
    panel = await openReview(recordedRow);
    assert.match(await panel.locator('[name="nextStep"]').inputValue(), /confirmar responsável/);
    checks.push('browser quota failure: work retained temporarily with warning and no false saved claim; original persisted value survives reload');
    // Simulate a stale second-tab store using the same real browser storage.
    await page.evaluate(key => {
      const newer = JSON.parse(localStorage.getItem(key));
      newer.records[Object.keys(newer.records)[0]].nextStep = 'EXEMPLO SINTÉTICO: edição salva em outra aba';
      localStorage.setItem(key, JSON.stringify(newer));
    }, recordKey);
    await panel.locator('[name="nextStep"]').fill('EXEMPLO SINTÉTICO: edição da aba desatualizada');
    await panel.locator('[data-workflow-save]').click();
    assert.match(await panel.locator('.workflow-feedback').innerText(), /outra aba/);
    assert.match(await page.evaluate(key => localStorage.getItem(key), recordKey), /edição salva em outra aba/);
    checks.push('stale tab protection: concurrent saved text is preserved and current edit remains temporary with recovery guidance');
    await page.evaluate(key => localStorage.setItem(key, '{synthetic-invalid-json'), recordKey);
    await page.reload(); await status('212 oportunidades');
    panel = await openReview(recordedRow);
    assert.match(await panel.locator('[data-local-review]').innerText(), /foram preservadas/);
    await panel.locator('[name="nextStep"]').fill('EXEMPLO SINTÉTICO: nova anotação temporária');
    await panel.locator('[data-workflow-save]').click();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), '{synthetic-invalid-json');
    assert.equal(await page.evaluate(() => JSON.parse(localReviewStore.export()).unreadableOriginal), '{synthetic-invalid-json');
    await page.evaluate(() => localStorage.setItem('synthetic-unrelated-key', 'preserve'));
    page.once('dialog', dialog => dialog.dismiss());
    await panel.locator('[data-workflow-action="clear"]').click();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), '{synthetic-invalid-json');
    page.once('dialog', dialog => dialog.accept());
    await panel.locator('[data-workflow-action="clear"]').click();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), recordKey), null);
    assert.equal(await page.evaluate(() => localStorage.getItem('synthetic-unrelated-key')), 'preserve');
    checks.push('corrupt storage and clear: unreadable original preserved in backup; explicit confirm deletes only this dataset, cancel preserves it');
    await panel.locator('[name="nextStep"]').fill('EXEMPLO SINTÉTICO: conferir responsável e combinar a próxima revisão.');
    await panel.locator('[data-answer="commitment"]').fill('EXEMPLO SINTÉTICO: pendência de confirmação do responsável.');
    await panel.locator('[name="due"]').fill('2026-10-20');
    await panel.locator('[data-workflow-save]').click();
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await alignPanel('[data-local-review]');
      await overflow();
      assert.equal(await panel.evaluate(n => n.scrollWidth <= n.clientWidth), true);
      assert.equal(await panel.locator('form').evaluate(n => n.scrollWidth <= n.clientWidth), true);
      if (width === 375) {
        await shot('mobile-next-step');
        await alignPanel('.workflow-fields');
        await shot('mobile-next-step-actions');
      }
    }
    checks.push('mobile review: saved step, questions, optional date and state fit at 375 and 320px without horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reset();
    const coordinationRow = data.rows.find(r => r.account === 'Zoomit' && r.product === 'GTX Plus Basic');
    const canonicalProduct = name => name === 'GTXPro' ? 'GTX Pro' : name;
    const expectedCoordination = data.rows.filter(r => r.account_identified && r.account === coordinationRow.account && canonicalProduct(r.product) === canonicalProduct(coordinationRow.product) && r.agent !== coordinationRow.agent && r.id !== coordinationRow.id);
    assert.ok(expectedCoordination.length > 1);
    await page.locator('#agent').selectOption(coordinationRow.agent);
    panel = await openReview(coordinationRow);
    await panel.locator('.account-opportunities>summary').click();
    assert.deepEqual((await panel.locator('.coordination-badge').evaluateAll(ns => ns.map(n => n.closest('[data-related-id]').dataset.relatedId))).sort(), expectedCoordination.map(r => r.id).sort());
    assert.match(await panel.locator('[data-coordination]').innerText(), /não comprova contato duplicado ou conflito/);
    await alignPanel('[data-coordination]'); await shot('desktop-coordination');
    await page.setViewportSize({ width: 375, height: 844 });
    await alignPanel('[data-coordination]'); await shot('mobile-coordination');
    assert.equal(await panel.evaluate(n => n.scrollWidth <= n.clientWidth), true);
    const crossAgent = expectedCoordination[0];
    await panel.locator(`[data-context-open="${crossAgent.id}"]`).click();
    assert.equal(await page.locator('.review-drawer[open]').getAttribute('data-deal-id'), crossAgent.id);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.review-drawer[open]').getAttribute('data-deal-id'), coordinationRow.id);
    assert.equal(await page.locator('#agent').inputValue(), coordinationRow.agent);
    assert.equal(await page.locator('#search').inputValue(), coordinationRow.id);
    checks.push('account/product coordination: exact matching peers from other sellers, historical caveat, mobile fit and contextual navigation preserve filters');
    assert.equal(JSON.stringify((await (await context.request.get(url + '/api/pipeline')).json()).rows), baseBefore);
    assert.deepEqual(await page.evaluate(() => base.rows.map(r => [r.id, r.position, r.score, r.operations.queue])), data.rows.map(r => [r.id, r.position, r.score, r.operations.queue]));
    checks.push('workflow invariance: all original IDs, positions, scores and queues unchanged after saving, copying, undo, failures and coordination');
    }
    await checkFileStartupAndBrowserRestart();
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    fs.writeFileSync(
      path.join(out, "browser-results.json"),
      JSON.stringify(
        { time: new Date().toISOString(), url, checks, page_errors: errors, external_requests: externalRequests, provider_calls: 0 },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify({ passed: checks.length, checks, page_errors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
