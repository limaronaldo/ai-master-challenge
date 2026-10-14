/* Local review records. No scoring, network calls or CRM writes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ReviewWorkflow = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const SCHEMA = 1, MAX_TEXT_LENGTH = 2 * 1024 * 1024, HISTORY_LIMIT = 5;
  const statuses = { planned: "Planejado", done: "Concluído", deferred: "Adiado" };
  const answerKeys = new Set(["account", "commitment", "responsible", "continuity", "blocker", "need", "decision"]);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

  function validDate(value) {
    if (value === "") return true;
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function fields(value) {
    if (!object(value) || typeof value.nextStep !== "string" || !value.nextStep.trim() || value.nextStep.length > 500
        || !validDate(value.due) || !Object.hasOwn(statuses, value.status) || !object(value.answers)) {
      throw new Error("Confira o próximo passo, a data e o estado do registro.");
    }
    const answers = {};
    for (const [key, text] of Object.entries(value.answers)) {
      if (!answerKeys.has(key) || typeof text !== "string" || text.length > 400) throw new Error("Resposta inválida ou muito longa.");
      answers[key] = text.trim();
    }
    return { nextStep: value.nextStep.trim(), due: value.due, status: value.status, answers };
  }
  function snapshot(value) {
    const result = fields(value);
    if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))
        || new Date(value.updatedAt).toISOString() !== value.updatedAt) throw new Error("Data do registro inválida.");
    return { ...result, updatedAt: value.updatedAt };
  }
  function questions(row) {
    const prompts = {
      conversion: [
        { id: "commitment", label: "O que ficou combinado na última conversa confirmada?" },
        { id: "responsible", label: "Quem deve confirmar ou executar o próximo passo?" },
      ],
      cleanup: [
        { id: "continuity", label: "A negociação continua ativa? Qual informação confirma isso?" },
        { id: "blocker", label: "Há um obstáculo ou uma pendência? Quem pode esclarecê-lo?" },
      ],
      qualify: [
        { id: "need", label: "Qual necessidade foi confirmada e qual resultado a empresa procura?" },
        { id: "decision", label: "Quem pode confirmar a necessidade e participar da decisão?" },
      ],
    };
    const result = [...(prompts[row.operations.queue] || prompts.qualify)];
    if (!row.account_identified) result.unshift({ id: "account", label: "A qual empresa este registro pertence? Confira na fonte antes de vincular." });
    return result;
  }
  const productName = (name) => name === "GTXPro" ? "GTX Pro" : name;
  function coordination(rows, row) {
    if (!row.account_identified) return [];
    return rows.filter((other) => other.account_identified && other.account === row.account
      && productName(other.product) === productName(row.product) && other.id !== row.id && other.agent !== row.agent)
      .sort((a, b) => a.agent.localeCompare(b.agent, "pt-BR") || a.id.localeCompare(b.id));
  }

  function createStore(identity, storage, now = () => new Date().toISOString()) {
    if (!/^[a-f0-9]{64}$/.test(identity.datasetHash) || !identity.asOf || !validDate(identity.asOf)) throw new Error("Base inválida.");
    const known = new Set(identity.ids);
    const key = `leadscorer:review:v${SCHEMA}:${identity.datasetHash}:${identity.asOf}`;
    let records = Object.create(null), warning = "", corrupt = false, originalRaw = null, lastStoredRaw = null;
    const unsaved = new Set();
    function envelope() { return { schema: SCHEMA, datasetHash: identity.datasetHash, asOf: identity.asOf, records }; }
    try {
      const raw = storage?.getItem(key);
      lastStoredRaw = raw ?? null;
      if (raw !== null && raw !== undefined) {
        originalRaw = raw;
        if (raw.length > MAX_TEXT_LENGTH) throw new Error("size");
        const saved = JSON.parse(raw);
        if (!object(saved) || saved.schema !== SCHEMA || saved.datasetHash !== identity.datasetHash
            || saved.asOf !== identity.asOf || !object(saved.records) || Object.keys(saved.records).length > known.size) throw new Error("identity");
        const clean = Object.create(null);
        for (const [id, record] of Object.entries(saved.records)) {
          if (!known.has(id) || !object(record) || !Array.isArray(record.history) || record.history.length > HISTORY_LIMIT) throw new Error("record");
          clean[id] = { ...snapshot(record), history: record.history.map((entry) => entry === null ? null : snapshot(entry)) };
        }
        records = clean;
      }
    } catch (_) {
      warning = "Não foi possível ler as anotações locais. Elas foram preservadas; novos registros ficam apenas nesta aba. Exporte sua cópia ou apague as anotações desta base para reiniciar.";
      corrupt = true;
    }
    function persist(id) {
      try {
        if (corrupt || !storage) throw new Error("unavailable");
        if (storage.getItem(key) !== lastStoredRaw) {
          warning = "As anotações foram alteradas em outra aba. Sua edição ficou apenas nesta aba; exporte uma cópia e recarregue antes de continuar.";
          if (id) unsaved.add(id);
          return false;
        }
        const text = JSON.stringify(envelope());
        if (text.length > MAX_TEXT_LENGTH) throw new Error("size");
        storage.setItem(key, text);
        lastStoredRaw = text;
        unsaved.clear(); warning = "";
        return true;
      } catch (_) {
        if (id) unsaved.add(id);
        if (!corrupt) warning = "Não foi possível guardar no navegador. O registro fica apenas nesta aba; exporte uma cópia antes de fechar.";
        return false;
      }
    }
    return {
      key,
      get warning() { return warning; },
      get(id) { return Object.hasOwn(records, id) ? clone(records[id]) : null; },
      isTemporary(id) { return unsaved.has(id); },
      save(id, value) {
        if (!known.has(id)) throw new Error("Oportunidade fora desta base.");
        const next = fields(value), previous = records[id];
        records[id] = { ...snapshot({ ...next, updatedAt: now() }), history: [...(previous?.history || []), previous ? snapshot(previous) : null].slice(-HISTORY_LIMIT) };
        return { persisted: persist(id), record: this.get(id) };
      },
      undo(id) {
        const record = records[id];
        if (!record?.history.length) return { changed: false, persisted: !unsaved.has(id) };
        const history = [...record.history], previous = history.pop();
        if (previous === null) delete records[id];
        else records[id] = { ...previous, history };
        return { changed: true, persisted: persist(id) };
      },
      clear() {
        try {
          if (!storage) throw new Error("unavailable");
          storage.removeItem(key);
          records = Object.create(null); unsaved.clear(); corrupt = false; originalRaw = null; lastStoredRaw = null; warning = "";
          return true;
        } catch (_) {
          warning = "Não foi possível apagar as anotações do navegador. Os registros foram mantidos.";
          return false;
        }
      },
      export() { return JSON.stringify({ ...envelope(), ...(corrupt && originalRaw !== null ? { unreadableOriginal: originalRaw } : {}) }, null, 2) + "\n"; },
    };
  }
  function summary(row, value, identity, saved) {
    const record = fields(value);
    return [
      "ROTEIRO DE REVISÃO — REGISTRO DECLARADO PELO USUÁRIO",
      `Oportunidade: ${row.id}`, `Conta da base: ${row.account}`, `Produto: ${row.product}`, `Vendedor da base: ${row.agent}`,
      `Data-base histórica: ${identity.asOf}`, `Hash do dataset: ${identity.datasetHash}`,
      "", "RESPOSTAS DECLARADAS — CONFERIR NA FONTE",
      ...questions(row).map((prompt) => `${prompt.label}\n${record.answers[prompt.id] || "Pendente de confirmação."}`),
      "", "PRÓXIMO PASSO ESCOLHIDO", record.nextStep,
      `Prazo informado: ${record.due || "Não definido"}`, `Estado informado: ${statuses[record.status]}`,
      `Origem do texto: ${saved ? "registro local salvo" : "rascunho desta aba, ainda não salvo"}`,
      "", "A fotografia histórica permanece preservada. Este registro não comprova contato ou venda e não atualiza o CRM.",
    ].join("\n");
  }
  return { SCHEMA, statuses, validDate, questions, coordination, createStore, summary };
});
