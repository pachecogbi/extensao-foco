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

const RES_TYPES = Object.freeze(["main_frame", "sub_frame"]);

let rebuildTimer = null;
let rebuildDnrQueue = Promise.resolve();

function makeBlockRedirectRule(id, host) {
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { extensionPath: "/blocked.html" }
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
  const s = await chrome.storage.local.get([STORAGE.blockingEnabled, STORAGE.userDomains]);
  const blocking = s[STORAGE.blockingEnabled] !== false;
  const userRaw = s[STORAGE.userDomains];
  const user = sortHosts(
    Array.from(new Set((userRaw || []).map(normalizeToHost).filter(Boolean)))
  );
  const remove = await getAllExtensionDynamicRuleIds();
  const toAdd = [];
  if (!blocking) {
    if (remove.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: remove });
    }
    await chrome.storage.local.set({
      [STORAGE.lastRebuildStats]: {
        applied: 0,
        cap: DNR_MAX_DYNAMIC_RULES,
        ts: Date.now()
      }
    });
    return { applied: 0, cap: DNR_MAX_DYNAMIC_RULES, missed: 0 };
  }
  const cap = DNR_MAX_DYNAMIC_RULES;
  let n = 1;
  for (const host of user) {
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
  const missed = user.length - applied;
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
    K_PENDING_REMOVALS
  ]);
  const now = Date.now();
  const patch = {};
  if (d[K_PENDING_DISABLE_AT] && typeof d[K_PENDING_DISABLE_AT] === "number" && d[K_PENDING_DISABLE_AT] <= now) {
    patch[STORAGE.blockingEnabled] = false;
    patch[K_PENDING_DISABLE_AT] = null;
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
  const d = await chrome.storage.local.get([K_PENDING_DISABLE_AT, K_PENDING_REMOVALS]);
  const ends = [];
  if (d[K_PENDING_DISABLE_AT] && typeof d[K_PENDING_DISABLE_AT] === "number" && d[K_PENDING_DISABLE_AT] > Date.now()) {
    ends.push(d[K_PENDING_DISABLE_AT]);
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
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    if (details.reason === "install") {
      await chrome.storage.local.set({
        [STORAGE.blockingEnabled]: true,
        [STORAGE.userDomains]: [],
        [K_PENDING_DISABLE_AT]: null,
        [K_PENDING_REMOVALS]: null,
        [K_COOLDOWN_MIN]: 5
      });
    }
    await processPendingIfDue();
    await rebuildFromStorage();
    await scheduleNextPendingAlarm();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await processPendingIfDue();
    await scheduleNextPendingAlarm();
    await rebuildFromStorage();
  })();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE.blockingEnabled] || changes[STORAGE.userDomains]) {
    scheduleRebuild();
  }
  if (changes[K_PENDING_DISABLE_AT] || changes[K_PENDING_REMOVALS]) {
    void scheduleNextPendingAlarm();
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
  await scheduleNextPendingAlarm();
  await rebuildFromStorage();
})();
