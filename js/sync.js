// ========================================
// JSONBIN SYNC - Sincronización en la nube
// ========================================
// Usa JSONBin.io como base de datos JSON gratuita.
// Múltiples usuarios se sincronizan via polling cada 15s.
//
// CONFIGURACIÓN: Solo necesitas 2 datos (ve SETUP.md):
//   1. Tu API Key de jsonbin.io
//   2. El Bin ID (se puede crear automáticamente)
// ========================================

// ┌─────────────────────────────────────────────┐
// │  CONFIGURACIÓN — Pega aquí tus 2 valores    │
// └─────────────────────────────────────────────┘
const JSONBIN_CONFIG = {
  API_KEY:     '$2a$10$NpZyMnDvuZqIxkNjRYsyAO2WDSUykzNnIRBIY/rtF2QwF8UuBjg1S',
  ACCESS_KEY:  '$2a$10$A8A83Y2Og/nAD16n4h.syOd5fTpwojXP7JCgSRJejAv83L02oVhWi',
  BIN_ID:      '69b032ee6a0858658be21196'
};

// ── Configuración avanzada (no necesitas tocar esto) ──
const SYNC_SETTINGS = {
  POLL_INTERVAL: 15000,    // Cada 15 segundos revisa cambios
  PRESENCE_TTL: 45000,     // Un usuario se considera "offline" tras 45s sin actividad
  DEBOUNCE_MS: 1500,       // Espera 1.5s tras el último cambio antes de subir
  API_URL: 'https://api.jsonbin.io/v3'
};

// ── Estado interno del módulo ──
const SYNC = {
  initialized: false,
  connected: false,
  onlineCount: 0,
  onlineUsers: [],
  sessionId: 'sess_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
  _remoteVersion: 0,
  _lastWriteTime: 0,
  _pollTimer: null,
  _debounceTimer: null,
  _presenceTimer: null
};

// ========================================
// API — Comunicación con JSONBin.io
// ========================================

async function _apiFetch(endpoint, method, body) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': JSONBIN_CONFIG.API_KEY,
    'X-Access-Key': JSONBIN_CONFIG.ACCESS_KEY
  };
  
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res = await fetch(SYNC_SETTINGS.API_URL + endpoint, opts);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[SYNC] API error:', res.status, errText);
      return null;
    }
    return await res.json();
  } catch(e) {
    console.warn('[SYNC] Red no disponible:', e.message);
    return null;
  }
}

// Leer el bin completo
async function _readBin() {
  const data = await _apiFetch('/b/' + JSONBIN_CONFIG.BIN_ID + '/latest', 'GET');
  if (data && data.record) return data.record;
  return null;
}

// Escribir al bin completo
async function _writeBin(content) {
  const data = await _apiFetch('/b/' + JSONBIN_CONFIG.BIN_ID, 'PUT', content);
  return data !== null;
}

// Crear un bin nuevo (solo la primera vez)
async function _createBin(content) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Master-Key': JSONBIN_CONFIG.API_KEY,
    'X-Access-Key': JSONBIN_CONFIG.ACCESS_KEY,
    'X-Bin-Name': 'debbiom-sync',
    'X-Bin-Private': 'false'
  };
  try {
    const res = await fetch(SYNC_SETTINGS.API_URL + '/b', {
      method: 'POST', headers,
      body: JSON.stringify(content)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.metadata && data.metadata.id) {
      return data.metadata.id;
    }
  } catch(e) {
    console.warn('[SYNC] Error creando bin:', e.message);
  }
  return null;
}

// ========================================
// INICIALIZACIÓN
// ========================================

async function initSync() {
  // Verificar que la API key fue configurada
  if (!JSONBIN_CONFIG.API_KEY || JSONBIN_CONFIG.API_KEY.includes('PEGA_TU')) {
    console.warn('[SYNC] ⚠️ Configura tu API_KEY en js/sync.js');
    console.warn('[SYNC] Funcionando en modo LOCAL (sin sincronización)');
    return false;
  }

  // Verificar que hay Bin ID
  if (!JSONBIN_CONFIG.BIN_ID || JSONBIN_CONFIG.BIN_ID.includes('PEGA_TU')) {
    console.warn('[SYNC] ⚠️ Falta BIN_ID en js/sync.js');
    return false;
  }

  // Verificar conexión con un read de prueba
  const testRead = await _readBin();
  if (testRead !== null) {
    SYNC.initialized = true;
    SYNC.connected = true;
    console.log('[SYNC] ✅ Conectado a JSONBin.io');
    updateSyncIndicator();
    return true;
  } else {
    // Si el bin está vacío (recién creado), inicializarlo
    console.log('[SYNC] Inicializando bin con datos vacíos...');
    const emptyData = {
      state: null,
      users: null,
      presence: {},
      _version: Date.now(),
      _lastModifiedBy: 'Sistema'
    };
    const ok = await _writeBin(emptyData);
    if (ok) {
      SYNC.initialized = true;
      SYNC.connected = true;
      console.log('[SYNC] ✅ Bin inicializado y conectado');
      updateSyncIndicator();
      return true;
    }
    
    console.warn('[SYNC] No se pudo conectar a JSONBin.io');
    SYNC.initialized = false;
    SYNC.connected = false;
    updateSyncIndicator();
    return false;
  }
}

// ========================================
// INDICADOR VISUAL
// ========================================

function updateSyncIndicator() {
  const el = document.getElementById('sync-indicator');
  if (!el) return;

  if (!SYNC.initialized) {
    el.className = 'sync-indicator sync-offline';
    el.innerHTML = '<i class="fas fa-database"></i> Local';
    el.title = 'Modo local (sin sincronización)';
  } else if (SYNC.connected) {
    el.className = 'sync-indicator sync-online';
    el.innerHTML = '<i class="fas fa-cloud"></i> En línea';
    el.title = 'Sincronizado — JSONBin.io';
  } else {
    el.className = 'sync-indicator sync-reconnecting';
    el.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Reconectando...';
    el.title = 'Intentando reconectar...';
  }
}

function updateOnlineCountUI() {
  const countEl = document.querySelector('.online-count');
  if (countEl) countEl.textContent = String(SYNC.onlineCount);
  const sidebarCount = document.getElementById('sidebar-online-count');
  if (sidebarCount) sidebarCount.textContent = String(SYNC.onlineCount);
}

// ========================================
// PRESENCIA (Usuarios en línea)
// ========================================

function registerPresence() {
  if (!SYNC.initialized || !AUTH.currentUser) return;
  // La presencia se envía junto con cada escritura al bin
  // y también mediante un heartbeat periódico
  _sendPresenceHeartbeat();
  // Heartbeat cada 20 segundos
  clearInterval(SYNC._presenceTimer);
  SYNC._presenceTimer = setInterval(_sendPresenceHeartbeat, 20000);
}

function unregisterPresence() {
  clearInterval(SYNC._presenceTimer);
  if (!SYNC.initialized) return;
  // Intentar eliminar presencia del bin
  _removePresence();
}

async function _sendPresenceHeartbeat() {
  if (!SYNC.initialized || !AUTH.currentUser) return;
  try {
    const remote = await _readBin();
    if (!remote) return;
    
    const presence = remote.presence || {};
    // Limpiar presencias viejas (más de PRESENCE_TTL ms)
    const now = Date.now();
    for (const sid in presence) {
      if (now - presence[sid].lastSeen > SYNC_SETTINGS.PRESENCE_TTL) {
        delete presence[sid];
      }
    }
    // Registrar nuestra presencia
    presence[SYNC.sessionId] = {
      username: AUTH.currentUser.username,
      fullName: AUTH.currentUser.fullName || AUTH.currentUser.username,
      lastSeen: now
    };
    
    remote.presence = presence;
    await _writeBin(remote);

    // Actualizar conteo
    _countOnlineUsers(presence);
  } catch(e) {
    console.warn('[SYNC] Error en heartbeat:', e);
  }
}

async function _removePresence() {
  try {
    const remote = await _readBin();
    if (!remote) return;
    const presence = remote.presence || {};
    delete presence[SYNC.sessionId];
    remote.presence = presence;
    await _writeBin(remote);
  } catch(e) {}
}

function _countOnlineUsers(presence) {
  if (!presence) { SYNC.onlineCount = 0; SYNC.onlineUsers = []; return; }
  const now = Date.now();
  const active = Object.values(presence).filter(p => now - p.lastSeen < SYNC_SETTINGS.PRESENCE_TTL);
  SYNC.onlineCount = active.length;
  SYNC.onlineUsers = [...new Set(active.map(p => p.username))];
  updateOnlineCountUI();
}

// ========================================
// GUARDAR ESTADO (Subir a la nube)
// ========================================

function syncSaveState() {
  if (!SYNC.initialized) {
    localSaveState();
    return;
  }
  // Siempre guardar local como caché inmediato
  localSaveState();

  // Debounce: no subir más de 1 vez cada DEBOUNCE_MS
  clearTimeout(SYNC._debounceTimer);
  SYNC._debounceTimer = setTimeout(async () => {
    SYNC._lastWriteTime = Date.now();

    try {
      // Leer el bin actual para preservar presencia
      const remote = await _readBin();
      const presence = (remote && remote.presence) ? remote.presence : {};

      // Actualizar nuestra presencia
      if (AUTH.currentUser) {
        presence[SYNC.sessionId] = {
          username: AUTH.currentUser.username,
          fullName: AUTH.currentUser.fullName || AUTH.currentUser.username,
          lastSeen: Date.now()
        };
      }

      const payload = {
        state: {
          records: STATE.records || [],
          obsoletos: STATE.obsoletos || [],
          papelera: STATE.papelera || [],
          salidas: STATE.salidas || [],
          logs: (STATE.logs || []).slice(0, 2000),
          elaboros: STATE.elaboros || [],
          nextId: STATE.nextId || 1000
        },
        users: (AUTH.users || []).map(u => ({
          username: u.username, _h: u._h, role: u.role, fullName: u.fullName
        })),
        presence: presence,
        _version: Date.now(),
        _lastModifiedBy: AUTH.currentUser ? AUTH.currentUser.username : 'Sistema'
      };

      const ok = await _writeBin(payload);
      if (ok) {
        SYNC._remoteVersion = payload._version;
        SYNC.connected = true;
        _countOnlineUsers(presence);
      } else {
        SYNC.connected = false;
      }
      updateSyncIndicator();
    } catch(e) {
      console.warn('[SYNC] Error al subir:', e);
      SYNC.connected = false;
      updateSyncIndicator();
    }
  }, SYNC_SETTINGS.DEBOUNCE_MS);
}

// ========================================
// CARGAR ESTADO (Bajar de la nube)
// ========================================

async function syncLoadState() {
  if (!SYNC.initialized) return localLoadState();

  try {
    const remote = await _readBin();
    if (remote && remote.state && remote.state.records && remote.state.records.length > 0) {
      // Aplicar estado remoto
      _applyRemoteState(remote.state);
      SYNC._remoteVersion = remote._version || 0;
      
      // Aplicar usuarios si existen
      if (remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
        if (remote.users.every(u => u._h && u.username)) {
          AUTH.users = remote.users;
          _localSaveUsers(remote.users);
        }
      }

      // Actualizar presencia
      _countOnlineUsers(remote.presence);

      // Cachear localmente
      localSaveState();
      console.log('[SYNC] Datos cargados desde la nube (' + remote.state.records.length + ' registros)');
      return true;
    }
  } catch(e) {
    console.warn('[SYNC] Error leyendo nube, usando caché local:', e);
  }

  return localLoadState();
}

function _applyRemoteState(state) {
  STATE.records = state.records || [];
  STATE.obsoletos = state.obsoletos || [];
  STATE.papelera = state.papelera || [];
  STATE.salidas = state.salidas || [];
  STATE.logs = state.logs || [];
  STATE.elaboros = state.elaboros || [];
  STATE.nextId = state.nextId || 1000;
}

// ========================================
// POLLING — Revisar cambios periódicamente
// ========================================

function listenStateChanges() {
  if (!SYNC.initialized) return;
  
  // Limpiar timer previo
  clearInterval(SYNC._pollTimer);
  
  SYNC._pollTimer = setInterval(async () => {
    // No revisar si acabamos de escribir (evitar eco)
    if (Date.now() - SYNC._lastWriteTime < 5000) return;
    // No revisar si la pestaña no está activa
    if (document.hidden) return;

    try {
      const remote = await _readBin();
      if (!remote) {
        if (SYNC.connected) {
          SYNC.connected = false;
          updateSyncIndicator();
        }
        return;
      }

      if (!SYNC.connected) {
        SYNC.connected = true;
        updateSyncIndicator();
      }

      // Actualizar presencia
      _countOnlineUsers(remote.presence);

      // ¿Hay nueva versión?
      const remoteVer = remote._version || 0;
      if (remoteVer > SYNC._remoteVersion && remote.state) {
        const prevCount = STATE.records ? STATE.records.length : 0;
        _applyRemoteState(remote.state);
        SYNC._remoteVersion = remoteVer;
        localSaveState();

        // Actualizar usuarios si cambiaron
        if (remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
          if (remote.users.every(u => u._h && u.username)) {
            AUTH.users = remote.users;
            _localSaveUsers(remote.users);
          }
        }

        // Re-renderizar
        if (AUTH.currentUser) {
          render();
          // Notificar si fue otro usuario quien hizo el cambio
          if (remote._lastModifiedBy && 
              remote._lastModifiedBy !== (AUTH.currentUser ? AUTH.currentUser.username : '')) {
            showToast(remote._lastModifiedBy + ' actualizó los datos', 'info');
          }
        }
      }
    } catch(e) {
      console.warn('[SYNC] Error en polling:', e);
    }
  }, SYNC_SETTINGS.POLL_INTERVAL);
}

// ========================================
// USUARIOS — Sincronización
// ========================================

function syncSaveUsers(users) {
  if (!SYNC.initialized) {
    _localSaveUsers(users);
    return;
  }
  // Los usuarios se guardan junto con el estado en syncSaveState
  _localSaveUsers(users);
  // Forzar una escritura completa
  syncSaveState();
}

async function syncLoadUsers() {
  if (!SYNC.initialized) return null;
  try {
    const remote = await _readBin();
    if (remote && remote.users && Array.isArray(remote.users) && remote.users.length > 0) {
      if (remote.users.every(u => u._h && u.username)) {
        return remote.users;
      }
    }
  } catch(e) {}
  return null;
}

function listenUserChanges() {
  // Los usuarios se sincronizan via el mismo polling de listenStateChanges
}

function _localSaveUsers(users) {
  try {
    const sanitized = users.map(u => ({
      username: u.username, _h: u._h, role: u.role, fullName: u.fullName
    }));
    localStorage.setItem('debbiom_users_v2', JSON.stringify(sanitized));
  } catch(e) {}
}

// ========================================
// LOCAL STORAGE (Caché / Fallback)
// ========================================

function localSaveState() {
  try {
    localStorage.setItem('debbiom_state', JSON.stringify({
      records: STATE.records,
      obsoletos: STATE.obsoletos,
      papelera: STATE.papelera,
      salidas: STATE.salidas,
      logs: STATE.logs,
      elaboros: STATE.elaboros,
      nextId: STATE.nextId
    }));
  } catch(e) {}
}

function localLoadState() {
  try {
    const saved = localStorage.getItem('debbiom_state');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.records && data.records.length > 0) {
        _applyRemoteState(data);
        return true;
      }
    }
  } catch(e) {}
  return false;
}

// ========================================
// LIMPIEZA
// ========================================

function cleanupSync() {
  clearInterval(SYNC._pollTimer);
  clearInterval(SYNC._presenceTimer);
  clearTimeout(SYNC._debounceTimer);
  // Intentar quitar presencia (no esperar respuesta)
  if (SYNC.initialized && JSONBIN_CONFIG.BIN_ID && !JSONBIN_CONFIG.BIN_ID.includes('PEGA')) {
    // navigator.sendBeacon no funciona con headers personalizados
    // así que hacemos un fetch rápido
    _removePresence();
  }
}

window.addEventListener('beforeunload', cleanupSync);
// Pausar polling cuando la pestaña no está activa
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && SYNC.initialized) {
    // Al volver a la pestaña, hacer un poll inmediato
    listenStateChanges();
  }
});
