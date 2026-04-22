const S = {
  blockingEnabled: "blockingEnabled",
  userDomains: "userDomains",
  lastRebuildStats: "lastRebuildStats"
};

const el = (id) => document.getElementById(id);

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

function setStatus(msg, ok = true) {
  const s = el("status");
  s.textContent = msg || "";
  s.style.color = ok ? "var(--ok, #7dcea0)" : "var(--err, #f0a0a0)";
}

let domains = [];

function render() {
  const u = el("listEl");
  const empty = el("emptyList");
  const c = el("listCount");
  c.textContent = "(" + domains.length + ")";
  u.innerHTML = "";
  if (domains.length === 0) {
    empty.hidden = false;
    u.hidden = true;
  } else {
    empty.hidden = true;
    u.hidden = false;
    for (const d of domains) {
      const li = document.createElement("li");
      li.setAttribute("role", "listitem");
      const sp = document.createElement("span");
      sp.className = "dname";
      sp.textContent = d;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn-remove";
      b.setAttribute("aria-label", "Remover " + d);
      b.textContent = "Remover";
      b.addEventListener("click", () => {
        void removeOne(d);
      });
      li.appendChild(sp);
      li.appendChild(b);
      u.appendChild(li);
    }
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
    w.textContent = "Aviso: " + tr.userMissed + " sítio(s) não puderam ser bloqueados (limite de 5000 regras do Chrome).";
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
    "listTruncated"
  ]);
  el("blockingEnabled").checked = d[S.blockingEnabled] !== false;
  const raw = d[S.userDomains];
  domains = sortArr(Array.isArray(raw) ? raw : []);
  render();
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
    setStatus("Este sítio já está na lista.", false);
    return;
  }
  if (domains.length >= 5000) {
    setStatus("Limite de 5000 sítios (limite de regras do Chrome).", false);
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

async function removeOne(host) {
  domains = domains.filter((x) => x !== host);
  setStatus("A atualizar…", true);
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

el("blockingEnabled").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ [S.blockingEnabled]: e.target.checked });
  await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "rebuild" }, () => resolve());
  });
  await load();
  setStatus(e.target.checked ? "Bloqueio ativado." : "Bloqueio desativado.", true);
});

chrome.storage.onChanged.addListener((c, a) => {
  if (a === "local" && (c[S.userDomains] || c[S.lastRebuildStats] || c[S.blockingEnabled] || c.listTruncated)) {
    void load();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  void load();
});
