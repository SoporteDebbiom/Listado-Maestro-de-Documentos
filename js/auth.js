// ========================================
// AUTH - Sistema de autenticación y seguridad
// ========================================

// ========================================
// AUTH / USER SYSTEM — CAPA DE SEGURIDAD
// ========================================

// ── CAPA 1: Utilidades criptográficas ──
const _SEC = Object.freeze({
  _ek: 'ZGViYmlvbV9zZWN1cml0eV9rZXlfMjAyNg==',
  _sk: 'ZGViYmlvbV9zZXNzaW9uX3NhbHQ=',
  async sha256(text) {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  },
  async deriveKey(passphrase) {
    const enc = new TextEncoder().encode(passphrase);
    const keyMaterial = await crypto.subtle.importKey('raw', enc, 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode(atob(this._sk)), iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  },
  async encrypt(data) {
    try {
      const key = await this.deriveKey(atob(this._ek));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(JSON.stringify(data));
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
      return JSON.stringify({
        iv: Array.from(iv),
        data: Array.from(new Uint8Array(cipher))
      });
    } catch(e) { return null; }
  },
  async decrypt(stored) {
    try {
      const key = await this.deriveKey(atob(this._ek));
      const { iv, data } = JSON.parse(stored);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        new Uint8Array(data)
      );
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch(e) { return null; }
  }
});

// ── CAPA 2: Usuarios predeterminados (solo hashes, sin contraseñas visibles) ──
const DEFAULT_USERS = [
  { username: 'SGuerrero', _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'admin', fullName: 'S. Guerrero' },
  { username: 'ROrtiz',    _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'user',  fullName: 'R. Ortiz' },
  { username: 'EZul',      _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'user',  fullName: 'E. Zul' },
  { username: 'JRamos',    _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'user',  fullName: 'J. Ramos' },
  { username: 'VRamos',    _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'user',  fullName: 'V. Ramos' },
  { username: 'HRamirez',  _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'user',  fullName: 'H. Ramírez' },
  { username: 'DPalacios', _h: 'e83f19585cd7d4956c40ec184e2c30e2591478e3b9210df470255b149090d4c8', role: 'user',  fullName: 'D. Palacios' },
];

// ── CAPA 3: Persistencia cifrada de usuarios ──
function loadUsers() {
  try {
    const saved = localStorage.getItem('debbiom_users_enc');
    if (saved) {
      // Intentar descifrar datos almacenados
      // Como decrypt es async, necesitamos un fallback sincrónico para la carga inicial
      const raw = localStorage.getItem('debbiom_users_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Validar integridad: cada usuario debe tener _h en vez de password
        if (Array.isArray(parsed) && parsed.every(u => u._h && !u.password)) {
          return parsed;
        }
      }
    }
    // Migración: si hay datos viejos con passwords en texto plano, eliminarlos
    const oldData = localStorage.getItem('debbiom_users');
    if (oldData) {
      localStorage.removeItem('debbiom_users'); // Limpiar datos inseguros
    }
  } catch(e) {}
  return JSON.parse(JSON.stringify(DEFAULT_USERS));
}

async function saveUsersEncrypted(users) {
  try {
    // Validar que ningún usuario tenga campo 'password' en texto plano
    const sanitized = users.map(u => {
      const clean = { username: u.username, _h: u._h, role: u.role, fullName: u.fullName };
      if (u.password) delete u.password; // Eliminar si existe accidentalmente
      return clean;
    });
    // Guardar versión cifrada
    const encrypted = await _SEC.encrypt(sanitized);
    if (encrypted) localStorage.setItem('debbiom_users_enc', encrypted);
    // Guardar versión con hashes (para carga sincrónica)
    localStorage.setItem('debbiom_users_v2', JSON.stringify(sanitized));
    // Limpiar datos antiguos inseguros
    localStorage.removeItem('debbiom_users');
  } catch(e) {}
}

// Wrapper sincrónico para compatibilidad
function saveUsers(users) {
  saveUsersEncrypted(users);
  // Sincronizar a Firebase si está disponible
  if (typeof syncSaveUsers === 'function') {
    syncSaveUsers(users);
  }
}

// ── CAPA 4: Sesión segura con expiración ──
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas de expiración

function loadSession() {
  try {
    const s = sessionStorage.getItem('debbiom_session_v2');
    if (s) {
      const session = JSON.parse(s);
      // Validar expiración
      if (session._exp && Date.now() > session._exp) {
        clearSession();
        return null;
      }
      // Validar estructura (no debe contener datos sensibles)
      if (session.username && session.role) {
        return { username: session.username, role: session.role, fullName: session.fullName };
      }
    }
  } catch(e) {}
  // Limpiar sesiones viejas inseguras
  try { sessionStorage.removeItem('debbiom_session'); } catch(e) {}
  return null;
}

function saveSession(user) {
  try {
    const session = {
      username: user.username,
      role: user.role,
      fullName: user.fullName,
      _exp: Date.now() + SESSION_TTL_MS,
      _ts: Date.now()
    };
    sessionStorage.setItem('debbiom_session_v2', JSON.stringify(session));
    // Limpiar sesiones viejas
    sessionStorage.removeItem('debbiom_session');
  } catch(e) {}
}

function clearSession() {
  try {
    sessionStorage.removeItem('debbiom_session_v2');
    sessionStorage.removeItem('debbiom_session');
  } catch(e) {}
}

// ── CAPA 5: Rate limiting y protección contra fuerza bruta ──
const _loginGuard = {
  attempts: 0,
  lockUntil: 0,
  maxAttempts: 5,
  lockoutMs: 60000, // 1 minuto de bloqueo
  isLocked() {
    if (Date.now() < this.lockUntil) return true;
    if (this.lockUntil > 0 && Date.now() >= this.lockUntil) {
      this.attempts = 0;
      this.lockUntil = 0;
    }
    return false;
  },
  recordFail() {
    this.attempts++;
    if (this.attempts >= this.maxAttempts) {
      this.lockUntil = Date.now() + this.lockoutMs;
    }
  },
  recordSuccess() {
    this.attempts = 0;
    this.lockUntil = 0;
  },
  getRemainingSeconds() {
    return Math.ceil(Math.max(0, this.lockUntil - Date.now()) / 1000);
  }
};

// ── CAPA 6: Objeto AUTH protegido ──
let AUTH = {
  users: loadUsers(),
  currentUser: loadSession(),
  loginError: '',
  showPassword: false,
};

// ── CAPA 7: Login seguro con hash comparison ──
async function attemptLogin(username, password) {
  // Validación de entrada
  if (!username || !password) {
    AUTH.loginError = 'Ingresa usuario y contraseña';
    return false;
  }
  username = username.trim();
  if (username.length > 50 || password.length > 128) {
    AUTH.loginError = 'Datos de entrada no válidos';
    return false;
  }

  // Verificar rate limit
  if (_loginGuard.isLocked()) {
    const sec = _loginGuard.getRemainingSeconds();
    AUTH.loginError = 'Demasiados intentos. Espera ' + sec + 's';
    return false;
  }

  // Hash de la contraseña ingresada
  const inputHash = await _SEC.sha256(password);

  // Buscar usuario por nombre (case-insensitive) y comparar hash
  const user = AUTH.users.find(u =>
    u.username.toLowerCase() === username.toLowerCase() && u._h === inputHash
  );

  if (user) {
    _loginGuard.recordSuccess();
    AUTH.currentUser = { username: user.username, role: user.role, fullName: user.fullName };
    AUTH.loginError = '';
    saveSession(AUTH.currentUser);
    // Registrar presencia en Firebase
    if (typeof registerPresence === 'function') registerPresence();
    addLog('login', 'Sesión iniciada');
    saveState();
    return true;
  }

  _loginGuard.recordFail();
  if (_loginGuard.isLocked()) {
    AUTH.loginError = 'Cuenta bloqueada temporalmente (60s)';
  } else {
    AUTH.loginError = 'Usuario o contraseña incorrectos (' + (5 - _loginGuard.attempts) + ' intentos restantes)';
  }
  return false;
}

function logout() {
  addLog('logout', 'Sesión cerrada');
  saveState();
  // Eliminar presencia de Firebase
  if (typeof unregisterPresence === 'function') unregisterPresence();
  AUTH.currentUser = null;
  clearSession();
  render();
}

function isAdmin() {
  return AUTH.currentUser && AUTH.currentUser.role === 'admin';
}

// ── CAPA 8: Validación de inputs ──
function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'})[c] || c);
}

function validateUsername(u) {
  if (!u || typeof u !== 'string') return false;
  return /^[a-zA-Z0-9._-]{2,30}$/.test(u.trim());
}

function validatePassword(p) {
  if (!p || typeof p !== 'string') return false;
  return p.length >= 6 && p.length <= 128;
}

