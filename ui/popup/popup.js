const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats"
};

const K = { pendingDisableAt: "pendingDisableAt" };
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
    if (!hasPending()) {
      if (tick) {
        clearInterval(tick);
        tick = null;
      }
      void refresh();
      return;
    }
    if ($("pendTime")) {
      $("pendTime").textContent = formatRemainingMs(pendingDisableAt - Date.now());
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

function renderDomainList(domains) {
  const ul = $("domainList");
  const empty = $("domainListEmpty");
  if (!ul || !empty) return;
  const list = Array.isArray(domains) ? sortArr(domains) : [];
  ul.innerHTML = "";
  for (const d of list) {
    const li = document.createElement("li");
    li.className = "list-pop-item";
    li.textContent = d;
    ul.appendChild(li);
  }
  const isEmpty = list.length === 0;
  empty.hidden = !isEmpty;
  ul.hidden = isEmpty;
}

async function refresh() {
  const d = await chrome.storage.local.get([
    S.blockingEnabled,
    S.userDomains,
    S.lastRebuildStats,
    K.pendingDisableAt
  ]);
  const mins = await focoGetPendingCooldownMinutes();
  const enc = $("pendEnc");
  if (enc) {
    enc.textContent = "A desativação ocorre após " + mins + " min. (em Configurações). Você pode cancelar abaixo.";
  }
  const blockOn = d[S.blockingEnabled] !== false;
  $("blockingEnabled").checked = blockOn;
  pendingDisableAt = typeof d[K.pendingDisableAt] === "number" ? d[K.pendingDisableAt] : null;

  const raw = d[S.userDomains] || [];
  const rows = sortArr(Array.isArray(raw) ? raw : []);
  const n = rows.length;
  renderDomainList(rows);

  const showPend = hasPending();
  if ($("boxPend")) $("boxPend").hidden = !showPend;
  if (showPend) {
    if ($("pendTime")) $("pendTime").textContent = formatRemainingMs(pendingDisableAt - Date.now());
    startTick();
  } else if (tick) {
    clearInterval(tick);
    tick = null;
  }

  const stats = d[S.lastRebuildStats];
  if (showPend) {
    setSt("Bloqueio ainda ativo. Desativação: " + formatRemainingMs(pendingDisableAt - Date.now()) + ".", true);
  } else if (stats && typeof stats.applied === "number") {
    setSt("Lista: " + n + (n === 1 ? " site — " : " sites — ") + stats.applied + " regras.", true);
  } else {
    setSt("Lista: " + n + (n === 1 ? " site." : " sites."), true);
  }
}

$("blockingEnabled").addEventListener("change", (e) => {
  const input = e.target;
  if (!input || input.type !== "checkbox") return;
  void (async () => {
    if (!input.checked) {
      if (hasPending()) {
        setSt("Já há desativação agendada. Cancele antes.", false);
        input.checked = true;
        return;
      }
      setSt("Agendando desativação… o bloqueio continua; você pode cancelar.", true);
      try {
        const ms = await focoGetPendingCooldownMs();
        setSt("Agendado. Abra Configurações para ver o tempo de reflexão. Você pode cancelar.", true);
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
      setSt("Desativação cancelada — bloqueio ativo.", true);
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
    setSt("Escreva o domínio do site.", false);
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

$("optPage")?.addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});

$("toSettings")?.addEventListener("click", () => {
  const u = typeof chrome !== "undefined" && chrome.runtime?.getURL
    ? chrome.runtime.getURL("ui/settings/settings.html")
    : "ui/settings/settings.html";
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
    (c[S.userDomains] || c[S.lastRebuildStats] || c[S.blockingEnabled] || c[K.pendingDisableAt] || c.pendingCooldownMinutes)
  ) {
    void refresh();
  }
});
