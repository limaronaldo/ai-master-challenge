const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("./workflow.js");
const identity = { datasetHash: "a".repeat(64), asOf: "2017-12-31", ids: ["DEAL0001", "DEAL0002"] };
const now = () => "2026-10-14T16:00:00.000Z";
function memory() {
  const data = new Map();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
}
const value = (overrides = {}) => ({ nextStep: "Confirmar responsável pelo próximo passo", due: "2026-10-20", status: "planned", answers: { commitment: "Pendente" }, ...overrides });
const row = { id: "DEAL0001", account: "Conta A", product: "GTX Pro", agent: "Vendedor A", account_identified: true, operations: { queue: "conversion" } };

test("records are written only on explicit save and restored for the same snapshot", () => {
  const storage = memory(), store = W.createStore(identity, storage, now);
  assert.equal(storage.data.size, 0);
  assert.equal(store.save("DEAL0001", value()).persisted, true);
  const restored = W.createStore(identity, storage, now);
  assert.equal(restored.get("DEAL0001").nextStep, value().nextStep);
  assert.equal(restored.get("DEAL0001").updatedAt, now());
  assert.equal(W.createStore({ ...identity, datasetHash: "b".repeat(64) }, storage).get("DEAL0001"), null);
  assert.equal(W.createStore({ ...identity, asOf: "2017-12-30" }, storage).get("DEAL0001"), null);
});
test("editing and undo restore saved values across reload; first undo removes first entry", () => {
  const storage = memory(), store = W.createStore(identity, storage, now);
  store.save("DEAL0001", value());
  store.save("DEAL0001", value({ nextStep: "Revisar pendência", status: "deferred" }));
  const restored = W.createStore(identity, storage, now);
  assert.equal(restored.undo("DEAL0001").persisted, true);
  assert.equal(restored.get("DEAL0001").status, "planned");
  assert.equal(restored.get("DEAL0001").nextStep, value().nextStep);
  restored.undo("DEAL0001");
  assert.equal(W.createStore(identity, storage).get("DEAL0001"), null);
});
test("history is bounded and export includes provenance and stored answers", () => {
  const storage = memory(), store = W.createStore(identity, storage, now);
  for (let i = 0; i < 12; i++) store.save("DEAL0001", value({ nextStep: "Revisão " + i }));
  assert.equal(store.get("DEAL0001").history.length, 5);
  const exported = JSON.parse(store.export());
  assert.equal(exported.datasetHash, identity.datasetHash);
  assert.equal(exported.asOf, identity.asOf);
  assert.equal(exported.records.DEAL0001.answers.commitment, "Pendente");
});
test("quota and missing storage retain temporary work without claiming persistence", () => {
  const storage = memory(); storage.setItem = () => { throw new Error("QuotaExceeded"); };
  const store = W.createStore(identity, storage, now);
  assert.equal(store.save("DEAL0001", value()).persisted, false);
  assert.equal(store.isTemporary("DEAL0001"), true);
  assert.match(store.warning, /apenas nesta aba/);
  assert.equal(W.createStore(identity, storage).get("DEAL0001"), null);
  assert.equal(W.createStore(identity, null, now).save("DEAL0002", value()).persisted, false);
});
test("a stale tab cannot overwrite another tab's saved records", () => {
  const storage = memory(), first = W.createStore(identity, storage, now), second = W.createStore(identity, storage, now);
  first.save("DEAL0001", value());
  const before = storage.getItem(first.key);
  assert.equal(second.save("DEAL0002", value()).persisted, false);
  assert.match(second.warning, /outra aba/);
  assert.equal(second.isTemporary("DEAL0002"), true);
  assert.equal(storage.getItem(first.key), before);
  assert.ok(JSON.parse(second.export()).records.DEAL0002);
  assert.ok(W.createStore(identity, storage).get("DEAL0001"));
});
test("corrupt data is preserved and included in backup until explicit clear", () => {
  const storage = memory(), key = W.createStore(identity, storage).key;
  storage.setItem(key, "{invalid-json");
  const store = W.createStore(identity, storage, now);
  assert.match(store.warning, /preservadas/);
  assert.equal(store.save("DEAL0001", value()).persisted, false);
  assert.equal(storage.getItem(key), "{invalid-json");
  assert.equal(JSON.parse(store.export()).unreadableOriginal, "{invalid-json");
  assert.equal(store.clear(), true);
  assert.equal(store.warning, "");
  assert.equal(store.save("DEAL0001", value()).persisted, true);
});
test("foreign identity, unknown IDs and malformed stored fields are rejected without overwrite", () => {
  for (const change of [
    (x) => { x.datasetHash = "b".repeat(64); },
    (x) => { x.records.UNKNOWN = x.records.DEAL0001; },
    (x) => { x.records.DEAL0001.due = "2026-02-30"; },
    (x) => { x.records.DEAL0001.history = Array(6).fill(null); },
    (x) => { x.records.DEAL0001.answers.unexpected = "value"; },
  ]) {
    const storage = memory(), store = W.createStore(identity, storage, now);
    store.save("DEAL0001", value());
    const saved = JSON.parse(store.export()); change(saved);
    const invalid = JSON.stringify(saved); storage.setItem(store.key, invalid);
    const restored = W.createStore(identity, storage, now);
    assert.equal(restored.get("DEAL0001"), null);
    assert.equal(restored.save("DEAL0002", value()).persisted, false);
    assert.equal(storage.getItem(store.key), invalid);
  }
});
test("invalid inputs, overlong text and impossible dates never write", () => {
  const storage = memory(), store = W.createStore(identity, storage, now);
  for (const v of [value({ nextStep: " " }), value({ nextStep: "x".repeat(501) }), value({ due: "2026-02-30" }), value({ status: "Won" }), value({ answers: { commitment: "x".repeat(401) } })]) {
    assert.throws(() => store.save("DEAL0001", v));
  }
  assert.throws(() => store.save("UNKNOWN", value()));
  assert.equal(storage.data.size, 0);
  assert.equal(W.validDate("2024-02-29"), true);
  assert.equal(W.validDate("2025-02-29"), false);
});
test("clear only affects the matching dataset and failure keeps records", () => {
  const storage = memory(), store = W.createStore(identity, storage, now);
  const other = W.createStore({ ...identity, datasetHash: "b".repeat(64) }, storage, now);
  store.save("DEAL0001", value()); other.save("DEAL0001", value());
  storage.removeItem = () => { throw new Error("blocked"); };
  assert.equal(store.clear(), false);
  assert.ok(store.get("DEAL0001"));
  storage.removeItem = (key) => storage.data.delete(key);
  assert.equal(store.clear(), true);
  assert.equal(W.createStore(identity, storage).get("DEAL0001"), null);
  assert.ok(W.createStore({ ...identity, datasetHash: "b".repeat(64) }, storage).get("DEAL0001"));
});
test("questions differ by queue and missing account adds a confirmation without assuming facts", () => {
  const variants = ["conversion", "cleanup", "qualify"].map((queue) => W.questions({ ...row, operations: { queue } }));
  assert.equal(new Set(variants.flat().map((q) => q.id)).size, 6);
  assert.ok(variants.every((q) => q.length === 2));
  assert.equal(W.questions({ ...row, account_identified: false })[0].id, "account");
});
test("summary distinguishes pending answers, historical facts and unsaved drafts", () => {
  const text = W.summary(row, value({ answers: {} }), identity, false);
  assert.match(text, /Pendente de confirmação/);
  assert.match(text, /2017-12-31/);
  assert.match(text, /rascunho desta aba, ainda não salvo/);
  assert.match(text, /não comprova contato ou venda/);
  assert.match(W.summary(row, value(), identity, true), /registro local salvo/);
});
test("coordination requires identified same account/product and another seller; source unchanged", () => {
  const data = [row,
    { ...row, id: "DEAL0002", product: "GTXPro", agent: "Vendedor B" },
    { ...row, id: "DEAL0003", agent: "Vendedor A" },
    { ...row, id: "DEAL0004", product: "MG Basic", agent: "Vendedor B" },
    { ...row, id: "DEAL0005", account: "Outra", agent: "Vendedor B" },
    { ...row, id: "DEAL0006", account_identified: false, agent: "Vendedor B" }];
  const before = JSON.stringify(data);
  assert.deepEqual(W.coordination(data, row).map((r) => r.id), ["DEAL0002"]);
  assert.equal(W.coordination(data, { ...row, account_identified: false }).length, 0);
  assert.equal(JSON.stringify(data), before);
});
