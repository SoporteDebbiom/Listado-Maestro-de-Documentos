// ========================================
// SYNC — Sincronización en la nube (JSONBin.io)
// ========================================
// Permite que múltiples usuarios en diferentes computadoras
// vean los mismos datos actualizados automáticamente.
//
// Cómo funciona:
//   - Cuando guardas algo → se sube a JSONBin.io
//   - Cada 8 segundos → se revisa si alguien más hizo cambios
//   - Si hay cambios → se actualiza tu pantalla automáticamente
// ========================================

const JSONBIN_CONFIG = {
  API_KEY:     '$2a$10$NpZyMnDvuZqIxkNjRYsyAO2WDSUykzNnIRBIY/rtF2QwF8UuBjg1S',
  ACCESS_KEY:  '$2a$10$A8A83Y2Og/nAD16n4h.syOd5fTpwojXP7JCgSRJejAv83L02oVhWi',
  BIN_ID:      '69b032ee6a0858658be21196'
};

const SYNC_INTERVAL = 8000;     // Revisar cambios cada 8 segundos
const SAVE_DEBOUNCE = 2000;     // Esperar 2s tras último cambio antes de subir
const PRESENCE_TTL = 30000;     // Usuario "offline" tras 30s sin actividad
const API_BASE = 'https://api.jsonbin.io/v3';

// ── Estado interno ──
const SYNC = {
  initialized: false,
  connected: false,
  onlineCount: 0,
  onlineUsers: [],
  sessionId: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
  _version: 0,
  _isSaving: false,
  _saveTimer: null,
  _pollTimer: null,
  _lastSaveAt: 0
};

// ========================================
// COMUNICACIÓN CON JSONBIN.IO
// ========================================

// Leer el bin SIN CACHÉ (la clave para que funcione la sincronización)
async function _binRead() {
  try {
    const res = await fetch(API_BASE + '/b/' + JSONBIN_CONFIG.BIN_ID + '/latest', {
      method: 'GET',
      headers: {
        'X-Master-Key': JSONBIN_CONFIG.API_KEY,
        'X-Access-Key': JSONBIN_CONFIG.ACCESS_KEY,
        'X-Bin-Meta':   'false'
      },
      cache: 'no-store'    // ← CRÍTICO: fuerza lectura fresca, sin caché del navegador
    });
    if (!res.ok) {
      console.warn('[SYNC] Error leyendo:', res.status);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.warn('[SYNC] Sin conexión:', e.message);
    return null;
  }
}

// Escribir al bin completo
async function _binWrite(payload) {
  try {
    const res = await fetch(API_BASE + '/b/' + JSONBIN_CONFIG.BIN_ID, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'X-Master-Key':  JSONBIN_CONFIG.API_KEY,
        'X-Access-Key':  JSONBIN_CONFIG.ACCESS_KEY
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn('[SYNC] Error escribiendo:', res.status);
      return false;
    }
    console.log('[SYNC] ✅ Datos subidos a la nube');
    return true;
  } catch (e) {
    console.warn('[SYNC] Error de red al escribir:', e.message);
    return false;
  }
}

// ========================================
// INICIALIZACIÓN
// ========================================

async function initSync() {
  if (!JSONBIN_CONFIG.API_KEY || JSONBIN_CONFIG.API_KEY.includes('PEGA')) {
    console.warn('[SYNC] Falta configurar API_KEY en js/sync.js');
    return false;
  }
  if (!JSONBIN_CONFIG.BIN_ID || JSONBIN_CONFIG.BIN_ID.includes('PEGA')) {
    console.warn('[SYNC] Falta configurar BIN_ID en js/sync.js');
    return false;
  }

  console.log('[SYNC] Conectando a JSONBin.io...');
  const data = await _binRead();

  if (data !== null) {
    SYNC.initialized = true;
    SYNC.connected = true;
    SYNC._version = data._v || 0;
    console.log('[SYNC] ✅ Conectado (versión actual: ' + SYNC._version + ')');
    updateSyncIndicator();
    return true;
  }

  // Bin vacío o recién creado: inicializar
  console.log('[SYNC] Inicializando bin...');
  var ok = await _binWrite({ state: null, users: null, presence: {}, _v: 1, _by: 'Sistema' });
  if (ok) {
    SYNC.initialized = true;
    SYNC.connected = true;
    SYNC._version = 1;
    console.log('[SYNC] ✅ Bin inicializado');
    updateSyncIndicator();
    return true;
  }

  console.error('[SYNC] ❌ No se pudo conectar');
  return false;
}

// ========================================
// GUARDAR — Subir cambios a la nube
// ========================================

function syncSaveState() {
  // Siempre guardar localmente de inmediato
  localSaveState();
  if (!SYNC.initialized) return;

  // Debounce: esperar a que termine de editar
  clearTimeout(SYNC._saveTimer);
  SYNC._saveTimer = setTimeout(async function() {
    SYNC._isSaving = true;

    // Construir presencia
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
          if (sid !== SYNC.sessionId && now - current.presence[sid].t < PRESENCE_TTL) {
            presence[sid] = current.presence[sid];
          }
        }
      }
    } catch (e) { /* ignorar si falla */ }

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

    var ok = await _binWrite(payload);
    if (ok) {
      SYNC._version = newVersion;
      SYNC._lastSaveAt = Date.now();
      SYNC.connected = true;
      _updatePresenceCount(presence);
    } else {
      SYNC.connected = false;
    }
    updateSyncIndicator();
    SYNC._isSaving = false;

  }, SAVE_DEBOUNCE);
}

// ========================================
// POLLING — Revisar cambios de otros usuarios
// ========================================

function listenStateChanges() {
  if (!SYNC.initialized) return;
  clearInterval(SYNC._pollTimer);

  // Poll inmediato
  _pollOnce();

  // Luego cada SYNC_INTERVAL
  SYNC._pollTimer = setInterval(_pollOnce, SYNC_INTERVAL);
}

async function _pollOnce() {
  // No leer mientras estamos guardando
  if (SYNC._isSaving) return;
  // No leer si guardamos hace menos de 4 segundos
  if (Date.now() - SYNC._lastSaveAt < 4000) return;
  // No leer si la pestaña está oculta
  if (document.hidden) return;

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

    // Actualizar quiénes están en línea
    _updatePresenceCount(remote.presence);

    // ¿Hay datos más nuevos?
    var remoteVersion = remote._v || 0;

    if (remoteVersion > SYNC._version && remote.state) {
      console.log('[SYNC] 📥 Cambios detectados de ' + (remote._by || '?') + ' (v' + remoteVersion + ')');

      // Aplicar datos remotos
      STATE.records   = remote.state.records || [];
      STATE.obsoletos = remote.state.obsoletos || [];
      STATE.papelera  = remote.state.papelera || [];
      STATE.salidas   = remote.state.salidas || [];
      STATE.logs      = remote.state.logs || [];
      STATE.elaboros  = remote.state.elaboros || [];
      STATE.nextId    = remote.state.nextId || 1000;

      SYNC._version = remoteVersion;
      localSaveState();

      // Actualizar usuarios
      if (remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
        AUTH.users = remote.users;
        _localSaveUsers(remote.users);
      }

      // Re-renderizar la pantalla
      if (AUTH.currentUser) {
        render();

        var by = remote._by || '';
        if (by && by !== AUTH.currentUser.username) {
          showToast('📥 ' + by + ' actualizó los datos', 'info');
        }
      }
    }
  } catch (e) {
    console.warn('[SYNC] Error en polling:', e);
  }
}

// Al volver a la pestaña → revisar inmediatamente
document.addEventListener('visibilitychange', function() {
  if (!document.hidden && SYNC.initialized) {
    _pollOnce();
  }
});

// ========================================
// PRESENCIA — Usuarios en línea
// ========================================

function registerPresence() {
  if (!SYNC.initialized || !AUTH.currentUser) return;
  syncSaveState();  // Registra presencia como parte del guardado
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
    var now = Date.now();
    var active = Object.values(presence).filter(function(p) { return now - p.t < PRESENCE_TTL; });
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
// INDICADOR VISUAL (sidebar)
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
}

// ========================================
// USUARIOS — Se guardan junto con el estado
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

function listenUserChanges() {
  // Se sincronizan automáticamente con el polling
}

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
      STATE.papelera  = remote.state.papelera || [];
      STATE.salidas   = remote.state.salidas || [];
      STATE.logs      = remote.state.logs || [];
      STATE.elaboros  = remote.state.elaboros || [];
      STATE.nextId    = remote.state.nextId || 1000;
      SYNC._version   = remote._v || 0;

      if (remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
        AUTH.users = remote.users;
        _localSaveUsers(remote.users);
      }

      _updatePresenceCount(remote.presence);
      localSaveState();

      console.log('[SYNC] 📥 Cargados ' + remote.state.records.length + ' registros desde la nube (v' + SYNC._version + ')');
      return true;
    }
  } catch (e) {
    console.warn('[SYNC] Error cargando desde la nube:', e);
  }

  return localLoadState();
}

// ========================================
// LOCAL STORAGE (Caché / Fallback offline)
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
    var saved = localStorage.getItem('debbiom_state');
    if (saved) {
      var d = JSON.parse(saved);
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
// LIMPIEZA al cerrar pestaña
// ========================================

function cleanupSync() {
  clearInterval(SYNC._pollTimer);
  clearTimeout(SYNC._saveTimer);
}

window.addEventListener('beforeunload', cleanupSync);
