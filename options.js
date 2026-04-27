const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats",
  tabLimitEnabled: "tabLimitEnabled",
  tabLimitMax: "tabLimitMax"
};

const K = {
  pendingDisableAt: "pendingDisableAt",
  pendingRemovals: "pendingRemovals",
  pendingTabLimitDisableAt: "pendingTabLimitDisableAt"
};

const el = (id) => document.getElementById(id);

let domains = [];
let cooldownMins = 5;
/** @type {Record<string, number> | null} */
let pendingRemovals = null;
let pendingDisableAt = null;
let pendingTabLimitAt = null;
let tickTimer = null;

/**
 * @param {unknown} n
 * @returns {number}
 */
function clampTabMax(n) {
  const x = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(x)) return 8;
  return Math.max(2, Math.min(100, Math.floor(x)));
}

function normalizeToHost(s) {
  if (!s || typeof s !== "string") return null;
  let t = s.trim();
  if (!t) return null;
  t = t.replace(/^\*\.?/, "");
  t = t.replace(/[,;\s].*$/, "").trim();
  if (t.toLowerCase() === "localhost" || t.includes("/") || t.includes("://")) {
    try {
      const u = t.includes("://") ? new URL(t) : new URL("http://" + t);
      t = u.hostname;
    } catch {
      return null;
    }
  } else {
    t = t.replace(/^[a-z+.-]+:\/\//i, "");
    t = t.split("/")[0].split(":")[0];
  }
  t = t.toLowerCase();
  if (!t || t.length > 253) return null;
  if (!/^[a-z0-9.-]+$/i.test(t)) return null;
  return t;
}

function sortArr(a) {
  return [...new Set(a)].filter(Boolean).sort((x, y) => x.localeCompare(y));
}

/**
 * Chrome.storage pode devolver tempos de remoção como string; as chaves devem
 * coincidir com o domínio em `userDomains` (já em minúsculas).
 * @param {unknown} pr
 * @returns {Record<string, number> | null}
 */
function parsePendingRemovals(pr) {
  if (!pr || typeof pr !== "object" || Array.isArray(pr)) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of Object.keys(/** @type {Record<string, unknown>} */ (pr))) {
    if (!k) continue;
    const v = pr[k];
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) {
      out[k.toLowerCase()] = n;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * @param {Record<string, number> | null | undefined} m
 * @param {string} host
 */
function removalEndAt(m, host) {
  if (!m || !host) return null;
  const h = host.toLowerCase();
  if (h in m) {
    const v = m[h];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (v != null) {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  for (const k of Object.keys(m)) {
    if (k.toLowerCase() === h) {
      const v = m[k];
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/**
 * @param {number} ms
 */
function formatRemainingMs(ms) {
  if (ms < 0) ms = 0;
  const totalS = Math.ceil(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function hasTabLimitPending() {
  return typeof pendingTabLimitAt === "number" && pendingTabLimitAt > Date.now();
}

function hasAnyPending() {
  if (pendingDisableAt && pendingDisableAt > Date.now()) return true;
  if (hasTabLimitPending()) return true;
  const m = pendingRemovals || {};
  for (const t of Object.values(m)) {
    const n = typeof t === "number" ? t : Number(t);
    if (Number.isFinite(n) && n > Date.now()) return true;
  }
  return false;
}

function startTick() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  if (!hasAnyPending()) return;
  const tick = () => {
    updatePendingUi();
    if (!hasAnyPending() && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
  tick();
  tickTimer = setInterval(tick, 1000);
}

function updatePendingUi() {
  const box = el("boxPendingDisable");
  const cDown = el("disableCountdown");
  const boxTab = el("boxPendingTabLimit");
  const cTab = el("tabLimitCountdown");
  if (box) {
    if (pendingDisableAt && typeof pendingDisableAt === "number" && pendingDisableAt > Date.now()) {
      box.hidden = false;
      if (cDown) cDown.textContent = formatRemainingMs(pendingDisableAt - Date.now());
    } else {
      box.hidden = true;
    }
  }
  if (boxTab) {
    if (hasTabLimitPending()) {
      boxTab.hidden = false;
      if (cTab) cTab.textContent = formatRemainingMs(pendingTabLimitAt - Date.now());
    } else {
      boxTab.hidden = true;
    }
  }

  const m = pendingRemovals || {};
  const now = Date.now();
  document.querySelectorAll("[data-rem-eta-for]").forEach((node) => {
    const h = node.getAttribute("data-rem-eta-for");
    if (!h) return;
    const when = removalEndAt(m, h);
    if (when && when > now) {
      node.textContent = formatRemainingMs(when - now);
    }
  });
}

function setStatus(msg, ok = true) {
  const s = el("status");
  s.textContent = msg || "";
  s.style.color = ok ? "var(--ok, #7dcea0)" : "var(--err, #f0a0a0)";
}

/**
 * Avisa o service worker para o alarme; nunca bloqueia a UI. Se a mensagem falhar (SW inativo, etc.),
 * o contador e o storage em `local` já estão alinhados após `load()`.
 */
function fireReschedule() {
  try {
    chrome.runtime.sendMessage({ type: "reschedulePending" }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // extensão recarregou ou contexto inválido
  }
}

function render() {
  const u = el("listEl");
  const empty = el("emptyList");
  const c = el("listCount");
  c.textContent = "(" + domains.length + ")";
  u.innerHTML = "";
  const m = pendingRemovals || {};
  const remHint = el("listRemHint");
  if (remHint) {
    remHint.hidden = domains.length === 0;
    if (domains.length > 0) {
      remHint.textContent =
        "Ao tocar em «Remover (" +
        cooldownMins +
        " min.)», cada site inicia o seu temporizador nessa duração; contadores por linha, independentes; quando o de um site acaba, só esse é removido.";
    }
  }
  if (domains.length === 0) {
    empty.hidden = false;
    u.hidden = true;
  } else {
    empty.hidden = true;
    u.hidden = false;
    for (const d of domains) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      const wrap = document.createElement("div");
      wrap.className = "dname-wrap";
      const sp = document.createElement("span");
      sp.className = "dname";
      sp.textContent = d;
      wrap.appendChild(sp);
      const endAt = removalEndAt(m, d);
      const now = Date.now();
      const scheduled = endAt != null && endAt > now;
      if (scheduled) {
        const p = document.createElement("p");
        p.className = "pend-note";
        p.textContent =
          "Repetir a decisão dá força à tua concentração. Se ainda tiveres a certeza, o site deixa de estar bloqueado a seguir — só este, no seu tempo.";
        const rowTimer = document.createElement("div");
        rowTimer.className = "site-cooldown";
        rowTimer.setAttribute("role", "status");
        rowTimer.setAttribute("aria-live", "off");
        const tLabel = document.createElement("span");
        tLabel.className = "site-cooldown-label";
        tLabel.textContent = "Temporizador (apenas este site)";
        const tVal = document.createElement("span");
        tVal.className = "site-cooldown-digits";
        tVal.setAttribute("data-rem-eta-for", d);
        tVal.textContent = formatRemainingMs(endAt - now);
        rowTimer.appendChild(tLabel);
        rowTimer.appendChild(tVal);
        wrap.appendChild(p);
        wrap.appendChild(rowTimer);
      }
      li.appendChild(wrap);

      const col = document.createElement("div");
      col.className = "li-btns";
      if (scheduled) {
        const ca = document.createElement("button");
        ca.type = "button";
        ca.className = "btn-pend";
        ca.textContent = "Anular remoção";
        ca.setAttribute("aria-label", "Anular remoção de " + d);
        ca.addEventListener("click", () => void cancelRemoval(d));
        col.appendChild(ca);
      } else {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "btn-remove";
        b.setAttribute(
          "aria-label",
          "Iniciar remoção de " + d + " (aguarda " + cooldownMins + " minutos, só para este site)"
        );
        b.textContent = "Remover (" + cooldownMins + " min.)";
        b.addEventListener("click", () => {
          void scheduleRemove(d);
        });
        col.appendChild(b);
      }
      li.appendChild(col);
      u.appendChild(li);
    }
  }
  startTick();
}

function renderMeta(data) {
  const t = el("footMeta");
  const w = el("truncWarn");
  const s = data[S.lastRebuildStats];
  const tr = data.listTruncated;
  if (s && typeof s.applied === "number") {
    el("ruleStat").textContent = "Regras ativas: " + s.applied + " / " + (s.cap || 5000);
    t.hidden = false;
  } else {
    t.hidden = true;
  }
  if (tr && tr.userMissed > 0) {
    w.textContent =
      "Aviso: " +
        (tr.userMissed === 1
          ? "1 site não pôde ser bloqueado"
          : tr.userMissed + " sites não puderam ser bloqueados") +
        " (limite de 5000 regras do Chrome).";
    w.hidden = false;
  } else {
    w.textContent = "";
    w.hidden = true;
  }
}

async function load() {
  const d = await chrome.storage.local.get([
    S.blockingEnabled,
    S.userDomains,
    S.lastRebuildStats,
    "listTruncated",
    K.pendingDisableAt,
    K.pendingRemovals,
    K.pendingTabLimitDisableAt,
    S.tabLimitEnabled,
    S.tabLimitMax,
    "pendingCooldownMinutes"
  ]);
  cooldownMins = await focoGetPendingCooldownMinutes();
  el("blockingEnabled").checked = d[S.blockingEnabled] !== false;
  if (el("tabLimitEnabled")) {
    el("tabLimitEnabled").checked = d[S.tabLimitEnabled] === true;
  }
  if (el("tabLimitMax")) {
    el("tabLimitMax").value = String(clampTabMax(d[S.tabLimitMax] != null ? d[S.tabLimitMax] : 8));
  }
  const raw = d[S.userDomains];
  domains = sortArr(Array.isArray(raw) ? raw : []);
  pendingDisableAt = typeof d[K.pendingDisableAt] === "number" ? d[K.pendingDisableAt] : null;
  pendingTabLimitAt = typeof d[K.pendingTabLimitDisableAt] === "number" ? d[K.pendingTabLimitDisableAt] : null;
  pendingRemovals = parsePendingRemovals(d[K.pendingRemovals]);
  render();
  updatePendingUi();
  renderMeta(d);
}

async function persist() {
  await chrome.storage.local.set({ [S.userDomains]: sortArr(domains) });
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "rebuild" }, () => resolve());
  });
  await load();
  setStatus("Lista atualizada.", true);
}

async function scheduleRemove(host) {
  const key = (host && String(host).toLowerCase()) || "";
  const m = { ...(typeof pendingRemovals === "object" && pendingRemovals ? pendingRemovals : {}) };
  const already = removalEndAt(m, key);
  if (already != null && already > Date.now()) {
    setStatus("Já há remoção agendada — anule primeiro se quiseres alterar o pedido.", false);
    return;
  }
  const mins = await focoGetPendingCooldownMinutes();
  cooldownMins = mins;
  m[key] = Date.now() + mins * 60 * 1000;
  setStatus(
    String(mins) +
      " min. a contar para este site (o tempo vêm das configurações, ícone de engrenagem). Podes anular; o site fica bloqueado até ao fim.",
    true
  );
  try {
    await chrome.storage.local.set({ [K.pendingRemovals]: m });
    await load();
    fireReschedule();
  } catch (e) {
    setStatus("Erro: " + (e && e.message), false);
  }
}

async function cancelRemoval(host) {
  const key = (host && String(host).toLowerCase()) || "";
  const m = { ...(typeof pendingRemovals === "object" && pendingRemovals ? pendingRemovals : {}) };
  delete m[key];
  for (const k of Object.keys(m)) {
    if (k.toLowerCase() === key) delete m[k];
  }
  const out = Object.keys(m).length ? m : null;
  setStatus("Remoção de " + host + " anulada. O site continua na lista de bloqueio.", true);
  try {
    await chrome.storage.local.set({ [K.pendingRemovals]: out });
    await load();
    fireReschedule();
  } catch (e) {
    setStatus("Erro: " + (e && e.message), false);
  }
}

async function addFromInput() {
  const v = (el("newSite").value || "").trim();
  if (!v) {
    setStatus("Escreva um domínio ou URL.", false);
    return;
  }
  const h = normalizeToHost(v);
  if (!h) {
    setStatus("Não percebemos o endereço. Tente o domínio (ex. exemplo.com).", false);
    return;
  }
  if (domains.includes(h)) {
    setStatus("Este site já está na lista.", false);
    return;
  }
  if (domains.length >= 5000) {
    setStatus("Limite de 5000 sites (limite de regras do Chrome).", false);
    return;
  }
  el("newSite").value = "";
  domains = sortArr([...domains, h]);
  setStatus("A adicionar…", true);
  try {
    await persist();
  } catch (e) {
    setStatus("Erro: " + (e && e.message), false);
  }
}

el("formAdd").addEventListener("submit", (e) => {
  e.preventDefault();
  void addFromInput();
});

el("cancelPendingDisable").addEventListener("click", () => {
  void (async () => {
    setStatus("Desativação anulada. A extensão mantém o bloqueio ativo.", true);
    try {
      await chrome.storage.local.set({ [K.pendingDisableAt]: null });
      await load();
      fireReschedule();
    } catch (e) {
      setStatus("Erro: " + (e && e.message), false);
    }
  })();
});

el("cancelPendingTabLimit")?.addEventListener("click", () => {
  void (async () => {
    setStatus("Desativação anulada. O limite de abas continua a aplicar-se.", true);
    try {
      await chrome.storage.local.set({ [K.pendingTabLimitDisableAt]: null });
      await load();
      fireReschedule();
    } catch (e) {
      setStatus("Erro: " + (e && e.message), false);
    }
  })();
});

el("tabLimitEnabled")?.addEventListener("change", (e) => {
  const input = e.target;
  if (!input || input.type !== "checkbox") return;
  void (async () => {
    if (!input.checked) {
      if (hasTabLimitPending()) {
        setStatus("Já há desativação do limite a contar. Anula primeiro, se quiseres alterar.", false);
        input.checked = true;
        return;
      }
      setStatus("A agendar desativação do limite de abas… O limite continua ativo; podes anular a qualquer momento.", true);
      try {
        const mins = await focoGetPendingCooldownMinutes();
        cooldownMins = mins;
        const end = Date.now() + mins * 60 * 1000;
        await chrome.storage.local.set({ [K.pendingTabLimitDisableAt]: end });
        input.checked = true;
        await load();
        fireReschedule();
      } catch (err) {
        setStatus("Erro: " + (err && err.message), false);
        input.checked = true;
      }
      return;
    }
    try {
      await chrome.storage.local.set({
        [K.pendingTabLimitDisableAt]: null,
        [S.tabLimitEnabled]: true
      });
      input.checked = true;
      await load();
      fireReschedule();
      setStatus("Limite de abas ativado.", true);
    } catch (er) {
      setStatus("Erro: " + (er && er.message), false);
    }
  })();
});

el("saveTabMax")?.addEventListener("click", () => {
  void (async () => {
    const raw = (el("tabLimitMax")?.value || "").trim();
    const v = clampTabMax(raw);
    if (el("tabLimitMax")) el("tabLimitMax").value = String(v);
    try {
      await chrome.storage.local.set({ [S.tabLimitMax]: v });
      await load();
      setStatus("Tecto de " + v + " abas guardado.", true);
    } catch (e) {
      setStatus("Erro: " + (e && e.message), false);
    }
  })();
});

el("blockingEnabled").addEventListener("change", (e) => {
  const input = e.target;
  if (!input || input.type !== "checkbox") return;
  void (async () => {
    if (!input.checked) {
      if (typeof pendingDisableAt === "number" && pendingDisableAt > Date.now()) {
        setStatus("Já tens uma desativação a contar decrescente. Anula primeiro, se quiseres alterar.", false);
        input.checked = true;
        return;
      }
      setStatus("A agendar desativação…", true);
      try {
        const mins = await focoGetPendingCooldownMinutes();
        cooldownMins = mins;
        setStatus(
          "O bloqueio mantém-se ativo " + mins + " min.; podes anular a qualquer momento. (Tempo definido em Configurações.)",
          true
        );
        const end = Date.now() + mins * 60 * 1000;
        await chrome.storage.local.set({ [K.pendingDisableAt]: end });
        input.checked = true;
        await load();
        fireReschedule();
      } catch (err) {
        setStatus("Erro: " + (err && err.message), false);
        input.checked = true;
      }
      return;
    }
    try {
      await chrome.storage.local.set({ [K.pendingDisableAt]: null, [S.blockingEnabled]: true });
      const d = await chrome.storage.local.get(S.blockingEnabled);
      input.checked = d[S.blockingEnabled] !== false;
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "rebuild" }, () => resolve());
      });
      await scheduleNextAndLoad();
    } catch (er) {
      setStatus("Erro: " + (er && er.message), false);
    }
  })();
});

async function scheduleNextAndLoad() {
  await load();
  fireReschedule();
  setStatus("Bloqueio ativado; qualquer desativação em espera foi limpa.", true);
}

chrome.storage.onChanged.addListener((c, a) => {
  if (
    a === "local" &&
    (c[S.userDomains] ||
      c[S.lastRebuildStats] ||
      c[S.blockingEnabled] ||
      c.listTruncated ||
      c[K.pendingDisableAt] ||
      c[K.pendingRemovals] ||
      c.pendingCooldownMinutes ||
      c[S.tabLimitEnabled] ||
      c[S.tabLimitMax] ||
      c[K.pendingTabLimitDisableAt])
  ) {
    void load();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  void load();
});
