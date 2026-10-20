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

const APP_VERSION = "github-2.6.0-state-safe";
const DB_PATH = "xbox_rev_db";
const CLAVE_ADMIN = "1980";
const LOCAL_BACKUP_KEY = "xbox_rev_cloud_snapshot_v3";
const OWNER_TRUST_KEY = "xbox_rev_owner_trusted_v1";
const DEFAULT_SETTINGS = Object.freeze({ p15: 8, p30: 15, p45: 20, p60: 25, ext1: 5, ext2: 10, ext3: 15 });
const PROMO_TD_PRICE = 120;

let database = null;
let currentRole = null;
let activeTab = "dashboard";
let isAdminAuthenticated = false;
let cloudConnected = false;
let cloudReady = false;
let lastCloudSyncAt = null;
let lastLocalBackupAt = null;
let saveInProgress = false;
let estadosPreviosDispositivos = {};
let lastRemoteDevices = [];

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


function normalizeSessionModeValue(value) {
    return ["free", "limited", "promo"].includes(value) ? value : null;
}

function normalizeOperationalStateValue(value) {
    return ["available", "session", "maintenance"].includes(value) ? value : null;
}

function inferOperationalState(device) {
    const explicit = normalizeOperationalStateValue(device?.operationalState);
    if (explicit) return explicit;
    if (Boolean(device?.running)) return "session";
    if (Boolean(device?.isUpdating)) return "maintenance";
    return "available";
}

function inferSessionMode(device) {
    if (inferOperationalState(device) !== "session") return null;
    const explicit = normalizeSessionModeValue(device?.sessionMode);
    if (explicit) return explicit;
    if (Boolean(device?.esPromoTD)) return "promo";
    if (Number(device?.limit) > 0) return "limited";
    return "free";
}

function enforceOperationalState(device) {
    if (!device) return device;
    const state = inferOperationalState(device);
    device.operationalState = state;
    device.stateRevision = Math.max(0, Number(device.stateRevision) || 0);
    device.stateEventId = device.stateEventId || `legacy-state-${device.id}-${state}-${Number(device.start || device.updateStart || 0)}`;
    if (state === "session") {
        device.running = true;
        device.isUpdating = false;
        device.updateMode = null;
        device.updateStart = null;
        device.updateLimitMins = 0;
        device.maintenanceId = null;
        const mode = inferSessionMode(device) || "free";
        device.sessionMode = mode;
        device.sessionId = device.sessionId || `legacy-${device.id}-${Number(device.start) || Date.now()}`;
        device.esPromoTD = mode === "promo";
        if (mode !== "limited") device.limit = null;
    } else if (state === "maintenance") {
        device.running = false;
        device.isUpdating = true;
        device.start = null;
        device.limit = null;
        device.esPromoTD = false;
        device.sessionMode = null;
        device.sessionId = null;
        device.maintenanceId = device.maintenanceId || `legacy-maintenance-${device.id}-${Number(device.updateStart) || 0}`;
    } else {
        device.running = false;
        device.isUpdating = false;
        device.start = null;
        device.limit = null;
        device.esPromoTD = false;
        device.sessionMode = null;
        device.sessionId = null;
        device.updateMode = null;
        device.updateStart = null;
        device.updateLimitMins = 0;
        device.maintenanceId = null;
    }
    return device;
}

function getOperationalState(device) { return inferOperationalState(device); }
function getSessionMode(device) { return inferSessionMode(device); }
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
        forcedOff: false,
        forcedOffAt: null,
        toleranceFreeMs: 0,
        sessionId: null,
        sessionMode: null,
        operationalState: null,
        stateRevision: 0,
        stateEventId: null,
        statePrevEventId: null,
        stateChangedAt: null,
        stateChangedBy: null,
        stateReason: null,
        maintenanceId: null,
        ...dev
    })).map(enforceOperationalState);

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
    el.innerHTML = `<div></div><div><strong>${escapeHTML(title)}</strong>${message ? `<span>${escapeHTML(message)}</span>` : ""}</div>`;
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
            cloudReady = true;

            if (data) {
                db = normalizeDB(data);
                lastRemoteDevices = cloneClean(db.devices || []);
                lastCloudSyncAt = Date.now();

                // Copia del navegador solo para recuperación manual.
                // Nunca se restaura automáticamente sobre Firebase.
                saveLocalBackup();
            }

            initShifts();
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

async function readRemoteDevices() {
    if (!database) return [];
    const snap = await database.ref(`${DB_PATH}/devices`).once("value");
    const raw = snap.val();
    return Array.isArray(raw)
        ? raw.filter(Boolean)
        : (raw && typeof raw === "object" ? Object.values(raw).filter(Boolean) : []);
}

function mergeDeviceConfigurationWithoutTouchingSessions(localDevices, remoteDevices) {
    const localById = new Map((localDevices || []).map(d => [String(d.id), d]));
    const remoteById = new Map((remoteDevices || []).map(d => [String(d.id), d]));
    const merged = [];

    // Conserva toda la sesión/runtime de Firebase. Desde GitHub solo se cambian
    // los campos de configuración de terminal.
    for (const remoteDev of remoteDevices || []) {
        const localDev = localById.get(String(remoteDev.id));

        if (!localDev) {
            // Una eliminación remota solo se permite si no está ocupada.
            if (getOperationalState(remoteDev) !== "available") {
                merged.push(remoteDev);
            }
            continue;
        }

        merged.push({
            ...remoteDev,
            name: localDev.name,
            ip: localDev.ip,
            monitorIp: localDev.monitorIp ?? remoteDev.monitorIp ?? "",
            type: localDev.type
        });
    }

    // Terminales nuevas.
    for (const localDev of localDevices || []) {
        if (!remoteById.has(String(localDev.id))) {
            merged.push({
                ...localDev,
                running: false,
                start: null,
                limit: null,
                esPromoTD: false,
                sessionMode: null,
                sessionId: null,
                operationalState: "available",
                stateRevision: 1,
                stateEventId: `state-web-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                statePrevEventId: null,
                stateChangedAt: Date.now(),
                stateChangedBy: "Administrador",
                stateReason: "device-created-web",
                maintenanceId: null,
                forcedOff: false,
                forcedOffAt: null,
                pausedTime: 0,
                offlineSince: null,
                toleranceFreeMs: 0
            });
        }
    }

    return merged.map(enforceOperationalState);
}

async function saveDB(reason = "update", options = {}) {
    if (!database || !cloudReady) {
        toast("Firebase todavía está cargando", "Espera unos segundos antes de guardar cambios.", "warning");
        renderSystemHealth();
        return false;
    }

    saveInProgress = true;
    renderSystemHealth();

    try {
        const clean = cloneClean(db);

        switch (reason) {
            case "prices":
                await database.ref(`${DB_PATH}/settings`).set(clean.settings || {});
                break;

            case "cash-adjustment": {
                const user = options.user || currentRole || "Administrador";
                const amount = Number(options.amount) || 0;
                const historyRecord = options.historyRecord || null;
                if (amount > 0) {
                    await database.ref(`${DB_PATH}/currentShift/${user}/sobrantes`).transaction(current => (Number(current) || 0) + amount);
                }
                if (historyRecord) {
                    await database.ref(`${DB_PATH}/history`).transaction(current => {
                        const list = Array.isArray(current) ? current.filter(Boolean) : (current && typeof current === "object" ? Object.values(current).filter(Boolean) : []);
                        const key = [historyRecord.timestamp, historyRecord.device, historyRecord.cajero, historyRecord.type, historyRecord.monto].join("|");
                        const exists = list.some(item => [item?.timestamp, item?.device, item?.cajero, item?.type, item?.monto].join("|") === key);
                        if (!exists) list.push(historyRecord);
                        return list;
                    }, undefined, false);
                }
                break;
            }

            case "shift-close": {
                // Reinicia a cero todos los cajeros que existan en Firebase en este momento.
                await database.ref(`${DB_PATH}/currentShift`).transaction(current => {
                    const out = {};
                    Object.keys(current || {}).forEach(name => { out[name] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 }; });
                    return out;
                }, undefined, false);
                break;
            }

            case "employee-save":
            case "employee-delete": {
                await database.ref(`${DB_PATH}/employees`).set(clean.employees || []);
                if (reason === "employee-save" && options.newName) {
                    // Solo se toca la caja de ese empleado; la del resto no se reemplaza.
                    await database.ref(`${DB_PATH}/currentShift`).transaction(current => {
                        const out = current && typeof current === "object" ? { ...current } : {};
                        if (options.oldName && options.oldName !== options.newName && out[options.oldName]) {
                            out[options.newName] = out[options.oldName];
                            delete out[options.oldName];
                        } else if (!out[options.newName]) {
                            out[options.newName] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
                        }
                        return out;
                    }, undefined, false);
                }
                break;
            }

            case "device-save": {
                const targetId = String(options.deviceId || "");
                const localDev = (clean.devices || []).find(d => String(d.id) === targetId);
                if (!localDev) throw new Error("No se encontró la terminal a guardar.");

                const tx = await database.ref(`${DB_PATH}/devices`).transaction(current => {
                    const list = Array.isArray(current) ? current.filter(Boolean) : (current && typeof current === "object" ? Object.values(current).filter(Boolean) : []);
                    const index = list.findIndex(d => String(d?.id) === targetId);
                    if (index >= 0) {
                        const remoteDev = enforceOperationalState({ ...list[index] });
                        list[index] = enforceOperationalState({
                            ...remoteDev,
                            name: localDev.name,
                            ip: localDev.ip,
                            monitorIp: localDev.monitorIp ?? remoteDev.monitorIp ?? "",
                            type: localDev.type
                        });
                    } else {
                        list.push(enforceOperationalState({
                            ...localDev,
                            running: false,
                            isUpdating: false,
                            operationalState: "available"
                        }));
                    }
                    return list;
                }, undefined, false);
                if (!tx.committed) throw new Error("No se pudo guardar la terminal.");
                break;
            }

            case "device-delete": {
                const targetId = String(options.deviceId || "");
                let blocked = false;
                const tx = await database.ref(`${DB_PATH}/devices`).transaction(current => {
                    const list = Array.isArray(current) ? current.filter(Boolean) : (current && typeof current === "object" ? Object.values(current).filter(Boolean) : []);
                    const remoteDev = list.find(d => String(d?.id) === targetId);
                    if (!remoteDev) return list;
                    if (getOperationalState(enforceOperationalState({ ...remoteDev })) !== "available") {
                        blocked = true;
                        return; // aborta la transacción
                    }
                    return list.filter(d => String(d?.id) !== targetId);
                }, undefined, false);
                if (blocked || !tx.committed) throw new Error("La terminal cambió de estado y no se eliminó.");
                break;
            }

            default:
                // El panel GitHub es supervisor: nunca publica el array devices por
                // una operación genérica. Esto evita cambiar sesiones activas.
                await database.ref(DB_PATH).update({
                    employees: clean.employees || [],
                    history: clean.history || [],
                    currentShift: clean.currentShift || {},
                    settings: clean.settings || {}
                });
                break;
        }

        saveLocalBackup();
        if (cloudConnected) lastCloudSyncAt = Date.now();
        return true;
    } catch (error) {
        console.error(`Error guardando (${reason}):`, error);
        toast("Error de sincronización", "No se pudo aplicar el cambio en Firebase.", "danger");
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

function isOwnerDeviceRemembered() {
    try {
        const raw = localStorage.getItem(OWNER_TRUST_KEY);
        if (!raw) return false;
        const value = JSON.parse(raw);
        return value?.trusted === true;
    } catch (_) {
        return false;
    }
}

function rememberOwnerDevice() {
    try {
        localStorage.setItem(OWNER_TRUST_KEY, JSON.stringify({
            trusted: true,
            savedAt: Date.now()
        }));
    } catch (error) {
        console.warn("No se pudo recordar este dispositivo:", error);
    }
}

function forgetOwnerDevice() {
    try {
        localStorage.removeItem(OWNER_TRUST_KEY);
    } catch (_) {}
}

function activarSesionPropietario() {
    currentRole = "Administrador";
    isAdminAuthenticated = true;

    const errorMsg = document.getElementById("loginError");
    if (errorMsg) errorMsg.style.display = "none";

    const pin = document.getElementById("loginPinInput");
    if (pin) pin.value = "";

    const overlay = document.getElementById("loginOverlay");
    const main = document.getElementById("mainApp");
    if (overlay) overlay.style.display = "none";
    if (main) main.style.display = "block";

    const nameDisplay = document.getElementById("currentUserNameDisplay");
    if (nameDisplay) nameDisplay.textContent = "Propietario";

    const adminTab = document.getElementById("tabNav-admin");
    if (adminTab) adminTab.style.display = "inline-flex";

    solicitarNotificaciones();
    switchTab("dashboard");
    refreshUI();
}

function realizarLogin() {
    const pinInput = document.getElementById("loginPinInput")?.value || "";
    const errorMsg = document.getElementById("loginError");

    if (pinInput !== CLAVE_ADMIN) {
        if (errorMsg) errorMsg.style.display = "block";
        return;
    }

    if (document.getElementById("rememberOwnerDevice")?.checked) {
        rememberOwnerDevice();
    }

    activarSesionPropietario();
}

function cerrarSesion() {
    if (!confirm(
        "¿Cerrar el acceso recordado en este dispositivo?\n\n" +
        "La próxima vez se volverá a solicitar el PIN del propietario."
    )) return;

    forgetOwnerDevice();

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

    let currentEnd = Date.now();
    if (dev.forcedOff && dev.forcedOffAt) currentEnd = Number(dev.forcedOffAt);
    else if (dev.isOffline && dev.offlineSince) currentEnd = Number(dev.offlineSince);

    return Math.max(0, currentEnd - Number(dev.start) - (Number(dev.pausedTime) || 0));
}

function getBillableMs(dev) {
    const elapsed = getElapsedMs(dev);

    if (getSessionMode(dev) === "promo") return elapsed;

    if (dev.limit) {
        return Math.min(elapsed, Number(dev.limit) * 60000);
    }

    const freeToleranceMs = Math.max(0, Number(dev.toleranceFreeMs) || 0);
    return Math.max(0, elapsed - freeToleranceMs);
}

function calcularCobroEfectivo(tipo, controles, msTranscurridos, esPromoTD, limit = null, controlLog = null) {
    if (esPromoTD && tipo === "Xbox") return PROMO_TD_PRICE;
    const mins = Number(msTranscurridos) / 60000;
    if (mins < 1) return 0.00;

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

        // Cada control extra se cobra por hora completada desde que se agregó
        // (mínimo 1 si lleva 10+ min). Misma regla que el sistema local.
        const tarifas = [Number(s.ext1) || 0, Number(s.ext2) || 0, Number(s.ext3) || 0];
        const nExtras = Math.min(3, Math.max(0, Number(controles) - 1));
        const log = Array.isArray(controlLog) ? controlLog : (controlLog && typeof controlLog === "object" ? Object.values(controlLog) : []);
        let cobroControlesExtra = 0;
        for (let i = 0; i < nExtras; i++) {
            const tarifaHora = Math.max(0, tarifas[i] - (i > 0 ? tarifas[i - 1] : 0));
            const minsConControl = Math.max(0, mins - ((Number(log[i]) || 0) / 60000));
            if (minsConControl >= 10) cobroControlesExtra += tarifaHora * Math.max(1, Math.floor(minsConControl / 60));
        }

        total = cobroBase + cobroControlesExtra;
    }

    return Math.max(5.00, Number(total) || 0);
}

function getSessionEstimate(dev) {
    return calcularCobroEfectivo(dev.type, dev.controls, getBillableMs(dev), getSessionMode(dev) === "promo", null, dev.extraControlLog);
}

// Total cobrado hoy (historial de hoy) + $120 de cualquier Promo Todo el Día en curso.
let dayTotalsCache = { key: "", total: 0 };
function getDayRevenue() {
    const today = new Date().toDateString();
    const history = Array.isArray(db.history) ? db.history : [];
    const last = history[history.length - 1];
    const key = `${today}|${history.length}|${last?.timestamp || ""}|${last?.monto ?? ""}`;
    if (dayTotalsCache.key !== key) {
        let total = 0;
        history.forEach(h => {
            if (!h || h.device === "Caja" || String(h.type || "").includes("Sobrante")) return;
            const fecha = new Date(h.timestamp);
            if (Number.isNaN(fecha.getTime()) || fecha.toDateString() !== today) return;
            total += Number.parseFloat(h.monto) || 0;
        });
        dayTotalsCache = { key, total };
    }
    const promos = db.devices.filter(d => getOperationalState(d) === "session" && getSessionMode(d) === "promo" && d.type === "Xbox").length;
    return dayTotalsCache.total + promos * PROMO_TD_PRICE;
}

function getRequestedTimeLabel(dev) {
    if (getOperationalState(dev) === "maintenance") return "Mantenimiento";
    if (!dev.running) return "Disponible";
    if (getSessionMode(dev) === "promo") return "Promo Todo el Día";
    if (!dev.limit) return "Tiempo libre";
    const limit = Number(dev.limit);
    return limit >= 60 ? `${(limit / 60).toFixed(1).replace(".0", "")} h solicitada${limit > 60 ? "s" : ""}` : `${limit} min solicitados`;
}

function getDeviceStatus(dev) {
    if (dev.isOffline) return { text: "Sin conexión", cls: "offline" };
    if (getOperationalState(dev) === "session" && dev.limit && (getElapsedMs(dev) / 60000) >= Number(dev.limit)) return { text: "Tiempo cumplido", cls: "time-up" };
    if (getOperationalState(dev) === "session") return { text: "En uso", cls: "active" };
    if (getOperationalState(dev) === "maintenance") return { text: "Mantenimiento", cls: "updating" };
    return { text: "Disponible", cls: "" };
}

function getDeviceTimerState(dev) {
    let tStr = "00:00:00";
    let cStr = "$0.00";

    if (getOperationalState(dev) === "session") {
        const diff = getElapsedMs(dev);
        const mins = diff / 60000;
        tStr = `${Math.floor(mins / 60).toString().padStart(2, "0")}:${Math.floor(mins % 60).toString().padStart(2, "0")}:${Math.floor((diff / 1000) % 60).toString().padStart(2, "0")}`;
        cStr = formatMoney(getSessionEstimate(dev));

        if (dev.isOffline) tStr = `PAUSADO · ${tStr}`;

        if (dev.limit && mins >= Number(dev.limit)) {
            const limit = Number(dev.limit);
            const tolerance = limit <= 30 ? 5 : limit <= 60 ? 8 : limit <= 90 ? 10 : 15;
            const remaining = Math.max(0, (limit + tolerance) - mins);
            if (remaining <= 0 || dev.forcedOff) tStr = "TIEMPO AGOTADO";
            else if (!dev.isOffline) tStr = `TOLERANCIA · ${Math.floor(remaining)}m ${Math.floor((remaining * 60) % 60).toString().padStart(2, "0")}s`;
        }
    } else if (getOperationalState(dev) === "maintenance") {
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
    const dayRevenue = getDayRevenue();

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
    if (revenue) revenue.textContent = formatMoney(dayRevenue);
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
        if (getOperationalState(dev) === "session") cardClass += " active";
        if (getOperationalState(dev) === "maintenance") cardClass += " updating";
        if (status.cls === "time-up") cardClass += " time-up";

        const controlsInfo = dev.type === "Xbox" && dev.running
            ? `<span class="detail-chip">${Number(dev.controls) || 1} control${Number(dev.controls) === 1 ? "" : "es"}</span>`
            : "";
        const promoInfo = getSessionMode(dev) === "promo" && dev.running ? `<span class="detail-chip">Promo TD · sesión protegida</span>` : "";

        let observerText = "Esperando actividad del sistema local";
        let observerClass = "";
        if (getOperationalState(dev) === "session") observerText = "Sesión activa en el local";
        if (getOperationalState(dev) === "maintenance") { observerText = "Equipo en mantenimiento"; observerClass = "updating"; }
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
    let efectivo = 0, sobrantes = 0, sesiones = 0;
    Object.values(db.currentShift || {}).forEach(shift => {
        efectivo += Number(shift?.efectivoEsperado) || 0;
        sobrantes += Number(shift?.sobrantes) || 0;
        sesiones += Number(shift?.sesiones) || 0;
    });
    const title = document.getElementById("cajaTitle");
    if (title) title.textContent = "Corte de caja · Turno global";
    document.getElementById("cajaEfectivoEsperado").textContent = formatMoney(efectivo);
    document.getElementById("cajaSobrantes").textContent = formatMoney(sobrantes);
    document.getElementById("cajaSesionesTurno").textContent = String(sesiones);
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
    const historyRecord = {
        timestamp: new Date().toISOString(),
        device: "Caja",
        cajero: currentRole,
        durationMins: 0,
        type: `Sobrante (${nota})`,
        monto
    };
    db.history.push(historyRecord);

    if (montoEl) montoEl.value = "";
    if (notaEl) notaEl.value = "";
    await saveDB("cash-adjustment", { user: currentRole, amount: monto, historyRecord });
    updateCajaUI();
    if (isAdminAuthenticated) renderHistoryTable();
    toast("Ajuste registrado", formatMoney(monto));
}

async function terminarTurno() {
    if (!currentRole) return;
    initShifts();
    if (!confirm("¿Terminar el turno global?\nEl conteo de TODOS los cajeros se reiniciará a $0.00.")) return;
    Object.keys(db.currentShift).forEach(key => {
        db.currentShift[key] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    });
    await saveDB("shift-close");
    updateCajaUI();
    toast("Turno reiniciado", "Caja global en $0.00");
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

    let savedId = id;
    if (id) {
        const dev = db.devices.find(d => String(d.id) === String(id));
        if (!dev) return;
        dev.name = name;
        dev.ip = ip;
        dev.type = type;
    } else {
        savedId = `dev-${Date.now()}`;
        db.devices.push({
            id: savedId,
            name,
            ip,
            type,
            running: false,
            start: null,
            limit: null,
            esPromoTD: false,
            sessionMode: null,
            sessionId: null,
            operationalState: "available",
            stateRevision: 1,
            stateEventId: `state-web-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            statePrevEventId: null,
            stateChangedAt: Date.now(),
            stateChangedBy: "Administrador",
            stateReason: "device-created-web",
            maintenanceId: null,
            controls: 1,
            isUpdating: false,
            updateLimitMins: 0,
            pausedTime: 0,
            offlineSince: null,
            isOffline: false
        });
    }

    cancelarEdicionDev();
    saveDB("device-save", { deviceId: savedId }).then(() => {
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
    if (getOperationalState(dev) !== "available") return toast("Terminal ocupada", "No se puede eliminar mientras está activa o en mantenimiento.", "warning");
    if (!confirm(`¿Eliminar permanentemente ${dev.name}?`)) return;
    db.devices = db.devices.filter(d => String(d.id) !== String(id));
    saveDB("device-delete", { deviceId: id }).then(() => {
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

    let oldNameForSave = null;
    if (id) {
        const emp = db.employees.find(e => String(e.id) === String(id));
        if (!emp) return;
        const oldName = emp.name;
        oldNameForSave = oldName;
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
    saveDB("employee-save", { newName: name, oldName: oldNameForSave }).then(() => {
        renderAdminTables();
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
    saveDB("employee-delete").then(() => {
        renderAdminTables();
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
    else if (range === "week") {
        // Semana natural: lunes 00:00 a domingo 23:59:59.
        const inicioSemana = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - ((ahora.getDay() + 6) % 7));
        const finSemana = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate() + 7);
        filtrados = filtrados.filter(h => {
            const fecha = new Date(h.timestamp);
            return fecha >= inicioSemana && fecha < finSemana;
        });
    }
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
    initShifts();
    renderSystemHealth();

    const loginPinInput = document.getElementById("loginPinInput");
    if (loginPinInput) loginPinInput.addEventListener("keydown", event => {
        if (event.key === "Enter") realizarLogin();
    });

    if (isOwnerDeviceRemembered()) {
        activarSesionPropietario();
    }

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
