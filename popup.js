const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats"
};

const K = { pendingDisableAt: "pendingDisableAt" };
const COOLDOWN_MS = 5 * 60 * 1000;
const $ = (id) => document.getElementById(id);

let pendingDisableAt = null;
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

function startTick() {
  if (tick) {
    clearInterval(tick);
    tick = null;
  }
  if (!hasPending()) return;
  const step = () => {
    if (!hasPending() || !tick) {
      if (tick) {
        clearInterval(tick);
        tick = null;
      }
      void refresh();
      return;
    }
    $("pendTime").textContent = formatRemainingMs(pendingDisableAt - Date.now());
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

async function reschedule() {
  await new Promise((r) => {
    chrome.runtime.sendMessage({ type: "reschedulePending" }, () => r());
  });
}

function sortArr(a) {
  return [...new Set(a)].filter(Boolean).sort((x, y) => x.localeCompare(y));
}

async function refresh() {
  const d = await chrome.storage.local.get([
    S.blockingEnabled,
    S.userDomains,
    S.lastRebuildStats,
    K.pendingDisableAt
  ]);
  const blockOn = d[S.blockingEnabled] !== false;
  $("blockingEnabled").checked = blockOn;
  pendingDisableAt = typeof d[K.pendingDisableAt] === "number" ? d[K.pendingDisableAt] : null;

  const a = d[S.userDomains] || [];
  const n = Array.isArray(a) ? a.length : 0;
  const stats = d[S.lastRebuildStats];

  const showPend = hasPending();
  $("boxPend").hidden = !showPend;
  if (showPend) {
    $("pendTime").textContent = formatRemainingMs(pendingDisableAt - Date.now());
    startTick();
  } else if (tick) {
    clearInterval(tick);
    tick = null;
  }

  if (stats && typeof stats.applied === "number") {
    if (showPend) {
      setSt("Bloqueio ainda ativo. Desativação: " + formatRemainingMs(pendingDisableAt - Date.now()) + ".", true);
    } else {
      setSt("Lista: " + n + " sítio(s) — " + stats.applied + " regras ativas.", true);
    }
  } else {
    if (showPend) {
      setSt("Bloqueio ainda ativo. Desativação: " + formatRemainingMs(pendingDisableAt - Date.now()) + ".", true);
    } else {
      setSt("Lista: " + n + " sítio(s).", true);
    }
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
      setSt("A agendar desativação (5 min). O bloqueio continua ativo; podes anular a qualquer momento.", true);
      try {
        await chrome.storage.local.set({ [K.pendingDisableAt]: Date.now() + COOLDOWN_MS });
        input.checked = true;
        await reschedule();
        await refresh();
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
      await reschedule();
      await refresh();
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
      await reschedule();
      await refresh();
      setSt("Desativação anulada — extensão com bloqueio ativo.", true);
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
    setSt("Escreva o sítio.", false);
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
    setSt("Limite de 5000 sítios.", false);
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

void refresh();
chrome.storage.onChanged.addListener((c, a) => {
  if (
    a === "local" &&
    (c[S.userDomains] || c[S.lastRebuildStats] || c[S.blockingEnabled] || c[K.pendingDisableAt])
  ) {
    void refresh();
  }
});
