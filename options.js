const S = {
  blockingEnabled: "blockingEnabled",
  adult18Enabled: "adult18Enabled",
  userDomains: "userDomains",
  adultListUrl: "adultListUrl",
  adultRefreshHours: "adultRefreshHours",
  lastAdultUpdate: "lastAdultUpdate",
  lastAdultError: "lastAdultError",
  adultListTruncated: "adultListTruncated",
  lastAdultTotalInSource: "lastAdultTotalInSource",
  lastRebuildStats: "lastRebuildStats"
};

const el = (id) => document.getElementById(id);

/**
 * Uma representação mínima da normalização (para a textarea ao guardar).
 * @param {string} s
 * @returns {string|null}
 */
function normalizeToHost(s) {
  if (!s || typeof s !== "string") return null;
  let t = s.trim();
  if (!t) return null;
  if (t.startsWith("#")) return null;
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

function textToDomainsArray(text) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const h = normalizeToHost(line);
    if (h) out.add(h);
  }
  return [...out].sort((a, b) => a.localeCompare(b));
}

function domainsArrayToText(arr) {
  if (!arr || !arr.length) return "";
  return [...new Set(arr)].filter(Boolean).sort().join("\n");
}

function formatTs(ms) {
  if (!ms) return "nunca";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-PT");
}

async function load() {
  const data = await chrome.storage.local.get([
    S.blockingEnabled,
    S.adult18Enabled,
    S.userDomains,
    S.adultListUrl,
    S.adultRefreshHours,
    S.lastAdultUpdate,
    S.lastAdultError,
    S.adultListTruncated,
    S.lastAdultTotalInSource,
    S.lastRebuildStats
  ]);
  el("blockingEnabled").checked = data[S.blockingEnabled] !== false;
  el("adult18Enabled").checked = data[S.adult18Enabled] !== false;
  const doms = data[S.userDomains];
  el("userDomains").value = Array.isArray(doms) ? domainsArrayToText(doms) : "";
  el("adultListUrl").value = data[S.adultListUrl] || "";
  const h = Number(data[S.adultRefreshHours]) || 24;
  const sel = el("adultRefreshHours");
  const ok = [1, 6, 12, 24, 48, 72, 168].includes(h);
  sel.value = String(ok ? h : 24);
  refreshStatus(data);
  el("details").hidden = false;
}

function showStatus(msg, ok = true) {
  const s = el("status");
  s.textContent = msg;
  s.style.color = ok ? "var(--ok, #7dcea0)" : "var(--err, #f0a0a0)";
}

function renderTruncation(t) {
  const tEl = el("truncMsg");
  if (!t) {
    tEl.hidden = true;
    tEl.textContent = "";
    return;
  }
  const parts = [];
  if (t.userMissed > 0) parts.push(`${t.userMissed} domínios manuais não entram (sem espaço de regras).`);
  if (t.adultMissed > 0) parts.push(`Lista +18: ${t.adultMissed} entradas não aplicadas (teto 5000 no total com a lista manual).`);
  tEl.textContent = parts.join(" ");
  tEl.hidden = parts.length === 0;
}

function renderError(msg) {
  const e = el("adultErr");
  if (msg) {
    e.textContent = msg;
    e.hidden = false;
  } else {
    e.hidden = true;
    e.textContent = "";
  }
}

/** @param {Record<string, any>} data */
function refreshStatus(data) {
  if (!data || typeof data !== "object") {
    return;
  }
  renderError(data[S.lastAdultError] || "");
  const totalSrc = data[S.lastAdultTotalInSource];
  const line = el("adultUpdateLine");
  if (data[S.lastAdultError] && (data[S.lastAdultError] + "").length) {
    line.textContent = `Origem: ${totalSrc == null ? "—" : totalSrc} entradas analisadas na última transferência; última atualização: ${formatTs(
      data[S.lastAdultUpdate]
    )}.`;
  } else {
    line.textContent = `Entradas na origem: ${totalSrc == null ? "—" : totalSrc}. Última atualização da lista +18: ${formatTs(
      data[S.lastAdultUpdate]
    )}.`;
  }
  renderTruncation(data[S.adultListTruncated]);
  const stats = data[S.lastRebuildStats];
  if (stats && typeof stats === "object" && "appliedUser" in stats) {
    el("dUser").textContent = String(stats.appliedUser);
    el("dAdult").textContent = String(stats.appliedAdult);
    el("dCap").textContent = String(stats.cap);
  } else {
    el("dUser").textContent = "—";
    el("dAdult").textContent = "—";
    el("dCap").textContent = "5000";
  }
}

async function save() {
  const blockingEnabled = el("blockingEnabled").checked;
  const adult18Enabled = el("adult18Enabled").checked;
  const userDomains = textToDomainsArray(el("userDomains").value);
  let url = (el("adultListUrl").value || "").trim();
  if (adult18Enabled && url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") {
        showStatus("Use apenas https:// no URL da lista +18.", false);
        return;
      }
    } catch {
      showStatus("URL da lista +18 inválido.", false);
      return;
    }
  }
  const adultRefreshHours = Math.max(1, Math.min(168, parseInt(el("adultRefreshHours").value, 10) || 24));
  el("adultListUrl").value = url;
  showStatus("A guardar…", true);
  await chrome.storage.local.set({
    [S.blockingEnabled]: blockingEnabled,
    [S.adult18Enabled]: adult18Enabled,
    [S.userDomains]: userDomains,
    [S.adultListUrl]: url,
    [S.adultRefreshHours]: adultRefreshHours
  });
  showStatus("Guardado. A aplicar regras…", true);
  if (adult18Enabled && url) {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "fetchAdultNow" }, () => resolve());
    });
  } else {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "rebuild" }, () => resolve());
    });
  }
  await load();
  showStatus("Definições guardadas e regras atualizadas.", true);
}

async function refreshAdult() {
  showStatus("A transferir lista +18…", true);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "fetchAdultNow" }, async (r) => {
      await load();
      if (r && r.ok) showStatus("Lista +18 atualizada com sucesso.", true);
      else if (r && (r.error || r.code)) showStatus("A lista +18 não pôde ser completada. Veja a mensagem abaixo.", false);
      else showStatus("Concluído. Veja o estado abaixo.", r && r.ok !== false);
      resolve(r);
    });
  });
}

el("saveBtn").addEventListener("click", () => {
  void save();
});
el("refreshAdultBtn").addEventListener("click", () => {
  void refreshAdult();
});
document.addEventListener("DOMContentLoaded", () => {
  void load();
});
