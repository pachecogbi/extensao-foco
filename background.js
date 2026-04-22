/** Teto de regras dinâmicas (Manifest V3 / Chromium). */
const DNR_MAX_DYNAMIC_RULES = 5000;
const REBUILD_DEBOUNCE_MS = 200;

const STORAGE = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats"
};

/** Só o documento da página/iframe, para mostrar a nossa tela; não tocar em ficheiros estáticos. */
const RES_TYPES = Object.freeze(["main_frame", "sub_frame"]);

let rebuildTimer = null;
let rebuildDnrQueue = Promise.resolve();

/**
 * Redireciona pedidos a este domínio para a mensagem "site bloqueado" (não usa ação "block" da Chrome).
 * @param {number} id
 * @param {string} host
 * @returns {import("chrome.declarativeNetRequest").Rule}
 */
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

/**
 * @param {string} s
 * @returns {string|null}
 */
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

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    if (details.reason === "install") {
      await chrome.storage.local.set({
        [STORAGE.blockingEnabled]: true,
        [STORAGE.userDomains]: []
      });
    }
    await rebuildFromStorage();
  })();
});

chrome.runtime.onStartup.addListener(() => {
  void rebuildFromStorage();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[STORAGE.blockingEnabled] || changes[STORAGE.userDomains]) {
    scheduleRebuild();
  }
});

chrome.runtime.onMessage.addListener((message, _s, sendResponse) => {
  if (message && message.type === "rebuild") {
    void rebuildFromStorage()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ error: String(e) }));
    return true;
  }
  return false;
});

void rebuildFromStorage();
