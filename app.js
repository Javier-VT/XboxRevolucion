// ===================================================================
// Xbox Revolución · Control Center Cloud
// Edición para GitHub Pages / supervisión remota
// Mantiene el modelo Firebase actual sin ejecutar controles físicos locales.
// ===================================================================

const firebaseConfig = {
    apiKey: "AIzaSyCRcKlstpOzVB7IrpBDjViQpGzGWjNNsWg",
    authDomain: "xboxrevolucion-fe9cd.firebaseapp.com",
    databaseURL: "https://xboxrevolucion-fe9cd-default-rtdb.firebaseio.com",
    projectId: "xboxrevolucion-fe9cd",
    storageBucket: "xboxrevolucion-fe9cd.firebasestorage.app",
    messagingSenderId: "681073353068",
    appId: "1:681073353068:web:4b0b0af8bbf0d2e667d349"
};

const DB_PATH = "xbox_rev_db";
const CLAVE_ADMIN = "1980";
const LOCAL_BACKUP_KEY = "xbox_rev_cloud_snapshot_v3";
const DEFAULT_SETTINGS = Object.freeze({ p15: 8, p30: 15, p45: 20, p60: 25, ext1: 5, ext2: 10, ext3: 15 });

let database = null;
let currentRole = null;
let activeTab = "dashboard";
let isAdminAuthenticated = false;
let cloudConnected = false;
let lastCloudSyncAt = null;
let lastLocalBackupAt = null;
let saveInProgress = false;
let estadosPreviosDispositivos = {};

let db = createDefaultDB();

function createDefaultDB() {
    return {
        devices: [],
        employees: [],
        history: [],
        currentShift: {},
        settings: { ...DEFAULT_SETTINGS }
    };
}

function normalizeDB(data) {
    const base = data && typeof data === "object" ? data : {};
    const normalized = { ...base };

    normalized.devices = Array.isArray(base.devices)
        ? base.devices
        : (base.devices && typeof base.devices === "object" ? Object.values(base.devices) : []);
    normalized.employees = Array.isArray(base.employees)
        ? base.employees
        : (base.employees && typeof base.employees === "object" ? Object.values(base.employees) : []);
    normalized.history = Array.isArray(base.history)
        ? base.history
        : (base.history && typeof base.history === "object" ? Object.values(base.history) : []);
    normalized.currentShift = base.currentShift && typeof base.currentShift === "object" ? base.currentShift : {};
    normalized.settings = { ...DEFAULT_SETTINGS, ...(base.settings || {}) };

    normalized.devices = normalized.devices.filter(Boolean).map(dev => ({
        controls: 1,
        running: false,
        start: null,
        limit: null,
        esPromoTD: false,
        isUpdating: false,
        updateLimitMins: 0,
        pausedTime: 0,
        offlineSince: null,
        isOffline: false,
        ...dev
    }));

    return normalized;
}

function cloneClean(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMoney(value) {
    const num = Number(value) || 0;
    return `$${num.toFixed(2)}`;
}

function formatTimeStamp(date) {
    if (!date) return "Sin sincronización";
    return new Date(date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function saveLocalBackup() {
    try {
        localStorage.setItem(LOCAL_BACKUP_KEY, JSON.stringify({ savedAt: Date.now(), db: cloneClean(db) }));
        lastLocalBackupAt = Date.now();
    } catch (error) {
        console.warn("No se pudo guardar el respaldo local:", error);
    }
}

function restoreLocalBackup() {
    try {
        const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed?.db) return false;
        db = normalizeDB(parsed.db);
        lastLocalBackupAt = Number(parsed.savedAt) || null;
        return true;
    } catch (error) {
        console.warn("No se pudo recuperar la copia local:", error);
        return false;
    }
}

function renderSystemHealth() {
    const dot = document.getElementById("systemStatusDot");
    const text = document.getElementById("systemStatusText");
    const last = document.getElementById("lastSyncText");
    const loginDot = document.getElementById("loginStateDot");
    const loginText = document.getElementById("loginStateText");
    const banner = document.getElementById("connectionBanner");

    const setDot = (el, state) => {
        if (!el) return;
        el.classList.remove("online", "offline");
        if (state) el.classList.add(state);
    };

    if (cloudConnected) {
        setDot(dot, "online");
        setDot(loginDot, "online");
        if (text) text.textContent = saveInProgress ? "Sincronizando…" : "Nube conectada";
        if (loginText) loginText.textContent = "Conectado con la base central";
        if (last) last.textContent = lastCloudSyncAt ? `Actualizado ${formatTimeStamp(lastCloudSyncAt)}` : "Conexión disponible";
        if (banner) {
            banner.classList.add("hidden");
            banner.classList.remove("danger");
            banner.textContent = "";
        }
    } else {
        setDot(dot, "offline");
        setDot(loginDot, "offline");
        if (text) text.textContent = "Sin conexión";
        if (loginText) loginText.textContent = lastLocalBackupAt ? "Sin nube · mostrando última copia disponible" : "Sin conexión con Firebase";
        if (last) last.textContent = lastLocalBackupAt ? `Copia local ${formatTimeStamp(lastLocalBackupAt)}` : "Esperando reconexión";
        if (banner) {
            banner.classList.remove("hidden");
            banner.classList.add("danger");
            banner.textContent = "Conexión con Firebase interrumpida. La vista puede mostrar información desactualizada hasta recuperar la nube.";
        }
    }
}

function toast(title, message = "", type = "success") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `<strong>${escapeHTML(title)}</strong>${message ? `<span>${escapeHTML(message)}</span>` : ""}`;
    container.appendChild(el);
    requestAnimationFrame(() => el.classList.add("show"));
    setTimeout(() => {
        el.classList.remove("show");
        setTimeout(() => el.remove(), 240);
    }, 3200);
}

function initFirebase() {
    try {
        if (!window.firebase) throw new Error("Firebase SDK no disponible");
        if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
        database = firebase.database();

        database.ref(".info/connected").on("value", snapshot => {
            cloudConnected = snapshot.val() === true;
            renderSystemHealth();
        });

        database.ref(DB_PATH).on("value", snapshot => {
            const data = snapshot.val();
            if (data) {
                db = normalizeDB(data);
                lastCloudSyncAt = Date.now();
                saveLocalBackup();
            }

            initShifts();
            poblarSelectLogin();
            detectarCambiosOfflineParaNotificacion();

            if (currentRole) {
                refreshUI();
            }
            renderSystemHealth();
        }, error => {
            console.error("Error de lectura Firebase:", error);
            cloudConnected = false;
            renderSystemHealth();
            toast("No se pudo leer la nube", "Se mantiene la última copia disponible.", "danger");
        });
    } catch (error) {
        console.error("No se pudo iniciar Firebase:", error);
        cloudConnected = false;
        renderSystemHealth();
    }
}

async function saveDB(reason = "update") {
    saveLocalBackup();
    if (!database) {
        toast("Cambio guardado localmente", "Firebase no está disponible en este momento.", "warning");
        renderSystemHealth();
        return false;
    }

    saveInProgress = true;
    renderSystemHealth();
    try {
        await database.ref(DB_PATH).set(cloneClean(db));
        if (cloudConnected) lastCloudSyncAt = Date.now();
        return true;
    } catch (error) {
        console.error(`Error guardando (${reason}):`, error);
        toast("Error de sincronización", "El cambio permanece en la copia local del navegador.", "danger");
        return false;
    } finally {
        saveInProgress = false;
        renderSystemHealth();
    }
}

function initShifts() {
    if (!db.currentShift || typeof db.currentShift !== "object") db.currentShift = {};
    if (!db.currentShift["Administrador"]) db.currentShift["Administrador"] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    db.employees.forEach(emp => {
        if (!db.currentShift[emp.name]) db.currentShift[emp.name] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    });
}

function detectarCambiosOfflineParaNotificacion() {
    db.devices.forEach(dev => {
        const anterior = estadosPreviosDispositivos[dev.id];
        const ahoraOffline = dev.isOffline === true;
        if (anterior !== undefined && anterior === false && ahoraOffline) {
            dispararNotificacionFlotante(dev);
        }
        estadosPreviosDispositivos[dev.id] = ahoraOffline;
    });
}

function solicitarNotificaciones() {
    try {
        if (!isAdminAuthenticated || !window.Notification || Notification.permission !== "default") return;
        Notification.requestPermission().catch(() => {});
    } catch (_) {}
}

function dispararNotificacionFlotante(dev) {
    if (!isAdminAuthenticated || !window.Notification || Notification.permission !== "granted") return;
    try {
        const notification = new Notification("Terminal sin conexión", {
            body: `${dev.name} perdió conexión con el sistema local.`,
            icon: "logo.png",
            tag: `offline-${dev.id}`,
            requireInteraction: true
        });
        notification.onclick = function () { window.focus(); this.close(); };
        playBeep();
    } catch (_) {}
}

let audioCtx = null;
function playBeep() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.frequency.value = 800;
        osc.type = "sine";
        gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.42);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.42);
    } catch (_) {}
}

function poblarSelectLogin() {
    const select = document.getElementById("loginUserSelect");
    if (!select) return;
    const previous = select.value;
    select.innerHTML = `<option value="Administrador">Administrador</option>` + db.employees
        .map(emp => `<option value="${escapeHTML(emp.id)}">${escapeHTML(emp.name)}</option>`)
        .join("");
    if (previous && [...select.options].some(o => o.value === previous)) select.value = previous;
}

function realizarLogin() {
    const userId = document.getElementById("loginUserSelect")?.value;
    const pinInput = document.getElementById("loginPinInput")?.value || "";
    const errorMsg = document.getElementById("loginError");
    let nombreValidado = null;
    let esAdmin = false;

    if (userId === "Administrador") {
        if (pinInput === CLAVE_ADMIN) {
            nombreValidado = "Administrador";
            esAdmin = true;
        }
    } else {
        const empleado = db.employees.find(e => String(e.id) === String(userId));
        if (empleado && String(empleado.pin) === pinInput) nombreValidado = empleado.name;
    }

    if (!nombreValidado) {
        if (errorMsg) errorMsg.style.display = "block";
        return;
    }

    currentRole = nombreValidado;
    isAdminAuthenticated = esAdmin;
    if (errorMsg) errorMsg.style.display = "none";
    const pin = document.getElementById("loginPinInput");
    if (pin) pin.value = "";
    document.getElementById("loginOverlay").style.display = "none";
    document.getElementById("mainApp").style.display = "block";
    document.getElementById("currentUserNameDisplay").textContent = currentRole;
    document.getElementById("tabNav-admin").style.display = isAdminAuthenticated ? "inline-flex" : "none";
    solicitarNotificaciones();
    switchTab("dashboard");
    refreshUI();
}

function cerrarSesion() {
    document.getElementById("mainApp").style.display = "none";
    document.getElementById("loginOverlay").style.display = "flex";
    currentRole = null;
    isAdminAuthenticated = false;
    activeTab = "dashboard";
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById("tabNav-dashboard")?.classList.add("active");
    document.getElementById("tab-dashboard")?.classList.add("active");
}

function switchTab(tabId) {
    if (tabId === "admin" && !isAdminAuthenticated) return;
    activeTab = tabId;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));
    document.getElementById(`tabNav-${tabId}`)?.classList.add("active");
    document.getElementById(`tab-${tabId}`)?.classList.add("active");

    if (tabId === "dashboard") render();
    if (tabId === "caja") updateCajaUI();
    if (tabId === "admin") {
        cargarPreciosUI();
        poblarFiltroCajerosAdmin();
        renderAdminTables();
        renderHistoryTable();
    }
}

function poblarFiltroCajerosAdmin() {
    const userFilter = document.getElementById("filterHistoryUser");
    if (!userFilter) return;
    const currentSelected = userFilter.value || "all";
    userFilter.innerHTML = `<option value="all">Todos los usuarios</option><option value="Administrador">Administrador</option>` +
        db.employees.map(emp => `<option value="${escapeHTML(emp.name)}">${escapeHTML(emp.name)}</option>`).join("");
    if ([...userFilter.options].some(o => o.value === currentSelected)) userFilter.value = currentSelected;
}

function getElapsedMs(dev) {
    if (!dev.running || !dev.start) return 0;
    const currentEnd = (dev.isOffline && dev.offlineSince) ? Number(dev.offlineSince) : Date.now();
    return Math.max(0, currentEnd - Number(dev.start) - (Number(dev.pausedTime) || 0));
}

function calcularCobroEfectivo(tipo, controles, msTranscurridos, esPromoTD, limit = null) {
    if (esPromoTD && tipo === "Xbox") return 120.00;
    let mins = Number(msTranscurridos) / 60000;
    if (mins < 1) return 0.00;
    if (limit && mins > Number(limit)) mins = Number(limit);

    const s = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    let total = 0;

    if (tipo === "PC") {
        total = (Number(s.p60) / 60) * mins;
    } else {
        const horasEnteras = Math.floor(mins / 60);
        const minsRestantes = mins % 60;
        let cobroBase = horasEnteras * Number(s.p60);

        if (minsRestantes > 0) {
            if (minsRestantes <= 15) cobroBase += (Number(s.p15) / 15) * minsRestantes;
            else if (minsRestantes <= 30) cobroBase += Number(s.p15) + (((Number(s.p30) - Number(s.p15)) / 15) * (minsRestantes - 15));
            else if (minsRestantes <= 45) cobroBase += Number(s.p30) + (((Number(s.p45) - Number(s.p30)) / 15) * (minsRestantes - 30));
            else cobroBase += Number(s.p45) + (((Number(s.p60) - Number(s.p45)) / 15) * (minsRestantes - 45));
        }

        let costoExtraHora = 0;
        if (Number(controles) === 2) costoExtraHora = Number(s.ext1);
        else if (Number(controles) === 3) costoExtraHora = Number(s.ext2);
        else if (Number(controles) === 4) costoExtraHora = Number(s.ext3);

        const cobroControlesExtra = Number(controles) > 1 && mins >= 10
            ? costoExtraHora * Math.ceil(mins / 60)
            : 0;

        total = cobroBase + cobroControlesExtra;
    }

    return Math.max(5.00, Number(total) || 0);
}

function getRequestedTimeLabel(dev) {
    if (dev.isUpdating) return "Mantenimiento";
    if (!dev.running) return "Disponible";
    if (dev.esPromoTD) return "Promo Todo el Día";
    if (!dev.limit) return "Tiempo libre";
    const limit = Number(dev.limit);
    return limit >= 60 ? `${(limit / 60).toFixed(1).replace(".0", "")} h solicitada${limit > 60 ? "s" : ""}` : `${limit} min solicitados`;
}

function getDeviceStatus(dev) {
    if (dev.isOffline) return { text: "Sin conexión", cls: "offline" };
    if (dev.running && dev.limit && (getElapsedMs(dev) / 60000) >= Number(dev.limit)) return { text: "Tiempo cumplido", cls: "time-up" };
    if (dev.running) return { text: "En uso", cls: "active" };
    if (dev.isUpdating) return { text: "Mantenimiento", cls: "updating" };
    return { text: "Disponible", cls: "" };
}

function getDeviceTimerState(dev) {
    let tStr = "00:00:00";
    let cStr = "$0.00";

    if (dev.running) {
        const diff = getElapsedMs(dev);
        const mins = diff / 60000;
        tStr = `${Math.floor(mins / 60).toString().padStart(2, "0")}:${Math.floor(mins % 60).toString().padStart(2, "0")}:${Math.floor((diff / 1000) % 60).toString().padStart(2, "0")}`;
        cStr = formatMoney(calcularCobroEfectivo(dev.type, dev.controls, diff, dev.esPromoTD, dev.limit));

        if (dev.isOffline) tStr = `PAUSADO · ${tStr}`;

        if (dev.limit && mins >= Number(dev.limit)) {
            const limit = Number(dev.limit);
            const tolerance = limit <= 30 ? 5 : limit <= 60 ? 8 : limit <= 90 ? 10 : 15;
            const remaining = Math.max(0, (limit + tolerance) - mins);
            if (remaining <= 0 || dev.forcedOff) tStr = "TIEMPO AGOTADO";
            else if (!dev.isOffline) tStr = `TOLERANCIA · ${Math.floor(remaining)}m ${Math.floor((remaining * 60) % 60).toString().padStart(2, "0")}s`;
        }
    } else if (dev.isUpdating) {
        const remaining = Number(dev.updateLimitMins || 0) - ((Date.now() - Number(dev.updateStart || Date.now())) / 60000);
        if (remaining <= 0) {
            tStr = "LISTO PARA REVISAR";
            cStr = "Mantenimiento";
        } else {
            tStr = `${Math.floor(remaining).toString().padStart(2, "0")}:${Math.floor((remaining * 60) % 60).toString().padStart(2, "0")}`;
            cStr = dev.updateMode === "main" ? "Actualizando" : "Verificando";
        }
    }

    return { tStr, cStr };
}

function renderDashboardSummary() {
    const active = db.devices.filter(d => d.running).length;
    const offline = db.devices.filter(d => d.isOffline).length;
    const updating = db.devices.filter(d => d.isUpdating).length;
    const available = db.devices.filter(d => !d.running && !d.isUpdating && !d.isOffline).length;
    const liveRevenue = db.devices.reduce((sum, dev) => {
        if (!dev.running) return sum;
        return sum + calcularCobroEfectivo(dev.type, dev.controls, getElapsedMs(dev), dev.esPromoTD, dev.limit);
    }, 0);

    const map = {
        summaryActive: active,
        summaryAvailable: available,
        summaryUpdating: updating,
        summaryOffline: offline
    };
    Object.entries(map).forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
    });
    const revenue = document.getElementById("dashboardLiveRevenue");
    if (revenue) revenue.textContent = formatMoney(liveRevenue);
}

function render() {
    if (!currentRole) return;
    const grid = document.getElementById("devicesGrid");
    if (!grid) return;

    renderDashboardSummary();

    if (!db.devices.length) {
        grid.innerHTML = `<div class="empty-state">No hay terminales registradas todavía.</div>`;
        return;
    }

    grid.innerHTML = db.devices.map(dev => {
        const timerState = getDeviceTimerState(dev);
        const status = getDeviceStatus(dev);
        let cardClass = `card ${dev.type === "PC" ? "pc" : ""}`;
        if (dev.isOffline) cardClass += " offline";
        if (dev.running) cardClass += " active";
        if (dev.isUpdating) cardClass += " updating";
        if (status.cls === "time-up") cardClass += " time-up";

        const controlsInfo = dev.type === "Xbox" && dev.running
            ? `<span class="detail-chip">${Number(dev.controls) || 1} control${Number(dev.controls) === 1 ? "" : "es"}</span>`
            : "";
        const promoInfo = dev.esPromoTD && dev.running ? `<span class="detail-chip">Promo TD</span>` : "";

        let observerText = "Esperando actividad del sistema local";
        let observerClass = "";
        if (dev.running) observerText = "Sesión activa en el local";
        if (dev.isUpdating) { observerText = "Equipo en mantenimiento"; observerClass = "updating"; }
        if (dev.isOffline) { observerText = "Terminal reportada sin conexión"; observerClass = "offline"; }

        return `
            <article class="${cardClass}" id="card-${escapeHTML(dev.id)}">
                <div class="card-header">
                    <div class="device-identity">
                        <div class="device-name-row">
                            <span class="badge ${dev.type === "PC" ? "badge-pc" : "badge-xbox"}">${escapeHTML(dev.type)}</span>
                            <h3 class="device-title">${escapeHTML(dev.name)}</h3>
                        </div>
                        <div class="device-network">
                            <span class="ip-label">${escapeHTML(dev.ip || "Sin IP")}</span>
                            ${dev.monitorIp ? `<span class="ip-label">Monitor ${escapeHTML(dev.monitorIp)}</span>` : ""}
                        </div>
                    </div>
                    <span class="device-status-pill ${status.cls}">${status.text}</span>
                </div>

                <div class="session-panel">
                    <div class="session-label-row">
                        <span class="session-label">Tiempo de sesión</span>
                        <span class="requested-time-label">${escapeHTML(getRequestedTimeLabel(dev))}</span>
                    </div>
                    <div class="timer-display" id="timer-${escapeHTML(dev.id)}">${escapeHTML(timerState.tStr)}</div>
                    <div class="cost-row">
                        <div>
                            <div class="cost-caption">Cobro estimado</div>
                            <div class="cost-display" id="cost-${escapeHTML(dev.id)}">${escapeHTML(timerState.cStr)}</div>
                        </div>
                        <div class="session-details">${controlsInfo}${promoInfo}</div>
                    </div>
                </div>

                <div class="remote-observer-note ${observerClass}">
                    <strong>Supervisión remota</strong>
                    <span>${escapeHTML(observerText)}</span>
                </div>
            </article>`;
    }).join("");
}

function updateCajaUI() {
    if (!currentRole) return;
    initShifts();
    const shift = db.currentShift[currentRole] || { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    const title = document.getElementById("cajaTitle");
    if (title) title.textContent = `Corte de caja · ${currentRole}`;
    document.getElementById("cajaEfectivoEsperado").textContent = formatMoney(shift.efectivoEsperado);
    document.getElementById("cajaSobrantes").textContent = formatMoney(shift.sobrantes);
    document.getElementById("cajaSesionesTurno").textContent = String(Number(shift.sesiones) || 0);
}

async function registrarSobrante() {
    if (!currentRole) return;
    const montoEl = document.getElementById("sobranteMonto");
    const notaEl = document.getElementById("sobranteNota");
    const monto = Number.parseFloat(montoEl?.value || "");
    if (!Number.isFinite(monto) || monto <= 0) {
        toast("Monto inválido", "Ingresa una cantidad mayor a cero.", "warning");
        return;
    }

    initShifts();
    const shift = db.currentShift[currentRole] || (db.currentShift[currentRole] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 });
    shift.sobrantes = (Number(shift.sobrantes) || 0) + monto;
    const nota = (notaEl?.value || "N/A").trim() || "N/A";
    db.history.push({
        timestamp: new Date().toISOString(),
        device: "Caja",
        cajero: currentRole,
        durationMins: 0,
        type: `Sobrante (${nota})`,
        monto
    });

    if (montoEl) montoEl.value = "";
    if (notaEl) notaEl.value = "";
    await saveDB("cash-adjustment");
    updateCajaUI();
    if (isAdminAuthenticated) renderHistoryTable();
    toast("Ajuste registrado", formatMoney(monto));
}

async function terminarTurno() {
    if (!currentRole) return;
    initShifts();
    if (!confirm(`¿Terminar el turno de ${currentRole}?\nEl conteo de caja de este usuario se reiniciará a $0.00.`)) return;
    db.currentShift[currentRole] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    await saveDB("shift-close");
    updateCajaUI();
    toast("Turno reiniciado", currentRole);
}

function guardarPrecios() {
    if (!isAdminAuthenticated) return;
    db.settings = {
        p15: Number.parseFloat(document.getElementById("cfg-p15").value) || DEFAULT_SETTINGS.p15,
        p30: Number.parseFloat(document.getElementById("cfg-p30").value) || DEFAULT_SETTINGS.p30,
        p45: Number.parseFloat(document.getElementById("cfg-p45").value) || DEFAULT_SETTINGS.p45,
        p60: Number.parseFloat(document.getElementById("cfg-p60").value) || DEFAULT_SETTINGS.p60,
        ext1: Number.parseFloat(document.getElementById("cfg-ext1").value) || DEFAULT_SETTINGS.ext1,
        ext2: Number.parseFloat(document.getElementById("cfg-ext2").value) || DEFAULT_SETTINGS.ext2,
        ext3: Number.parseFloat(document.getElementById("cfg-ext3").value) || DEFAULT_SETTINGS.ext3
    };
    saveDB("prices").then(ok => {
        toast(ok ? "Precios actualizados" : "Precios guardados localmente", ok ? "Cambios sincronizados con Firebase." : "Pendientes de sincronización.", ok ? "success" : "warning");
    });
}

function cargarPreciosUI() {
    const settings = { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
    ["p15", "p30", "p45", "p60", "ext1", "ext2", "ext3"].forEach(key => {
        const el = document.getElementById(`cfg-${key}`);
        if (el) el.value = settings[key];
    });
}

function isValidHost(value) {
    const v = String(value || "").trim();
    if (!v || v.length > 80) return false;
    return /^[a-zA-Z0-9._:-]+$/.test(v);
}

function guardarDispositivo() {
    if (!isAdminAuthenticated) return;
    const id = document.getElementById("editDevId").value;
    const name = document.getElementById("devName").value.trim();
    const ip = document.getElementById("devIP").value.trim();
    const type = document.getElementById("devType").value;

    if (!name || !ip) return toast("Faltan datos", "Nombre e IP son obligatorios.", "warning");
    if (!isValidHost(ip)) return toast("IP inválida", "Revisa la dirección de la terminal.", "warning");
    if (db.devices.some(d => d.ip === ip && String(d.id) !== String(id))) return toast("IP duplicada", "Esa IP ya está asignada.", "warning");

    if (id) {
        const dev = db.devices.find(d => String(d.id) === String(id));
        if (!dev) return;
        dev.name = name;
        dev.ip = ip;
        dev.type = type;
    } else {
        db.devices.push({
            id: `dev-${Date.now()}`,
            name,
            ip,
            type,
            running: false,
            start: null,
            limit: null,
            esPromoTD: false,
            controls: 1,
            isUpdating: false,
            updateLimitMins: 0,
            pausedTime: 0,
            offlineSince: null,
            isOffline: false
        });
    }

    cancelarEdicionDev();
    saveDB("device-save").then(() => {
        renderAdminTables();
        render();
        toast("Terminal guardada", name);
    });
}

function editarDispositivo(id) {
    if (!isAdminAuthenticated) return;
    const dev = db.devices.find(d => String(d.id) === String(id));
    if (!dev) return;
    document.getElementById("editDevId").value = dev.id;
    document.getElementById("devName").value = dev.name || "";
    document.getElementById("devIP").value = dev.ip || "";
    document.getElementById("devType").value = dev.type === "PC" ? "PC" : "Xbox";
    const btn = document.getElementById("btnSaveDev");
    btn.textContent = "Guardar cambios";
    document.getElementById("btnCancelDev").style.display = "inline-flex";
}

function cancelarEdicionDev() {
    document.getElementById("editDevId").value = "";
    document.getElementById("devName").value = "";
    document.getElementById("devIP").value = "";
    document.getElementById("devType").value = "Xbox";
    document.getElementById("btnSaveDev").textContent = "Agregar terminal";
    document.getElementById("btnCancelDev").style.display = "none";
}

function eliminarDispositivo(id) {
    if (!isAdminAuthenticated) return;
    const dev = db.devices.find(d => String(d.id) === String(id));
    if (!dev) return;
    if (dev.running || dev.isUpdating) return toast("Terminal ocupada", "No se puede eliminar mientras está activa o en mantenimiento.", "warning");
    if (!confirm(`¿Eliminar permanentemente ${dev.name}?`)) return;
    db.devices = db.devices.filter(d => String(d.id) !== String(id));
    saveDB("device-delete").then(() => {
        renderAdminTables();
        render();
        toast("Terminal eliminada", dev.name, "warning");
    });
}

function guardarEmpleado() {
    if (!isAdminAuthenticated) return;
    const id = document.getElementById("editEmpId").value;
    const name = document.getElementById("empName").value.trim();
    const pin = document.getElementById("empPin").value.trim();
    if (!name || !pin) return toast("Faltan datos", "Nombre y PIN son obligatorios.", "warning");
    if (!/^\d{3,12}$/.test(pin)) return toast("PIN inválido", "Usa entre 3 y 12 dígitos.", "warning");
    if (db.employees.some(e => String(e.name).toLowerCase() === name.toLowerCase() && String(e.id) !== String(id))) return toast("Empleado duplicado", "Ese nombre ya existe.", "warning");

    if (id) {
        const emp = db.employees.find(e => String(e.id) === String(id));
        if (!emp) return;
        const oldName = emp.name;
        emp.name = name;
        emp.pin = pin;
        if (oldName !== name) {
            db.currentShift[name] = db.currentShift[oldName] || { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
            delete db.currentShift[oldName];
        }
    } else {
        db.employees.push({ id: `emp-${Date.now()}`, name, pin });
        db.currentShift[name] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    }

    cancelarEdicionEmp();
    saveDB("employee-save").then(() => {
        renderAdminTables();
        poblarSelectLogin();
        poblarFiltroCajerosAdmin();
        toast("Empleado guardado", name);
    });
}

function editarEmpleado(id) {
    if (!isAdminAuthenticated) return;
    const emp = db.employees.find(e => String(e.id) === String(id));
    if (!emp) return;
    document.getElementById("editEmpId").value = emp.id;
    document.getElementById("empName").value = emp.name || "";
    document.getElementById("empPin").value = emp.pin || "";
    document.getElementById("btnSaveEmp").textContent = "Guardar cambios";
    document.getElementById("btnCancelEmp").style.display = "inline-flex";
}

function cancelarEdicionEmp() {
    document.getElementById("editEmpId").value = "";
    document.getElementById("empName").value = "";
    document.getElementById("empPin").value = "";
    document.getElementById("btnSaveEmp").textContent = "Agregar empleado";
    document.getElementById("btnCancelEmp").style.display = "none";
}

function eliminarEmpleado(id) {
    if (!isAdminAuthenticated) return;
    const emp = db.employees.find(e => String(e.id) === String(id));
    if (!emp) return;
    if (!confirm(`¿Dar de baja a ${emp.name}?`)) return;
    db.employees = db.employees.filter(e => String(e.id) !== String(id));
    delete db.currentShift[emp.name];
    saveDB("employee-delete").then(() => {
        renderAdminTables();
        poblarSelectLogin();
        poblarFiltroCajerosAdmin();
        toast("Empleado dado de baja", emp.name, "warning");
    });
}

function renderAdminTables() {
    const devTbody = document.getElementById("adminDevicesTableBody");
    if (devTbody) {
        devTbody.innerHTML = db.devices.length ? db.devices.map(d => `
            <tr>
                <td><strong>${escapeHTML(d.name)}</strong></td>
                <td><span class="badge ${d.type === "PC" ? "badge-pc" : "badge-xbox"}">${escapeHTML(d.type)}</span></td>
                <td><span class="ip-label">${escapeHTML(d.ip || "—")}</span></td>
                <td class="action-cell">
                    <button class="btn btn-secondary btn-compact" onclick="editarDispositivo('${escapeHTML(d.id)}')">Editar</button>
                    <button class="btn btn-danger btn-compact" onclick="eliminarDispositivo('${escapeHTML(d.id)}')">Borrar</button>
                </td>
            </tr>`).join("") : `<tr><td colspan="4" class="table-empty">No hay terminales registradas.</td></tr>`;
    }

    const empTbody = document.getElementById("adminEmployeesTableBody");
    if (empTbody) {
        empTbody.innerHTML = db.employees.length ? db.employees.map(e => `
            <tr>
                <td><strong>${escapeHTML(e.name)}</strong></td>
                <td><span class="pin-mask">••••</span></td>
                <td class="action-cell">
                    <button class="btn btn-secondary btn-compact" onclick="editarEmpleado('${escapeHTML(e.id)}')">Editar</button>
                    <button class="btn btn-danger btn-compact" onclick="eliminarEmpleado('${escapeHTML(e.id)}')">Baja</button>
                </td>
            </tr>`).join("") : `<tr><td colspan="3" class="table-empty">No hay empleados registrados.</td></tr>`;
    }
}

function renderHistoryTable() {
    const range = document.getElementById("filterHistoryRange")?.value || "all";
    const dateInput = document.getElementById("filterHistoryDate");
    const userFilter = document.getElementById("filterHistoryUser")?.value || "all";
    const tbody = document.getElementById("historyTableBody");
    if (!tbody) return;

    if (range === "exact" && dateInput) {
        dateInput.style.display = "block";
    } else if (dateInput) {
        dateInput.style.display = "none";
        dateInput.value = "";
    }

    let filtrados = [...db.history];
    const ahora = new Date();

    if (range === "day") filtrados = filtrados.filter(h => new Date(h.timestamp).toDateString() === ahora.toDateString());
    else if (range === "week") filtrados = filtrados.filter(h => new Date(h.timestamp) >= new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000));
    else if (range === "month") filtrados = filtrados.filter(h => {
        const d = new Date(h.timestamp);
        return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
    });
    else if (range === "exact" && dateInput?.value) filtrados = filtrados.filter(h => {
        const d = new Date(h.timestamp);
        const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return ymd === dateInput.value;
    });

    if (userFilter !== "all") filtrados = filtrados.filter(h => h.cajero === userFilter);
    filtrados.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    let ingresos = 0;
    let sobrantes = 0;

    if (!filtrados.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No hay movimientos para este filtro.</td></tr>`;
    } else {
        tbody.innerHTML = filtrados.map(h => {
            const monto = Number(h.monto) || 0;
            const type = String(h.type || "Movimiento");
            if (type.includes("Sobrante")) sobrantes += monto;
            else ingresos += monto;
            const horario = h.startStr ? `${h.startStr} a ${h.endStr || "—"}` : "N/A";
            return `
                <tr>
                    <td>${escapeHTML(new Date(h.timestamp).toLocaleDateString())}</td>
                    <td>${escapeHTML(h.device || "—")}</td>
                    <td>${escapeHTML(h.cajero || "—")}</td>
                    <td>${escapeHTML(horario)}<br><small>${Number(h.durationMins) || 0} min</small></td>
                    <td><span class="status-badge ${type.includes("Sobrante") ? "status-update" : "status-active"}">${escapeHTML(type)}</span></td>
                    <td><strong>${formatMoney(monto)}</strong></td>
                </tr>`;
        }).join("");
    }

    document.getElementById("adminTotalIngresos").textContent = formatMoney(ingresos);
    document.getElementById("adminTotalSobrantes").textContent = formatMoney(sobrantes);
}

function actualizarRelojesEnVivo() {
    if (!currentRole || !db.devices) return;
    db.devices.forEach(dev => {
        const timerEl = document.getElementById(`timer-${dev.id}`);
        const costEl = document.getElementById(`cost-${dev.id}`);
        if (!timerEl || !costEl) return;
        if (dev.running || dev.isUpdating) {
            const state = getDeviceTimerState(dev);
            timerEl.textContent = state.tStr;
            costEl.textContent = state.cStr;
        }
    });
    renderDashboardSummary();
}

function refreshUI() {
    initShifts();
    poblarSelectLogin();
    renderSystemHealth();
    if (!currentRole) return;
    render();
    updateCajaUI();
    if (isAdminAuthenticated) {
        renderAdminTables();
        cargarPreciosUI();
        poblarFiltroCajerosAdmin();
        renderHistoryTable();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    restoreLocalBackup();
    initShifts();
    poblarSelectLogin();
    renderSystemHealth();

    const loginPinInput = document.getElementById("loginPinInput");
    if (loginPinInput) loginPinInput.addEventListener("keydown", event => {
        if (event.key === "Enter") realizarLogin();
    });

    initFirebase();
});

window.addEventListener("online", renderSystemHealth);
window.addEventListener("offline", () => {
    cloudConnected = false;
    renderSystemHealth();
});

setInterval(() => {
    const liveClock = document.getElementById("liveClock");
    if (liveClock) liveClock.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    if (currentRole && db.devices.some(d => d.running || d.isUpdating)) actualizarRelojesEnVivo();
}, 1000);
