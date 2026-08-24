importScripts("../lib/foco-core.js");

/* global FocoCore */

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
/** { "host": epochMsFim } — remoção do *limite de tempo* aplica nessa hora. */
const K_PENDING_TIME_LIMIT_REMOVALS = "pendingTimeLimitRemovals";
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
const ALARM_FOCUS_SESSION = "foco-focus-session-end";
const ALARM_ALLOWANCE = "foco-mindful-allowance-end";

const K_FOCUS_SESSION = "focusSession";
const K_FOCUS_HISTORY = "focusHistory";
const K_DAILY_STATS = "dailyStats";
const K_DAILY_GOAL = "dailyFocusGoalMinutes";
const K_TEMP_ALLOWANCES = "temporaryAllowances";
const K_SCHEMA_VERSION = "schemaVersion";
const SCHEMA_VERSION = 3;

const LIM_TABS_MIN = 2;
const LIM_TABS_MAX_CAP = 100;

const RES_TYPES = Object.freeze(["main_frame", "sub_frame"]);

const SITE_TIME_MINS_MIN = 1;
const SITE_TIME_MINS_MAX = 24 * 60;
let statsMutationQueue = Promise.resolve();

function enqueueStatsMutation(work) {
  const next = statsMutationQueue.catch(() => {}).then(work);
  statsMutationQueue = next.catch(() => {});
  return next;
}

/**
 * @returns {string} Chave do dia local, ex. "2026-04-27"
 */
function localDayKey() {
  return FocoCore.localDayKey();
}

/**
 * @param {string | null} tabHost
 * @param {string} limitHost
 * @returns {boolean}
 */
function hostMatchesTimeLimitHost(tabHost, limitHost) {
  return FocoCore.hostMatches(tabHost, limitHost);
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
 * Ajusta o uso por site ao dia; persiste; atualiza início de segmento; bloqueia ao atingir teto.
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
      // Mantém uso do dia ao remover o limite e readicionar no mesmo dia (não recomeçar a contagem).
      if (usage[h] && usage[h].day === day) continue;
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
  const s = await chrome.storage.local.get([K_TAB_LIMIT_ENABLED, K_TAB_LIMIT_MAX, K_FOCUS_SESSION]);
  const session = FocoCore.normalizeSession(s[K_FOCUS_SESSION]);
  const sessionActive = session && session.status === "active" && !session.expired;
  if (s[K_TAB_LIMIT_ENABLED] !== true && !sessionActive) return;
  const configuredMax = clampTabLimitCount(s[K_TAB_LIMIT_MAX]);
  const max = sessionActive ? Math.min(configuredMax, session.sessionTabLimit) : configuredMax;
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
    const s = await chrome.storage.local.get([K_TAB_LIMIT_ENABLED, K_TAB_LIMIT_MAX, K_FOCUS_SESSION]);
    const session = FocoCore.normalizeSession(s[K_FOCUS_SESSION]);
    const sessionActive = session && session.status === "active" && !session.expired;
    if (s[K_TAB_LIMIT_ENABLED] !== true && !sessionActive) return;
    const configuredMax = clampTabLimitCount(s[K_TAB_LIMIT_MAX]);
    const max = sessionActive ? Math.min(configuredMax, session.sessionTabLimit) : configuredMax;
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
      redirect: { url: chrome.runtime.getURL("ui/blocked/blocked.html") + "?site=" + encodeURIComponent(host) }
    },
    condition: {
      urlFilter: "||" + host + "^",
      isUrlFilterCaseSensitive: false,
      resourceTypes: [...RES_TYPES]
    }
  };
}

function normalizeToHost(s) {
  return FocoCore.normalizeHost(s);
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
  const s = await chrome.storage.local.get([STORAGE.blockingEnabled, STORAGE.userDomains, K_SITE_TIME_LIMITS, K_SITE_TIME_USAGE, K_FOCUS_SESSION, K_TEMP_ALLOWANCES]);
  const blocking = s[STORAGE.blockingEnabled] !== false;
  const session = FocoCore.normalizeSession(s[K_FOCUS_SESSION]);
  const sessionActive = session && session.status === "active" && !session.expired;
  const allowances = FocoCore.activeAllowances(s[K_TEMP_ALLOWANCES]);
  const userRaw = s[STORAGE.userDomains];
  const user = sortHosts(
    Array.from(new Set((userRaw || []).map(normalizeToHost).filter(Boolean)))
  );
  const limits = normalizeTimeLimitsObject(s[K_SITE_TIME_LIMITS]);
  const day = localDayKey();
  const uRaw = s[K_SITE_TIME_USAGE] && typeof s[K_SITE_TIME_USAGE] === "object" && !Array.isArray(s[K_SITE_TIME_USAGE]) ? s[K_SITE_TIME_USAGE] : {};
  const exhausted = hostsExhaustedToday(day, limits, /** @type {Record<string, { day: string, usedMs: number } | unknown>} */ (uRaw));
  const toBlock = new Set();
  if (blocking || sessionActive) {
    for (const h of user) toBlock.add(h);
  }
  for (const h of exhausted) toBlock.add(h);
  if (!sessionActive) {
    for (const allowedHost of Object.keys(allowances)) {
      for (const blockedHost of [...toBlock]) {
        if (FocoCore.hostMatches(allowedHost, blockedHost) || FocoCore.hostMatches(blockedHost, allowedHost)) {
          toBlock.delete(blockedHost);
        }
      }
    }
  }
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

async function migrateStorage() {
  const data = await chrome.storage.local.get([K_SCHEMA_VERSION, K_DAILY_GOAL, K_FOCUS_HISTORY, K_DAILY_STATS, K_TEMP_ALLOWANCES]);
  if ((Number(data[K_SCHEMA_VERSION]) || 0) >= SCHEMA_VERSION) return;
  const patch = { [K_SCHEMA_VERSION]: SCHEMA_VERSION };
  if (data[K_DAILY_GOAL] == null) patch[K_DAILY_GOAL] = 50;
  if (!Array.isArray(data[K_FOCUS_HISTORY])) patch[K_FOCUS_HISTORY] = [];
  if (!data[K_DAILY_STATS] || typeof data[K_DAILY_STATS] !== "object") patch[K_DAILY_STATS] = {};
  if (!data[K_TEMP_ALLOWANCES] || typeof data[K_TEMP_ALLOWANCES] !== "object") patch[K_TEMP_ALLOWANCES] = {};
  await chrome.storage.local.set(patch);
}

async function updateActionBadge(sessionRaw) {
  const session = FocoCore.normalizeSession(sessionRaw);
  if (!session || session.status !== "active" || session.expired) {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: "#5f8f78" });
  await chrome.action.setBadgeText({ text: "ON" });
}

async function scheduleFocusAlarm(sessionRaw) {
  await chrome.alarms.clear(ALARM_FOCUS_SESSION);
  const session = FocoCore.normalizeSession(sessionRaw);
  if (!session || session.status !== "active") {
    await updateActionBadge(null);
    return;
  }
  if (session.endsAt <= Date.now()) {
    await finishFocusSession("completed");
    return;
  }
  await chrome.alarms.create(ALARM_FOCUS_SESSION, { when: session.endsAt });
  await updateActionBadge(session);
}

function finishFocusSession(outcome) {
  return enqueueStatsMutation(() => finishFocusSessionImpl(outcome));
}

async function finishFocusSessionImpl(outcome) {
  const data = await chrome.storage.local.get([K_FOCUS_SESSION, K_FOCUS_HISTORY, K_DAILY_STATS]);
  const session = FocoCore.normalizeSession(data[K_FOCUS_SESSION]);
  if (!session || session.status !== "active") return { ok: false, reason: "no-active-session" };
  const entry = FocoCore.finishSession(session, outcome, Date.now());
  if (!entry) return { ok: false, reason: "invalid-session" };
  const day = FocoCore.localDayKey(entry.startedAt);
  const dailyStats = FocoCore.addDailyMetric(data[K_DAILY_STATS], day, {
    focusMinutes: entry.focusedMinutes,
    sessionsCompleted: entry.outcome === "completed" ? 1 : 0,
    sessionsAbandoned: entry.outcome === "abandoned" ? 1 : 0
  });
  await chrome.storage.local.set({
    [K_FOCUS_SESSION]: null,
    [K_FOCUS_HISTORY]: FocoCore.appendHistory(data[K_FOCUS_HISTORY], entry),
    [K_DAILY_STATS]: dailyStats
  });
  await chrome.alarms.clear(ALARM_FOCUS_SESSION);
  await updateActionBadge(null);
  await rebuildFromStorage();
  await enforceTabLimitFromStorage();
  return { ok: true, entry };
}

async function startFocusSession(input) {
  const data = await chrome.storage.local.get(K_FOCUS_SESSION);
  const existing = FocoCore.normalizeSession(data[K_FOCUS_SESSION]);
  if (existing && existing.status === "active" && !existing.expired) {
    return { ok: false, reason: "session-already-active", session: existing };
  }
  if (existing && existing.expired) await finishFocusSession("completed");
  const session = FocoCore.createSession(input || {}, Date.now());
  await chrome.storage.local.set({ [K_FOCUS_SESSION]: session });
  await scheduleFocusAlarm(session);
  await rebuildFromStorage();
  await enforceTabLimitFromStorage();
  return { ok: true, session };
}

function recordBlockedAttempt(hostValue) {
  return enqueueStatsMutation(() => recordBlockedAttemptImpl(hostValue));
}

async function recordBlockedAttemptImpl(hostValue) {
  const host = normalizeToHost(hostValue) || "desconhecido";
  const data = await chrome.storage.local.get([K_DAILY_STATS, "blockedAttemptsByHost"]);
  const day = localDayKey();
  const byHost = data.blockedAttemptsByHost && typeof data.blockedAttemptsByHost === "object" ? { ...data.blockedAttemptsByHost } : {};
  const todayHosts = byHost[day] && typeof byHost[day] === "object" ? { ...byHost[day] } : {};
  todayHosts[host] = Math.max(0, Number(todayHosts[host]) || 0) + 1;
  byHost[day] = todayHosts;
  for (const key of Object.keys(byHost).sort().slice(0, -30)) delete byHost[key];
  const stats = FocoCore.addDailyMetric(data[K_DAILY_STATS], day, { blockedAttempts: 1 });
  await chrome.storage.local.set({ [K_DAILY_STATS]: stats, blockedAttemptsByHost: byHost });
  return { ok: true, count: todayHosts[host] };
}

async function scheduleAllowanceAlarm(allowancesRaw) {
  await chrome.alarms.clear(ALARM_ALLOWANCE);
  const allowances = FocoCore.activeAllowances(allowancesRaw);
  const ends = Object.values(allowances);
  if (ends.length) await chrome.alarms.create(ALARM_ALLOWANCE, { when: Math.min(...ends) });
}

function grantMindfulAllowance(hostValue, minutes) {
  return enqueueStatsMutation(() => grantMindfulAllowanceImpl(hostValue, minutes));
}

async function grantMindfulAllowanceImpl(hostValue, minutes) {
  const host = normalizeToHost(hostValue);
  if (!host) return { ok: false, reason: "invalid-host" };
  const data = await chrome.storage.local.get([K_FOCUS_SESSION, K_TEMP_ALLOWANCES, K_DAILY_STATS]);
  const session = FocoCore.normalizeSession(data[K_FOCUS_SESSION]);
  if (session && session.status === "active" && !session.expired) return { ok: false, reason: "focus-session-active" };
  const allowances = FocoCore.activeAllowances(data[K_TEMP_ALLOWANCES]);
  const until = Date.now() + FocoCore.clampInt(minutes, 1, 15, 5) * 60000;
  allowances[host] = until;
  const stats = FocoCore.addDailyMetric(data[K_DAILY_STATS], localDayKey(), { mindfulPauses: 1 });
  await chrome.storage.local.set({ [K_TEMP_ALLOWANCES]: allowances, [K_DAILY_STATS]: stats });
  await scheduleAllowanceAlarm(allowances);
  await rebuildFromStorage();
  return { ok: true, until, host };
}

async function clearExpiredAllowances() {
  const data = await chrome.storage.local.get(K_TEMP_ALLOWANCES);
  const active = FocoCore.activeAllowances(data[K_TEMP_ALLOWANCES]);
  await chrome.storage.local.set({ [K_TEMP_ALLOWANCES]: active });
  await scheduleAllowanceAlarm(active);
  await rebuildFromStorage();
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
    K_PENDING_TAB_LIMIT_DISABLE_AT,
    K_PENDING_TIME_LIMIT_REMOVALS,
    K_SITE_TIME_LIMITS,
    K_SITE_TIME_USAGE,
    K_SITE_TIME_ACCRUE_SINCE
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
  const ptr0 = d[K_PENDING_TIME_LIMIT_REMOVALS];
  const ptime = ptr0 && typeof ptr0 === "object" && !Array.isArray(ptr0) ? { ...ptr0 } : {};
  let timeLimitRemovalApplied = false;
  const limT = normalizeTimeLimitsObject(d[K_SITE_TIME_LIMITS]);
  const usageT =
    d[K_SITE_TIME_USAGE] && typeof d[K_SITE_TIME_USAGE] === "object" && !Array.isArray(d[K_SITE_TIME_USAGE]) ? { ...d[K_SITE_TIME_USAGE] } : {};
  const accrT =
    d[K_SITE_TIME_ACCRUE_SINCE] && typeof d[K_SITE_TIME_ACCRUE_SINCE] === "object" && !Array.isArray(d[K_SITE_TIME_ACCRUE_SINCE]) ? { ...d[K_SITE_TIME_ACCRUE_SINCE] } : {};
  for (const h of Object.keys(ptime)) {
    const when = ptime[h];
    if (typeof when !== "number" || !Number.isFinite(when)) {
      delete ptime[h];
      timeLimitRemovalApplied = true;
      continue;
    }
    if (when > now) continue;
    const hl = h.toLowerCase();
    for (const k of [...Object.keys(limT)]) {
      if (k.toLowerCase() === hl) {
        delete limT[k];
      }
    }
    for (const k of [...Object.keys(accrT)]) {
      if (k.toLowerCase() === hl) {
        delete accrT[k];
      }
    }
    delete ptime[h];
    for (const k of [...Object.keys(ptime)]) {
      if (k.toLowerCase() === hl && k !== h) {
        delete ptime[k];
      }
    }
    timeLimitRemovalApplied = true;
  }
  if (timeLimitRemovalApplied) {
    patch[K_SITE_TIME_LIMITS] = Object.keys(limT).length > 0 ? limT : {};
    patch[K_SITE_TIME_USAGE] = usageT;
    patch[K_SITE_TIME_ACCRUE_SINCE] = Object.keys(accrT).length > 0 ? accrT : null;
    patch[K_PENDING_TIME_LIMIT_REMOVALS] = Object.keys(ptime).length > 0 ? ptime : null;
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
  const d = await chrome.storage.local.get([
    K_PENDING_DISABLE_AT,
    K_PENDING_REMOVALS,
    K_PENDING_TAB_LIMIT_DISABLE_AT,
    K_PENDING_TIME_LIMIT_REMOVALS
  ]);
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
  const ptl = d[K_PENDING_TIME_LIMIT_REMOVALS];
  if (ptl && typeof ptl === "object") {
    for (const t of Object.values(ptl)) {
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
  } else if (a.name === ALARM_FOCUS_SESSION) {
    void finishFocusSession("completed");
  } else if (a.name === ALARM_ALLOWANCE) {
    void clearExpiredAllowances();
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
        [K_PENDING_TIME_LIMIT_REMOVALS]: null,
        [K_COOLDOWN_MIN]: 5,
        [K_TAB_LIMIT_ENABLED]: false,
        [K_TAB_LIMIT_MAX]: 8,
        [K_PENDING_TAB_LIMIT_DISABLE_AT]: null,
        [K_SITE_TIME_LIMITS]: {},
        [K_SITE_TIME_USAGE]: {},
        [K_SITE_TIME_ACCRUE_SINCE]: null,
        [K_FOCUS_SESSION]: null,
        [K_FOCUS_HISTORY]: [],
        [K_DAILY_STATS]: {},
        [K_DAILY_GOAL]: 50,
        [K_TEMP_ALLOWANCES]: {},
        [K_SCHEMA_VERSION]: SCHEMA_VERSION
      });
    }
    await migrateStorage();
    await processPendingIfDue();
    await accrueSiteTimeAndMaybeRebuild();
    await ensureSiteTimeAlarm();
    await rebuildFromStorage();
    await scheduleNextPendingAlarm();
    const current = await chrome.storage.local.get([K_FOCUS_SESSION, K_TEMP_ALLOWANCES]);
    await scheduleFocusAlarm(current[K_FOCUS_SESSION]);
    await scheduleAllowanceAlarm(current[K_TEMP_ALLOWANCES]);
    await enforceTabLimitFromStorage();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await migrateStorage();
    await processPendingIfDue();
    await accrueSiteTimeAndMaybeRebuild();
    await ensureSiteTimeAlarm();
    await scheduleNextPendingAlarm();
    await rebuildFromStorage();
    const current = await chrome.storage.local.get([K_FOCUS_SESSION, K_TEMP_ALLOWANCES]);
    await scheduleFocusAlarm(current[K_FOCUS_SESSION]);
    await clearExpiredAllowances();
    await enforceTabLimitFromStorage();
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE.blockingEnabled] || changes[STORAGE.userDomains] || changes[K_SITE_TIME_LIMITS] || changes[K_FOCUS_SESSION] || changes[K_TEMP_ALLOWANCES]) {
    scheduleRebuild();
  }
  if (
    changes[K_PENDING_DISABLE_AT] ||
    changes[K_PENDING_REMOVALS] ||
    changes[K_PENDING_TAB_LIMIT_DISABLE_AT] ||
    changes[K_PENDING_TIME_LIMIT_REMOVALS]
  ) {
    void scheduleNextPendingAlarm();
  }
  if (changes[K_TAB_LIMIT_ENABLED] || changes[K_TAB_LIMIT_MAX] || changes[K_FOCUS_SESSION]) {
    void enforceTabLimitFromStorage();
  }
  if (changes[K_SITE_TIME_LIMITS] || changes[K_SITE_TIME_ACCRUE_SINCE]) {
    void ensureSiteTimeAlarm();
  }
  if (changes[K_FOCUS_SESSION]) void scheduleFocusAlarm(changes[K_FOCUS_SESSION].newValue);
  if (changes[K_TEMP_ALLOWANCES]) void scheduleAllowanceAlarm(changes[K_TEMP_ALLOWANCES].newValue);
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
  if (message && message.type === "startFocusSession") {
    void startFocusSession(message.payload)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message && message.type === "finishFocusSession") {
    void finishFocusSession(message.outcome === "completed" ? "completed" : "abandoned")
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message && message.type === "recordBlockedAttempt") {
    void recordBlockedAttempt(message.host)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message && message.type === "grantMindfulAllowance") {
    void grantMindfulAllowance(message.host, message.minutes)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-focus-dashboard") void chrome.runtime.openOptionsPage();
});

void (async () => {
  await migrateStorage();
  await processPendingIfDue();
  await accrueSiteTimeAndMaybeRebuild();
  await ensureSiteTimeAlarm();
  await scheduleNextPendingAlarm();
  await rebuildFromStorage();
  const current = await chrome.storage.local.get([K_FOCUS_SESSION, K_TEMP_ALLOWANCES]);
  await scheduleFocusAlarm(current[K_FOCUS_SESSION]);
  await clearExpiredAllowances();
  await enforceTabLimitFromStorage();
})();
