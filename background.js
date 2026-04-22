/** Limite de regras dinâmicas (Manifesto V3 / Chromium) — orçamento total partilhado. */
const DNR_MAX_DYNAMIC_RULES = 5000;
/** Teto de domínios +18 guardados (evita storage excessivo; truncagem fina aplica no rebuild). */
const MAX_ADULT_HOSTS_CACHED = 20000;

const MAX_FETCH_BYTES = 5 * 1024 * 1024;
const REBUILD_DEBOUNCE_MS = 200;

const STORAGE = {
  blockingEnabled: "blockingEnabled",
  adult18Enabled: "adult18Enabled",
  userDomains: "userDomains",
  adultListUrl: "adultListUrl",
  adultListHosts: "adultListHosts",
  adultRefreshHours: "adultRefreshHours",
  lastAdultUpdate: "lastAdultUpdate",
  lastAdultError: "lastAdultError",
  adultListTruncated: "adultListTruncated",
  lastAdultTotalInSource: "lastAdultTotalInSource",
  lastAdultApplied: "lastAdultApplied",
  lastRebuildStats: "lastRebuildStats"
};

const ALARM_ADULT = "foco-adult-refresh";

let rebuildTimer = null;

/**
 * Uma regra de bloqueio por domínio, estilo uBlock/AdGuard (Chromium DNR).
 * @param {number} id
 * @param {string} host ASCII (ex.: sub.exemplo.com)
 * @returns {import("chrome.declarativeNetRequest").Rule}
 */
function makeBlockRule(id, host) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: "||" + host + "^",
      isUrlFilterCaseSensitive: false
    }
  };
}

/**
 * @param {string} s
 * @returns {string|null} hostname normalizado, ou null
 */
function normalizeToHost(s) {
  if (!s || typeof s !== "string") return null;
  let t = s.trim();
  if (!t) return null;
  if (t.startsWith("#")) return null;
  t = t.replace(/^\*\.?/, "");
  t = t.replace(/[,;\s].*$/, "").trim();
  if (t.toLowerCase() === "localhost" || t.includes("/")) {
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

/**
 * @param {string} text
 * @returns {string[]}
 */
function parseAdultListText(text) {
  const out = new Set();
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) {
        for (const el of data) {
          if (typeof el === "string") {
            const h = normalizeToHost(el);
            if (h) out.add(h);
          } else if (el && typeof el === "object" && typeof el.domain === "string") {
            const h = normalizeToHost(el.domain);
            if (h) out.add(h);
          }
        }
        return sortHosts([...out]);
      }
      if (data && typeof data === "object") {
        const ar =
          (Array.isArray(data.domains) && data.domains) ||
          (Array.isArray(data.hosts) && data.hosts) ||
          (Array.isArray(data.block) && data.block) ||
          null;
        if (ar) {
          for (const el of ar) {
            const s = typeof el === "string" ? el : el && el.domain;
            if (s) {
              const h = normalizeToHost(s);
              if (h) out.add(h);
            }
          }
          return sortHosts([...out]);
        }
      }
    } catch {
      // continua com linha a linha
    }
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    let L = line.trim();
    if (!L || L.startsWith("#") || L.startsWith("!")) continue;
    if (/^127\.0\.0\.1\s+/.test(L) || /^0\.0\.0\.0\s+/.test(L)) {
      const parts = L.split(/\s+/);
      for (let i = 1; i < parts.length; i++) {
        if (parts[i] === "#" || parts[i] === "localhost") break;
        const h = normalizeToHost(parts[i]);
        if (h) out.add(h);
      }
      continue;
    }
    const h = normalizeToHost(L);
    if (h) out.add(h);
  }
  return sortHosts([...out]);
}

function sortHosts(h) {
  return [...h].sort((a, b) => a.localeCompare(b));
}

async function getOurDynamicRuleIds() {
  const rules = await chrome.declarativeNetRequest.getDynamicRules();
  return rules.filter((r) => r.id >= 1 && r.id <= DNR_MAX_DYNAMIC_RULES).map((r) => r.id);
}

/**
 * Aplica o conjunto de regras (bloqueio geral, lista manual, +18 em cache).
 */
async function rebuildFromStorage() {
  const keys = [
    STORAGE.blockingEnabled,
    STORAGE.adult18Enabled,
    STORAGE.userDomains,
    STORAGE.adultListHosts
  ];
  const s = await chrome.storage.local.get(keys);
  const blocking = s[STORAGE.blockingEnabled] !== false;
  const adultOn = s[STORAGE.adult18Enabled] !== false;
  const userRaw = s[STORAGE.userDomains];
  const adultRaw = s[STORAGE.adultListHosts];
  const user = sortHosts(Array.from(new Set((userRaw || []).map(normalizeToHost).filter(Boolean))));
  const userSet = new Set(user);
  const adult = sortHosts(
    Array.from(new Set((adultRaw || []).map(normalizeToHost).filter(Boolean))).filter((h) => !userSet.has(h))
  );

  const remove = await getOurDynamicRuleIds();
  const toAdd = [];

  if (!blocking) {
    if (remove.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove });
    }
    await chrome.storage.local.set({
      [STORAGE.lastRebuildStats]: {
        appliedUser: 0,
        appliedAdult: 0,
        cap: DNR_MAX_DYNAMIC_RULES,
        ts: Date.now()
      }
    });
    return { appliedUser: 0, appliedAdult: 0, cap: DNR_MAX_DYNAMIC_RULES };
  }

  const cap = DNR_MAX_DYNAMIC_RULES;
  let n = 1;
  for (const host of user) {
    if (n > cap) break;
    toAdd.push(makeBlockRule(n, host));
    n += 1;
  }
  const appliedUser = toAdd.length;
  const remaining = cap - toAdd.length;
  const adultTotalInCache = adultOn ? adult.length : 0;
  if (adultOn && adultTotalInCache > 0) {
    const take = Math.min(adultTotalInCache, remaining);
    for (let i = 0; i < take; i++) {
      toAdd.push(makeBlockRule(n, adult[i]));
      n += 1;
    }
  }
  const appliedAdult = adultOn ? toAdd.length - appliedUser : 0;

  if (remove.length > 0 || toAdd.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: remove,
      addRules: toAdd
    });
  }

  const userMissed = user.length - appliedUser;
  const adultMissed = adultOn ? adultTotalInCache - appliedAdult : 0;
  const hasTrunc = userMissed > 0 || adultMissed > 0;
  if (hasTrunc) {
    await chrome.storage.local.set({
      [STORAGE.adultListTruncated]: { userMissed, adultMissed },
      [STORAGE.lastAdultApplied]: appliedAdult
    });
  } else {
    await chrome.storage.local.set({
      [STORAGE.adultListTruncated]: null,
      [STORAGE.lastAdultApplied]: adultOn ? appliedAdult : 0
    });
  }
  await chrome.storage.local.set({
    [STORAGE.lastRebuildStats]: {
      appliedUser,
      appliedAdult,
      cap: DNR_MAX_DYNAMIC_RULES,
      ts: Date.now()
    }
  });

  return { appliedUser, appliedAdult, cap: DNR_MAX_DYNAMIC_RULES };
}

function scheduleRebuild() {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuildFromStorage();
  }, REBUILD_DEBOUNCE_MS);
}

async function setAlarmForAdult() {
  const s = await chrome.storage.local.get(STORAGE.adultRefreshHours);
  const h = Math.max(1, Math.min(168, Number(s[STORAGE.adultRefreshHours]) || 24));
  const period = Math.max(1, h * 60);
  await chrome.alarms.clear(ALARM_ADULT);
  await chrome.alarms.create(ALARM_ADULT, { periodInMinutes: period });
}

/**
 * @param {{ errorIfNoUrl?: boolean; silentIfNoUrl?: boolean }} [opts]
 */
async function fetchAndStoreAdultList(opts) {
  const errorIfNoUrl = Boolean(opts && opts.errorIfNoUrl);
  const silentIfNoUrl = Boolean(opts && opts.silentIfNoUrl);
  const s = await chrome.storage.local.get([STORAGE.adult18Enabled, STORAGE.adultListUrl]);
  if (s[STORAGE.adult18Enabled] === false) {
    await chrome.storage.local.set({ [STORAGE.lastAdultError]: null });
    return { ok: true, skipped: true };
  }
  const url = (s[STORAGE.adultListUrl] || "").trim();
  if (!url) {
    if (silentIfNoUrl) {
      return { ok: true, skipped: true };
    }
    if (errorIfNoUrl) {
      await chrome.storage.local.set({
        [STORAGE.lastAdultError]: "Defina o URL da lista +18 nas opções.",
        [STORAGE.lastAdultTotalInSource]: 0
      });
    }
    return { ok: false, skipped: true, code: "no_url" };
  }
  if (!/^https:\/\//i.test(url)) {
    await chrome.storage.local.set({ [STORAGE.lastAdultError]: "Apenas HTTPS é permitido para a lista +18." });
    return { ok: false, error: "https_only" };
  }

  let res;
  try {
    res = await fetch(url, { cache: "no-cache" });
  } catch (e) {
    const msg = (e && e.message) || String(e);
    await chrome.storage.local.set({ [STORAGE.lastAdultError]: "Falha de rede: " + msg });
    return { ok: false, error: msg };
  }
  if (!res.ok) {
    await chrome.storage.local.set({ [STORAGE.lastAdultError]: "Resposta do servidor: HTTP " + res.status });
    return { ok: false, error: "http_" + res.status };
  }

  const ab = await res.arrayBuffer();
  if (ab.byteLength > MAX_FETCH_BYTES) {
    const err = "Lista demasiado grande (máx. 5 MB).";
    await chrome.storage.local.set({ [STORAGE.lastAdultError]: err });
    return { ok: false, error: "size" };
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(ab));
  const all = parseAdultListText(text);
  const total = all.length;
  const toStore = all.length > MAX_ADULT_HOSTS_CACHED ? all.slice(0, MAX_ADULT_HOSTS_CACHED) : all;
  const cacheCapped = all.length > MAX_ADULT_HOSTS_CACHED;
  await chrome.storage.local.set({
    [STORAGE.adultListHosts]: toStore,
    [STORAGE.lastAdultUpdate]: Date.now(),
    [STORAGE.lastAdultError]: null,
    [STORAGE.lastAdultTotalInSource]: total,
    [STORAGE.lastAdultApplied]: 0
  });
  if (cacheCapped) {
    await chrome.storage.local.set({
      [STORAGE.lastAdultError]: `Lista de origem tem ${total} entradas; em cache: ${toStore.length} (máx. ${MAX_ADULT_HOSTS_CACHED}). A truncagem de regras aplica no bloqueio.`
    });
  }
  return { ok: true, count: toStore.length, totalInSource: total, cacheCapped };
}

async function onAlarmOrStartup() {
  await setAlarmForAdult();
  const s0 = await chrome.storage.local.get([STORAGE.blockingEnabled, STORAGE.adult18Enabled]);
  if (s0[STORAGE.blockingEnabled] === false) {
    await rebuildFromStorage();
    return;
  }
  if (s0[STORAGE.adult18Enabled] === false) {
    await rebuildFromStorage();
    return;
  }
  await fetchAndStoreAdultList({ silentIfNoUrl: true });
  await rebuildFromStorage();
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    if (details.reason === "install") {
      await chrome.storage.local.set({
        [STORAGE.blockingEnabled]: true,
        [STORAGE.adult18Enabled]: true,
        [STORAGE.userDomains]: [],
        [STORAGE.adultListUrl]: "",
        [STORAGE.adultListHosts]: [],
        [STORAGE.adultRefreshHours]: 24
      });
    }
    await onAlarmOrStartup();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void onAlarmOrStartup();
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM_ADULT) void onAlarmOrStartup();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes[STORAGE.blockingEnabled] ||
    changes[STORAGE.adult18Enabled] ||
    changes[STORAGE.userDomains] ||
    changes[STORAGE.adultListHosts] ||
    changes[STORAGE.adultListUrl] ||
    changes[STORAGE.adultRefreshHours]
  ) {
  if (changes[STORAGE.adultRefreshHours] || Object.keys(changes).some((k) => k === STORAGE.adult18Enabled || k === STORAGE.adultListUrl)) {
    void setAlarmForAdult();
  }
  scheduleRebuild();
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "rebuild") {
    void rebuildFromStorage()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  if (message && message.type === "fetchAdultNow") {
    (async () => {
      const r = await fetchAndStoreAdultList({
        errorIfNoUrl: message.errorIfNoUrl !== false,
        silentIfNoUrl: false
      });
      await rebuildFromStorage();
      return r;
    })()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (message && message.type === "getState") {
    void chrome.storage.local
      .get(null)
      .then((d) => sendResponse(d))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  return false;
});

void setAlarmForAdult();
void rebuildFromStorage();
