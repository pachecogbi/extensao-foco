/** Teto de regras dinâmicas (Manifest V3 / Chromium). */
const DNR_MAX_DYNAMIC_RULES = 5000;
const REBUILD_DEBOUNCE_MS = 200;
const ALARM_PENDING = "foco-apply-pending";
const K_COOLDOWN_MIN = "pendingCooldownMinutes";

const STORAGE = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats"
};

/** Fim (epoch ms) a partir do qual a extensão fica de facto desligada, ou `null` / omitido. */
const K_PENDING_DISABLE_AT = "pendingDisableAt";
/** { "domínio": epochMsFim } — remoção aplica nessa hora. */
const K_PENDING_REMOVALS = "pendingRemovals";
const K_TAB_LIMIT_ENABLED = "tabLimitEnabled";
const K_TAB_LIMIT_MAX = "tabLimitMax";
const K_PENDING_TAB_LIMIT_DISABLE_AT = "pendingTabLimitDisableAt";

/** `Record<host, minutos (1..1440) por dia>`. Não exige o site na lista de bloqueio manual. */
const K_SITE_TIME_LIMITS = "siteTimeLimits";
/** `Record<host, { day, usedMs }>` — dia no fuso local `YYYY-M-D` */
const K_SITE_TIME_USAGE = "siteTimeUsage";
/**
 * Início (epoch ms) do período ainda por somar a `used` para o host, enquanto há aba a corresponder; persistente.
 * Só usado com extensão em runtime (mesmo S.W. a reiniciar, evita atribuir tudo a um `delta` global com abas abertas).
 */
const K_SITE_TIME_ACCRUE_SINCE = "siteTimeAccrueSinceByHost";
const ALARM_SITE_TIME = "foco-site-time-usage";

const LIM_TABS_MIN = 2;
const LIM_TABS_MAX_CAP = 100;

const RES_TYPES = Object.freeze(["main_frame", "sub_frame"]);

const SITE_TIME_MINS_MIN = 1;
const SITE_TIME_MINS_MAX = 24 * 60;

/**
 * @returns {string} Chave do dia local, ex. "2026-04-27"
 */
function localDayKey() {
  const d = new Date();
  return (
    d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0")
  );
}

/**
 * @param {string | null} tabHost
 * @param {string} limitHost
 * @returns {boolean}
 */
function hostMatchesTimeLimitHost(tabHost, limitHost) {
  if (!tabHost || !limitHost) return false;
  const t = tabHost.toLowerCase();
  const h = limitHost.toLowerCase();
  if (h === t) return true;
  return t === h || t.endsWith("." + h);
}

/**
 * @param {chrome.tabs.Tab} tab
 * @returns {string | null}
 */
function hostnameFromTab(tab) {
  const u = tab && tab.url;
  if (!u || typeof u !== "string" || u.startsWith("chrome") || u.startsWith("edge") || u.startsWith("about:") || u.startsWith("file:") || u.startsWith("extension:") || u.startsWith("brave://")) {
    return null;
  }
  if (!u.startsWith("http:") && !u.startsWith("https:")) {
    return null;
  }
  try {
    return new URL(u).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * @param {import("chrome").tabs.Tab[]} tabs
 * @param {string} limitHost
 * @returns {boolean}
 */
function hasOpenTabForTimeHost(tabs, limitHost) {
  for (const t of tabs) {
    const h = hostnameFromTab(t);
    if (h && hostMatchesTimeLimitHost(h, limitHost)) return true;
  }
  return false;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, number>}
 */
function normalizeTimeLimitsObject(raw) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const k of Object.keys(/** @type {Record<string, unknown>} */ (raw))) {
    const hn = normalizeToHost(k);
    if (!hn) continue;
    const v = raw[/** @type {keyof typeof raw} */ (k)];
    const n = typeof v === "number" ? v : parseInt(String(v), 10);
    if (!Number.isFinite(n)) continue;
    const m = Math.floor(n);
    if (m < SITE_TIME_MINS_MIN) continue;
    if (m > SITE_TIME_MINS_MAX) continue;
    out[hn] = m;
  }
  return out;
}

/**
 * @param {string} day
 * @param {Record<string, number>} limits
 * @param {Record<string, { day: string, usedMs: number } | unknown>} usage
 * @returns {string[]}
 */
function hostsExhaustedToday(day, limits, usage) {
  const out = [];
  for (const h of Object.keys(limits)) {
    const capMin = limits[h];
    if (!Number.isFinite(capMin) || capMin <= 0) continue;
    const capMs = capMin * 60 * 1000;
    const u = usage && typeof usage === "object" && usage[/** @type {keyof usage} */ (h)];
    const o = u && typeof u === "object" && !Array.isArray(u) ? u : null;
    const d = o && o.day;
    const used = o && typeof o.usedMs === "number" ? o.usedMs : 0;
    if (d === day && used >= capMs) out.push(h);
  }
  return out;
}

/**
 * Ajusta o uso por site ao dia; persiste; actualiza início de segmento; bloqueia ao atingir teto.
 * @returns {Promise<void>}
 */
async function accrueSiteTimeAndMaybeRebuild() {
  const s = await chrome.storage.local.get([
    K_SITE_TIME_LIMITS,
    K_SITE_TIME_USAGE,
    K_SITE_TIME_ACCRUE_SINCE
  ]);
  const limits = normalizeTimeLimitsObject(s[K_SITE_TIME_LIMITS]);
  const now = Date.now();
  const day = localDayKey();
  /** @type {Record<string, { day: string, usedMs: number }>} */
  const usage = { ...(s[K_SITE_TIME_USAGE] && typeof s[K_SITE_TIME_USAGE] === "object" && !Array.isArray(s[K_SITE_TIME_USAGE]) ? s[K_SITE_TIME_USAGE] : {}) };
  const accrSince =
    s[K_SITE_TIME_ACCRUE_SINCE] && typeof s[K_SITE_TIME_ACCRUE_SINCE] === "object" && !Array.isArray(s[K_SITE_TIME_ACCRUE_SINCE])
      ? { ...s[K_SITE_TIME_ACCRUE_SINCE] }
      : /** @type {Record<string, number>} */ ({});

  const timeHosts = Object.keys(limits);
  if (timeHosts.length === 0) {
    if (Object.keys(usage).length) {
      await chrome.storage.local.set({ [K_SITE_TIME_USAGE]: {} });
    }
    await chrome.storage.local.set({ [K_SITE_TIME_ACCRUE_SINCE]: null });
    void scheduleRebuild();
    return;
  }

  for (const h of timeHosts) {
    if (!usage[h] || usage[h].day !== day) {
      usage[h] = { day, usedMs: 0 };
      if (accrSince[h] != null && typeof accrSince[h] === "number") {
        accrSince[h] = now;
      }
    }
  }

  const tabs = await chrome.tabs.query({});
  /** @type {Record<string, boolean>} */
  const open = {};
  for (const h of timeHosts) {
    open[h] = hasOpenTabForTimeHost(tabs, h);
  }

  for (const h of timeHosts) {
    const capM = limits[h];
    const capMs = capM * 60 * 1000;
    if (!open[h]) {
      if (accrSince[h] != null && typeof accrSince[h] === "number" && usage[h] && usage[h].day === day) {
        const delta = Math.max(0, now - accrSince[h]);
        const next = (usage[h].usedMs || 0) + delta;
        usage[h] = { day, usedMs: Math.min(next, capMs) };
        delete accrSince[h];
      }
    } else {
      const start = accrSince[h];
      if (typeof start === "number" && usage[h] && usage[h].day === day) {
        const delta = Math.max(0, now - start);
        const next = (usage[h].usedMs || 0) + delta;
        usage[h] = { day, usedMs: Math.min(next, capMs) };
        accrSince[h] = now;
      } else {
        accrSince[h] = now;
      }
    }
  }

  for (const h of Object.keys(usage)) {
    if (limits[h] == null) {
      delete usage[h];
    }
  }
  for (const h of Object.keys(accrSince)) {
    if (limits[h] == null) {
      delete accrSince[h];
    }
  }

  await chrome.storage.local.set({
    [K_SITE_TIME_USAGE]: usage,
    [K_SITE_TIME_ACCRUE_SINCE]: Object.keys(accrSince).length > 0 ? accrSince : null
  });
  void scheduleRebuild();
}

let siteTimeDebounce = null;
function requestAccrueSiteTimeDebounced() {
  if (siteTimeDebounce) clearTimeout(siteTimeDebounce);
  siteTimeDebounce = setTimeout(() => {
    siteTimeDebounce = null;
    void accrueSiteTimeAndMaybeRebuild();
  }, 2000);
}

/**
 * Cria o alarme periódico se existirem limites, caso contrário limpa.
 * @returns {Promise<void>}
 */
async function ensureSiteTimeAlarm() {
  const s = await chrome.storage.local.get(K_SITE_TIME_LIMITS);
  const lim = normalizeTimeLimitsObject(s[K_SITE_TIME_LIMITS]);
  if (Object.keys(lim).length === 0) {
    await chrome.alarms.clear(ALARM_SITE_TIME);
    return;
  }
  const a = await chrome.alarms.get(ALARM_SITE_TIME);
  if (!a) {
    await chrome.alarms.create(ALARM_SITE_TIME, { periodInMinutes: 1 });
  }
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function clampTabLimitCount(n) {
  const x = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(x)) return 8;
  return Math.max(LIM_TABS_MIN, Math.min(LIM_TABS_MAX_CAP, Math.floor(x)));
}

/**
 * Garante que o número de abas (em todas as janelas) não excede o limite. Remove as abas abertas mais recentemente.
 * @returns {Promise<void>}
 */
async function enforceTabLimitFromStorage() {
  const s = await chrome.storage.local.get([K_TAB_LIMIT_ENABLED, K_TAB_LIMIT_MAX]);
  if (s[K_TAB_LIMIT_ENABLED] !== true) return;
  const max = clampTabLimitCount(s[K_TAB_LIMIT_MAX]);
  const tabs = await chrome.tabs.query({});
  if (tabs.length <= max) return;
  const byNewest = [...tabs].sort((a, b) => (b.id || 0) - (a.id || 0));
  for (const t of byNewest.slice(0, tabs.length - max)) {
    if (t.id == null) continue;
    try {
      await chrome.tabs.remove(t.id);
    } catch {
      /* aba já fechada */
    }
  }
}

/**
 * @param {chrome.tabs.Tab} tab
 */
function onTabCreatedForTabLimit(tab) {
  if (!tab || tab.id == null) return;
  void (async () => {
    const s = await chrome.storage.local.get([K_TAB_LIMIT_ENABLED, K_TAB_LIMIT_MAX]);
    if (s[K_TAB_LIMIT_ENABLED] !== true) return;
    const max = clampTabLimitCount(s[K_TAB_LIMIT_MAX]);
    const all = await chrome.tabs.query({});
    if (all.length > max) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* ignorar */
      }
    }
  })();
}

chrome.tabs.onCreated.addListener((tab) => {
  onTabCreatedForTabLimit(tab);
  requestAccrueSiteTimeDebounced();
});
chrome.tabs.onUpdated.addListener(() => {
  requestAccrueSiteTimeDebounced();
});
chrome.tabs.onRemoved.addListener(() => {
  requestAccrueSiteTimeDebounced();
});
chrome.tabs.onActivated.addListener(() => {
  requestAccrueSiteTimeDebounced();
});

let rebuildTimer = null;
let rebuildDnrQueue = Promise.resolve();

function makeBlockRedirectRule(id, host) {
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/ui/blocked/blocked.html" }
    },
    condition: {
      urlFilter: "||" + host + "^",
      isUrlFilterCaseSensitive: false,
      resourceTypes: [...RES_TYPES]
    }
  };
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

function sortHosts(h) {
  return [...h].sort((a, b) => a.localeCompare(b));
}

async function getAllExtensionDynamicRuleIds() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.map((r) => r.id);
}

function rebuildFromStorage() {
  return new Promise((resolve, reject) => {
    rebuildDnrQueue = rebuildDnrQueue
      .catch(() => {})
      .then(() => rebuildFromStorageImpl().then(resolve, reject));
  });
}

async function rebuildFromStorageImpl() {
  const s = await chrome.storage.local.get([STORAGE.blockingEnabled, STORAGE.userDomains, K_SITE_TIME_LIMITS, K_SITE_TIME_USAGE]);
  const blocking = s[STORAGE.blockingEnabled] !== false;
  const userRaw = s[STORAGE.userDomains];
  const user = sortHosts(
    Array.from(new Set((userRaw || []).map(normalizeToHost).filter(Boolean)))
  );
  const limits = normalizeTimeLimitsObject(s[K_SITE_TIME_LIMITS]);
  const day = localDayKey();
  const uRaw = s[K_SITE_TIME_USAGE] && typeof s[K_SITE_TIME_USAGE] === "object" && !Array.isArray(s[K_SITE_TIME_USAGE]) ? s[K_SITE_TIME_USAGE] : {};
  const exhausted = hostsExhaustedToday(day, limits, /** @type {Record<string, { day: string, usedMs: number } | unknown>} */ (uRaw));
  const toBlock = new Set();
  if (blocking) {
    for (const h of user) toBlock.add(h);
  }
  for (const h of exhausted) toBlock.add(h);
  const blockList = sortHosts([...toBlock]);

  const remove = await getAllExtensionDynamicRuleIds();
  const toAdd = [];
  if (blockList.length === 0) {
    if (remove.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove });
    }
    await chrome.storage.local.set({
      [STORAGE.lastRebuildStats]: { applied: 0, cap: DNR_MAX_DYNAMIC_RULES, ts: Date.now() }
    });
    return { applied: 0, cap: DNR_MAX_DYNAMIC_RULES, missed: 0 };
  }
  const cap = DNR_MAX_DYNAMIC_RULES;
  let n = 1;
  for (const host of blockList) {
    if (n > cap) break;
    toAdd.push(makeBlockRedirectRule(n, host));
    n += 1;
  }
  if (remove.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove });
  }
  if (toAdd.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: toAdd });
  }
  const applied = toAdd.length;
  const missed = blockList.length - applied;
  if (missed > 0) {
    await chrome.storage.local.set({
      listTruncated: { userMissed: missed }
    });
  } else {
    await chrome.storage.local.set({ listTruncated: null });
  }
  await chrome.storage.local.set({
    [STORAGE.lastRebuildStats]: { applied, cap, ts: Date.now() }
  });
  return { applied, cap, missed };
}

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuildFromStorage();
  }, REBUILD_DEBOUNCE_MS);
}

/**
 * Aplica desligar extensão e/ou remoções de site cuja data já passou, depois regras DNR.
 */
async function processPendingIfDue() {
  const d = await chrome.storage.local.get([
    STORAGE.blockingEnabled,
    STORAGE.userDomains,
    K_PENDING_DISABLE_AT,
    K_PENDING_REMOVALS,
    K_PENDING_TAB_LIMIT_DISABLE_AT
  ]);
  const now = Date.now();
  const patch = {};
  if (d[K_PENDING_DISABLE_AT] && typeof d[K_PENDING_DISABLE_AT] === "number" && d[K_PENDING_DISABLE_AT] <= now) {
    patch[STORAGE.blockingEnabled] = false;
    patch[K_PENDING_DISABLE_AT] = null;
  }
  if (
    d[K_PENDING_TAB_LIMIT_DISABLE_AT] &&
    typeof d[K_PENDING_TAB_LIMIT_DISABLE_AT] === "number" &&
    d[K_PENDING_TAB_LIMIT_DISABLE_AT] <= now
  ) {
    patch[K_TAB_LIMIT_ENABLED] = false;
    patch[K_PENDING_TAB_LIMIT_DISABLE_AT] = null;
  }
  let u = sortHosts(
    Array.from(new Set((d[STORAGE.userDomains] || []).map(normalizeToHost).filter(Boolean)))
  );
  const pr = d[K_PENDING_REMOVALS] && typeof d[K_PENDING_REMOVALS] === "object" ? { ...d[K_PENDING_REMOVALS] } : {};
  let removalsApplied = false;
  for (const h of Object.keys(pr)) {
    if (typeof pr[h] === "number" && pr[h] <= now) {
      u = u.filter((x) => x !== h);
      delete pr[h];
      removalsApplied = true;
    }
  }
  if (removalsApplied) {
    patch[STORAGE.userDomains] = u;
    patch[K_PENDING_REMOVALS] = Object.keys(pr).length > 0 ? pr : null;
  }
  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
  await scheduleNextPendingAlarm();
  void rebuildFromStorage();
}

/**
 * Limpa a extensão de alarm e agenda o próximo instante a verificar, ou nada a agendar.
 */
async function scheduleNextPendingAlarm() {
  await chrome.alarms.clear(ALARM_PENDING);
  const d = await chrome.storage.local.get([K_PENDING_DISABLE_AT, K_PENDING_REMOVALS, K_PENDING_TAB_LIMIT_DISABLE_AT]);
  const ends = [];
  if (d[K_PENDING_DISABLE_AT] && typeof d[K_PENDING_DISABLE_AT] === "number" && d[K_PENDING_DISABLE_AT] > Date.now()) {
    ends.push(d[K_PENDING_DISABLE_AT]);
  }
  if (d[K_PENDING_TAB_LIMIT_DISABLE_AT] && typeof d[K_PENDING_TAB_LIMIT_DISABLE_AT] === "number" && d[K_PENDING_TAB_LIMIT_DISABLE_AT] > Date.now()) {
    ends.push(d[K_PENDING_TAB_LIMIT_DISABLE_AT]);
  }
  const m = d[K_PENDING_REMOVALS];
  if (m && typeof m === "object") {
    for (const t of Object.values(m)) {
      if (typeof t === "number" && t > Date.now()) {
        ends.push(t);
      }
    }
  }
  if (ends.length === 0) {
    return;
  }
  const next = Math.min(...ends);
  if (next <= Date.now()) {
    await processPendingIfDue();
    return;
  }
  await chrome.alarms.create(ALARM_PENDING, { when: next });
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_PENDING) {
    void processPendingIfDue();
  } else if (a.name === ALARM_SITE_TIME) {
    void (async () => {
      await accrueSiteTimeAndMaybeRebuild();
      await ensureSiteTimeAlarm();
    })();
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    if (details.reason === "install") {
      await chrome.storage.local.set({
        [STORAGE.blockingEnabled]: false,
        [STORAGE.userDomains]: [],
        [K_PENDING_DISABLE_AT]: null,
        [K_PENDING_REMOVALS]: null,
        [K_COOLDOWN_MIN]: 5,
        [K_TAB_LIMIT_ENABLED]: false,
        [K_TAB_LIMIT_MAX]: 8,
        [K_PENDING_TAB_LIMIT_DISABLE_AT]: null,
        [K_SITE_TIME_LIMITS]: {},
        [K_SITE_TIME_USAGE]: {},
        [K_SITE_TIME_ACCRUE_SINCE]: null
      });
    }
    await processPendingIfDue();
    await accrueSiteTimeAndMaybeRebuild();
    await ensureSiteTimeAlarm();
    await rebuildFromStorage();
    await scheduleNextPendingAlarm();
    await enforceTabLimitFromStorage();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await processPendingIfDue();
    await accrueSiteTimeAndMaybeRebuild();
    await ensureSiteTimeAlarm();
    await scheduleNextPendingAlarm();
    await rebuildFromStorage();
    await enforceTabLimitFromStorage();
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE.blockingEnabled] || changes[STORAGE.userDomains] || changes[K_SITE_TIME_LIMITS]) {
    scheduleRebuild();
  }
  if (changes[K_PENDING_DISABLE_AT] || changes[K_PENDING_REMOVALS] || changes[K_PENDING_TAB_LIMIT_DISABLE_AT]) {
    void scheduleNextPendingAlarm();
  }
  if (changes[K_TAB_LIMIT_ENABLED] || changes[K_TAB_LIMIT_MAX]) {
    void enforceTabLimitFromStorage();
  }
  if (changes[K_SITE_TIME_LIMITS] || changes[K_SITE_TIME_ACCRUE_SINCE]) {
    void ensureSiteTimeAlarm();
  }
});

chrome.runtime.onMessage.addListener((message, _s, sendResponse) => {
  if (message && message.type === "rebuild") {
    void rebuildFromStorage()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (message && message.type === "applyPendingNow") {
    void processPendingIfDue()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (message && message.type === "reschedulePending") {
    void scheduleNextPendingAlarm()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  return false;
});

void (async () => {
  await processPendingIfDue();
  await accrueSiteTimeAndMaybeRebuild();
  await ensureSiteTimeAlarm();
  await scheduleNextPendingAlarm();
  await rebuildFromStorage();
  await enforceTabLimitFromStorage();
})();
