// ===================================================================
// 1. CONFIGURACIÓN DE CONEXIÓN A LA NUBE (FIREBASE)
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

firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ===================================================================
// 2. VARIABLES DEL SISTEMA Y ESTADOS POR DEFECTO
// ===================================================================
const CLAVE_ADMIN = "1980";
let currentRole = null;
let activeTab = "dashboard";
let isAdminAuthenticated = false;

let db = { devices: [], employees: [], history: [], currentShift: {} };
let estadosPreviosDispositivos = {}; 

try {
    if (window.Notification && Notification.permission !== "granted") {
        let promesa = Notification.requestPermission();
        if (promesa) promesa.catch(e => console.warn("Notificaciones silenciadas."));
    }
} catch (e) { console.warn("Sin soporte para Notificaciones."); }

// FUNCIONES CRÍTICAS MOVIDAS AL PRINCIPIO PARA EVITAR ERRORES DE REFERENCIA
function saveDB() {
    database.ref('xbox_rev_db').set(db);
}

function initShifts() {
    if(!db.currentShift["Administrador"]) db.currentShift["Administrador"] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    db.employees.forEach(emp => {
        if(!db.currentShift[emp.name]) db.currentShift[emp.name] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    });
}

// ===================================================================
// 3. ESCUCHA DE DATOS AUTOMÁTICA EN TIEMPO REAL
// ===================================================================
database.ref('xbox_rev_db').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        db = data;
        if (db.devices && !Array.isArray(db.devices)) db.devices = Object.values(db.devices);
        if (db.employees && !Array.isArray(db.employees)) db.employees = Object.values(db.employees);
        if (db.history && !Array.isArray(db.history)) db.history = Object.values(db.history);
        
        if (!db.devices) db.devices = [];
        if (!db.employees) db.employees = [];
        if (!db.history) db.history = [];
        if (!db.currentShift) db.currentShift = {};
    }
    
    initShifts();
    poblarSelectLogin();
    
    if (isAdminAuthenticated && activeTab === 'admin') poblarFiltroCajerosAdmin();
    
    // Detector de desconexiones para notificaciones flotantes
    if (db.devices) {
        db.devices.forEach(dev => {
            if (estadosPreviosDispositivos[dev.id] !== undefined) {
                const estabaOnline = estadosPreviosDispositivos[dev.id] === false;
                const estaOfflineAhora = dev.isOffline === true;

                if (estabaOnline && estaOfflineAhora) dispararNotificacionFlotante(dev);
            }
            estadosPreviosDispositivos[dev.id] = dev.isOffline || false;
        });
    }
    
    if (currentRole) {
        render();
        if (isAdminAuthenticated) renderAdminTables();
        updateCajaUI();
    }
});

function dispararNotificacionFlotante(dev) {
    if (!window.Notification || Notification.permission !== "granted") return;
    const opciones = {
        body: `Alerta: La terminal "${dev.name}" ha perdido conexión con el sistema local.`,
        icon: "logo.png",
        vibrate: [200, 100, 200],
        requireInteraction: true 
    };
    const notificacion = new Notification(`⚠️ ESP32 DESCONECTADA`, opciones);
    notificacion.onclick = function() { window.focus(); this.close(); };
    playBeep();
}

function poblarFiltroCajerosAdmin() {
    const userFilter = document.getElementById('filterHistoryUser');
    if (userFilter) {
        const currentSelected = userFilter.value || 'all';
        userFilter.innerHTML = `<option value="all">Todos los usuarios</option><option value="Administrador">Administrador</option>`;
        db.employees.forEach(emp => { userFilter.innerHTML += `<option value="${emp.name}">${emp.name}</option>`; });
        userFilter.value = currentSelected;
    }
}

// ===================================================================
// 4. GENERADOR DE ALERTAS DE SONIDO Y LOGIN
// ===================================================================
let audioCtx = null;
function playBeep() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.value = 800; osc.type = "sine";
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.5);
    } catch(e) {}
}

function poblarSelectLogin() {
    const select = document.getElementById('loginUserSelect');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = `<option value="Administrador">Administrador (Yo)</option>`;
    db.employees.forEach(emp => { select.innerHTML += `<option value="${emp.id}">${emp.name}</option>`; });
    if(currentVal) select.value = currentVal;
}

function realizarLogin() {
    const userId = document.getElementById('loginUserSelect').value;
    const pinInput = document.getElementById('loginPinInput').value;
    const errorMsg = document.getElementById('loginError');
    let nombreValidado = null; let esAdmin = false;

    if (userId === "Administrador") {
        if (pinInput === CLAVE_ADMIN) { nombreValidado = "Administrador"; esAdmin = true; }
    } else {
        const empleado = db.employees.find(e => e.id === userId);
        if (empleado && empleado.pin === pinInput) { nombreValidado = empleado.name; }
    }

    if (nombreValidado) {
        currentRole = nombreValidado; isAdminAuthenticated = esAdmin;
        errorMsg.style.display = 'none'; document.getElementById('loginPinInput').value = '';
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        document.getElementById('currentUserNameDisplay').innerText = currentRole;
        document.getElementById('tabNav-admin').style.display = isAdminAuthenticated ? 'inline-block' : 'none';
        switchTab('dashboard'); render();
        if (isAdminAuthenticated) renderAdminTables();
    } else { errorMsg.style.display = 'block'; }
}

function cerrarSesion() {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
    currentRole = null; isAdminAuthenticated = false;
}

function switchTab(tabId) {
    if (tabId === 'admin' && !isAdminAuthenticated) return;
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tabNav-${tabId}`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
    if(tabId === 'admin') { poblarFiltroCajerosAdmin(); renderAdminTables(); renderHistoryTable(); }
    if(tabId === 'caja') updateCajaUI();
}

// ===================================================================
// 5. MATEMÁTICA EN VIVO (SIN FUNCIONES DE CONTROL)
// ===================================================================
function getElapsedMs(dev) {
    if (!dev.running) return 0;
    let currentEnd = (dev.isOffline && dev.offlineSince) ? dev.offlineSince : Date.now();
    return Math.max(0, currentEnd - dev.start - (dev.pausedTime || 0));
}

function calcularCobroEfectivo(tipo, controles, msTranscurridos, esPromoTD, limit = null) {
    if (esPromoTD && tipo === 'Xbox') return 120.00; 
    let mins = msTranscurridos / 60000;
    if (mins < 1) return 0.00; 
    if (limit && mins > limit) mins = limit;

    let minsEfectivos = mins;
    if (!limit) {
        if (mins >= 30 && mins < 60) minsEfectivos -= 5;
        else if (mins >= 60 && mins < 90) minsEfectivos -= 8;
        else if (mins >= 90 && mins < 120) minsEfectivos -= 10;
        else if (mins >= 120) minsEfectivos -= 15;
        if (minsEfectivos < 0) minsEfectivos = 0;
    }

    let total = 0;
    if (tipo === 'PC') { total = (25 / 60) * minsEfectivos; } 
    else {
        let t30 = 15, t60 = 25;
        if (controles == 2) { t30 = 20; t60 = 30; } else if (controles == 3) { t30 = 25; t60 = 35; } else if (controles == 4) { t30 = 30; t60 = 40; }
        total = minsEfectivos <= 30 ? (t30 / 30) * minsEfectivos : (t60 / 60) * minsEfectivos;
    }
    return Math.max(5.00, total);
}

function updateCajaUI() {
    if(!currentRole || !db.currentShift[currentRole]) return;
    document.getElementById('cajaTitle').innerText = `Corte de Caja - ${currentRole}`;
    document.getElementById('cajaEfectivoEsperado').innerText = `$${db.currentShift[currentRole].efectivoEsperado.toFixed(2)}`;
    document.getElementById('cajaSobrantes').innerText = `$${db.currentShift[currentRole].sobrantes.toFixed(2)}`;
    document.getElementById('cajaSesionesTurno').innerText = db.currentShift[currentRole].sesiones;
}

// CRUD Admin...
function guardarDispositivo() {
    const id = document.getElementById('editDevId').value, name = document.getElementById('devName').value.trim(), ip = document.getElementById('devIP').value.trim(), type = document.getElementById('devType').value;
    if(!name || !ip) return alert("Nombre e IP son obligatorios.");
    if(db.devices.some(d => d.ip === ip && d.id !== id)) return alert("Esa IP ya está asignada.");
    if (id) { const dev = db.devices.find(d => d.id === id); dev.name = name; dev.ip = ip; dev.type = type; } 
    else { db.devices.push({ id: `dev-${Date.now()}`, name, ip, type, running: false, start: null, limit: null, esPromoTD: false, controls: 1, isUpdating: false, updateLimitMins: 0 }); }
    cancelarEdicionDev(); saveDB();
}
function editarDispositivo(id) {
    const dev = db.devices.find(d => d.id === id);
    document.getElementById('editDevId').value = dev.id; document.getElementById('devName').value = dev.name; document.getElementById('devIP').value = dev.ip; document.getElementById('devType').value = dev.type;
    document.getElementById('btnSaveDev').innerHTML = "💾 Guardar"; document.getElementById('btnSaveDev').className = "btn-edit"; document.getElementById('btnCancelDev').style.display = "inline-flex";
}
function cancelarEdicionDev() {
    document.getElementById('editDevId').value = ''; document.getElementById('devName').value = ''; document.getElementById('devIP').value = '';
    document.getElementById('btnSaveDev').innerHTML = "+ Agregar"; document.getElementById('btnSaveDev').className = "btn-green"; document.getElementById('btnCancelDev').style.display = "none";
}
function eliminarDispositivo(id) { if(confirm("¿Eliminar terminal permanentemente?")) { db.devices = db.devices.filter(d => d.id !== id); saveDB(); } }

function guardarEmpleado() {
    const id = document.getElementById('editEmpId').value, name = document.getElementById('empName').value.trim(), pin = document.getElementById('empPin').value.trim();
    if(!name || !pin) return alert("El nombre y el PIN son obligatorios.");
    if(db.employees.some(e => e.name.toLowerCase() === name.toLowerCase() && e.id !== id)) return alert("El empleado ya existe.");
    if (id) {
        const emp = db.employees.find(e => e.id === id); const oldName = emp.name; emp.name = name; emp.pin = pin;
        if(oldName !== name) { db.currentShift[name] = db.currentShift[oldName]; delete db.currentShift[oldName]; }
    } else { db.employees.push({ id: `emp-${Date.now()}`, name, pin }); db.currentShift[name] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 }; }
    cancelarEdicionEmp(); saveDB();
}
function editarEmpleado(id) {
    const emp = db.employees.find(e => e.id === id);
    document.getElementById('editEmpId').value = emp.id; document.getElementById('empName').value = emp.name; document.getElementById('empPin').value = emp.pin;
    document.getElementById('btnSaveEmp').innerHTML = "💾 Guardar"; document.getElementById('btnSaveEmp').className = "btn-edit"; document.getElementById('btnCancelEmp').style.display = "inline-flex";
}
function cancelarEdicionEmp() {
    document.getElementById('editEmpId').value = ''; document.getElementById('empName').value = ''; document.getElementById('empPin').value = '';
    document.getElementById('btnSaveEmp').innerHTML = "+ Agregar Empleado"; document.getElementById('btnSaveEmp').className = "btn-green"; document.getElementById('btnCancelEmp').style.display = "none";
}
function eliminarEmpleado(id) { const emp = db.employees.find(e => e.id === id); if(confirm(`¿Dar de baja a ${emp.name}?`)) { db.employees = db.employees.filter(e => e.id !== id); delete db.currentShift[emp.name]; saveDB(); } }

// ===================================================================
// 6. MOTORES DE RENDERIZADO VISUAL (MODO LECTURA)
// ===================================================================
function renderAdminTables() {
    const devTbody = document.getElementById('adminDevicesTableBody');
    if(devTbody) devTbody.innerHTML = db.devices.map(d => `<tr><td><strong>${d.name}</strong></td><td>${d.type}</td><td><span class="ip-label">${d.ip}</span></td><td class="action-cell"><button class="btn-edit" style="font-size:11px; padding:4px 8px;" onclick="editarDispositivo('${d.id}')">✏️ Editar</button> <button class="btn-danger" style="font-size:11px; padding:4px 8px;" onclick="eliminarDispositivo('${d.id}')">🗑️ Borrar</button></td></tr>`).join('');
    const empTbody = document.getElementById('adminEmployeesTableBody');
    if(empTbody) empTbody.innerHTML = db.employees.map(e => `<tr><td>${e.name}</td><td><span class="ip-label" style="font-size:13px; background:#222; padding:3px 6px; border-radius:4px;">${e.pin}</span></td><td class="action-cell"><button class="btn-edit" style="font-size:11px; padding:4px 8px;" onclick="editarEmpleado('${e.id}')">✏️ Editar</button> <button class="btn-danger" style="font-size:11px; padding:4px 8px;" onclick="eliminarEmpleado('${e.id}')">🗑️ Baja</button></td></tr>`).join('');
}

function renderHistoryTable() {
    const range = document.getElementById('filterHistoryRange')?.value || 'all', userFilter = document.getElementById('filterHistoryUser')?.value || 'all', tbody = document.getElementById('historyTableBody');
    if(!tbody) return;
    let filtrados = db.history; const ahora = new Date();
    if (range === 'day') filtrados = db.history.filter(h => new Date(h.timestamp).toDateString() === ahora.toDateString());
    else if (range === 'week') filtrados = db.history.filter(h => new Date(h.timestamp) >= new Date(ahora.getTime() - 7*24*60*60*1000));
    else if (range === 'month') filtrados = db.history.filter(h => new Date(h.timestamp).getMonth() === ahora.getMonth() && new Date(h.timestamp).getFullYear() === ahora.getFullYear());
    if (userFilter !== 'all') filtrados = filtrados.filter(h => h.cajero === userFilter);

    let inTot = 0, sobTot = 0;
    tbody.innerHTML = filtrados.map(h => {
        h.type.includes("Sobrante") ? sobTot += h.monto : inTot += h.monto;
        return `<tr><td>${new Date(h.timestamp).toLocaleString([],{dateStyle:'short',timeStyle:'short'})}</td><td>${h.device}</td><td>${h.cajero}</td><td>${h.durationMins}m</td><td><span class="status-badge ${h.type.includes('Sobrante')?'status-update':'status-active'}">${h.type}</span></td><td style="color:var(--xbox-green); font-weight:bold;">$${parseFloat(h.monto).toFixed(2)}</td></tr>`;
    }).join('');
    document.getElementById('adminTotalIngresos').innerText = `$${inTot.toFixed(2)}`;
    document.getElementById('adminTotalSobrantes').innerText = `$${sobTot.toFixed(2)}`;
}

function render() {
    if(!currentRole) return;
    const grid = document.getElementById('devicesGrid');
    if(!grid) return;

    grid.innerHTML = db.devices.map(dev => {
        let tStr = "00:00:00", cStr = "$0.00", lStr = "", cClass = dev.type === 'PC' ? 'card pc' : 'card';
        if (dev.isOffline) cClass += ' offline';

        if (dev.running) {
            cClass += ' active';
            const diff = getElapsedMs(dev), mins = diff/60000;
            tStr = `${Math.floor(mins/60).toString().padStart(2,'0')}:${Math.floor(mins%60).toString().padStart(2,'0')}:${Math.floor((diff/1000)%60).toString().padStart(2,'0')}`;
            cStr = `$${calcularCobroEfectivo(dev.type, dev.controls, diff, dev.esPromoTD, dev.limit).toFixed(2)}`;
            if (dev.isOffline) tStr = `PAUSADO - ${tStr}`;
            
            if (dev.limit) lStr = dev.limit >= 60 ? `${(dev.limit / 60).toFixed(1).replace('.0', '')} Hora(s)` : `${dev.limit} Minutos`;
            else lStr = dev.esPromoTD ? "Promo Todo el Día" : "Libre";

            if (dev.limit && mins >= dev.limit) {
                cClass += ' time-up';
                let tol = dev.limit <= 30 ? 5 : dev.limit <= 60 ? 8 : dev.limit <= 90 ? 10 : 15;
                const rem = Math.max(0, (dev.limit + tol) - mins);
                if (rem <= 0 || dev.forcedOff) tStr = "TIEMPO AGOTADO";
                else if (!dev.isOffline) tStr = `TOLERANCIA: ${Math.floor(rem)}m ${Math.floor((rem*60)%60).toString().padStart(2,'0')}s`;
            }
        } else if (dev.isUpdating) {
            cClass += ' updating'; const res = dev.updateLimitMins - ((Date.now() - dev.updateStart)/60000); lStr = "Mantenimiento";
            if (res <= 0) { tStr = "Espera Progreso"; cStr = "Pantalla APAGADA"; } 
            else { tStr = `${Math.floor(res).toString().padStart(2,'0')}:${Math.floor((res*60)%60).toString().padStart(2,'0')}`; cStr = dev.updateMode === 'main' ? "Actualizando..." : "Verificando..."; }
        }

        return `
            <div class="${cClass}" id="card-${dev.id}">
                <div class="card-header">
                    <span class="badge ${dev.type==='PC'?'badge-pc':'badge-xbox'}">${dev.type}</span>
                    <span class="ip-label">${dev.ip}</span>
                    ${dev.isOffline ? `<span style="background:red; color:white; padding:2px 5px; border-radius:3px; font-size:10px; margin-left:5px;">OFFLINE</span>` : ''}
                </div>
                <div class="device-title">${dev.name}</div>
                <div class="timer-display" id="timer-${dev.id}" style="${dev.isOffline ? 'color:#ff4444; font-size:18px;' : ''}">${tStr}</div>
                <div class="requested-time-label" id="label-${dev.id}" style="color: #aaaaaa; font-size: 13px; margin-top: -6px; margin-bottom: 8px; font-weight: 500; letter-spacing: 0.5px;">
                    ${lStr ? `⏱️ Tipo: ${lStr}` : ''}
                </div>
                <div class="cost-display" id="cost-${dev.id}">${cStr}</div>
                
                <div style="text-align:center; padding: 15px 10px; margin-top: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; border: 1px dashed var(--border-color); color: var(--text-muted); font-size: 13px; font-weight: 500;">
                    ${dev.running ? '🟢 Ocupada en Local' : (dev.isOffline ? '🔴 Sin Conexión' : '⚪ Libre / Esperando')}
                </div>
            </div>`;
    }).join('');
}

// ===================================================================
// 7. ACTUALIZACIÓN VISUAL EN VIVO (RELOJES)
// ===================================================================
document.addEventListener("DOMContentLoaded", () => {
    const loginPinInput = document.getElementById("loginPinInput");
    if(loginPinInput) loginPinInput.addEventListener("keypress", function(event) { if (event.key === "Enter") realizarLogin(); });
});

function actualizarRelojesEnVivo() {
    if(!currentRole || !db.devices) return;
    db.devices.forEach(dev => {
        const timerEl = document.getElementById(`timer-${dev.id}`), costEl = document.getElementById(`cost-${dev.id}`), cardEl = document.getElementById(`card-${dev.id}`);
        if (!timerEl || !costEl || !cardEl) return; 
        
        if (dev.running) {
            const diff = getElapsedMs(dev), mins = diff/60000;
            let tStr = `${Math.floor(mins/60).toString().padStart(2,'0')}:${Math.floor(mins%60).toString().padStart(2,'0')}:${Math.floor((diff/1000)%60).toString().padStart(2,'0')}`;
            let cStr = `$${calcularCobroEfectivo(dev.type, dev.controls, diff, dev.esPromoTD, dev.limit).toFixed(2)}`;
            
            if (dev.isOffline) { tStr = `PAUSADO - ${tStr}`; timerEl.style.color = '#ff4444'; timerEl.style.fontSize = '18px'; } 
            else { timerEl.style.color = ''; timerEl.style.fontSize = ''; }

            if (dev.limit && mins >= dev.limit) {
                if (!cardEl.classList.contains('time-up')) cardEl.classList.add('time-up');
                let tol = dev.limit <= 30 ? 5 : dev.limit <= 60 ? 8 : dev.limit <= 90 ? 10 : 15;
                const remTolerance = Math.max(0, (dev.limit + tol) - mins);
                if (remTolerance <= 0 || dev.forcedOff) tStr = "TIEMPO AGOTADO";
                else if (!dev.isOffline) tStr = `TOLERANCIA: ${Math.floor(remTolerance)}m ${Math.floor((remTolerance*60)%60).toString().padStart(2,'0')}s`;
            } else {
                if (!cardEl.classList.contains('active')) cardEl.classList.add('active');
            }
            timerEl.innerText = tStr; costEl.innerText = cStr;
        }
    });
}

setInterval(() => {
    const liveClock = document.getElementById('liveClock');
    if(liveClock) liveClock.innerText = new Date().toLocaleTimeString();
    if(currentRole && db.devices && db.devices.some(d => d.running || d.isUpdating)) actualizarRelojesEnVivo(); 
}, 1000);