const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats"
};

const K = {
  pendingDisableAt: "pendingDisableAt",
  pendingRemovals: "pendingRemovals"
};

const COOLDOWN_MS = 5 * 60 * 1000;

const el = (id) => document.getElementById(id);

let domains = [];
/** @type {Record<string, number> | null} */
let pendingRemovals = null;
let pendingDisableAt = null;
let tickTimer = null;

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
 * @param {number} ms
 */
function formatRemainingMs(ms) {
  if (ms < 0) ms = 0;
  const totalS = Math.ceil(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function hasAnyPending() {
  if (pendingDisableAt && pendingDisableAt > Date.now()) return true;
  const m = pendingRemovals || {};
  for (const t of Object.values(m)) {
    if (typeof t === "number" && t > Date.now()) return true;
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
  if (pendingDisableAt && typeof pendingDisableAt === "number" && pendingDisableAt > Date.now()) {
    box.hidden = false;
    const left = pendingDisableAt - Date.now();
    el("disableCountdown").textContent = formatRemainingMs(left);
  } else {
    box.hidden = true;
  }

  const m = pendingRemovals || {};
  for (const d of domains) {
    const c = document.getElementById("rem-eta-" + d.replace(/[^a-z0-9.-]/gi, "_"));
    if (!c) continue;
    const when = m[d];
    if (when && when > Date.now()) {
      c.textContent = "Aplica em " + formatRemainingMs(when - Date.now());
    }
  }
}

function setStatus(msg, ok = true) {
  const s = el("status");
  s.textContent = msg || "";
  s.style.color = ok ? "var(--ok, #7dcea0)" : "var(--err, #f0a0a0)";
}

async function reschedule() {
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "reschedulePending" }, () => resolve());
  });
}

function render() {
  const u = el("listEl");
  const empty = el("emptyList");
  const c = el("listCount");
  c.textContent = "(" + domains.length + ")";
  u.innerHTML = "";
  const m = pendingRemovals || {};
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
      const scheduled = typeof m[d] === "number" && m[d] > Date.now();
      if (scheduled) {
        const p = document.createElement("p");
        p.className = "pend-note";
        p.appendChild(
          (() => {
            const t = document.createElement("span");
            t.textContent =
              "Repetir a decisão dá força à tua concentração. Se ainda tiveres a certeza, o sítio deixa de ser bloqueado a seguir. ";
            return t;
          })()
        );
        const eta = document.createElement("span");
        eta.className = "pend-eta";
        eta.id = "rem-eta-" + d.replace(/[^a-z0-9.-]/gi, "_");
        eta.textContent = "Aplica em " + formatRemainingMs(m[d] - Date.now());
        p.appendChild(eta);
        wrap.appendChild(p);
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
        b.setAttribute("aria-label", "Agendar remoção de " + d);
        b.textContent = "Remover";
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
      "Aviso: " + tr.userMissed + " sítio(s) não puderam ser bloqueados (limite de 5000 regras do Chrome).";
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
    K.pendingRemovals
  ]);
  el("blockingEnabled").checked = d[S.blockingEnabled] !== false;
  const raw = d[S.userDomains];
  domains = sortArr(Array.isArray(raw) ? raw : []);
  pendingDisableAt = typeof d[K.pendingDisableAt] === "number" ? d[K.pendingDisableAt] : null;
  pendingRemovals = d[K.pendingRemovals] && typeof d[K.pendingRemovals] === "object" ? d[K.pendingRemovals] : null;
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
  if (typeof pendingRemovals === "object" && pendingRemovals[host] && pendingRemovals[host] > Date.now()) {
    setStatus("Já há remoção agendada — anule primeiro se quiseres alterar o pedido.", false);
    return;
  }
  const m = { ...(typeof pendingRemovals === "object" && pendingRemovals ? pendingRemovals : {}) };
  m[host] = Date.now() + COOLDOWN_MS;
  setStatus("Remoção agendada. O sítio continua bloqueado durante o intervalo; podes anular a qualquer momento.", true);
  try {
    await chrome.storage.local.set({ [K.pendingRemovals]: m });
    await reschedule();
    await load();
  } catch (e) {
    setStatus("Erro: " + (e && e.message), false);
  }
}

async function cancelRemoval(host) {
  const m = { ...(typeof pendingRemovals === "object" && pendingRemovals ? pendingRemovals : {}) };
  delete m[host];
  const out = Object.keys(m).length ? m : null;
  setStatus("Remoção de " + host + " anulada. O sítio continua na lista de bloqueio.", true);
  try {
    await chrome.storage.local.set({ [K.pendingRemovals]: out });
    await reschedule();
    await load();
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
    setStatus("Este sítio já está na lista.", false);
    return;
  }
  if (domains.length >= 5000) {
    setStatus("Limite de 5000 sítios (limite de regras do Chrome).", false);
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
      await reschedule();
      await load();
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
      setStatus(
        "A agendar desativação. O bloqueio mantém-se ativo 5 minutos; podes anular enquanto o contador correr.",
        true
      );
      try {
        const end = Date.now() + COOLDOWN_MS;
        await chrome.storage.local.set({ [K.pendingDisableAt]: end });
        input.checked = true;
        await reschedule();
        await load();
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
  await reschedule();
  await load();
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
      c[K.pendingRemovals])
  ) {
    void load();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  void load();
});
