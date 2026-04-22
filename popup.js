const S = { blockingEnabled: "blockingEnabled", userDomains: "userDomains", lastRebuildStats: "lastRebuildStats" };
const $ = (id) => document.getElementById(id);

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

async function refresh() {
  const d = await chrome.storage.local.get([S.blockingEnabled, S.userDomains, S.lastRebuildStats]);
  $("blockingEnabled").checked = d[S.blockingEnabled] !== false;
  const a = d[S.userDomains] || [];
  const n = Array.isArray(a) ? a.length : 0;
  const r = d[S.lastRebuildStats];
  if (r && typeof r.applied === "number") {
    setSt("Lista: " + n + " sítio(s) — " + r.applied + " regras ativas.", true);
  } else {
    setSt("Lista: " + n + " sítio(s).", true);
  }
}

$("blockingEnabled").addEventListener("change", async (e) => {
  await chrome.storage.local.set({ [S.blockingEnabled]: e.target.checked });
  await new Promise((r) => {
    chrome.runtime.sendMessage({ type: "rebuild" }, () => r());
  });
  await refresh();
});

$("formQ").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = ( $("quick").value || "").trim();
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

function sortArr(a) {
  return [...new Set(a)].filter(Boolean).sort((x, y) => x.localeCompare(y));
}

$("open").addEventListener("click", () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  }
});

void refresh();
chrome.storage.onChanged.addListener((c, a) => {
  if (a === "local" && (c[S.userDomains] || c[S.lastRebuildStats] || c[S.blockingEnabled])) {
    void refresh();
  }
});
