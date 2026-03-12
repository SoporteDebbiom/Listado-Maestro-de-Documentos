// ========================================
// SYNC — Sincronización en la nube
// ========================================
// JSONBin.io como base de datos compartida.
// Cada cambio se sube. Cada 8s se revisa si hay cambios de otros.
// ========================================

const JSONBIN_CONFIG = {
  API_KEY:     '$2a$10$NpZyMnDvuZqIxkNjRYsyAO2WDSUykzNnIRBIY/rtF2QwF8UuBjg1S',
  ACCESS_KEY:  '$2a$10$A8A83Y2Og/nAD16n4h.syOd5fTpwojXP7JCgSRJejAv83L02oVhWi',
  BIN_ID:      '69b032ee6a0858658be21196'
};

var SYNC_INTERVAL  = 8000;   // Polling cada 8 segundos
var SAVE_DEBOUNCE  = 2000;   // Esperar 2s después del último cambio
var PRESENCE_TTL   = 40000;  // Offline tras 40s sin actividad
var API_BASE       = 'https://api.jsonbin.io/v3';

// Estado interno
var SYNC = {
  initialized:  false,
  connected:    false,
  onlineCount:  0,
  onlineUsers:  [],
  sessionId:    Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
  _version:     0,
  _isSaving:    false,
  _saveTimer:   null,
  _pollTimer:   null,
  _lastSaveAt:  0,
  _lastPollAt:  0,
  _syncCount:   0       // Contador de sincronizaciones exitosas
};

// ========================================
// API — Lectura y escritura a JSONBin.io
// ========================================

// LEER — con doble anti-caché: URL timestamp + fetch no-store
async function _binRead() {
  // El parámetro ?_t= engaña al CDN de JSONBin para que NO cachee
  var url = API_BASE + '/b/' + JSONBIN_CONFIG.BIN_ID + '/latest?_t=' + Date.now();
  try {
    var res = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Master-Key':  JSONBIN_CONFIG.API_KEY,
        'X-Access-Key':  JSONBIN_CONFIG.ACCESS_KEY,
        'X-Bin-Meta':    'false',
        'Cache-Control': 'no-cache, no-store'
      },
      cache: 'no-store'
    });
    if (!res.ok) {
      console.warn('[SYNC] ❌ Error leyendo (HTTP ' + res.status + ')');
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[SYNC] ❌ Sin conexión:', e.message);
    return null;
  }
}

// ESCRIBIR — enviar datos completos
async function _binWrite(payload) {
  try {
    var res = await fetch(API_BASE + '/b/' + JSONBIN_CONFIG.BIN_ID, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'X-Master-Key':  JSONBIN_CONFIG.API_KEY,
        'X-Access-Key':  JSONBIN_CONFIG.ACCESS_KEY
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn('[SYNC] ❌ Error escribiendo (HTTP ' + res.status + ')');
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[SYNC] ❌ Error de red al escribir:', e.message);
    return false;
  }
}

// ========================================
// INICIALIZACIÓN
// ========================================

async function initSync() {
  if (!JSONBIN_CONFIG.API_KEY || JSONBIN_CONFIG.API_KEY.includes('PEGA')) {
    console.warn('[SYNC] Falta API_KEY en js/sync.js — Modo local');
    return false;
  }
  if (!JSONBIN_CONFIG.BIN_ID || JSONBIN_CONFIG.BIN_ID.includes('PEGA')) {
    console.warn('[SYNC] Falta BIN_ID en js/sync.js — Modo local');
    return false;
  }

  console.log('[SYNC] Conectando...');
  var data = await _binRead();

  if (data !== null) {
    SYNC.initialized = true;
    SYNC.connected   = true;
    SYNC._version    = (data && data._v) ? data._v : 0;
    console.log('[SYNC] ✅ Conectado a JSONBin.io (versión: ' + SYNC._version + ')');
    updateSyncIndicator();
    return true;
  }

  // Bin vacío — inicializar
  console.log('[SYNC] Bin vacío, inicializando...');
  var ok = await _binWrite({ state: null, users: null, presence: {}, _v: 1, _by: 'Sistema' });
  if (ok) {
    SYNC.initialized = true;
    SYNC.connected   = true;
    SYNC._version    = 1;
    updateSyncIndicator();
    return true;
  }

  console.error('[SYNC] ❌ No se pudo conectar. Revisa API Key y Bin ID.');
  return false;
}

// ========================================
// GUARDAR — Subir cambios a la nube
// ========================================

function syncSaveState() {
  localSaveState();
  if (!SYNC.initialized) return;

  clearTimeout(SYNC._saveTimer);
  SYNC._saveTimer = setTimeout(_doSave, SAVE_DEBOUNCE);
}

async function _doSave() {
  SYNC._isSaving = true;
  _showSyncAnimation(true);

  // 1. Construir presencia: yo + otros activos
  var presence = {};
  if (AUTH.currentUser) {
    presence[SYNC.sessionId] = {
      u: AUTH.currentUser.username,
      t: Date.now()
    };
  }

  // Leer presencia actual para conservar a otros usuarios
  try {
    var current = await _binRead();
    if (current && current.presence) {
      var now = Date.now();
      for (var sid in current.presence) {
        if (sid !== SYNC.sessionId && (now - current.presence[sid].t) < PRESENCE_TTL) {
          presence[sid] = current.presence[sid];
        }
      }
    }
  } catch (e) { /* si falla, no importa */ }

  // 2. Construir payload completo
  var newVersion = Date.now();
  var payload = {
    state: {
      records:   STATE.records || [],
      obsoletos: STATE.obsoletos || [],
      papelera:  STATE.papelera || [],
      salidas:   STATE.salidas || [],
      logs:      (STATE.logs || []).slice(0, 1500),
      elaboros:  STATE.elaboros || [],
      nextId:    STATE.nextId || 1000
    },
    users: (AUTH.users || []).map(function(u) {
      return { username: u.username, _h: u._h, role: u.role, fullName: u.fullName };
    }),
    presence: presence,
    _v:  newVersion,
    _by: AUTH.currentUser ? AUTH.currentUser.username : 'Sistema'
  };

  // 3. Escribir
  var ok = await _binWrite(payload);
  if (ok) {
    SYNC._version    = newVersion;
    SYNC._lastSaveAt = Date.now();
    SYNC._syncCount++;
    SYNC.connected   = true;
    _updatePresenceCount(presence);
    console.log('[SYNC] ⬆️ Subido v' + newVersion + ' (' + (STATE.records||[]).length + ' registros)');
  } else {
    SYNC.connected = false;
  }

  updateSyncIndicator();
  _showSyncAnimation(false);
  SYNC._isSaving = false;
}

// Forzar sincronización manual (para el botón)
async function forceSync() {
  if (!SYNC.initialized) {
    showToast('Sincronización no disponible (modo local)', 'error');
    return;
  }
  _showSyncAnimation(true);
  console.log('[SYNC] 🔄 Sincronización manual...');

  // Primero subir mis cambios
  await _doSave();

  // Luego descargar cambios de otros
  await _pollOnce(true);

  _showSyncAnimation(false);
  showToast('✅ Sincronización completa', 'success');
}

// ========================================
// POLLING — Revisar cambios de otros
// ========================================

function listenStateChanges() {
  if (!SYNC.initialized) return;
  clearInterval(SYNC._pollTimer);

  // Poll inmediato
  setTimeout(function() { _pollOnce(false); }, 1000);

  // Luego cada SYNC_INTERVAL
  SYNC._pollTimer = setInterval(function() { _pollOnce(false); }, SYNC_INTERVAL);
}

async function _pollOnce(force) {
  // Protecciones (se pueden saltar con force=true)
  if (!force) {
    if (SYNC._isSaving) return;
    if (Date.now() - SYNC._lastSaveAt < 4000) return;
    if (document.hidden) return;
  }

  try {
    var remote = await _binRead();

    if (!remote) {
      if (SYNC.connected) {
        SYNC.connected = false;
        updateSyncIndicator();
      }
      return;
    }

    // Reconexión
    if (!SYNC.connected) {
      SYNC.connected = true;
      updateSyncIndicator();
      console.log('[SYNC] ✅ Reconectado');
    }

    SYNC._lastPollAt = Date.now();

    // Actualizar presencia
    _updatePresenceCount(remote.presence);

    // ¿Hay datos más nuevos?
    var remoteVer = remote._v || 0;

    if (remoteVer > SYNC._version && remote.state) {
      var by = remote._by || '?';
      console.log('[SYNC] 📥 Cambios de ' + by + ' detectados (v' + SYNC._version + ' → v' + remoteVer + ')');

      // Aplicar datos remotos
      STATE.records   = remote.state.records   || [];
      STATE.obsoletos = remote.state.obsoletos || [];
      STATE.papelera  = remote.state.papelera  || [];
      STATE.salidas   = remote.state.salidas   || [];
      STATE.logs      = remote.state.logs      || [];
      STATE.elaboros  = remote.state.elaboros  || [];
      STATE.nextId    = remote.state.nextId    || 1000;

      SYNC._version = remoteVer;
      localSaveState();

      // Actualizar lista de usuarios
      if (remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
        AUTH.users = remote.users;
        _localSaveUsers(remote.users);
      }

      // Re-renderizar pantalla
      if (AUTH.currentUser) {
        render();
        if (by && by !== AUTH.currentUser.username) {
          showToast('📥 ' + by + ' actualizó los datos', 'info');
        }
      }
    } else {
      // Sin cambios — actualizar solo el timestamp de último chequeo
      _updateLastSyncUI();
    }
  } catch (e) {
    console.warn('[SYNC] Error polling:', e);
  }
}

// Al volver a la pestaña → revisar inmediatamente
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && SYNC.initialized) {
    _pollOnce(true);
  }
});

// ========================================
// PRESENCIA — Usuarios en línea
// ========================================

function registerPresence() {
  if (!SYNC.initialized || !AUTH.currentUser) return;
  syncSaveState();
}

function unregisterPresence() {
  if (!SYNC.initialized) return;
  (async function() {
    try {
      var remote = await _binRead();
      if (remote && remote.presence) {
        delete remote.presence[SYNC.sessionId];
        await _binWrite(remote);
      }
    } catch (e) {}
  })();
}

function _updatePresenceCount(presence) {
  if (!presence || typeof presence !== 'object') {
    SYNC.onlineCount = 0;
    SYNC.onlineUsers = [];
  } else {
    var now    = Date.now();
    var active = Object.values(presence).filter(function(p) { return (now - p.t) < PRESENCE_TTL; });
    SYNC.onlineCount = active.length;
    SYNC.onlineUsers = active.map(function(p) { return p.u; }).filter(function(v, i, a) { return a.indexOf(v) === i; });
  }
  updateOnlineCountUI();
}

function updateOnlineCountUI() {
  var el1 = document.querySelector('.online-count');
  if (el1) el1.textContent = String(SYNC.onlineCount);
  var el2 = document.getElementById('sidebar-online-count');
  if (el2) el2.textContent = String(SYNC.onlineCount);
}

// ========================================
// UI — Indicadores visuales
// ========================================

function updateSyncIndicator() {
  var el = document.getElementById('sync-indicator');
  if (!el) return;
  if (!SYNC.initialized) {
    el.className = 'sync-indicator sync-offline';
    el.innerHTML = '<i class="fas fa-database"></i> Local';
  } else if (SYNC.connected) {
    el.className = 'sync-indicator sync-online';
    el.innerHTML = '<i class="fas fa-cloud"></i> En línea';
  } else {
    el.className = 'sync-indicator sync-reconnecting';
    el.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Reconectando...';
  }
  _updateLastSyncUI();
}

function _updateLastSyncUI() {
  var el = document.getElementById('sync-last-time');
  if (!el) return;
  if (SYNC._lastPollAt > 0) {
    var secsAgo = Math.round((Date.now() - SYNC._lastPollAt) / 1000);
    el.textContent = secsAgo < 5 ? 'ahora' : 'hace ' + secsAgo + 's';
  }
}

// Animación de sync (spinner en el botón)
function _showSyncAnimation(active) {
  var btn = document.getElementById('btn-sync');
  if (!btn) return;
  if (active) {
    btn.classList.add('syncing');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sincronizando...';
  } else {
    btn.classList.remove('syncing');
    btn.innerHTML = '<i class="fas fa-arrows-rotate"></i> Sincronizar';
  }
}

// Actualizar el reloj cada 5 segundos
setInterval(function() { _updateLastSyncUI(); }, 5000);

// ========================================
// USUARIOS
// ========================================

function syncSaveUsers(users) {
  _localSaveUsers(users);
  if (SYNC.initialized) syncSaveState();
}

async function syncLoadUsers() {
  if (!SYNC.initialized) return null;
  try {
    var remote = await _binRead();
    if (remote && remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
      return remote.users;
    }
  } catch (e) {}
  return null;
}

function listenUserChanges() { /* via polling automático */ }

function _localSaveUsers(users) {
  try {
    localStorage.setItem('debbiom_users_v2', JSON.stringify(
      users.map(function(u) { return { username: u.username, _h: u._h, role: u.role, fullName: u.fullName }; })
    ));
  } catch (e) {}
}

// ========================================
// CARGA DESDE LA NUBE
// ========================================

async function syncLoadState() {
  if (!SYNC.initialized) return localLoadState();

  try {
    var remote = await _binRead();
    if (remote && remote.state && remote.state.records && remote.state.records.length > 0) {
      STATE.records   = remote.state.records;
      STATE.obsoletos = remote.state.obsoletos || [];
      STATE.papelera  = remote.state.papelera  || [];
      STATE.salidas   = remote.state.salidas   || [];
      STATE.logs      = remote.state.logs      || [];
      STATE.elaboros  = remote.state.elaboros  || [];
      STATE.nextId    = remote.state.nextId    || 1000;
      SYNC._version   = remote._v || 0;

      if (remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
        AUTH.users = remote.users;
        _localSaveUsers(remote.users);
      }
      _updatePresenceCount(remote.presence);
      localSaveState();
      console.log('[SYNC] 📥 Cargados ' + remote.state.records.length + ' registros (v' + SYNC._version + ')');
      return true;
    }
  } catch (e) {
    console.warn('[SYNC] Error cargando nube:', e);
  }
  return localLoadState();
}

// ========================================
// LOCAL STORAGE (Caché offline)
// ========================================

function localSaveState() {
  try {
    localStorage.setItem('debbiom_state', JSON.stringify({
      records: STATE.records, obsoletos: STATE.obsoletos,
      papelera: STATE.papelera, salidas: STATE.salidas,
      logs: STATE.logs, elaboros: STATE.elaboros, nextId: STATE.nextId
    }));
  } catch (e) {}
}

function localLoadState() {
  try {
    var s = localStorage.getItem('debbiom_state');
    if (s) {
      var d = JSON.parse(s);
      if (d.records && d.records.length > 0) {
        STATE.records = d.records; STATE.obsoletos = d.obsoletos || [];
        STATE.papelera = d.papelera || []; STATE.salidas = d.salidas || [];
        STATE.logs = d.logs || []; STATE.elaboros = d.elaboros || [];
        STATE.nextId = d.nextId || 1000;
        return true;
      }
    }
  } catch (e) {}
  return false;
}

// ========================================
// LIMPIEZA
// ========================================

function cleanupSync() {
  clearInterval(SYNC._pollTimer);
  clearTimeout(SYNC._saveTimer);
}
window.addEventListener('beforeunload', cleanupSync);
