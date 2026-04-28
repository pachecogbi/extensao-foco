const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats",
  siteTimeLimits: "siteTimeLimits",
  siteTimeUsage: "siteTimeUsage"
};

const K = {
  pendingDisableAt: "pendingDisableAt",
  pendingRemovals: "pendingRemovals",
  pendingTimeLimitRemovals: "pendingTimeLimitRemovals"
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
/** @type {Record<string, number> | null} */
let pendingTimeLimitRemovals = null;
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
  const ptl = pendingTimeLimitRemovals || {};
  for (const t of Object.values(ptl)) {
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
  const ptl = pendingTimeLimitRemovals || {};
  document.querySelectorAll("[data-tl-rem-eta-for]").forEach((node) => {
    const h = node.getAttribute("data-tl-rem-eta-for");
    if (!h) return;
    const when = removalEndAt(ptl, h);
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
        "Ao clicar em «Remover (" +
        cooldownMins +
        " min.)», cada site inicia o temporizador nessa duração; contadores por linha, independentes; quando o de um site acaba, só esse é removido.";
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
          "Reforçar a escolha ajuda a manter a concentração. Se ainda tiver certeza, o site deixa de ser bloqueado a seguir — só este, no ritmo dele.";
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
        ca.textContent = "Cancelar remoção";
        ca.setAttribute("aria-label", "Cancelar remoção de " + d);
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
  const remHint = el("timeListRemHint");
  const list = siteTimeLimits && typeof siteTimeLimits === "object" ? siteTimeLimits : {};
  const keys = sortArr(Object.keys(list));
  if (!section || !u || !empty) return;
  if (keys.length === 0) {
    section.hidden = true;
    u.hidden = true;
    empty.hidden = true;
    if (hint) hint.hidden = true;
    if (remHint) remHint.hidden = true;
    return;
  }
  section.hidden = false;
  u.hidden = false;
  empty.hidden = true;
  if (hint) hint.hidden = false;
  if (remHint) {
    remHint.hidden = false;
    remHint.textContent =
      "Ao clicar em «Remover limite (" +
      cooldownMins +
      " min.)», inicia o temporizador (o valor vem de Configurações, ícone de engrenagem); a contagem é por linha; ao fim, só aquele site deixa de ter limite. Pode cancelar a qualquer momento no botão da linha.";
  }
  u.innerHTML = "";
  const m = pendingTimeLimitRemovals || {};
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
    p1.textContent = "Hoje: " + formatDurationMsShort(used) + " de " + maxMin + " min. " + (ex ? " — limite atingido (bloqueio até amanhã)." : "");
    wrap.appendChild(t1);
    wrap.appendChild(p1);
    const endAt = removalEndAt(m, d);
    const now = Date.now();
    const scheduled = endAt != null && endAt > now;
    if (scheduled) {
      const p2 = document.createElement("p");
      p2.className = "pend-note";
      p2.textContent =
        "Reforçar a escolha ajuda a manter o foco. Se ainda tiver a certeza, o site deixa de ter limite de tempo a seguir — só para este endereço.";
      const rowTimer = document.createElement("div");
      rowTimer.className = "site-cooldown";
      rowTimer.setAttribute("role", "status");
      rowTimer.setAttribute("aria-live", "off");
      const tLabel = document.createElement("span");
      tLabel.className = "site-cooldown-label";
      tLabel.textContent = "Temporizador (só este site)";
      const tVal = document.createElement("span");
      tVal.className = "site-cooldown-digits";
      tVal.setAttribute("data-tl-rem-eta-for", d);
      tVal.textContent = formatRemainingMs(endAt - now);
      rowTimer.appendChild(tLabel);
      rowTimer.appendChild(tVal);
      wrap.appendChild(p2);
      wrap.appendChild(rowTimer);
    }
    li.appendChild(wrap);
    const col = document.createElement("div");
    col.className = "li-btns";
    if (scheduled) {
      const ca = document.createElement("button");
      ca.type = "button";
      ca.className = "btn-pend";
      ca.textContent = "Cancelar remoção do limite";
      ca.setAttribute("aria-label", "Cancelar remoção do limite de " + d);
      ca.addEventListener("click", () => void cancelTimeLimitRemoval(d));
      col.appendChild(ca);
    } else {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-remove";
      b.setAttribute(
        "aria-label",
        "Iniciar remoção do limite de tempo de " + d + " (aguarda " + cooldownMins + " minutos, só para este site)"
      );
      b.textContent = "Remover limite (" + cooldownMins + " min.)";
      b.addEventListener("click", () => {
        void scheduleTimeLimitRemove(d);
      });
      col.appendChild(b);
    }
    li.appendChild(col);
    u.appendChild(li);
  }
  startTick();
}

async function scheduleTimeLimitRemove(host) {
  const key = (host && String(host).toLowerCase()) || "";
  const m = { ...(typeof pendingTimeLimitRemovals === "object" && pendingTimeLimitRemovals ? pendingTimeLimitRemovals : {}) };
  const already = removalEndAt(m, key);
  if (already != null && already > Date.now()) {
    setStatus("Já há remoção de limite agendada — cancele antes se quiser alterar o pedido (este site).", false);
    return;
  }
  const mins = await focoGetPendingCooldownMinutes();
  cooldownMins = mins;
  m[key] = Date.now() + mins * 60 * 1000;
  setStatus(
    String(mins) +
      " min. em contagem para retirar o limite de tempo deste site. Pode cancelar; o teto de tempo mantém-se até o fim.",
    true
  );
  try {
    await chrome.storage.local.set({ [K.pendingTimeLimitRemovals]: m });
    await load();
    fireReschedule();
  } catch (e) {
    setStatus("Erro: " + (e && e.message), false);
  }
}

async function cancelTimeLimitRemoval(host) {
  const key = (host && String(host).toLowerCase()) || "";
  const m = { ...(typeof pendingTimeLimitRemovals === "object" && pendingTimeLimitRemovals ? pendingTimeLimitRemovals : {}) };
  delete m[key];
  for (const k of Object.keys(m)) {
    if (k.toLowerCase() === key) delete m[k];
  }
  const out = Object.keys(m).length ? m : null;
  setStatus("Remoção do limite de tempo de " + host + " cancelada. O teto de minutos continua a aplicar-se.", true);
  try {
    await chrome.storage.local.set({ [K.pendingTimeLimitRemovals]: out });
    await load();
    fireReschedule();
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
    K.pendingTimeLimitRemovals,
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
  pendingTimeLimitRemovals = parsePendingRemovals(d[K.pendingTimeLimitRemovals]);
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
    setStatus("Já há remoção agendada — cancele antes se quiser alterar o pedido.", false);
    return;
  }
  const mins = await focoGetPendingCooldownMinutes();
  cooldownMins = mins;
  m[key] = Date.now() + mins * 60 * 1000;
  setStatus(
    String(mins) +
      " min. em contagem para este site (o tempo vem de Configurações, ícone de engrenagem). Você pode cancelar; o site fica bloqueado até o fim.",
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
  setStatus("Remoção de " + host + " cancelada. O site continua na lista de bloqueio.", true);
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
    setStatus("Não entendemos o endereço. Tente o domínio (ex. exemplo.com).", false);
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
  setStatus("Adicionando…", true);
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
      setStatus("Não entendemos o endereço do site no limite de tempo. Ex.: youtube.com", false);
      return;
    }
    const m = Math.floor(parseInt(String(rawM).trim(), 10));
    if (!Number.isFinite(m) || m < TIME_MINS_MIN || m > TIME_MINS_MAX) {
      setStatus("Indique entre " + TIME_MINS_MIN + " e " + TIME_MINS_MAX + " minutos por dia.", false);
      return;
    }
    if (!siteTimeLimits[h] && Object.keys(siteTimeLimits || {}).length >= 200) {
      setStatus("Limite de 200 entradas (tempo). Remova uma para adicionar outra.", false);
      return;
    }
    const today = localDayKey();
    const oldM = siteTimeLimits[h];
    if (oldM != null && Number.isFinite(oldM) && m > oldM) {
      const urec = siteTimeUsage && siteTimeUsage[h];
      const used = urec && urec.day === today && typeof urec.usedMs === "number" ? urec.usedMs : 0;
      const oldCapMs = oldM * 60 * 1000;
      if (oldCapMs > 0 && used >= oldCapMs) {
        setStatus(
          "Hoje o tempo deste site já chegou ao limite. Não é possível subir o teto (min/dia) até amanhã; pode só baixar ou manter o mesmo limite.",
          false
        );
        return;
      }
    }
    setStatus("Salvando o limite…", true);
    try {
      const next = { ...siteTimeLimits, [h]: m };
      /** @type {Record<string, unknown>} */
      const patch = { [S.siteTimeLimits]: next };
      if (typeof pendingTimeLimitRemovals === "object" && pendingTimeLimitRemovals) {
        const w = removalEndAt(pendingTimeLimitRemovals, h);
        if (w != null && w > Date.now()) {
          const ptr = { ...pendingTimeLimitRemovals };
          for (const k of Object.keys(ptr)) {
            if (k.toLowerCase() === h) delete ptr[k];
          }
          patch[K.pendingTimeLimitRemovals] = Object.keys(ptr).length > 0 ? ptr : null;
        }
      }
      await chrome.storage.local.set(/** @type {Record<string, unknown>} */ (patch));
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
    setStatus("Desativação cancelada. A extensão mantém o bloqueio ativo.", true);
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
        setStatus("Já existe uma desativação em contagem. Cancele antes se quiser alterar.", false);
        input.checked = true;
        return;
      }
        setStatus("Agendando desativação…", true);
      try {
        const mins = await focoGetPendingCooldownMinutes();
        cooldownMins = mins;
        setStatus(
          "O bloqueio continua ativo por " + mins + " min.; você pode cancelar a qualquer momento. (Tempo definido em Configurações.)",
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
  setStatus("Bloqueio ativado; qualquer desativação pendente foi descartada.", true);
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
      c[K.pendingTimeLimitRemovals] ||
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
