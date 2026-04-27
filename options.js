const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats",
  siteTimeLimits: "siteTimeLimits",
  siteTimeUsage: "siteTimeUsage"
};

const K = {
  pendingDisableAt: "pendingDisableAt",
  pendingRemovals: "pendingRemovals"
};

const K_SITE_ACCR = "siteTimeAccrueSinceByHost";
const TIME_MINS_MAX = 24 * 60;
const TIME_MINS_MIN = 1;

const el = (id) => document.getElementById(id);

/**
 * @returns {string} Chave do dia local (YYYY-MM-DD)
 */
function localDayKey() {
  const d = new Date();
  return (
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
  );
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDurationMsShort(ms) {
  if (ms < 0 || !Number.isFinite(ms)) ms = 0;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return m + " min " + s + " s";
}

let domains = [];
let siteTimeLimits = /** @type {Record<string, number>} */ ({});
let siteTimeUsage = /** @type {Record<string, { day: string, usedMs: number }>} */ ({});
let cooldownMins = 5;
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
 * @param {unknown} raw
 * @returns {Record<string, number>}
 */
function normalizeTimeLimitsPage(raw) {
  /** @type {Record<string, number>} */
  const o = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
  for (const k of Object.keys(/** @type {Record<string, unknown>} */ (raw))) {
    const h = normalizeToHost(k);
    if (!h) continue;
    const v = raw[/** @type {keyof typeof raw} */ (k)];
    const n = Math.floor(typeof v === "number" ? v : parseInt(String(v), 10));
    if (!Number.isFinite(n) || n < TIME_MINS_MIN || n > TIME_MINS_MAX) continue;
    o[h] = n;
  }
  return o;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, { day: string, usedMs: number }>}
 */
function parseTimeUsagePage(raw) {
  /** @type {Record<string, { day: string, usedMs: number }>} */
  const o = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return o;
  for (const k of Object.keys(/** @type {Record<string, unknown>} */ (raw))) {
    const h = (k && String(k).toLowerCase()) || "";
    if (!h) continue;
    const v = raw[/** @type {keyof typeof raw} */ (k)];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const day = v.day;
    const used = v.usedMs;
    if (typeof day === "string" && typeof used === "number" && Number.isFinite(used)) {
      o[h] = { day, usedMs: used };
    }
  }
  return o;
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

function hasAnyPending() {
  if (pendingDisableAt && pendingDisableAt > Date.now()) return true;
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
  if (box) {
    if (pendingDisableAt && typeof pendingDisableAt === "number" && pendingDisableAt > Date.now()) {
      box.hidden = false;
      if (cDown) cDown.textContent = formatRemainingMs(pendingDisableAt - Date.now());
    } else {
      box.hidden = true;
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

/**
 * @returns {void}
 */
function renderTimeLimits() {
  const section = el("listTimeLimit");
  const u = el("timeListEl");
  const empty = el("emptyTimeList");
  const hint = el("timeLimitHint");
  const list = siteTimeLimits && typeof siteTimeLimits === "object" ? siteTimeLimits : {};
  const keys = sortArr(Object.keys(list));
  if (!section || !u || !empty) return;
  if (keys.length === 0) {
    section.hidden = true;
    u.hidden = true;
    empty.hidden = true;
    if (hint) hint.hidden = true;
    return;
  }
  section.hidden = false;
  u.hidden = false;
  empty.hidden = true;
  if (hint) hint.hidden = false;
  u.innerHTML = "";
  const today = localDayKey();
  for (const d of keys) {
    const maxMin = list[d] != null ? list[d] : 0;
    const capMs = maxMin * 60 * 1000;
    const urec = siteTimeUsage[d];
    const used = urec && urec.day === today && typeof urec.usedMs === "number" ? urec.usedMs : 0;
    const ex = urec && urec.day === today && used >= capMs;

    const li = document.createElement("li");
    li.setAttribute("role", "listitem");
    const wrap = document.createElement("div");
    wrap.className = "dname-wrap";
    const t1 = document.createElement("span");
    t1.className = "dname";
    t1.textContent = d;
    const p1 = document.createElement("p");
    p1.className = "pend-note";
    p1.style.marginTop = "0.25rem";
    p1.textContent = "Hoje: " + formatDurationMsShort(used) + " de " + maxMin + " min. " + (ex ? " — limite alcançado (bloqueio até amanhã)." : "");
    wrap.appendChild(t1);
    wrap.appendChild(p1);
    li.appendChild(wrap);
    const col = document.createElement("div");
    col.className = "li-btns";
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-remove";
    b.setAttribute("aria-label", "Remover limite de " + d);
    b.textContent = "Remover limite";
    b.addEventListener("click", () => void removeTimeLimit(d));
    col.appendChild(b);
    li.appendChild(col);
    u.appendChild(li);
  }
}

/**
 * @param {string} host
 */
async function removeTimeLimit(host) {
  const h = (host && String(host).toLowerCase()) || "";
  if (!h) return;
  const lim = { ...siteTimeLimits };
  delete lim[h];
  for (const k of Object.keys(lim)) {
    if (k.toLowerCase() === h) delete lim[k];
  }
  const u = { ...siteTimeUsage };
  delete u[h];
  for (const k of Object.keys(u)) {
    if (k.toLowerCase() === h) delete u[k];
  }
  const st = await chrome.storage.local.get(K_SITE_ACCR);
  const accr = st[K_SITE_ACCR] && typeof st[K_SITE_ACCR] === "object" && !Array.isArray(st[K_SITE_ACCR]) ? { ...st[K_SITE_ACCR] } : {};
  delete accr[h];
  for (const k of Object.keys(accr)) {
    if (k.toLowerCase() === h) delete accr[k];
  }
  try {
    await chrome.storage.local.set({
      [S.siteTimeLimits]: Object.keys(lim).length > 0 ? lim : {},
      [S.siteTimeUsage]: u,
      [K_SITE_ACCR]: Object.keys(accr).length > 0 ? accr : null
    });
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "rebuild" }, () => resolve());
    });
    await load();
    setStatus("Limite de tempo removido: " + host, true);
  } catch (e) {
    setStatus("Erro: " + (e && e.message), false);
  }
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
    "pendingCooldownMinutes",
    S.siteTimeLimits,
    S.siteTimeUsage
  ]);
  cooldownMins = await focoGetPendingCooldownMinutes();
  el("blockingEnabled").checked = d[S.blockingEnabled] !== false;
  const raw = d[S.userDomains];
  domains = sortArr(Array.isArray(raw) ? raw : []);
  pendingDisableAt = typeof d[K.pendingDisableAt] === "number" ? d[K.pendingDisableAt] : null;
  pendingRemovals = parsePendingRemovals(d[K.pendingRemovals]);
  siteTimeLimits = normalizeTimeLimitsPage(d[S.siteTimeLimits]);
  siteTimeUsage = parseTimeUsagePage(d[S.siteTimeUsage]);
  render();
  updatePendingUi();
  renderTimeLimits();
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

el("formTimeLimit")?.addEventListener("submit", (e) => {
  e.preventDefault();
  void (async () => {
    const v = (el("timeLimitDomain") && el("timeLimitDomain").value) || "";
    const rawM = (el("timeLimitMins") && el("timeLimitMins").value) || "";
    const h = normalizeToHost(v.trim());
    if (!h) {
      setStatus("Não percebemos o endereço do site para o limite de tempo. Ex.: youtube.com", false);
      return;
    }
    const m = Math.floor(parseInt(String(rawM).trim(), 10));
    if (!Number.isFinite(m) || m < TIME_MINS_MIN || m > TIME_MINS_MAX) {
      setStatus("Indica entre " + TIME_MINS_MIN + " e " + TIME_MINS_MAX + " minutos por dia.", false);
      return;
    }
    if (Object.keys(siteTimeLimits || {}).length >= 200) {
      setStatus("Limite de 200 entradas (tempo). Remove uma para adicionar outra.", false);
      return;
    }
    setStatus("A guardar o limite…", true);
    try {
      const next = { ...siteTimeLimits, [h]: m };
      await chrome.storage.local.set({ [S.siteTimeLimits]: next });
      if (el("timeLimitDomain")) el("timeLimitDomain").value = "";
      if (el("timeLimitMins")) el("timeLimitMins").value = "60";
      await new Promise((r) => {
        chrome.runtime.sendMessage({ type: "rebuild" }, () => r());
      });
      await load();
      setStatus("Limite: " + h + " — " + m + " min por dia. O tempo conta com abas abertas.", true);
    } catch (e) {
      setStatus("Erro: " + (e && e.message), false);
    }
  })();
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
      c[S.siteTimeLimits] ||
      c[S.siteTimeUsage] ||
      c.siteTimeAccrueSinceByHost)
  ) {
    void load();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  void load();
});
