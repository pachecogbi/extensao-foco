/* global chrome, FocoCore, focoGetPendingCooldownMinutes */

const $ = (id) => document.getElementById(id);
const KEYS = ["blockingEnabled","userDomains","siteTimeLimits","siteTimeUsage","pendingDisableAt","pendingRemovals","pendingTimeLimitRemovals","focusSession","focusHistory","dailyStats","dailyFocusGoalMinutes","blockedAttemptsByHost","pendingCooldownMinutes"];
let state = {};
let ticker = null;
let toastTimer = null;

function send(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
    else resolve(response || { ok: true });
  }));
}

function toast(message, ok = true) {
  const node = $("toast");
  node.textContent = message;
  node.className = "toast show" + (ok ? "" : " error");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = "toast"; }, 3200);
}

function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return (hours ? String(hours).padStart(2, "0") + ":" : "") + String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}

function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return value + " min";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours + "h" + (rest ? " " + rest + "min" : "");
}

function parseMap(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function dateLabel() {
  const text = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function daySeries(days = 7, endOffset = 0) {
  const output = [];
  const now = new Date();
  for (let i = days - 1 + endOffset; i >= endOffset; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    output.push({ key: FocoCore.localDayKey(date), date });
  }
  return output;
}

function getTodayStats() {
  return FocoCore.normalizeDailyStats(state.dailyStats)[FocoCore.localDayKey()] || { focusMinutes: 0, sessionsCompleted: 0, sessionsAbandoned: 0, blockedAttempts: 0, mindfulPauses: 0 };
}

function currentSession() {
  const session = FocoCore.normalizeSession(state.focusSession);
  return session && session.status === "active" && !session.expired ? session : null;
}

function showView(name) {
  const safe = ["today", "distractions", "insights"].includes(name) ? name : "today";
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === "view-" + safe));
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === safe));
  const titles = { today: "Sua atenção, hoje", distractions: "Proteja seu ambiente", insights: "Seu progresso" };
  $("viewTitle").textContent = titles[safe];
  history.replaceState(null, "", "#" + safe);
}

function renderProtection() {
  const session = currentSession();
  const enabled = state.blockingEnabled !== false || Boolean(session);
  $("protectionText").textContent = session ? "Sessão protegida" : enabled ? "Proteção ativa" : "Proteção sob demanda";
  document.querySelector(".protection-pill").classList.toggle("off", !enabled);
}

function renderSession() {
  const session = currentSession();
  $("focusForm").hidden = Boolean(session);
  $("focusRunning").hidden = !session;
  $("focusHeading").textContent = session ? "Você já começou. Agora, permaneça." : "Qual é a única coisa que importa agora?";
  $("focusDescription").textContent = session ? "As distrações estão bloqueadas e seu ambiente foi simplificado até o cronômetro terminar." : "Defina uma intenção. Durante a sessão, suas distrações serão bloqueadas e o limite de abas ficará mais rígido.";
  if (!session) return;
  const remaining = Math.max(0, session.endsAt - Date.now());
  $("sessionTimer").textContent = formatClock(remaining);
  $("sessionIntention").textContent = session.intention || "Sessão sem título";
  $("sessionMeta").textContent = (session.deepMode ? "Modo profundo" : "Pausas conscientes disponíveis") + " · até " + new Date(session.endsAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const progress = Math.min(1, Math.max(0, (Date.now() - session.startedAt) / (session.endsAt - session.startedAt)));
  $("timerRing").style.setProperty("--progress", Math.round(progress * 360) + "deg");
}

function renderChart(id, series) {
  const node = $(id);
  const stats = FocoCore.normalizeDailyStats(state.dailyStats);
  const max = Math.max(1, ...series.map((day) => (stats[day.key] && stats[day.key].focusMinutes) || 0));
  node.innerHTML = "";
  series.forEach((day, index) => {
    const value = Math.round((stats[day.key] && stats[day.key].focusMinutes) || 0);
    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";
    const val = document.createElement("span"); val.className = "bar-value"; val.textContent = value ? value + "m" : "";
    const bar = document.createElement("span"); bar.className = "bar" + (index === series.length - 1 ? " today" : ""); bar.style.height = Math.max(3, Math.round((value / max) * 100)) + "%";
    const label = document.createElement("span"); label.className = "bar-label"; label.textContent = new Intl.DateTimeFormat("pt-BR", { weekday: "short" }).format(day.date).replace(".", "");
    wrap.append(val, bar, label); node.appendChild(wrap);
  });
}

function renderStats() {
  const stats = FocoCore.normalizeDailyStats(state.dailyStats);
  const today = getTodayStats();
  const goal = FocoCore.clampInt(state.dailyFocusGoalMinutes, 5, 600, 50);
  const streak = FocoCore.calculateStreak(stats, goal);
  $("todayMinutes").textContent = Math.round(today.focusMinutes);
  $("goalMinutes").textContent = goal;
  $("goalInput").value = goal;
  $("goalProgress").style.width = Math.min(100, Math.round((today.focusMinutes / goal) * 100)) + "%";
  $("todaySessions").textContent = today.sessionsCompleted;
  $("todayBlocks").textContent = today.blockedAttempts;
  $("streakValue").textContent = streak;
  $("insightStreak").textContent = streak + (streak === 1 ? " dia" : " dias");
  const week = daySeries();
  const previous = daySeries(7, 7);
  const weekMinutes = week.reduce((sum, day) => sum + ((stats[day.key] && stats[day.key].focusMinutes) || 0), 0);
  const previousMinutes = previous.reduce((sum, day) => sum + ((stats[day.key] && stats[day.key].focusMinutes) || 0), 0);
  const completed = week.reduce((sum, day) => sum + ((stats[day.key] && stats[day.key].sessionsCompleted) || 0), 0);
  const blocks = week.reduce((sum, day) => sum + ((stats[day.key] && stats[day.key].blockedAttempts) || 0), 0);
  $("weekMinutes").textContent = formatMinutes(weekMinutes);
  $("completedTotal").textContent = completed;
  $("blocksTotal").textContent = blocks;
  $("weekComparison").textContent = previousMinutes ? (weekMinutes >= previousMinutes ? "+" : "") + Math.round(((weekMinutes - previousMinutes) / previousMinutes) * 100) + "% vs. semana anterior" : weekMinutes ? "Sua primeira semana em construção." : "Comece sua primeira sessão.";
  renderChart("weekChart", week); renderChart("insightChart", week);
}

function pendingAt(map, host) {
  const value = parseMap(map)[host];
  return Number.isFinite(Number(value)) && Number(value) > Date.now() ? Number(value) : null;
}

function actionButton(label, className, onClick) {
  const button = document.createElement("button"); button.type = "button"; button.className = className; button.textContent = label; button.addEventListener("click", onClick); return button;
}

function renderDomains() {
  const domains = [...new Set((Array.isArray(state.userDomains) ? state.userDomains : []).map(FocoCore.normalizeHost).filter(Boolean))].sort();
  const list = $("domainList"); list.innerHTML = ""; $("domainCount").textContent = domains.length; $("domainEmpty").hidden = domains.length > 0;
  const cooldown = FocoCore.clampInt(state.pendingCooldownMinutes, 1, 180, 5);
  domains.forEach((host) => {
    const end = pendingAt(state.pendingRemovals, host);
    const li = document.createElement("li"); li.className = "item-row";
    const main = document.createElement("div"); main.className = "item-main"; main.innerHTML = "<strong></strong><small></small>"; main.querySelector("strong").textContent = host; main.querySelector("small").textContent = end ? "Remoção em " + formatClock(end - Date.now()) : "Bloqueio completo";
    const actions = document.createElement("div"); actions.className = "item-actions";
    actions.appendChild(actionButton(end ? "Cancelar" : "Remover", "danger-link", () => end ? cancelPending("pendingRemovals", host) : scheduleRemoval("pendingRemovals", host, cooldown)));
    li.append(main, actions); list.appendChild(li);
  });
}

function usageFor(host) {
  const row = parseMap(state.siteTimeUsage)[host];
  return row && row.day === FocoCore.localDayKey() ? Math.max(0, Number(row.usedMs) || 0) : 0;
}

function renderLimits() {
  const limits = parseMap(state.siteTimeLimits); const hosts = Object.keys(limits).sort(); const list = $("limitList"); list.innerHTML = ""; $("limitEmpty").hidden = hosts.length > 0;
  const cooldown = FocoCore.clampInt(state.pendingCooldownMinutes, 1, 180, 5);
  hosts.forEach((host) => {
    const max = Number(limits[host]) || 0; const usedMin = usageFor(host) / 60000; const end = pendingAt(state.pendingTimeLimitRemovals, host);
    const li = document.createElement("li"); li.className = "item-row";
    const main = document.createElement("div"); main.className = "item-main";
    const title = document.createElement("strong"); title.textContent = host;
    const detail = document.createElement("small"); detail.textContent = end ? "Remoção em " + formatClock(end - Date.now()) : formatMinutes(usedMin) + " de " + max + " min hoje";
    const progress = document.createElement("div"); progress.className = "progress-mini"; const fill = document.createElement("span"); fill.style.width = Math.min(100, Math.round((usedMin / max) * 100)) + "%"; progress.appendChild(fill); main.append(title, detail, progress);
    const actions = document.createElement("div"); actions.className = "item-actions"; actions.appendChild(actionButton(end ? "Cancelar" : "Remover", "danger-link", () => end ? cancelPending("pendingTimeLimitRemovals", host) : scheduleRemoval("pendingTimeLimitRemovals", host, cooldown)));
    li.append(main, actions); list.appendChild(li);
  });
}

function renderBlocking() {
  const checked = state.blockingEnabled !== false; $("blockingEnabled").checked = checked; $("blockingLabel").textContent = checked ? "Bloqueio contínuo" : "Só durante sessões";
  const end = Number(state.pendingDisableAt); const pending = Number.isFinite(end) && end > Date.now(); $("pendingDisableCard").hidden = !pending; if (pending) $("disableTimer").textContent = formatClock(end - Date.now());
}

function renderRanking() {
  const rows = parseMap(parseMap(state.blockedAttemptsByHost)[FocoCore.localDayKey()]);
  const entries = Object.entries(rows).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 6); const list = $("blockedRanking"); list.innerHTML = ""; $("rankingEmpty").hidden = entries.length > 0;
  entries.forEach(([host, count]) => { const li = document.createElement("li"); const name = document.createElement("strong"); name.textContent = host; const total = document.createElement("span"); total.textContent = count + (Number(count) === 1 ? " tentativa" : " tentativas"); li.append(name, total); list.appendChild(li); });
}

function renderHistory() {
  const rows = Array.isArray(state.focusHistory) ? [...state.focusHistory].reverse().slice(0, 12) : []; const list = $("historyList"); list.innerHTML = "";
  if (!rows.length) { list.innerHTML = '<div class="empty-state compact"><p>Suas sessões concluídas aparecerão aqui.</p></div>'; return; }
  rows.forEach((entry) => { const row = document.createElement("div"); row.className = "history-row"; const time = document.createElement("time"); time.textContent = new Date(entry.startedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }); const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = entry.intention || "Sessão de foco"; const meta = document.createElement("small"); meta.textContent = formatMinutes(entry.focusedMinutes); copy.append(title, meta); const outcome = document.createElement("span"); outcome.className = "outcome " + (entry.outcome === "completed" ? "" : "abandoned"); outcome.textContent = entry.outcome === "completed" ? "Concluída" : "Encerrada"; row.append(time, copy, outcome); list.appendChild(row); });
}

function renderAll() { $("dateLabel").textContent = dateLabel(); renderProtection(); renderSession(); renderStats(); renderBlocking(); renderDomains(); renderLimits(); renderRanking(); renderHistory(); }

async function load() { state = await chrome.storage.local.get(KEYS); renderAll(); startTicker(); }

function startTicker() {
  clearInterval(ticker);
  ticker = setInterval(() => { renderSession(); renderBlocking(); renderDomains(); renderLimits(); if (!currentSession() && state.focusSession) void load(); }, 1000);
}

async function scheduleRemoval(key, host, minutes) { const map = { ...parseMap(state[key]), [host]: Date.now() + minutes * 60000 }; await chrome.storage.local.set({ [key]: map }); await send({ type: "reschedulePending" }); toast("A remoção acontecerá após " + minutes + " min. Você pode cancelar."); }
async function cancelPending(key, host) { const map = { ...parseMap(state[key]) }; delete map[host]; await chrome.storage.local.set({ [key]: Object.keys(map).length ? map : null }); await send({ type: "reschedulePending" }); toast("Remoção cancelada."); }

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.go)));
document.querySelectorAll("[data-duration]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-duration]").forEach((item) => item.classList.remove("selected")); button.classList.add("selected"); $("focusDuration").value = button.dataset.duration; }));

$("focusForm").addEventListener("submit", async (event) => { event.preventDefault(); const intention = $("focusIntention").value.trim(); const durationMin = FocoCore.clampInt($("focusDuration").value, 5, 180, 25); if (!intention) return toast("Escreva uma intenção clara para esta sessão.", false); const result = await send({ type: "startFocusSession", payload: { intention, durationMin, deepMode: $("deepMode").checked, sessionTabLimit: $("sessionTabLimit").value } }); if (!result || !result.ok) return toast("Não foi possível começar a sessão.", false); $("focusIntention").value = ""; toast("Sessão iniciada. Uma coisa de cada vez."); await load(); });
$("finishSession").addEventListener("click", async () => { if (!confirm("Encerrar esta sessão antes do tempo? O progresso realizado será salvo.")) return; await send({ type: "finishFocusSession", outcome: "abandoned" }); toast("Sessão encerrada e progresso salvo."); await load(); });

$("editGoal").addEventListener("click", () => { $("goalEdit").hidden = !$("goalEdit").hidden; });
$("saveGoal").addEventListener("click", async () => { const goal = FocoCore.clampInt($("goalInput").value, 5, 600, 50); await chrome.storage.local.set({ dailyFocusGoalMinutes: goal }); $("goalEdit").hidden = true; toast("Meta diária atualizada para " + goal + " min."); });

$("formAdd").addEventListener("submit", async (event) => { event.preventDefault(); const host = FocoCore.normalizeHost($("newSite").value); if (!host) return toast("Informe um domínio ou URL válido.", false); const domains = [...new Set([...(Array.isArray(state.userDomains) ? state.userDomains : []), host])].sort(); if (domains.length === (state.userDomains || []).length) return toast("Esse site já está na lista.", false); await chrome.storage.local.set({ userDomains: domains }); $("newSite").value = ""; toast(host + " adicionado às distrações."); });

$("formTimeLimit").addEventListener("submit", async (event) => { event.preventDefault(); const host = FocoCore.normalizeHost($("timeLimitDomain").value); const minutes = FocoCore.clampInt($("timeLimitMins").value, 1, 1440, 30); if (!host) return toast("Informe um domínio válido.", false); const limits = { ...parseMap(state.siteTimeLimits), [host]: minutes }; await chrome.storage.local.set({ siteTimeLimits: limits }); $("timeLimitDomain").value = ""; toast("Orçamento de " + minutes + " min definido para " + host + "."); });

$("blockingEnabled").addEventListener("change", async (event) => { if (event.target.checked) { await chrome.storage.local.set({ blockingEnabled: true, pendingDisableAt: null }); await send({ type: "rebuild" }); toast("Bloqueio contínuo ativado."); return; } event.target.checked = true; const minutes = await focoGetPendingCooldownMinutes(); await chrome.storage.local.set({ pendingDisableAt: Date.now() + minutes * 60000 }); await send({ type: "reschedulePending" }); toast("Desativação iniciada com " + minutes + " min de reflexão."); });
$("cancelDisable").addEventListener("click", async () => { await chrome.storage.local.set({ pendingDisableAt: null }); await send({ type: "reschedulePending" }); toast("Proteção mantida."); });

chrome.storage.onChanged.addListener((_changes, area) => { if (area === "local") void load(); });
showView(location.hash.slice(1) || "today");
void load();
