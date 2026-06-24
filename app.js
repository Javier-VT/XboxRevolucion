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

// Inicializar base de datos
firebase.initializeApp(firebaseConfig);
const database = firebase.database();

// ===================================================================
// 2. VARIABLES DEL SISTEMA Y ESTADOS POR DEFECTO
// ===================================================================
const CLAVE_ADMIN = "1980"; // PIN Maestro
let currentRole = null;
let activeTab = "dashboard";
let isAdminAuthenticated = false;

let db = {
    devices: [
        { id: `xbox-1`, name: `Xbox 01`, ip: `192.168.1.101`, type: 'Xbox', running: false, start: null, limit: null, esPromoTD: false, controls: 1, isUpdating: false, updateLimitMins: 0 },
        { id: `pc-1`, name: `PC 01`, ip: `192.168.1.120`, type: 'PC', running: false, start: null, limit: null, esPromoTD: false, controls: 1, isUpdating: false, updateLimitMins: 0 }
    ],
    employees: [
        { id: "1", name: "Carlos López (Cajero 1)", pin: "1111" },
        { id: "2", name: "Ana Martínez (Cajero 2)", pin: "2222" }
    ],
    history: [],
    currentShift: {}
};

let estadosPreviosDispositivos = {}; // Memoria para evitar que la notificación se repita cada segundo

// Solicitar permisos de notificación apenas cargue la página en GitHub
if (window.Notification && Notification.permission !== "granted") {
    Notification.requestPermission();
}


// ===================================================================
// 3. ESCUCHA DE DATOS AUTOMÁTICA EN TIEMPO REAL (VERSIÓN GITHUB)
// ===================================================================
database.ref('xbox_rev_db').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        db = data;
        if (!db.devices) db.devices = [];
        if (!db.employees) db.employees = [];
        if (!db.history) db.history = [];
        if (!db.currentShift) db.currentShift = {};
    }
    
    initShifts();
    poblarSelectLogin();
    
    // --- NUEVO DETECTOR DE CAMBIOS DE CONEXIÓN PARA EL ADMINISTRADOR ---
    if (db.devices) {
        db.devices.forEach(dev => {
            // Verificar si el dispositivo existe en nuestro registro previo
            if (estadosPreviosDispositivos[dev.id] !== undefined) {
                const estabaOnline = estadosPreviosDispositivos[dev.id] === false;
                const estaOfflineAhora = dev.isOffline === true;

                // REGLA: Si estaba online y se acaba de desconectar, dispara la alerta
                if (estabaOnline && estaOfflineAhora) {
                    dispararNotificacionFlotante(dev);
                }
            }
            // Actualizar la memoria con el estado actual
            estadosPreviosDispositivos[dev.id] = dev.isOffline || false;
        });
    }
    
    if (currentRole) {
        render();
        if (isAdminAuthenticated) renderAdminTables();
        updateCajaUI();
    }
});

// FUNCIÓN MAESTRA: Lanza la notificación al sistema operativo (Windows, Android, Mac)
function dispararNotificacionFlotante(dev) {
    if (!window.Notification) return;

    if (Notification.permission === "granted") {
        const opciones = {
            body: `Alerta: La terminal "${dev.name}" (${dev.type}) ha perdido conexión con el sistema local.`,
            icon: "logo.png", // Usa tu logo.png que ya tienes en la raíz
            vibrate: [200, 100, 200],
            requireInteraction: true // La notificación no se quita hasta que le des clic
        };

        const notificacion = new Notification(`⚠️ ESP32 DESCONECTADA`, opciones);
        
        // Al darle clic a la notificación, te lleva automáticamente a la pestaña del navegador
        notificacion.onclick = function() {
            window.focus();
            this.close();
        };

        // Hacer sonar el pitido también en la computadora remota del administrador
        playBeep();
    }
}

// ===================================================================
// 4. GENERADOR DE ALERTAS DE SONIDO
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

// ===================================================================
// 5. CONTROL DE ACCESO (LOGIN)
// ===================================================================
function poblarSelectLogin() {
    const select = document.getElementById('loginUserSelect');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = `<option value="Administrador">Administrador (Yo)</option>`;
    db.employees.forEach(emp => {
        select.innerHTML += `<option value="${emp.id}">${emp.name}</option>`;
    });
    if(currentVal) select.value = currentVal;
}

function realizarLogin() {
    const userId = document.getElementById('loginUserSelect').value;
    const pinInput = document.getElementById('loginPinInput').value;
    const errorMsg = document.getElementById('loginError');

    let nombreValidado = null;
    let esAdmin = false;

    if (userId === "Administrador") {
        if (pinInput === CLAVE_ADMIN) { nombreValidado = "Administrador"; esAdmin = true; }
    } else {
        const empleado = db.employees.find(e => e.id === userId);
        if (empleado && empleado.pin === pinInput) { nombreValidado = empleado.name; }
    }

    if (nombreValidado) {
        currentRole = nombreValidado;
        isAdminAuthenticated = esAdmin;
        errorMsg.style.display = 'none';
        document.getElementById('loginPinInput').value = '';
        
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainApp').style.display = 'block';
        
        document.getElementById('currentUserNameDisplay').innerText = currentRole;
        document.getElementById('tabNav-admin').style.display = isAdminAuthenticated ? 'inline-block' : 'none';
        
        switchTab('dashboard');
        render();
        if (isAdminAuthenticated) renderAdminTables();
    } else {
        errorMsg.style.display = 'block';
    }
}

function cerrarSesion() {
    document.getElementById('mainApp').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
    currentRole = null;
    isAdminAuthenticated = false;
}

// Navegación
function switchTab(tabId) {
    if (tabId === 'admin' && !isAdminAuthenticated) return;
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`tabNav-${tabId}`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');
    
    if(tabId === 'admin') { 
        // Primero poblamos el nuevo filtro de usuarios con los empleados vigentes
        const userFilter = document.getElementById('filterHistoryUser');
        if (userFilter) {
            const currentSelected = userFilter.value;
            userFilter.innerHTML = `
                <option value="all">Todos los usuarios</option>
                <option value="Administrador">Administrador</option>
            `;
            db.employees.forEach(emp => {
                userFilter.innerHTML += `<option value="${emp.name}">${emp.name}</option>`;
            });
            if (currentSelected) userFilter.value = currentSelected;
        }
        
        // Ejecutamos el renderizado de las tablas de administración
        renderAdminTables(); 
        renderHistoryTable(); 
    }
    if(tabId === 'caja') updateCajaUI();
}

// ===================================================================
// 6. MATEMÁTICA, ALGORITMO DE COBROS Y CONTROL DE AUTO-APAGADO
// ===================================================================

// Calcula el tiempo exacto transcurrido, descontando las pausas por desconexión
function getElapsedMs(dev) {
    if (!dev.running) return 0;
    let currentEnd = (dev.isOffline && dev.offlineSince) ? dev.offlineSince : Date.now();
    return Math.max(0, currentEnd - dev.start - (dev.pausedTime || 0));
}

function calcularCobroEfectivo(tipo, controles, msTranscurridos, esPromoTD, limit = null) {
    if (esPromoTD && tipo === 'Xbox') return 120.00; 

    let mins = msTranscurridos / 60000;
    if (mins < 1) return 0.00; 

    // Si es tiempo limitado y ya entró en tolerancia, congelamos el cobro en el límite pedido
    if (limit && mins > limit) {
        mins = limit;
    }

    let minsEfectivos = mins;
    
    // Las deducciones automáticas solo aplican para Tiempo Libre
    if (!limit) {
        if (mins >= 30 && mins < 60) minsEfectivos -= 5;
        else if (mins >= 60 && mins < 90) minsEfectivos -= 8;
        else if (mins >= 90 && mins < 120) minsEfectivos -= 10;
        else if (mins >= 120) minsEfectivos -= 15;
        if (minsEfectivos < 0) minsEfectivos = 0;
    }

    let total = 0;
    if (tipo === 'PC') {
        total = (25 / 60) * minsEfectivos;
    } else {
        let t30 = 15, t60 = 25;
        if (controles == 2) { t30 = 20; t60 = 30; }
        else if (controles == 3) { t30 = 25; t60 = 35; }
        else if (controles == 4) { t30 = 30; t60 = 40; }
        total = minsEfectivos <= 30 ? (t30 / 30) * minsEfectivos : (t60 / 60) * minsEfectivos;
    }
    
    return Math.max(5.00, total);
}

// Convierte una sesión limitada a Tiempo Libre
function pasarALibre(id) {
    const dev = db.devices.find(d => d.id === id);
    if(dev) {
        dev.limit = null; 
        dev.blinkTriggered = false;
        dev.forcedOff = false;
        saveDB(); 
        render();
    }
}

function manejarParpadeos(dev, mins) {
    if (!dev.limit) return; 

    let tolerance = 15;
    if (dev.limit <= 30) tolerance = 5;
    else if (dev.limit <= 60) tolerance = 8;
    else if (dev.limit <= 90) tolerance = 10;

    // 1. PARPADEO: Al cumplirse el tiempo solicitado
    if (mins >= dev.limit && !dev.blinkTriggered) {
        dev.blinkTriggered = true; 
        fetch(`http://${dev.ip}/off`).catch(()=>{});
        setTimeout(() => { if (dev.running && !dev.isOffline) fetch(`http://${dev.ip}/on`).catch(()=>{}); }, 3000);
        playBeep(); saveDB();
    }

    // 2. CORTE FÍSICO AUTOMÁTICO (Al acabar la tolerancia)
    if (mins >= (dev.limit + tolerance) && !dev.forcedOff) {
        dev.forcedOff = true; 
        fetch(`http://${dev.ip}/off`).catch(()=>{});
        playBeep(); 
        saveDB(); 
        render(); 
    }
}

function toggleSesion(id) {
    const dev = db.devices.find(d => d.id === id);
    if (!dev.running) {
        const minInput = document.getElementById(`input-time-${id}`).value;
        dev.limit = parseInt(minInput) > 0 ? parseInt(minInput) : null;
        dev.controls = document.getElementById(`select-ctrl-${id}`)?.value || 1;
        dev.esPromoTD = document.getElementById(`check-td-${id}`)?.checked || false;
        
        dev.running = true; 
        dev.start = Date.now(); 
        dev.blinkTriggered = false; 
        dev.forcedOff = false;      
        dev.pausedTime = 0;      
        dev.offlineSince = null; 
        
        fetch(`http://${dev.ip}/on`).catch(()=>{});
    } else {
        const ms = getElapsedMs(dev);
        const cobro = calcularCobroEfectivo(dev.type, dev.controls, ms, dev.esPromoTD, dev.limit);
        
        // --- NUEVO DETECTOR INTELIGENTE DE ETIQUETAS PARA EL HISTORIAL ---
        let tipoSesion = "Tiempo Libre"; // Por defecto es tiempo libre
        
        if (dev.forcedOff) {
            tipoSesion = "Auto-Apagado";
        } else if (dev.esPromoTD) {
            tipoSesion = "Promo TD";
        } else if (dev.limit) {
            tipoSesion = "Corte Anticipado"; // Tenía un límite, pero el cajero lo cortó antes de que se acabara
        }

        // Guarda en el historial con la etiqueta correcta
        db.history.push({ 
            timestamp: new Date().toISOString(), 
            device: dev.name, 
            cajero: currentRole, 
            durationMins: Math.ceil(ms/60000), 
            type: tipoSesion, 
            monto: cobro 
        });
        
        db.currentShift[currentRole].efectivoEsperado += cobro;
        db.currentShift[currentRole].sesiones += 1;
        
        dev.running = false; 
        dev.start = null; 
        dev.limit = null; 
        dev.blinkTriggered = false;
        dev.forcedOff = false;
        
        fetch(`http://${dev.ip}/off`).catch(()=>{});
        playBeep(); 
    }
    saveDB();
}

// Módulo de Actualizaciones
function iniciarActualizacion(id) {
    const dev = db.devices.find(d => d.id === id);
    dev.isUpdating = true; dev.updateMode = 'main'; dev.updateStart = Date.now(); dev.updateLimitMins = 20;
    fetch(`http://${dev.ip}/on`).catch(()=>{}); saveDB();
}
function verificarProgreso(id) {
    const dev = db.devices.find(d => d.id === id);
    dev.updateMode = 'check'; dev.updateStart = Date.now(); dev.updateLimitMins = 3;
    fetch(`http://${dev.ip}/on`).catch(()=>{}); saveDB();
}
function finalizarActualizacion(id) {
    const dev = db.devices.find(d => d.id === id);
    dev.isUpdating = false; fetch(`http://${dev.ip}/off`).catch(()=>{}); saveDB();
}

// ===================================================================
// 7. ARQUEO DE CAJA
// ===================================================================
function updateCajaUI() {
    if(!currentRole || !db.currentShift[currentRole]) return;
    document.getElementById('cajaTitle').innerText = `Corte de Caja - ${currentRole}`;
    document.getElementById('cajaEfectivoEsperado').innerText = `$${db.currentShift[currentRole].efectivoEsperado.toFixed(2)}`;
    document.getElementById('cajaSobrantes').innerText = `$${db.currentShift[currentRole].sobrantes.toFixed(2)}`;
    document.getElementById('cajaSesionesTurno').innerText = db.currentShift[currentRole].sesiones;
}

function registrarSobrante() {
    const monto = parseFloat(document.getElementById('sobranteMonto').value);
    if (!monto || monto <= 0) return alert("Monto inválido.");
    db.currentShift[currentRole].sobrantes += monto;
    db.history.push({ timestamp: new Date().toISOString(), device: "Caja", cajero: currentRole, durationMins: 0, type: `Sobrante (${document.getElementById('sobranteNota').value||'N/A'})`, monto });
    document.getElementById('sobranteMonto').value = ''; document.getElementById('sobranteNota').value = '';
    saveDB();
}

// ===================================================================
// 8. ADMINISTRACIÓN AVANZADA (CRUD)
// ===================================================================
function guardarDispositivo() {
    const id = document.getElementById('editDevId').value;
    const name = document.getElementById('devName').value.trim();
    const ip = document.getElementById('devIP').value.trim();
    const type = document.getElementById('devType').value;

    if(!name || !ip) return alert("Nombre e IP son obligatorios.");
    if(db.devices.some(d => d.ip === ip && d.id !== id)) return alert("Esa IP ya está asignada.");

    if (id) {
        const dev = db.devices.find(d => d.id === id);
        dev.name = name; dev.ip = ip; dev.type = type;
    } else {
        db.devices.push({ id: `dev-${Date.now()}`, name, ip, type, running: false, start: null, limit: null, esPromoTD: false, controls: 1, isUpdating: false, updateLimitMins: 0 });
    }
    cancelarEdicionDev(); saveDB();
}

function editarDispositivo(id) {
    const dev = db.devices.find(d => d.id === id);
    document.getElementById('editDevId').value = dev.id;
    document.getElementById('devName').value = dev.name;
    document.getElementById('devIP').value = dev.ip;
    document.getElementById('devType').value = dev.type;
    document.getElementById('btnSaveDev').innerHTML = "💾 Guardar Cambios";
    document.getElementById('btnSaveDev').className = "btn-edit";
    document.getElementById('btnCancelDev').style.display = "inline-flex";
}

function cancelarEdicionDev() {
    document.getElementById('editDevId').value = '';
    document.getElementById('devName').value = '';
    document.getElementById('devIP').value = '';
    document.getElementById('btnSaveDev').innerHTML = "+ Agregar";
    document.getElementById('btnSaveDev').className = "btn-green";
    document.getElementById('btnCancelDev').style.display = "none";
}

function eliminarDispositivo(id) {
    if(confirm("¿Eliminar terminal permanentemente?")) { db.devices = db.devices.filter(d => d.id !== id); saveDB(); }
}

function guardarEmpleado() {
    const id = document.getElementById('editEmpId').value;
    const name = document.getElementById('empName').value.trim();
    const pin = document.getElementById('empPin').value.trim();
    
    if(!name || !pin) return alert("El nombre y el PIN son obligatorios.");
    if(db.employees.some(e => e.name.toLowerCase() === name.toLowerCase() && e.id !== id)) return alert("El empleado ya existe.");

    if (id) {
        const emp = db.employees.find(e => e.id === id);
        const oldName = emp.name;
        emp.name = name; emp.pin = pin;
        if(oldName !== name) {
            db.currentShift[name] = db.currentShift[oldName];
            delete db.currentShift[oldName];
        }
    } else {
        db.employees.push({ id: `emp-${Date.now()}`, name, pin });
        db.currentShift[name] = { efectivoEsperado: 0, sobrantes: 0, sesiones: 0 };
    }
    cancelarEdicionEmp(); saveDB();
}

function editarEmpleado(id) {
    const emp = db.employees.find(e => e.id === id);
    document.getElementById('editEmpId').value = emp.id;
    document.getElementById('empName').value = emp.name;
    document.getElementById('empPin').value = emp.pin;
    document.getElementById('btnSaveEmp').innerHTML = "💾 Guardar";
    document.getElementById('btnSaveEmp').className = "btn-edit";
    document.getElementById('btnCancelEmp').style.display = "inline-flex";
}

function cancelarEdicionEmp() {
    document.getElementById('editEmpId').value = '';
    document.getElementById('empName').value = '';
    document.getElementById('empPin').value = '';
    document.getElementById('btnSaveEmp').innerHTML = "+ Agregar Empleado";
    document.getElementById('btnSaveEmp').className = "btn-green";
    document.getElementById('btnCancelEmp').style.display = "none";
}

// ===================================================================
// 9. MOTORES DE RENDERIZADO VISUAL HTML
// ===================================================================
function renderAdminTables() {
    const devTbody = document.getElementById('adminDevicesTableBody');
    if(devTbody) {
        devTbody.innerHTML = db.devices.map(d => `
            <tr>
                <td><strong>${d.name}</strong></td><td>${d.type}</td><td><span class="ip-label">${d.ip}</span></td>
                <td class="action-cell">
                    <button class="btn-edit" style="font-size:11px; padding:4px 8px;" onclick="editarDispositivo('${d.id}')">✏️ Editar</button>
                    <button class="btn-danger" style="font-size:11px; padding:4px 8px;" onclick="eliminarDispositivo('${d.id}')">🗑️ Borrar</button>
                </td>
            </tr>`).join('');
    }

    const empTbody = document.getElementById('adminEmployeesTableBody');
    if(empTbody) {
        empTbody.innerHTML = db.employees.map(e => `
            <tr>
                <td>${e.name}</td><td><span class="ip-label" style="font-size:13px; background:#222; padding:3px 6px; border-radius:4px;">${e.pin}</span></td>
                <td class="action-cell">
                    <button class="btn-edit" style="font-size:11px; padding:4px 8px;" onclick="editarEmpleado('${e.id}')">✏️ Editar</button>
                    <button class="btn-danger" style="font-size:11px; padding:4px 8px;" onclick="eliminarEmpleado('${e.id}')">🗑️ Baja</button>
                </td>
            </tr>`).join('');
    }
}

function renderHistoryTable() {
    const range = document.getElementById('filterHistoryRange')?.value || 'all';
    const userFilter = document.getElementById('filterHistoryUser')?.value || 'all';
    const tbody = document.getElementById('historyTableBody');
    if(!tbody) return;
    
    let filtrados = db.history;
    const ahora = new Date();

    if (range === 'day') {
        filtrados = db.history.filter(h => new Date(h.timestamp).toDateString() === ahora.toDateString());
    } else if (range === 'week') {
        filtrados = db.history.filter(h => new Date(h.timestamp) >= new Date(ahora.getTime() - 7*24*60*60*1000));
    } else if (range === 'month') {
        filtrados = db.history.filter(h => new Date(h.timestamp).getMonth() === ahora.getMonth() && new Date(h.timestamp).getFullYear() === ahora.getFullYear());
    }

    if (userFilter !== 'all') {
        filtrados = filtrados.filter(h => h.cajero === userFilter);
    }

    let inTot = 0, sobTot = 0;
    tbody.innerHTML = filtrados.map(h => {
        h.type.includes("Sobrante") ? sobTot += h.monto : inTot += h.monto;
        
        return `<tr>
            <td>${new Date(h.timestamp).toLocaleString([],{dateStyle:'short',timeStyle:'short'})}</td>
            <td>${h.device}</td>
            <td>${h.cajero}</td>
            <td>${h.durationMins}m</td>
            <td><span class="status-badge ${h.type.includes('Sobrante')?'status-update':'status-active'}">${h.type}</span></td>
            <td style="color:var(--xbox-green); font-weight:bold;">$${parseFloat(h.monto).toFixed(2)}</td>
        </tr>`;
    }).join('');
    
    document.getElementById('adminTotalIngresos').innerText = `$${inTot.toFixed(2)}`;
    document.getElementById('adminTotalSobrantes').innerText = `$${sobTot.toFixed(2)}`;
}

function render() {
    if(!currentRole) return;
    const grid = document.getElementById('devicesGrid');
    if(!grid) return;

    let focusedInputId = null;
    if (document.activeElement && document.activeElement.tagName === "INPUT") {
        focusedInputId = document.activeElement.id;
    }

    grid.innerHTML = db.devices.map(dev => {
        let tStr = "00:00:00", cStr = "$0.00", lStr = "", cClass = dev.type === 'PC' ? 'card pc' : 'card';
        
        if (dev.isOffline) cClass += ' offline';

        if (dev.running) {
            cClass += ' active';
            const diff = getElapsedMs(dev), mins = diff/60000;
            tStr = `${Math.floor(mins/60).toString().padStart(2,'0')}:${Math.floor(mins%60).toString().padStart(2,'0')}:${Math.floor((diff/1000)%60).toString().padStart(2,'0')}`;
            
            cStr = `$${calcularCobroEfectivo(dev.type, dev.controls, diff, dev.esPromoTD, dev.limit).toFixed(2)}`;
            
            if (dev.isOffline) tStr = `PAUSADO - ${tStr}`;

            if (dev.limit) {
                lStr = dev.limit >= 60 ? `${(dev.limit / 60).toFixed(1).replace('.0', '')} Hora(s)` : `${dev.limit} Minutos`;
            } else {
                lStr = dev.esPromoTD ? "Promo Todo el Día" : "Libre";
            }

            if (dev.limit && mins >= dev.limit) {
                cClass += ' time-up';
                let tol = dev.limit <= 30 ? 5 : dev.limit <= 60 ? 8 : dev.limit <= 90 ? 10 : 15;
                const rem = Math.max(0, (dev.limit + tol) - mins);
                
                if (rem <= 0 || dev.forcedOff) {
                    tStr = "TIEMPO AGOTADO";
                } else {
                    if (!dev.isOffline) tStr = `TOLERANCIA: ${Math.floor(rem)}m ${Math.floor((rem*60)%60).toString().padStart(2,'0')}s`;
                }
            }
        } else if (dev.isUpdating) {
            cClass += ' updating';
            const res = dev.updateLimitMins - ((Date.now() - dev.updateStart)/60000);
            lStr = "Mantenimiento";
            if (res <= 0) {
                tStr = "Espera Progreso"; cStr = "Pantalla APAGADA";
            } else {
                tStr = `${Math.floor(res).toString().padStart(2,'0')}:${Math.floor((res*60)%60).toString().padStart(2,'0')}`;
                cStr = dev.updateMode === 'main' ? "Actualizando..." : "Verificando...";
            }
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
                    ${lStr ? `⏱️ Tiempo: ${lStr}` : ''}
                </div>

                <div class="cost-display" id="cost-${dev.id}">${cStr}</div>
                <div class="control-group">
                    ${!dev.running && !dev.isUpdating ? `
                        <input type="number" id="input-time-${dev.id}" placeholder="Minutos (vacío=libre)" style="text-align:center;" ${dev.isOffline ? 'disabled' : ''}>
                        ${dev.type === 'Xbox' ? `
                            <div class="row-inputs">
                                <select id="select-ctrl-${dev.id}">
                                    <option value="1">1 Mando</option><option value="2">2 Mandos</option><option value="3">3 Mandos</option><option value="4">4 Mandos</option>
                                </select>
                                <label style="display:flex; align-items:center; gap:4px; font-size:12px; cursor:pointer;"><input type="checkbox" id="check-td-${dev.id}"> Promo TD</label>
                            </div>` : ''}
                        <div class="row-inputs">
                            <button class="btn-green" onclick="toggleSesion('${dev.id}')" ${dev.isOffline ? 'disabled style="opacity:0.5;"' : ''}>Iniciar Renta</button>
                            <button class="btn-warning" onclick="iniciarActualizacion('${dev.id}')" ${dev.isOffline ? 'disabled style="opacity:0.5;"' : ''}>⚙️ Act.</button>
                        </div>
                    ` : ''}
                    
                    ${dev.running ? `
                        <div style="display:flex; flex-direction:column; gap:5px; width:100%;">
                            <button class="btn-danger" style="width:100%;" onclick="toggleSesion('${dev.id}')">Cobrar y Liberar</button>
                            ${dev.limit && !dev.forcedOff ? `<button class="btn-warning" style="width:100%;" onclick="pasarALibre('${dev.id}')">Libre (Quitar Límite)</button>` : ''}
                        </div>
                    ` : ''}

                    ${dev.isUpdating ? `
                        <div class="row-inputs">
                            ${dev.updateMode === 'idle_wait' ? `<button class="btn-warning" onclick="verificarProgreso('${dev.id}')">Revisar(3m)</button>` : '<span style="font-size:12px;color:var(--warning);">Encendida...</span>'}
                            <button class="btn-danger" onclick="finalizarActualizacion('${dev.id}')">Liberar</button>
                        </div>
                    ` : ''}
                </div>
            </div>`;
    }).join('');

    if (focusedInputId) {
        const inputToFocus = document.getElementById(focusedInputId);
        if (inputToFocus) {
            const val = inputToFocus.value;
            inputToFocus.value = ''; 
            inputToFocus.value = val; 
            inputToFocus.focus();
        }
    }
}

// ===================================================================
// 10. LISTENERS E INTERVALOS ACTIVOS
// ===================================================================
document.addEventListener("DOMContentLoaded", () => {
    const loginPinInput = document.getElementById("loginPinInput");
    if(loginPinInput) {
        loginPinInput.addEventListener("keypress", function(event) {
            if (event.key === "Enter") realizarLogin();
        });
    }
});

function actualizarRelojesEnVivo() {
    if(!currentRole || !db.devices) return;
    
    db.devices.forEach(dev => {
        const timerEl = document.getElementById(`timer-${dev.id}`);
        const costEl = document.getElementById(`cost-${dev.id}`);
        const cardEl = document.getElementById(`card-${dev.id}`);
        
        if (!timerEl || !costEl || !cardEl) return; 
        
        if (dev.running) {
            const diff = getElapsedMs(dev), mins = diff/60000;
            let tStr = `${Math.floor(mins/60).toString().padStart(2,'0')}:${Math.floor(mins%60).toString().padStart(2,'0')}:${Math.floor((diff/1000)%60).toString().padStart(2,'0')}`;
            let cStr = `$${calcularCobroEfectivo(dev.type, dev.controls, diff, dev.esPromoTD, dev.limit).toFixed(2)}`;
            
            if (dev.isOffline) {
                tStr = `PAUSADO - ${tStr}`;
                timerEl.style.color = '#ff4444'; 
                timerEl.style.fontSize = '18px';
            } else {
                timerEl.style.color = ''; 
                timerEl.style.fontSize = '';
            }

            if (dev.limit && mins >= dev.limit) {
                if (!cardEl.classList.contains('time-up')) cardEl.classList.add('time-up');
                let tol = dev.limit <= 30 ? 5 : dev.limit <= 60 ? 8 : dev.limit <= 90 ? 10 : 15;
                const remTolerance = Math.max(0, (dev.limit + tol) - mins);
                
                if (remTolerance <= 0 || dev.forcedOff) {
                    tStr = "TIEMPO AGOTADO";
                } else {
                    if (!dev.isOffline) tStr = `TOLERANCIA: ${Math.floor(remTolerance)}m ${Math.floor((remTolerance*60)%60).toString().padStart(2,'0')}s`;
                }
            } else {
                if (!cardEl.classList.contains('active')) cardEl.classList.add('active');
            }
            timerEl.innerText = tStr;
            costEl.innerText = cStr;
            
        } else if (dev.isUpdating) {
            const res = dev.updateLimitMins - ((Date.now() - dev.updateStart)/60000);
            if (res <= 0) {
                timerEl.innerText = "Espera Progreso"; costEl.innerText = "Pantalla APAGADA";
            } else {
                timerEl.innerText = `${Math.floor(res).toString().padStart(2,'0')}:${Math.floor((res*60)%60).toString().padStart(2,'0')}`;
                costEl.innerText = dev.updateMode === 'main' ? "Actualizando..." : "Verificando...";
            }
        }
    });
}

// LATIDO DEL SISTEMA: Revisa la conexión y controla la pausa/reconexión cada 5 segundos (5000 ms)
setInterval(() => {
    if(db.devices) {
        db.devices.forEach(dev => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000); 
            fetch(`http://${dev.ip}/`, { mode: 'no-cors', signal: controller.signal })
                .then(() => { 
                    clearTimeout(timeoutId); 
                    if(dev.isOffline) { 
                        dev.isOffline = false; 
                        if (dev.running && dev.offlineSince) {
                            dev.pausedTime = (dev.pausedTime || 0) + (Date.now() - dev.offlineSince);
                            dev.offlineSince = null;
                            fetch(`http://${dev.ip}/on`).catch(()=>{}); 
                        }
                        saveDB(); render(); 
                    } 
                })
                .catch(() => { 
                    clearTimeout(timeoutId); 
                    if(!dev.isOffline) { 
                        dev.isOffline = true; 
                        if (dev.running) dev.offlineSince = Date.now();
                        saveDB(); render(); 
                    } 
                });
        });
    }
}, 5000); // ¡Ajustado a 5 segundos con éxito!

setInterval(() => {
    const liveClock = document.getElementById('liveClock');
    if(liveClock) liveClock.innerText = new Date().toLocaleTimeString();
    
    if(currentRole && db.devices && db.devices.some(d => d.running || d.isUpdating)) {
        db.devices.forEach(dev => {
            if (dev.running) manejarParpadeos(dev, getElapsedMs(dev) / 60000);
        });
        actualizarRelojesEnVivo(); 
    }
}, 1000);   