const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats",
  tabLimitEnabled: "tabLimitEnabled",
  tabLimitMax: "tabLimitMax"
};

const K = { pendingDisableAt: "pendingDisableAt", pendingTabLimitDisableAt: "pendingTabLimitDisableAt" };
const $ = (id) => document.getElementById(id);

let pendingDisableAt = null;
let pendingTabLimitAt = null;
let tick = null;

function formatRemainingMs(ms) {
  if (ms < 0) ms = 0;
  const totalS = Math.ceil(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function hasPending() {
  return typeof pendingDisableAt === "number" && pendingDisableAt > Date.now();
}

function hasPendingTabLimit() {
  return typeof pendingTabLimitAt === "number" && pendingTabLimitAt > Date.now();
}

/**
 * @param {unknown} n
 * @returns {number}
 */
function clampTabMax(n) {
  const x = typeof n === "number" ? n : parseInt(String(n), 10);
  if (!Number.isFinite(x)) return 8;
  return Math.max(2, Math.min(100, Math.floor(x)));
}

function startTick() {
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  if (!hasPending() && !hasPendingTabLimit()) return;
  const step = () => {
    if (!hasPending() && !hasPendingTabLimit()) {
      if (tick) {
        clearInterval(tick);
        tick = null;
      }
      void refresh();
      return;
    }
    if (hasPending() && $("pendTime")) {
      $("pendTime").textContent = formatRemainingMs(pendingDisableAt - Date.now());
    }
    if (hasPendingTabLimit() && $("pendTimeTab")) {
      $("pendTimeTab").textContent = formatRemainingMs(pendingTabLimitAt - Date.now());
    }
  };
  step();
  tick = setInterval(step, 1000);
}

function norm(s) {
  if (!s) return null;
  let t = s.trim();
  t = t.replace(/^\*\.?/, "");
  t = t.replace(/[,;\s].*$/, "").trim();
  if (t.toLowerCase() === "localhost" || t.includes("/") || t.includes("://")) {
    try {
      t = t.includes("://") ? new URL(t).hostname : new URL("http://" + t).hostname;
    } catch {
      return null;
    }
  } else {
    t = t.replace(/^[a-z+.-]+:\/\//i, "");
    t = t.split("/")[0].split(":")[0].toLowerCase();
  }
  t = t.toLowerCase();
  if (!/^[a-z0-9.-]+$/i.test(t)) return null;
  return t;
}

function setSt(msg, ok) {
  const s = $("st");
  s.textContent = msg || "";
  s.className = "st" + (ok === false ? " err" : "");
}

function fireReschedule() {
  try {
    chrome.runtime.sendMessage({ type: "reschedulePending" }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* extensão recarregou */
  }
}

function sortArr(a) {
  return [...new Set(a)].filter(Boolean).sort((x, y) => x.localeCompare(y));
}

async function refresh() {
  const d = await chrome.storage.local.get([
    S.blockingEnabled,
    S.userDomains,
    S.lastRebuildStats,
    K.pendingDisableAt,
    S.tabLimitEnabled,
    S.tabLimitMax,
    K.pendingTabLimitDisableAt
  ]);
  const mins = await focoGetPendingCooldownMinutes();
  const enc = $("pendEnc");
  if (enc) {
    enc.textContent =
      "A resistir ao impulso ajuda o teu foco. A desativação só aplica após " +
      mins +
      " min. (o tempo podes ajustar na engrenagem, quando a extensão puder). Podes anular abaixo.";
  }
  const blockOn = d[S.blockingEnabled] !== false;
  $("blockingEnabled").checked = blockOn;
  pendingDisableAt = typeof d[K.pendingDisableAt] === "number" ? d[K.pendingDisableAt] : null;
  pendingTabLimitAt = typeof d[K.pendingTabLimitDisableAt] === "number" ? d[K.pendingTabLimitDisableAt] : null;

  const tEnabled = d[S.tabLimitEnabled] === true;
  if ($("tabLimitEnabled")) $("tabLimitEnabled").checked = tEnabled;
  if ($("tabLimitMax")) $("tabLimitMax").value = String(clampTabMax(d[S.tabLimitMax] != null ? d[S.tabLimitMax] : 8));

  const a = d[S.userDomains] || [];
  const n = Array.isArray(a) ? a.length : 0;
  const stats = d[S.lastRebuildStats];

  const showPend = hasPending();
  const showPendTab = hasPendingTabLimit();
  if ($("boxPend")) $("boxPend").hidden = !showPend;
  if ($("boxPendTab")) {
    $("boxPendTab").hidden = !showPendTab;
  }
  if (showPend) {
    if ($("pendTime")) $("pendTime").textContent = formatRemainingMs(pendingDisableAt - Date.now());
  }
  if (showPendTab) {
    if ($("pendTimeTab")) $("pendTimeTab").textContent = formatRemainingMs(pendingTabLimitAt - Date.now());
  }
  if (showPend || showPendTab) {
    startTick();
  } else if (tick) {
    clearInterval(tick);
    tick = null;
  }

  const tMax = clampTabMax(d[S.tabLimitMax] != null ? d[S.tabLimitMax] : 8);
  const tabOn = tEnabled && !showPendTab;
  const extra = tabOn ? " · Limite de abas: " + tMax + "." : "";

  if (showPend && showPendTab) {
    setSt("Desativação da extensão e do limite de abas a contar. Vê os contadores abaixo.", true);
  } else if (showPend) {
    setSt("Bloqueio ainda ativo. Desativação: " + formatRemainingMs(pendingDisableAt - Date.now()) + extra, true);
  } else if (showPendTab) {
    setSt("Limite de abas ainda ativo. Desativação: " + formatRemainingMs(pendingTabLimitAt - Date.now()) + ".", true);
  } else if (stats && typeof stats.applied === "number") {
    setSt("Lista: " + n + (n === 1 ? " site — " : " sites — ") + stats.applied + " regras ativas." + extra, true);
  } else {
    setSt("Lista: " + n + (n === 1 ? " site." : " sites.") + extra, true);
  }
}

$("blockingEnabled").addEventListener("change", (e) => {
  const input = e.target;
  if (!input || input.type !== "checkbox") return;
  void (async () => {
    if (!input.checked) {
      if (hasPending()) {
        setSt("Já há desativação agendada. Anula primeiro, se quiseres alterar.", false);
        input.checked = true;
        return;
      }
      setSt("A agendar desativação… O bloqueio continua ativo; podes anular a qualquer momento.", true);
      try {
        const ms = await focoGetPendingCooldownMs();
        const mStr = (await focoGetPendingCooldownMinutes()) + " min";
        setSt("Agendado. Tempo: " + mStr + " (vês na engrenagem). Podes anular a qualquer momento.", true);
        await chrome.storage.local.set({ [K.pendingDisableAt]: Date.now() + ms });
        input.checked = true;
        await refresh();
        fireReschedule();
      } catch (er) {
        setSt("Erro: " + (er && er.message), false);
        input.checked = true;
      }
      return;
    }
    try {
      await chrome.storage.local.set({ [K.pendingDisableAt]: null, [S.blockingEnabled]: true });
      input.checked = true;
      await new Promise((r) => {
        chrome.runtime.sendMessage({ type: "rebuild" }, () => r());
      });
      await refresh();
      fireReschedule();
      setSt("Bloqueio ativado.", true);
    } catch (e2) {
      setSt("Erro: " + (e2 && e2.message), false);
    }
  })();
});

$("pendCancel").addEventListener("click", () => {
  void (async () => {
    try {
      await chrome.storage.local.set({ [K.pendingDisableAt]: null });
      await refresh();
      fireReschedule();
      setSt("Desativação anulada — extensão com bloqueio ativo.", true);
    } catch (e) {
      setSt("Erro: " + (e && e.message), false);
    }
  })();
});

$("pendCancelTab")?.addEventListener("click", () => {
  void (async () => {
    try {
      await chrome.storage.local.set({ [K.pendingTabLimitDisableAt]: null });
      await refresh();
      fireReschedule();
      setSt("Desativação do limite de abas anulada; o limite continua ativo.", true);
    } catch (e) {
      setSt("Erro: " + (e && e.message), false);
    }
  })();
});

$("tabLimitEnabled")?.addEventListener("change", (e) => {
  const input = e.target;
  if (!input || input.type !== "checkbox") return;
  void (async () => {
    if (!input.checked) {
      if (hasPendingTabLimit()) {
        setSt("Já há desativação do limite de abas agendada. Anula primeiro, se quiseres alterar.", false);
        input.checked = true;
        return;
      }
      setSt("A agendar desativação do limite de abas… O limite continua ativo; podes anular a qualquer momento.", true);
      try {
        const ms = await focoGetPendingCooldownMs();
        const mStr = (await focoGetPendingCooldownMinutes()) + " min";
        setSt("Agendado. Tempo: " + mStr + ". Podes anular a qualquer momento.", true);
        await chrome.storage.local.set({ [K.pendingTabLimitDisableAt]: Date.now() + ms });
        input.checked = true;
        await refresh();
        fireReschedule();
      } catch (er) {
        setSt("Erro: " + (er && er.message), false);
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
      await refresh();
      fireReschedule();
      setSt("Limite de abas ativado.", true);
    } catch (e2) {
      setSt("Erro: " + (e2 && e2.message), false);
    }
  })();
});

$("tabLimitMax")?.addEventListener("change", () => {
  void (async () => {
    const elM = $("tabLimitMax");
    if (!elM) return;
    const v = clampTabMax(elM.value);
    elM.value = String(v);
    try {
      await chrome.storage.local.set({ [S.tabLimitMax]: v });
      await refresh();
    } catch (e) {
      setSt("Erro: " + (e && e.message), false);
    }
  })();
});

$("formQ").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = ($("quick").value || "").trim();
  $("quick").value = "";
  if (!t) {
    setSt("Escreva o site (domínio).", false);
    return;
  }
  const h = norm(t);
  if (!h) {
    setSt("Endereço inválido.", false);
    return;
  }
  const d = await chrome.storage.local.get(S.userDomains);
  const cur = sortArr(d[S.userDomains] || []);
  if (cur.includes(h)) {
    setSt("Já estava na lista.", false);
    return;
  }
  if (cur.length >= 5000) {
    setSt("Limite de 5000 sites.", false);
    return;
  }
  cur.push(h);
  cur.sort();
  await chrome.storage.local.set({ [S.userDomains]: cur });
  await new Promise((r) => {
    chrome.runtime.sendMessage({ type: "rebuild" }, () => r());
  });
  setSt("Adicionado: " + h, true);
  await refresh();
});

$("open").addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});

$("toSettings")?.addEventListener("click", () => {
  const u = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("settings.html")
    : "settings.html";
  if (window.open) {
    window.open(u, "_blank", "noopener");
  } else {
    self.location.href = u;
  }
});

void refresh();
chrome.storage.onChanged.addListener((c, a) => {
  if (
    a === "local" &&
    (c[S.userDomains] ||
      c[S.lastRebuildStats] ||
      c[S.blockingEnabled] ||
      c[K.pendingDisableAt] ||
      c.pendingCooldownMinutes ||
      c[S.tabLimitEnabled] ||
      c[S.tabLimitMax] ||
      c[K.pendingTabLimitDisableAt])
  ) {
    void refresh();
  }
});
