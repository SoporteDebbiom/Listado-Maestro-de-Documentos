// ========================================
// APP - Lógica principal de la aplicación
// ========================================

// ========================================
// STATE MANAGEMENT
// ========================================

let STATE = {
  records: [],
  obsoletos: [],
  papelera: [],
  salidas: [],
  logs: [],
  elaboros: [],
  currentArea: 'Dir. Gral.',
  currentSection: 'areas', // areas, obsoletos, salidas, papelera, logs
  searchQuery: '',
  filterEstado: '',
  filterElaboro: '',
  page: 1,
  perPage: 25,
  modal: null,
  selectedRecord: null,
  editForm: {},
  salidaForm: {},
  obsoletoMotivo: '',
  toasts: [],
  nextId: 1000,
  sortCol: null,
  sortDir: 'asc'
};

// ========================================
// STATE PERSISTENCE (localStorage)
// ========================================

function saveState() {
  // Usar Firebase si está disponible, sino localStorage
  if (typeof syncSaveState === 'function') {
    syncSaveState();
  } else {
    try {
      const toSave = {
        records: STATE.records,
        obsoletos: STATE.obsoletos,
        papelera: STATE.papelera,
        salidas: STATE.salidas,
        logs: STATE.logs,
        elaboros: STATE.elaboros,
        nextId: STATE.nextId
      };
      localStorage.setItem('debbiom_state', JSON.stringify(toSave));
    } catch(e) { console.warn('No se pudo guardar estado:', e); }
  }
}

function loadSavedState() {
  // Intenta cargar desde localStorage como fallback rápido
  try {
    const saved = localStorage.getItem('debbiom_state');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.records && data.records.length > 0) {
        STATE.records = data.records;
        STATE.obsoletos = data.obsoletos || [];
        STATE.papelera = data.papelera || [];
        STATE.salidas = data.salidas || [];
        STATE.logs = data.logs || [];
        STATE.elaboros = data.elaboros || [];
        STATE.nextId = data.nextId || 1000;
        return true;
      }
    }
  } catch(e) { console.warn('No se pudo cargar estado:', e); }
  return false;
}

function getNextId() {
  return ++STATE.nextId;
}

function showToast(msg, type='success') {
  const id = Date.now();
  STATE.toasts.push({id, msg, type});
  renderToasts();
  setTimeout(() => {
    STATE.toasts = STATE.toasts.filter(t => t.id !== id);
    renderToasts();
  }, 3000);
}

// ========================================
// AUDIT LOG
// ========================================

const LOG_TYPES = {
  login:    { icon: 'fa-right-to-bracket', color: '#26c6da', label: 'Inicio de sesión' },
  logout:   { icon: 'fa-right-from-bracket', color: '#5a8999', label: 'Cierre de sesión' },
  create:   { icon: 'fa-circle-plus', color: '#8cc63f', label: 'Registro creado' },
  edit:     { icon: 'fa-pen-to-square', color: '#fbbf24', label: 'Registro editado' },
  delete:   { icon: 'fa-trash-can', color: '#f87171', label: 'Enviado a papelera' },
  restore:  { icon: 'fa-rotate-left', color: '#34d399', label: 'Restaurado' },
  permDelete:{ icon: 'fa-xmark', color: '#ef4444', label: 'Eliminado permanente' },
  obsolete: { icon: 'fa-box-archive', color: '#fb923c', label: 'Enviado a obsoletos' },
  version:  { icon: 'fa-code-branch', color: '#fb923c', label: 'Cambio de versión' },
  salida:   { icon: 'fa-right-from-bracket', color: '#a78bfa', label: 'Registro de salida' },
  export:   { icon: 'fa-file-excel', color: '#10b981', label: 'Exportación' },
  userAdd:  { icon: 'fa-user-plus', color: '#8cc63f', label: 'Usuario creado' },
  userDel:  { icon: 'fa-user-minus', color: '#f87171', label: 'Usuario eliminado' },
  userPw:   { icon: 'fa-key', color: '#fbbf24', label: 'Contraseña cambiada' },
};

function addLog(type, details, docName) {
  STATE.logs.unshift({
    id: Date.now() + Math.random(),
    timestamp: new Date().toISOString(),
    user: AUTH.currentUser ? AUTH.currentUser.username : 'Sistema',
    type: type,
    details: details || '',
    docName: docName || ''
  });
  if (STATE.logs.length > 5000) STATE.logs.length = 5000;
}

function formatLogDate(iso) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2,'0');
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const yy = String(d.getFullYear());
    const hh = String(d.getHours()).padStart(2,'0');
    const mi = String(d.getMinutes()).padStart(2,'0');
    const ss = String(d.getSeconds()).padStart(2,'0');
    return dd+'/'+mm+'/'+yy+' '+hh+':'+mi+':'+ss;
  } catch(e) { return iso; }
}

// ========================================
// CAPA 1: FUNCIÓN CENTRALIZADA OBSOLETOS
// Copia TODOS los campos del registro original
// sin omisiones. Solo agrega motivo y fechaObsoleto.
// ========================================

function createObsoletoEntry(rec, motivo) {
  // Deep copy completa de todo el registro
  const entry = JSON.parse(JSON.stringify(rec));

  // Asignar nuevo ID
  entry.id = getNextId();

  // Calcular vigencia a partir de fecha de emisión
  const vig = calcVigencia(rec.fechaEmision);
  entry.vigencia = vig ? formatDateFull(vig) : '';

  // Campos específicos de obsoletos
  entry.motivo = (motivo || '').trim();
  entry.fechaObsoleto = new Date().toISOString();

  return entry;
}

// ========================================
// INITIALIZE DATA FROM EXCEL
// ========================================

function loadExcelData() {
  // This will be populated from the embedded data
  if (typeof RAW_DATA === 'undefined') {
    STATE.records = [];
    STATE.obsoletos = [];
    STATE.elaboros = ['Hramírez','AMartinez','HRamirez'];
    return;
  }
  
  const data = RAW_DATA;
  STATE.records = data.r.map((r, i) => ({
    id: i + 1,
    area: r[1]||'',
    no: r[2]||'',
    codManual: r[3]||'',
    codInstructivo: r[4]||'',
    codListado: r[5]||'',
    codFormato: r[6]||'',
    nombreDoc: r[7]||'',
    version: r[8]||'',
    fechaEmision: r[9]||'',
    elaboro: r[10]||'',
    tipoResguardo: r[11]||'',
    ubicacion: r[12]||'',
    copias: r[13]||'',
    tipoResguardoCopia: r[14]||'',
    usuarios: r[15]||'',
    observaciones: r[16]||'',
    archivos: [],
    archivoURLs: []
  }));
  
  STATE.obsoletos = data.o.map((o, i) => ({
    id: i + 1,
    area: '',
    no: o[1]||'',
    codManual: o[2]||'',
    codInstructivo: o[3]||'',
    codListado: o[4]||'',
    codFormato: o[5]||'',
    nombreDoc: o[6]||'',
    version: o[7]||'',
    fechaEmision: o[8]||'',
    elaboro: o[9]||'',
    vigencia: o[10]||'',
    destino: o[11]||'',
    ubicacion: o[12]||'',
    copias: o[13]||'',
    destinoCopia: o[14]||'',
    observaciones: o[15]||'',
    motivo: 'Importado del listado original',
    archivos: [],
    archivoURLs: []
  }));
  
  STATE.elaboros = data.e || [];
  STATE.nextId = Math.max(...STATE.records.map(r=>r.id), ...STATE.obsoletos.map(o=>o.id), 999) + 1;
}

// ========================================
// RENDERING ENGINE
// ========================================

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  let deferValue = undefined;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'innerHTML') el.innerHTML = v;
      else if (k === 'value') {
        if (tag === 'select') deferValue = v;
        else el.value = v;
      }
      else if (k === 'checked') el.checked = v;
      else if (k === 'selected') el.selected = v;
      else if (k === 'disabled') { if(v) el.disabled = true; }
      else if (k === 'htmlFor') el.htmlFor = v;
      else if (k === 'dataset') { for(const [dk,dv] of Object.entries(v)) el.dataset[dk]=dv; }
      else el.setAttribute(k, v);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(child));
    } else if (child instanceof HTMLElement) {
      el.appendChild(child);
    }
  }
  if (deferValue !== undefined) el.value = deferValue;
  return el;
}

function getFilteredRecords() {
  let recs = STATE.records;
  
  if (STATE.currentSection === 'areas') {
    recs = recs.filter(r => r.area === STATE.currentArea);
  }
  
  if (STATE.searchQuery) {
    const q = STATE.searchQuery.toLowerCase();
    recs = recs.filter(r => 
      (r.nombreDoc||'').toLowerCase().includes(q) ||
      (r.codManual||'').toLowerCase().includes(q) ||
      (r.codInstructivo||'').toLowerCase().includes(q) ||
      (r.codListado||'').toLowerCase().includes(q) ||
      (r.codFormato||'').toLowerCase().includes(q) ||
      (r.no||'').toLowerCase().includes(q)
    );
  }
  
  if (STATE.filterEstado) {
    recs = recs.filter(r => calcEstado(r.fechaEmision) === STATE.filterEstado);
  }
  
  if (STATE.filterElaboro) {
    recs = recs.filter(r => r.elaboro === STATE.filterElaboro);
  }
  
  // Sort
  if (STATE.sortCol) {
    recs = [...recs].sort((a, b) => {
      let va = a[STATE.sortCol] || '';
      let vb = b[STATE.sortCol] || '';
      if (STATE.sortCol === 'dias') {
        va = calcDiasVigencia(a.fechaEmision) || -9999;
        vb = calcDiasVigencia(b.fechaEmision) || -9999;
        return STATE.sortDir === 'asc' ? va - vb : vb - va;
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return STATE.sortDir === 'asc' ? -1 : 1;
      if (va > vb) return STATE.sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }
  
  return recs;
}

function renderSidebar() {
  const areaItems = AREAS.map(area => {
    const count = STATE.records.filter(r => r.area === area).length;
    const isActive = STATE.currentSection === 'areas' && STATE.currentArea === area;
    return h('div', {
      className: 'nav-item' + (isActive ? ' active' : ''),
      onClick: () => { STATE.currentSection='areas'; STATE.currentArea=area; STATE.page=1; STATE.searchQuery=''; STATE.filterEstado=''; STATE.filterElaboro=''; render(); }
    },
      h('i', {className: 'fas fa-folder'}),
      h('span', null, area),
      h('span', {className: 'nav-badge'}, String(count))
    );
  });

  const obsCount = STATE.obsoletos.length;
  const salCount = STATE.salidas.length;
  const papCount = STATE.papelera.length;

  return h('div', {className: 'sidebar'},
    h('div', {className: 'sidebar-header'},
      h('img', {className:'sidebar-logo', src:'data:image/jpeg;base64,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', alt:'DEBBIOM'}),
      h('div', {className:'sidebar-header-text'},
        h('h1', null, 'Listado Maestro de Documentos'),
        h('p', null, 'DEBBIOM — Sistema de Gestión')
      )
    ),
    h('div', {className: 'sidebar-nav'},
      h('div', {className: 'nav-section'},
        h('div', {className: 'nav-section-title'}, 'Áreas'),
        ...areaItems
      ),
      h('div', {className: 'nav-section'},
        h('div', {className: 'nav-section-title'}, 'Gestión'),
        h('div', {
          className: 'nav-item' + (STATE.currentSection==='obsoletos'?' active':''),
          onClick: () => { STATE.currentSection='obsoletos'; STATE.page=1; render(); }
        },
          h('i', {className: 'fas fa-archive'}),
          h('span', null, 'Obsoletos'),
          h('span', {className: 'nav-badge'}, String(obsCount))
        ),
        h('div', {
          className: 'nav-item' + (STATE.currentSection==='salidas'?' active':''),
          onClick: () => { STATE.currentSection='salidas'; STATE.page=1; render(); }
        },
          h('i', {className: 'fas fa-sign-out-alt'}),
          h('span', null, 'Reg. de Salidas'),
          h('span', {className: 'nav-badge'}, String(salCount))
        ),
        h('div', {
          className: 'nav-item' + (STATE.currentSection==='papelera'?' active':''),
          onClick: () => { STATE.currentSection='papelera'; STATE.page=1; render(); }
        },
          h('i', {className: 'fas fa-trash-alt'}),
          h('span', null, 'Papelera'),
          h('span', {className: 'nav-badge'}, String(papCount))
        ),
        // Admin: user management
        isAdmin() ? h('div', {
          className: 'nav-item',
          onClick: () => { STATE.modal='users'; render(); }
        },
          h('i', {className: 'fas fa-users-gear'}),
          h('span', null, 'Gestión de Usuarios')
        ) : null
      ),
      // Logs section
      h('div', {className: 'nav-section'},
        h('div', {className: 'nav-section-title'}, 'Auditoría'),
        h('div', {
          className: 'nav-item' + (STATE.currentSection==='logs'?' active':''),
          onClick: () => { STATE.currentSection='logs'; STATE.page=1; render(); }
        },
          h('i', {className: 'fas fa-clock-rotate-left'}),
          h('span', null, 'Registro de Actividad'),
          h('span', {className: 'nav-badge'}, String(STATE.logs.length))
        )
      )
    ),
    // User bar at bottom
    AUTH.currentUser ? h('div', {className: 'sidebar-user'},
      h('div', {className: 'user-avatar'}, AUTH.currentUser.fullName ? AUTH.currentUser.fullName.charAt(0).toUpperCase() : '?'),
      h('div', {className: 'user-info'},
        h('div', {className: 'user-name'}, AUTH.currentUser.username),
        h('div', {className: 'user-role'}, isAdmin() ? 'Administrador' : 'Usuario')
      ),
      h('button', {className: 'logout-btn', 'data-info':'Cerrar sesión', onClick: logout},
        h('i', {className: 'fas fa-right-from-bracket'})
      )
    ) : null,
    // Sync indicator + online users
    AUTH.currentUser ? h('div', {className: 'sidebar-sync'},
      h('div', {id: 'sync-indicator', className: 'sync-indicator ' + (typeof SYNC !== 'undefined' && SYNC.connected ? 'sync-online' : (typeof SYNC !== 'undefined' && SYNC.initialized ? 'sync-reconnecting' : 'sync-offline'))},
        h('i', {className: typeof SYNC !== 'undefined' && SYNC.connected ? 'fas fa-cloud' : 'fas fa-database'}),
        typeof SYNC !== 'undefined' && SYNC.connected ? ' En línea' : ' Local'
      ),
      h('div', {className: 'sidebar-online-info'},
        h('i', {className: 'fas fa-users', style:{fontSize:'11px',marginRight:'6px',color:'var(--accent)'}}),
        h('span', {id:'sidebar-online-count'}, String(typeof SYNC !== 'undefined' ? SYNC.onlineCount : 0)),
        ' en línea'
      )
    ) : null
  );
}

function renderStatsBar() {
  let recs;
  if (STATE.currentSection === 'areas') {
    recs = STATE.records.filter(r => r.area === STATE.currentArea);
  } else {
    return h('div');
  }
  const total = recs.length;
  const vigentes = recs.filter(r => calcEstado(r.fechaEmision) === 'Vigente').length;
  const porVencer = recs.filter(r => calcEstado(r.fechaEmision) === 'Por vencer').length;
  const vencidos = recs.filter(r => calcEstado(r.fechaEmision) === 'Vencido').length;

  return h('div', {className: 'stats-bar'},
    h('div', {className: 'stat-card'},
      h('div', {className: 'stat-label'}, 'Total Documentos'),
      h('div', {className: 'stat-value'}, String(total))
    ),
    h('div', {className: 'stat-card'},
      h('div', {className: 'stat-label'}, 'Vigentes'),
      h('div', {className: 'stat-value green'}, String(vigentes))
    ),
    h('div', {className: 'stat-card'},
      h('div', {className: 'stat-label'}, 'Por Vencer'),
      h('div', {className: 'stat-value yellow'}, String(porVencer))
    ),
    h('div', {className: 'stat-card'},
      h('div', {className: 'stat-label'}, 'Vencidos'),
      h('div', {className: 'stat-value red'}, String(vencidos))
    )
  );
}

function renderFilterBar() {
  if (STATE.currentSection !== 'areas') return h('div');
  
  const uniqueElaboros = [...new Set(STATE.records.filter(r=>r.area===STATE.currentArea).map(r=>r.elaboro).filter(Boolean))].sort();
  
  return h('div', {className: 'filter-bar'},
    h('div', {className: 'search-box'},
      h('i', {className: 'fas fa-search'}),
      h('input', {
        type: 'text',
        placeholder: 'Buscar por nombre, código...',
        value: STATE.searchQuery,
        onInput: (e) => { STATE.searchQuery = e.target.value; STATE.page=1; render(); }
      })
    ),
    h('select', {
      className: 'filter-select',
      value: STATE.filterEstado,
      onChange: (e) => { STATE.filterEstado = e.target.value; STATE.page=1; render(); }
    },
      h('option', {value: ''}, 'Todos los estados'),
      h('option', {value: 'Vigente'}, 'Vigente'),
      h('option', {value: 'Por vencer'}, 'Por vencer'),
      h('option', {value: 'Vencido'}, 'Vencido')
    ),
    h('select', {
      className: 'filter-select',
      value: STATE.filterElaboro,
      onChange: (e) => { STATE.filterElaboro = e.target.value; STATE.page=1; render(); }
    },
      h('option', {value: ''}, 'Todos - Elaboró'),
      ...uniqueElaboros.map(e => h('option', {value: e}, e))
    )
  );
}

function renderStatusBadge(fechaEmision) {
  const estado = calcEstado(fechaEmision);
  const cls = estado === 'Vigente' ? 'badge-green' : estado === 'Por vencer' ? 'badge-yellow' : estado === 'Vencido' ? 'badge-red' : '';
  if (!estado) return h('span', {className: 'badge badge-blue'}, '—');
  return h('span', {className: 'badge ' + cls},
    h('span', {className: 'badge-dot'}),
    estado
  );
}

function renderDiasVigencia(fechaEmision) {
  const dias = calcDiasVigencia(fechaEmision);
  if (dias === null) return h('span', {style:{color:'var(--text-muted)'}}, '—');
  if (dias >= 60) return h('span', {style:{color:'var(--green)', fontFamily:'JetBrains Mono, monospace', fontSize:'12px'}}, String(dias) + ' días');
  if (dias >= 1) return h('span', {style:{color:'var(--yellow)', fontFamily:'JetBrains Mono, monospace', fontSize:'12px'}}, String(dias) + ' días');
  return h('span', {style:{color:'var(--red)', fontFamily:'JetBrains Mono, monospace', fontSize:'12px'}}, String(Math.abs(dias)) + ' días vencido');
}

function renderVigenciaDate(fechaEmision) {
  const vig = calcVigencia(fechaEmision);
  if (!vig) return '—';
  return formatDateFull(vig);
}

function renderAreasTable() {
  const allFiltered = getFilteredRecords();
  const totalPages = Math.ceil(allFiltered.length / STATE.perPage);
  const start = (STATE.page - 1) * STATE.perPage;
  const pageRecords = allFiltered.slice(start, start + STATE.perPage);
  
  const sortIcon = (col) => {
    if (STATE.sortCol !== col) return h('i', {className: 'fas fa-sort', style:{opacity:'.3'}});
    return h('i', {className: STATE.sortDir === 'asc' ? 'fas fa-sort-up' : 'fas fa-sort-down'});
  };
  
  const thClick = (col) => () => {
    if (STATE.sortCol === col) {
      STATE.sortDir = STATE.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      STATE.sortCol = col;
      STATE.sortDir = 'asc';
    }
    render();
  };

  const table = h('table', null,
    h('thead', null,
      h('tr', null,
        h('th', {onClick: thClick('no')}, 'No. ', sortIcon('no')),
        h('th', {onClick: thClick('codManual')}, 'Cód. Manual/Proc. ', sortIcon('codManual')),
        h('th', {onClick: thClick('codInstructivo')}, 'Cód. Instructivo ', sortIcon('codInstructivo')),
        h('th', {onClick: thClick('codListado')}, 'Cód. Listado ', sortIcon('codListado')),
        h('th', {onClick: thClick('codFormato')}, 'Cód. Formato ', sortIcon('codFormato')),
        h('th', {onClick: thClick('nombreDoc'), style:{minWidth:'200px'}}, 'Nombre Documento ', sortIcon('nombreDoc')),
        h('th', {onClick: thClick('version')}, 'Versión ', sortIcon('version')),
        h('th', {onClick: thClick('fechaEmision')}, 'Emisión ', sortIcon('fechaEmision')),
        h('th', null, 'Elaboró'),
        h('th', null, 'Vigencia'),
        h('th', null, 'Estado'),
        h('th', {onClick: thClick('dias')}, 'Días Vig. ', sortIcon('dias')),
        h('th', null, 'Resguardo'),
        h('th', null, 'Archivos'),
        h('th', null, 'Copias'),
        h('th', {style:{minWidth:'340px'}}, 'Acciones')
      )
    ),
    h('tbody', null,
      ...pageRecords.map(rec => {
        const estado = calcEstado(rec.fechaEmision);
        const fechaE = parseDate(rec.fechaEmision);
        
        return h('tr', null,
          h('td', null, rec.no || ''),
          h('td', null, rec.codManual || ''),
          h('td', null, rec.codInstructivo || ''),
          h('td', null, rec.codListado || ''),
          h('td', null, rec.codFormato || ''),
          h('td', {className: 'wrap', title: rec.nombreDoc}, rec.nombreDoc || ''),
          h('td', null, h('span', {className: 'badge badge-blue'}, rec.version || '—')),
          h('td', null, fechaE ? formatDateShort(fechaE) : (rec.fechaEmision || '—')),
          h('td', null, rec.elaboro || ''),
          h('td', null, renderVigenciaDate(rec.fechaEmision)),
          h('td', null, renderStatusBadge(rec.fechaEmision)),
          h('td', null, renderDiasVigencia(rec.fechaEmision)),
          h('td', null, rec.tipoResguardo ? h('span', {className:'badge badge-purple'}, rec.tipoResguardo) : '—'),
          h('td', null, renderFilePreview(rec)),
          h('td', null, rec.copias || '—'),
          h('td', null,
            h('div', {className: 'actions-cell'},
              h('button', {className:'action-btn view', 'data-info':'Ver detalle completo del registro', onClick:()=>openView(rec)}, h('i',{className:'fas fa-eye'}), h('span',{className:'btn-label'},'Ver')),
              h('button', {className:'action-btn edit', 'data-info':'Editar los datos de este registro', onClick:()=>openEdit(rec)}, h('i',{className:'fas fa-pen-to-square'}), h('span',{className:'btn-label'},'Editar')),
              h('button', {className:'action-btn delete', 'data-info':'Enviar este registro a la papelera', onClick:()=>deleteRecord(rec)}, h('i',{className:'fas fa-trash-can'}), h('span',{className:'btn-label'},'Eliminar')),
              h('button', {className:'action-btn output', 'data-info':'Crear un registro de salida del documento', onClick:()=>openSalida(rec)}, h('i',{className:'fas fa-right-from-bracket'}), h('span',{className:'btn-label'},'Salida'))
            )
          )
        );
      }),
      pageRecords.length === 0 ? h('tr', null,
        h('td', {colspan: '16', style: {textAlign:'center',padding:'40px',color:'var(--text-muted)'}},
          h('i', {className:'fas fa-folder-open', style:{fontSize:'24px',display:'block',marginBottom:'8px',opacity:'.4'}}),
          'No se encontraron registros'
        )
      ) : null
    )
  );

  // Pagination
  const pag = h('div', {className: 'pagination'},
    h('div', {className: 'pagination-info'},
      `Mostrando ${allFiltered.length > 0 ? start+1 : 0}-${Math.min(start+STATE.perPage, allFiltered.length)} de ${allFiltered.length} registros`
    ),
    h('div', {className: 'pagination-controls'},
      h('button', {className: 'page-btn', disabled: STATE.page <= 1, onClick: () => { STATE.page--; render(); }}, h('i',{className:'fas fa-chevron-left'})),
      ...Array.from({length: Math.min(totalPages, 7)}, (_, i) => {
        let p;
        if (totalPages <= 7) p = i + 1;
        else if (STATE.page <= 4) p = i + 1;
        else if (STATE.page >= totalPages - 3) p = totalPages - 6 + i;
        else p = STATE.page - 3 + i;
        return h('button', {className: 'page-btn' + (p===STATE.page?' active':''), onClick: () => { STATE.page=p; render(); }}, String(p));
      }),
      h('button', {className: 'page-btn', disabled: STATE.page >= totalPages, onClick: () => { STATE.page++; render(); }}, h('i',{className:'fas fa-chevron-right'}))
    )
  );

  return h('div', {className: 'content-area'},
    renderStatsBar(),
    renderFilterBar(),
    h('div', {className: 'table-container'}, table),
    pag
  );
}

function renderFilePreview(rec) {
  const items = [];
  if (rec.archivoURLs && rec.archivoURLs.length > 0) {
    rec.archivoURLs.forEach(url => {
      items.push(h('a', {className:'file-chip', href:url, target:'_blank', rel:'noopener'}, h('i',{className:'fas fa-link'}), 'URL'));
    });
  }
  if (rec.archivos && rec.archivos.length > 0) {
    rec.archivos.forEach(f => {
      items.push(h('span', {className:'file-chip', onClick:()=>downloadFile(f)}, h('i',{className:'fas fa-file'}), f.name.length > 12 ? f.name.substring(0,12)+'…' : f.name));
    });
  }
  if (rec.ubicacion && (rec.ubicacion.startsWith('http') || rec.ubicacion.startsWith('www'))) {
    const url = rec.ubicacion.startsWith('http') ? rec.ubicacion : 'https://' + rec.ubicacion;
    items.push(h('a', {className:'file-chip', href:url, target:'_blank', rel:'noopener'}, h('i',{className:'fas fa-external-link-alt'}), 'Link'));
  }
  if (items.length === 0) return h('span', {style:{color:'var(--text-muted)',fontSize:'12px'}}, '—');
  return h('div', {className:'file-preview'}, ...items);
}

function downloadFile(f) {
  if (f.dataUrl) {
    const a = document.createElement('a');
    a.href = f.dataUrl;
    a.download = f.name;
    a.click();
  }
}

// ========================================
// OBSOLETOS TABLE
// ========================================

function renderObsoletosTable() {
  // CAPA 4: Ordenar del más reciente al más antiguo por fechaObsoleto
  const sorted = [...STATE.obsoletos].sort((a, b) => {
    const da = a.fechaObsoleto ? new Date(a.fechaObsoleto).getTime() : 0;
    const db = b.fechaObsoleto ? new Date(b.fechaObsoleto).getTime() : 0;
    return db - da; // newest first
  });

  const start = (STATE.page - 1) * STATE.perPage;
  const pageRecs = sorted.slice(start, start + STATE.perPage);
  const totalPages = Math.max(1, Math.ceil(sorted.length / STATE.perPage));

  return h('div', {className: 'content-area'},
    h('div', {className: 'stats-bar'},
      h('div', {className: 'stat-card'},
        h('div', {className: 'stat-label'}, 'Total Obsoletos'),
        h('div', {className: 'stat-value'}, String(sorted.length))
      )
    ),
    h('div', {className: 'table-container'},
      h('table', null,
        h('thead', null,
          h('tr', null,
            h('th', {style:{minWidth:'150px',background:'rgba(249,115,22,.1)',color:'#fb923c'}}, 'Fecha Obsoleto'),
            h('th', null, 'No.'),
            h('th', null, 'Área'),
            h('th', null, 'Cód. Manual'),
            h('th', null, 'Cód. Instructivo'),
            h('th', null, 'Cód. Listado'),
            h('th', null, 'Cód. Formato'),
            h('th', {style:{minWidth:'200px'}}, 'Nombre Documento'),
            h('th', null, 'Versión'),
            h('th', null, 'Fecha Emisión'),
            h('th', null, 'Elaboró'),
            h('th', null, 'Vigencia'),
            h('th', null, 'Tipo Resguardo'),
            h('th', null, 'Ubicación'),
            h('th', null, 'Copias Ctrl.'),
            h('th', null, 'Tipo Resg. Copia'),
            h('th', null, 'Usuarios'),
            h('th', {style:{minWidth:'180px'}}, 'Motivo'),
            h('th', null, 'Archivos'),
            h('th', null, 'Observaciones')
          )
        ),
        h('tbody', null,
          ...pageRecs.map(rec => h('tr', null,
            h('td', null,
              rec.fechaObsoleto
                ? h('span', {style:{fontFamily:'JetBrains Mono,monospace',fontSize:'11px',color:'#fb923c',fontWeight:'600',background:'rgba(249,115,22,.08)',padding:'3px 8px',borderRadius:'5px',whiteSpace:'nowrap'}}, formatLogDate(rec.fechaObsoleto))
                : h('span', {style:{color:'var(--text-muted)'}}, '—')
            ),
            h('td', null, rec.no||''),
            h('td', null, rec.area||''),
            h('td', null, rec.codManual||''),
            h('td', null, rec.codInstructivo||''),
            h('td', null, rec.codListado||''),
            h('td', null, rec.codFormato||''),
            h('td', {className:'wrap'}, rec.nombreDoc||''),
            h('td', null, h('span',{className:'badge badge-blue'}, rec.version||'—')),
            h('td', null, rec.fechaEmision||''),
            h('td', null, rec.elaboro||''),
            h('td', null, rec.vigencia||''),
            h('td', null, rec.tipoResguardo||''),
            h('td', {className:'wrap'}, rec.ubicacion||''),
            h('td', null, rec.copias||''),
            h('td', null, rec.tipoResguardoCopia||''),
            h('td', {className:'wrap'}, rec.usuarios||''),
            h('td', {className:'wrap'}, rec.motivo||''),
            h('td', null, renderFilePreview(rec)),
            h('td', {className:'wrap'}, rec.observaciones||'')
          )),
          pageRecs.length === 0 ? h('tr', null,
            h('td', {colspan:'20', style:{textAlign:'center',padding:'40px',color:'var(--text-muted)'}},
              h('i', {className:'fas fa-archive', style:{fontSize:'24px',display:'block',marginBottom:'8px',opacity:'.4'}}),
              'No hay documentos obsoletos'
            )
          ) : null
        )
      )
    ),
    h('div', {className: 'pagination'},
      h('div', {className: 'pagination-info'}, `${sorted.length} registros`),
      h('div', {className: 'pagination-controls'},
        h('button', {className:'page-btn', disabled:STATE.page<=1, onClick:()=>{STATE.page--;render();}}, h('i',{className:'fas fa-chevron-left'})),
        h('button', {className:'page-btn', disabled:STATE.page>=totalPages, onClick:()=>{STATE.page++;render();}}, h('i',{className:'fas fa-chevron-right'}))
      )
    )
  );
}

// ========================================
// SALIDAS TABLE
// ========================================

function renderSalidasTable() {
  const recs = STATE.salidas;
  return h('div', {className:'content-area'},
    h('div', {className:'stats-bar'},
      h('div', {className:'stat-card'},
        h('div', {className:'stat-label'}, 'Total Salidas'),
        h('div', {className:'stat-value'}, String(recs.length))
      )
    ),
    h('div', {className:'table-container'},
      h('table', null,
        h('thead', null,
          h('tr', null,
            h('th', null, '#'),
            h('th', null, 'Nombre Documento'),
            h('th', null, 'Versión'),
            h('th', null, 'Fecha Emisión'),
            h('th', null, 'Área'),
            h('th', null, 'Motivo de Entrega'),
            h('th', null, 'Destinatario'),
            h('th', null, 'Correo'),
            h('th', null, 'Fecha Salida'),
            h('th', null, 'Archivos/URLs')
          )
        ),
        h('tbody', null,
          ...recs.map((s, i) => h('tr', null,
            h('td', null, String(i+1)),
            h('td', {className:'wrap'}, s.nombreDoc||''),
            h('td', null, h('span',{className:'badge badge-blue'}, s.version||'')),
            h('td', null, s.fechaEmision||''),
            h('td', null, s.area||''),
            h('td', {className:'wrap'}, s.motivo||''),
            h('td', null, s.destinatario||''),
            h('td', null, s.correo ? h('a',{href:'mailto:'+s.correo, className:'url-link'}, s.correo) : ''),
            h('td', null, s.fechaSalida||''),
            h('td', null, renderFilePreview(s))
          )),
          recs.length === 0 ? h('tr', null,
            h('td', {colspan:'10', style:{textAlign:'center',padding:'40px',color:'var(--text-muted)'}},
              h('i', {className:'fas fa-sign-out-alt', style:{fontSize:'24px',display:'block',marginBottom:'8px',opacity:'.4'}}),
              'No hay registros de salida'
            )
          ) : null
        )
      )
    )
  );
}

// ========================================
// PAPELERA TABLE
// ========================================

function renderPapeleraTable() {
  const recs = STATE.papelera;
  return h('div', {className:'content-area'},
    h('div', {className:'stats-bar'},
      h('div', {className:'stat-card'},
        h('div', {className:'stat-label'}, 'En Papelera'),
        h('div', {className:'stat-value'}, String(recs.length))
      )
    ),
    h('div', {className:'table-container'},
      h('table', null,
        h('thead', null,
          h('tr', null,
            h('th', null, 'No.'),
            h('th', null, 'Nombre Documento'),
            h('th', null, 'Versión'),
            h('th', null, 'Emisión'),
            h('th', null, 'Área'),
            h('th', null, 'Elaboró'),
            h('th', {style:{minWidth:'230px'}}, 'Acciones')
          )
        ),
        h('tbody', null,
          ...recs.map(rec => h('tr', null,
            h('td', null, rec.no||''),
            h('td', {className:'wrap'}, rec.nombreDoc||''),
            h('td', null, h('span',{className:'badge badge-blue'}, rec.version||'')),
            h('td', null, rec.fechaEmision||''),
            h('td', null, rec.area||''),
            h('td', null, rec.elaboro||''),
            h('td', null,
              h('div', {className:'actions-cell'},
                h('button', {className:'action-btn restore', 'data-info':'Devolver este registro al listado activo', onClick:()=>restoreRecord(rec)}, h('i',{className:'fas fa-rotate-left'}), h('span',{className:'btn-label'},'Restaurar')),
                h('button', {className:'action-btn delete', 'data-info':'Eliminar permanentemente (no se puede deshacer)', onClick:()=>permanentDelete(rec)}, h('i',{className:'fas fa-xmark'}), h('span',{className:'btn-label'},'Eliminar'))
              )
            )
          )),
          recs.length === 0 ? h('tr', null,
            h('td', {colspan:'7', style:{textAlign:'center',padding:'40px',color:'var(--text-muted)'}},
              h('i', {className:'fas fa-trash-alt', style:{fontSize:'24px',display:'block',marginBottom:'8px',opacity:'.4'}}),
              'La papelera está vacía'
            )
          ) : null
        )
      )
    )
  );
}

// ========================================
// ACTIONS
// ========================================

function openView(rec) {
  STATE.modal = 'view';
  STATE.selectedRecord = rec;
  render();
}

function openEdit(rec) {
  STATE.modal = 'edit';
  // Deep copy the original record so files are preserved independently
  STATE.selectedRecord = JSON.parse(JSON.stringify(rec));
  STATE.editForm = JSON.parse(JSON.stringify(rec));
  STATE.originalVersion = String(rec.version || '').trim();
  STATE.obsoletoMotivo = '';
  render();
}

function openAdd() {
  STATE.modal = 'add';
  STATE.editForm = {
    id: getNextId(),
    area: STATE.currentArea,
    no: '', codManual: '', codInstructivo: '', codListado: '', codFormato: '',
    nombreDoc: '', version: '', fechaEmision: '', elaboro: '',
    tipoResguardo: '', ubicacion: '', copias: '',
    tipoResguardoCopia: '', usuarios: '', observaciones: '',
    archivos: [], archivoURLs: [],
    archivosCopia: [], archivoURLsCopia: []
  };
  render();
}

function openSalida(rec) {
  STATE.modal = 'salida';
  STATE.selectedRecord = rec;
  STATE.salidaForm = {
    area: rec.area || STATE.currentArea,
    motivo: '',
    destinatario: '',
    correo: ''
  };
  render();
}

function openObsoleto(rec) {
  STATE.modal = 'obsoleto';
  STATE.selectedRecord = rec;
  STATE.obsoletoMotivo = '';
  render();
}

function closeModal() {
  STATE.modal = null;
  STATE.selectedRecord = null;
  STATE.editForm = {};
  render();
}

function saveRecord() {
  const form = STATE.editForm;
  if (!form.nombreDoc && !form.codManual && !form.codInstructivo && !form.codFormato) {
    showToast('Ingresa al menos el nombre del documento o un código', 'error');
    return;
  }
  
  if (STATE.modal === 'add') {
    form.area = STATE.currentArea;
    STATE.records.push({...form});
    addLog('create', 'Área: ' + form.area, form.nombreDoc || form.codManual || 'Sin nombre');
    showToast('Registro agregado exitosamente');
  } else if (STATE.modal === 'edit') {
    const idx = STATE.records.findIndex(r => r.id === form.id);
    if (idx >= 0) {
      const original = STATE.selectedRecord;
      const newVer = String(form.version || '').trim();
      const oldVer = STATE.originalVersion || '';
      const versionChanged = oldVer !== '' && newVer !== '' && newVer !== oldVer;

      if (versionChanged) {
        // Motivo is required
        if (!STATE.obsoletoMotivo || !STATE.obsoletoMotivo.trim()) {
          showToast('Debes escribir el motivo del cambio de versión para continuar', 'error');
          return;
        }

        // CAPA 2: Usar función centralizada — copia TODO sin omisiones
        const obsEntry = createObsoletoEntry(original, STATE.obsoletoMotivo);
        STATE.obsoletos.unshift(obsEntry); // newest first

        // Clear files on new version record
        form.archivos = [];
        form.archivoURLs = [];
        form.archivosCopia = [];
        form.archivoURLsCopia = [];

        addLog('version', 'V' + oldVer + ' → V' + newVer + ' | Motivo: ' + STATE.obsoletoMotivo.trim(), original.nombreDoc || original.codManual || '');
        showToast('Versión anterior (V' + oldVer + ') enviada a obsoletos con todos sus datos y archivos.');
      }

      STATE.records[idx] = {...form};
      addLog('edit', 'Área: ' + (form.area||''), form.nombreDoc || form.codManual || '');
      showToast('Registro actualizado exitosamente');
    }
  }
  STATE.obsoletoMotivo = '';
  saveState();
  closeModal();
}

function deleteRecord(rec) {
  if (!confirm('¿Enviar este registro a la papelera de reciclaje?')) return;
  STATE.records = STATE.records.filter(r => r.id !== rec.id);
  STATE.papelera.push({...rec, deletedAt: new Date().toISOString()});
  addLog('delete', 'Área: ' + (rec.area||''), rec.nombreDoc || rec.codManual || '');
  showToast('Registro enviado a papelera');
  saveState();
  render();
}

function restoreRecord(rec) {
  STATE.papelera = STATE.papelera.filter(r => r.id !== rec.id);
  delete rec.deletedAt;
  STATE.records.push(rec);
  addLog('restore', 'Área: ' + (rec.area||''), rec.nombreDoc || rec.codManual || '');
  showToast('Registro restaurado');
  saveState();
  render();
}

function permanentDelete(rec) {
  if (!confirm('¿Eliminar permanentemente? Esta acción no se puede deshacer.')) return;
  STATE.papelera = STATE.papelera.filter(r => r.id !== rec.id);
  addLog('permDelete', 'Eliminado de papelera', rec.nombreDoc || rec.codManual || '');
  showToast('Registro eliminado permanentemente');
  saveState();
  render();
}

function confirmSalida() {
  const form = STATE.salidaForm;
  const rec = STATE.selectedRecord;
  if (!form.motivo || !form.destinatario || !form.correo) {
    showToast('Completa todos los campos obligatorios', 'error');
    return;
  }
  
  STATE.salidas.push({
    id: getNextId(),
    nombreDoc: rec.nombreDoc,
    version: rec.version,
    fechaEmision: rec.fechaEmision,
    area: form.area,
    motivo: form.motivo,
    destinatario: form.destinatario,
    correo: form.correo,
    fechaSalida: formatDateFull(new Date()),
    archivos: rec.archivos ? [...rec.archivos] : [],
    archivoURLs: rec.archivoURLs ? [...rec.archivoURLs] : [],
    ubicacion: rec.ubicacion
  });
  
  addLog('salida', 'Destino: ' + form.destinatario + ' | Motivo: ' + form.motivo, rec.nombreDoc || '');
  showToast('Registro de salida creado exitosamente');
  saveState();
  closeModal();
}

function confirmObsoleto() {
  if (!STATE.obsoletoMotivo.trim()) {
    showToast('Debes ingresar el motivo del cambio', 'error');
    return;
  }
  
  const rec = STATE.selectedRecord;

  // CAPA 3: Usar función centralizada — copia TODO sin omisiones
  const obsEntry = createObsoletoEntry(rec, STATE.obsoletoMotivo);
  STATE.obsoletos.unshift(obsEntry); // newest first
  
  STATE.records = STATE.records.filter(r => r.id !== rec.id);
  
  addLog('obsolete', 'Motivo: ' + STATE.obsoletoMotivo, rec.nombreDoc || rec.codManual || '');
  showToast('Documento enviado a obsoletos');
  saveState();
  closeModal();
}

function exportToExcel() {
  let data;
  let filename;
  
  if (STATE.currentSection === 'areas') {
    data = STATE.records.filter(r => r.area === STATE.currentArea);
    filename = `Listado_${STATE.currentArea.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`;
  } else if (STATE.currentSection === 'obsoletos') {
    data = STATE.obsoletos;
    filename = 'Obsoletos.xlsx';
  } else if (STATE.currentSection === 'salidas') {
    data = STATE.salidas;
    filename = 'Registro_Salidas.xlsx';
  } else {
    data = STATE.papelera;
    filename = 'Papelera.xlsx';
  }
  
  const headers = STATE.currentSection === 'salidas' 
    ? ['Nombre Documento','Versión','Fecha Emisión','Área','Motivo','Destinatario','Correo','Fecha Salida']
    : STATE.currentSection === 'obsoletos'
    ? ['Fecha Obsoleto','No.','Área','Cód. Manual','Cód. Instructivo','Cód. Listado','Cód. Formato','Nombre Documento','Versión','Fecha Emisión','Elaboró','Vigencia','Tipo Resguardo','Ubicación','Copias Controladas','Tipo Resguardo Copia','Usuarios','Motivo','Observaciones']
    : ['No.','Cód. Manual','Cód. Instructivo','Cód. Listado','Cód. Formato','Nombre Documento','Versión','Fecha Emisión','Elaboró','Vigencia','Estado','Días Vigencia','Tipo Resguardo','Ubicación','Copias Controladas','Tipo Resguardo Copia','Usuarios','Observaciones'];
  
  const rows = data.map(r => {
    if (STATE.currentSection === 'salidas') {
      return [r.nombreDoc, r.version, r.fechaEmision, r.area, r.motivo, r.destinatario, r.correo, r.fechaSalida];
    }
    if (STATE.currentSection === 'obsoletos') {
      return [r.fechaObsoleto ? formatLogDate(r.fechaObsoleto) : '', r.no, r.area, r.codManual, r.codInstructivo, r.codListado, r.codFormato, r.nombreDoc, r.version, r.fechaEmision, r.elaboro, r.vigencia, r.tipoResguardo, r.ubicacion, r.copias, r.tipoResguardoCopia, r.usuarios, r.motivo, r.observaciones];
    }
    return [r.no, r.codManual, r.codInstructivo, r.codListado, r.codFormato, r.nombreDoc, r.version, r.fechaEmision, r.elaboro, renderVigenciaDate(r.fechaEmision), calcEstado(r.fechaEmision), calcDiasVigencia(r.fechaEmision), r.tipoResguardo, r.ubicacion, r.copias, r.tipoResguardoCopia, r.usuarios, r.observaciones];
  });
  
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb2 = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb2, ws, 'Datos');
  XLSX.writeFile(wb2, filename);
  addLog('export', filename);
  showToast('Excel exportado: ' + filename);
}

// ========================================
// LOGS TABLE
// ========================================

function renderLogsTable() {
  const perPage = 50;
  let logs = STATE.logs;

  // Filter by search
  if (STATE.searchQuery) {
    const q = STATE.searchQuery.toLowerCase();
    logs = logs.filter(l => {
      const lt = LOG_TYPES[l.type] || {};
      return (l.user||'').toLowerCase().includes(q)
        || (l.details||'').toLowerCase().includes(q)
        || (l.docName||'').toLowerCase().includes(q)
        || (lt.label||'').toLowerCase().includes(q);
    });
  }

  const total = logs.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  if (STATE.page > totalPages) STATE.page = totalPages;
  const start = (STATE.page - 1) * perPage;
  const pageData = logs.slice(start, start + perPage);

  return h('div', {className: 'content-area'},
    // Stats bar
    h('div', {className: 'stats-bar'},
      h('div', {className: 'stat-card'},
        h('div', {className: 'stat-label'}, 'Total Registros'),
        h('div', {className: 'stat-value'}, String(total))
      )
    ),
    // Filter bar
    h('div', {className: 'filter-bar'},
      h('div', {className: 'search-box'},
        h('i', {className: 'fas fa-search'}),
        h('input', {
          type: 'text',
          placeholder: 'Buscar por usuario, acción, documento...',
          value: STATE.searchQuery,
          onInput: (e) => { STATE.searchQuery = e.target.value; STATE.page=1; render(); }
        })
      ),
      h('button', {className:'btn btn-sm btn-danger', onClick:()=>{
        if(confirm('¿Limpiar todo el registro de actividad?')) {
          STATE.logs = [];
          addLog('edit', 'Registro de actividad limpiado');
          saveState();
          render();
        }
      }}, h('i',{className:'fas fa-trash-can'}), ' Limpiar Logs')
    ),
    // Table
    h('div', {className: 'table-container'},
      h('table', {className: 'data-table'},
        h('thead', null,
          h('tr', null,
            h('th', {style:{width:'170px'}}, 'Fecha / Hora'),
            h('th', {style:{width:'120px'}}, 'Usuario'),
            h('th', {style:{width:'180px'}}, 'Acción'),
            h('th', null, 'Documento'),
            h('th', null, 'Detalles')
          )
        ),
        h('tbody', null,
          ...pageData.map(log => {
            const lt = LOG_TYPES[log.type] || { icon:'fa-circle', color:'#5a8999', label: log.type };
            return h('tr', null,
              h('td', null,
                h('span', {style:{fontFamily:'JetBrains Mono,monospace',fontSize:'12px',color:'var(--text-secondary)'}}, formatLogDate(log.timestamp))
              ),
              h('td', null,
                h('span', {style:{fontWeight:'600',color:'var(--text-primary)'}}, log.user)
              ),
              h('td', null,
                h('span', {style:{display:'inline-flex',alignItems:'center',gap:'7px',padding:'4px 10px',borderRadius:'6px',fontSize:'11px',fontWeight:'700',background:lt.color+'18',color:lt.color,letterSpacing:'.2px'}},
                  h('i', {className:'fas '+lt.icon, style:{fontSize:'11px'}}),
                  lt.label
                )
              ),
              h('td', null,
                log.docName ? h('span', {style:{fontWeight:'500',color:'var(--text-primary)'}}, log.docName) : h('span', {style:{color:'var(--text-muted)'}}, '—')
              ),
              h('td', null,
                h('span', {style:{fontSize:'12px',color:'var(--text-secondary)'}}, log.details || '—')
              )
            );
          }),
          pageData.length === 0 ? h('tr', null,
            h('td', {style:{textAlign:'center', padding:'40px', color:'var(--text-muted)'}, colSpan:'5'},
              h('i', {className:'fas fa-clock-rotate-left', style:{fontSize:'28px',opacity:'.3',display:'block',marginBottom:'10px'}}),
              'No hay registros de actividad'
            )
          ) : null
        )
      )
    ),
    // Pagination
    h('div', {className: 'pagination'},
      h('span', {className: 'pagination-info'}, `Mostrando ${total?start+1:0}-${Math.min(start+perPage,total)} de ${total}`),
      h('div', {className: 'pagination-btns'},
        h('button', {className:'page-btn', disabled:STATE.page<=1, onClick:()=>{STATE.page--;render();}}, h('i',{className:'fas fa-chevron-left'})),
        h('button', {className:'page-btn', disabled:STATE.page>=totalPages, onClick:()=>{STATE.page++;render();}}, h('i',{className:'fas fa-chevron-right'}))
      )
    )
  );
}

// ========================================
// MODALS
// ========================================

function renderViewModal() {
  const rec = STATE.selectedRecord;
  if (!rec) return null;
  
  const estado = calcEstado(rec.fechaEmision);
  const dias = calcDiasVigencia(rec.fechaEmision);
  const vig = calcVigencia(rec.fechaEmision);
  
  const dv = (label, value, isFull) => h('div', {className: 'detail-item' + (isFull?' full':'')},
    h('div', {className:'detail-label'}, label),
    h('div', {className:'detail-value'}, value || '—')
  );
  
  return h('div', {className:'modal-overlay', onClick:(e)=>{if(e.target.className==='modal-overlay')closeModal();}},
    h('div', {className:'modal modal-lg'},
      h('div', {className:'modal-header'},
        h('h2', null, h('i',{className:'fas fa-file-alt', style:{marginRight:'8px',color:'var(--accent)'}}), 'Detalle del Documento'),
        h('button', {className:'modal-close', onClick:closeModal}, h('i',{className:'fas fa-times'}))
      ),
      h('div', {className:'modal-body'},
        h('div', {className:'detail-grid'},
          dv('No.', rec.no),
          dv('Área', rec.area),
          dv('Código Manual / Procedimiento', rec.codManual),
          dv('Código Instructivo', rec.codInstructivo),
          dv('Código Listado', rec.codListado),
          dv('Código Formato', rec.codFormato),
          dv('Nombre del Documento', rec.nombreDoc, true),
          dv('Versión', rec.version),
          dv('Fecha Emisión', rec.fechaEmision),
          dv('Elaboró / Actualizó', rec.elaboro),
          dv('Vigencia', vig ? formatDateFull(vig) : '—'),
          h('div', {className:'detail-item'},
            h('div', {className:'detail-label'}, 'Estado'),
            h('div', {className:'detail-value'}, renderStatusBadge(rec.fechaEmision))
          ),
          h('div', {className:'detail-item'},
            h('div', {className:'detail-label'}, 'Días de Vigencia'),
            h('div', {className:'detail-value'}, renderDiasVigencia(rec.fechaEmision))
          ),
          dv('Tipo de Resguardo - Original', rec.tipoResguardo),
          dv('Ubicación / URL', rec.ubicacion ? (
            rec.ubicacion.startsWith('http') 
              ? h('a', {href:rec.ubicacion, target:'_blank', rel:'noopener'}, rec.ubicacion)
              : rec.ubicacion
          ) : '—'),
          dv('Copias Controladas', rec.copias),
          dv('Tipo Resguardo - Copia', rec.tipoResguardoCopia),
          dv('Usuarios con acceso', rec.usuarios, true),
          dv('Observaciones', rec.observaciones, true),
          h('div', {className:'detail-item full'},
            h('div', {className:'detail-label'}, 'Archivos'),
            h('div', {className:'detail-value'},
              (rec.archivos && rec.archivos.length > 0) || (rec.archivoURLs && rec.archivoURLs.length > 0)
                ? h('div', {className:'file-preview', style:{flexWrap:'wrap',gap:'8px'}},
                    ...(rec.archivoURLs||[]).map(url => h('a', {className:'file-chip', href:url, target:'_blank'}, h('i',{className:'fas fa-link'}), url.length > 40 ? url.substring(0,40)+'…' : url)),
                    ...(rec.archivos||[]).map(f => h('span', {className:'file-chip', onClick:()=>downloadFile(f)}, h('i',{className:'fas fa-file'}), f.name))
                  )
                : '—'
            )
          ),
          h('div', {className:'detail-item full'},
            h('div', {className:'detail-label'}, 'Archivos de Copia'),
            h('div', {className:'detail-value'},
              (rec.archivosCopia && rec.archivosCopia.length > 0) || (rec.archivoURLsCopia && rec.archivoURLsCopia.length > 0)
                ? h('div', {className:'file-preview', style:{flexWrap:'wrap',gap:'8px'}},
                    ...(rec.archivoURLsCopia||[]).map(url => h('a', {className:'file-chip', href:url, target:'_blank'}, h('i',{className:'fas fa-link'}), url.length > 40 ? url.substring(0,40)+'…' : url)),
                    ...(rec.archivosCopia||[]).map(f => h('span', {className:'file-chip', onClick:()=>downloadFile(f)}, h('i',{className:'fas fa-file'}), f.name))
                  )
                : '—'
            )
          )
        )
      ),
      h('div', {className:'modal-footer'},
        h('button', {className:'btn btn-secondary', onClick:closeModal}, 'Cerrar')
      )
    )
  );
}

function renderEditModal() {
  const form = STATE.editForm;
  const isAdd = STATE.modal === 'add';
  
  const fg = (label, key, opts={}) => {
    const isFull = opts.full;
    const type = opts.type || 'text';
    const hint = opts.hint;
    const isSelect = opts.options;
    const isTextarea = opts.textarea;
    
    let input;
    if (isSelect) {
      input = h('select', {
        className:'form-select',
        value: form[key]||'',
        onChange: (e) => { STATE.editForm[key] = e.target.value; refreshModal(); }
      },
        h('option', {value:''}, '-- Seleccionar --'),
        ...opts.options.map(o => h('option', {value: typeof o === 'string' ? o : o.value}, typeof o === 'string' ? o : o.label))
      );
    } else if (isTextarea) {
      input = h('textarea', {
        className:'form-textarea',
        value: form[key]||'',
        onInput: (e) => { STATE.editForm[key] = e.target.value; }
      });
    } else {
      input = h('input', {
        className:'form-input',
        type: type,
        value: form[key]||'',
        placeholder: opts.placeholder || '',
        onInput: (e) => {
          let val = e.target.value;
          if (opts.numbersOnly) val = val.replace(/[^0-9]/g, '');
          STATE.editForm[key] = val;
          if (opts.numbersOnly) e.target.value = val;
        }
      });
    }
    
    return h('div', {className:'form-group' + (isFull?' full':'')},
      h('label', {className:'form-label'}, label),
      input,
      hint ? h('div', {className:'form-hint'}, hint) : null
    );
  };

  // Elaboro with add-new option
  const elaboroOptions = STATE.elaboros.map(e => ({value: e, label: e}));
  
  return h('div', {className:'modal-overlay', onClick:(e)=>{if(e.target.className==='modal-overlay')closeModal();}},
    h('div', {className:'modal modal-lg'},
      h('div', {className:'modal-header'},
        h('h2', null, h('i',{className:'fas fa-'+(isAdd?'plus':'pen'), style:{marginRight:'8px',color:'var(--accent)'}}), isAdd ? 'Nuevo Registro' : 'Editar Registro'),
        h('button', {className:'modal-close', onClick:closeModal}, h('i',{className:'fas fa-times'}))
      ),
      h('div', {className:'modal-body'},
        h('div', {className:'form-grid'},
          fg('No.', 'no', {placeholder:'ID manual'}),
          fg('Código Manual / Procedimiento', 'codManual'),
          fg('Código Instructivo', 'codInstructivo'),
          fg('Código Listado', 'codListado'),
          fg('Código Formato', 'codFormato'),
          fg('Nombre del Documento', 'nombreDoc', {full:true}),
          // Version field with inline change detection
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Versión'),
            h('input', {
              className:'form-input',
              type:'text',
              value: form.version||'',
              placeholder:'Solo números',
              onInput: (e) => {
                STATE.editForm.version = e.target.value.replace(/[^0-9]/g,'');
                e.target.value = STATE.editForm.version;
                refreshModal();
              }
            }),
            h('div', {className:'form-hint'}, 'Solo números')
          ),
          fg('Fecha Emisión', 'fechaEmision', {placeholder:'ej: oct-24 o 2024-10-30', hint:'Formato: mes-año (oct-24) o AAAA-MM-DD'}),

          // === VERSION CHANGE WARNING + MOTIVO ===
          (!isAdd && STATE.originalVersion && String(form.version||'').trim() !== '' && String(form.version||'').trim() !== STATE.originalVersion)
            ? h('div', {className:'form-group full'},
                h('div', {style:{background:'rgba(249,115,22,.08)', border:'1.5px solid rgba(249,115,22,.3)', borderRadius:'12px', padding:'16px', marginTop:'4px'}},
                  h('div', {style:{display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px'}},
                    h('div', {style:{width:'36px',height:'36px',borderRadius:'50%',background:'rgba(249,115,22,.15)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:'0'}},
                      h('i', {className:'fas fa-box-archive', style:{color:'#fb923c',fontSize:'15px'}})
                    ),
                    h('div', null,
                      h('div', {style:{fontWeight:'700',fontSize:'14px',color:'#fb923c'}}, 'Cambio de versión detectado'),
                      h('div', {style:{fontSize:'12px',color:'var(--text-secondary)',marginTop:'2px'}},
                        'Versión ', h('span',{style:{fontFamily:'JetBrains Mono,monospace',fontWeight:'700',color:'var(--red)',textDecoration:'line-through'}}, STATE.originalVersion),
                        ' → ',
                        h('span',{style:{fontFamily:'JetBrains Mono,monospace',fontWeight:'700',color:'var(--green)'}}, form.version)
                      )
                    )
                  ),
                  h('div', {style:{fontSize:'12px',color:'var(--text-secondary)',marginBottom:'10px',lineHeight:'1.5'}},
                    h('i', {className:'fas fa-info-circle', style:{marginRight:'6px',color:'var(--accent)'}}),
                    'La versión anterior con sus archivos será enviada automáticamente a Obsoletos. Los archivos del registro actual se vaciarán para la nueva versión.'
                  ),
                  h('label', {style:{display:'block',fontSize:'12px',fontWeight:'700',color:'#fb923c',marginBottom:'6px',textTransform:'uppercase',letterSpacing:'.4px'}}, 'Motivo del cambio de versión *'),
                  h('textarea', {
                    className:'form-textarea',
                    id: 'motivo-version-input',
                    placeholder:'Describe el motivo del cambio de versión (obligatorio)...',
                    style:{minHeight:'80px',borderColor:'rgba(249,115,22,.3)'},
                    value: STATE.obsoletoMotivo||'',
                    onInput: (e) => {
                      STATE.obsoletoMotivo = e.target.value;
                      // Directly toggle save button without re-render
                      const btn = document.getElementById('btn-save-obsoleto');
                      if (btn) {
                        btn.disabled = !e.target.value.trim();
                      }
                    }
                  })
                )
              )
            : null,
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Elaboró / Actualizó'),
            h('select', {
              className:'form-select',
              value: form.elaboro||'',
              onChange: (e) => {
                if (e.target.value === '__new__') {
                  const name = prompt('Ingresa el nombre del nuevo elaborador:');
                  if (name && name.trim()) {
                    STATE.elaboros.push(name.trim());
                    STATE.editForm.elaboro = name.trim();
                  }
                } else {
                  STATE.editForm.elaboro = e.target.value;
                }
                refreshModal();
              }
            },
              h('option', {value:''}, '-- Seleccionar --'),
              ...STATE.elaboros.map(e => h('option', {value:e}, e)),
              h('option', {value:'__new__'}, '+ Agregar nuevo...')
            )
          ),
          fg('Tipo Resguardo - Original', 'tipoResguardo', {options:['Físico','Electrónico']}),
          form.tipoResguardo === 'Físico'
            ? fg('Ubicación Física', 'ubicacion', {placeholder:'¿Dónde se guarda?'})
            : form.tipoResguardo === 'Electrónico'
              ? fg('URL del Documento', 'ubicacion', {placeholder:'https://...', hint:'Ingresa la URL del documento'})
              : fg('Ubicación', 'ubicacion', {placeholder:'Selecciona tipo de resguardo primero'}),
          
          // Archivos
          h('div', {className:'form-group full'},
            h('label', {className:'form-label'}, 'Archivos'),
            h('div', {style:{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}},
              ...(form.archivos||[]).map((f,i) => h('span', {className:'file-chip'},
                h('i',{className:'fas fa-file'}),
                f.name,
                h('i', {className:'fas fa-times', style:{marginLeft:'4px',cursor:'pointer'}, onClick:()=>{
                  STATE.editForm.archivos.splice(i,1);
                  refreshModal();
                }})
              ))
            ),
            h('input', {
              type:'file',
              multiple:true,
              className:'form-input',
              onChange: (e) => {
                const files = Array.from(e.target.files);
                files.forEach(file => {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    if (!STATE.editForm.archivos) STATE.editForm.archivos = [];
                    STATE.editForm.archivos.push({name: file.name, size: file.size, type: file.type, dataUrl: ev.target.result});
                    refreshModal();
                  };
                  reader.readAsDataURL(file);
                });
              }
            })
          ),
          
          // URLs de archivos
          h('div', {className:'form-group full'},
            h('label', {className:'form-label'}, 'URLs de Archivos'),
            h('div', {style:{display:'flex',flexDirection:'column',gap:'6px'}},
              ...(form.archivoURLs||[]).map((url, i) => h('div', {style:{display:'flex',gap:'6px',alignItems:'center'}},
                h('input', {className:'form-input', value:url, style:{flex:1}, onInput:(e)=>{STATE.editForm.archivoURLs[i]=e.target.value;}}),
                h('button', {className:'btn btn-sm btn-danger', onClick:()=>{STATE.editForm.archivoURLs.splice(i,1);refreshModal();}}, h('i',{className:'fas fa-times'}))
              ))
            ),
            h('button', {className:'btn btn-sm btn-secondary', style:{marginTop:'6px'}, onClick:()=>{
              if(!STATE.editForm.archivoURLs) STATE.editForm.archivoURLs = [];
              STATE.editForm.archivoURLs.push('');
              refreshModal();
            }}, h('i',{className:'fas fa-plus'}), ' Agregar URL')
          ),
          
          fg('Copias Controladas', 'copias', {numbersOnly:true, hint:'Solo números'}),
          fg('Tipo Resguardo - Copia', 'tipoResguardoCopia', {options:['Físico','Electrónico']}),

          // Archivos de Copia
          h('div', {className:'form-group full'},
            h('label', {className:'form-label'}, 'Archivos de Copia'),
            h('div', {style:{display:'flex',gap:'8px',flexWrap:'wrap',marginBottom:'8px'}},
              ...(form.archivosCopia||[]).map((f,i) => h('span', {className:'file-chip'},
                h('i',{className:'fas fa-file'}),
                f.name,
                h('i', {className:'fas fa-times', style:{marginLeft:'4px',cursor:'pointer'}, onClick:()=>{
                  STATE.editForm.archivosCopia.splice(i,1);
                  refreshModal();
                }})
              ))
            ),
            h('input', {
              type:'file',
              multiple:true,
              className:'form-input',
              onChange: (e) => {
                const files = Array.from(e.target.files);
                files.forEach(file => {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    if (!STATE.editForm.archivosCopia) STATE.editForm.archivosCopia = [];
                    STATE.editForm.archivosCopia.push({name: file.name, size: file.size, type: file.type, dataUrl: ev.target.result});
                    refreshModal();
                  };
                  reader.readAsDataURL(file);
                });
              }
            })
          ),

          // URLs de archivos de Copia
          h('div', {className:'form-group full'},
            h('label', {className:'form-label'}, 'URLs de Archivos de Copia'),
            h('div', {style:{display:'flex',flexDirection:'column',gap:'6px'}},
              ...(form.archivoURLsCopia||[]).map((url, i) => h('div', {style:{display:'flex',gap:'6px',alignItems:'center'}},
                h('input', {className:'form-input', value:url, style:{flex:1}, onInput:(e)=>{STATE.editForm.archivoURLsCopia[i]=e.target.value;}}),
                h('button', {className:'btn btn-sm btn-danger', onClick:()=>{STATE.editForm.archivoURLsCopia.splice(i,1);refreshModal();}}, h('i',{className:'fas fa-times'}))
              ))
            ),
            h('button', {className:'btn btn-sm btn-secondary', style:{marginTop:'6px'}, onClick:()=>{
              if(!STATE.editForm.archivoURLsCopia) STATE.editForm.archivoURLsCopia = [];
              STATE.editForm.archivoURLsCopia.push('');
              refreshModal();
            }}, h('i',{className:'fas fa-plus'}), ' Agregar URL')
          ),

          fg('Usuarios con acceso a copia', 'usuarios', {full:true, placeholder:'correo1@ejemplo.com, correo2@ejemplo.com'}),
          fg('Observaciones', 'observaciones', {full:true, textarea:true})
        )
      ),
      h('div', {className:'modal-footer'},
        h('button', {className:'btn btn-secondary', onClick:closeModal}, 'Cancelar'),
        (() => {
          const vChanged = !isAdd && STATE.originalVersion && String(form.version||'').trim() !== '' && String(form.version||'').trim() !== STATE.originalVersion;
          if (vChanged) {
            const btn = h('button', {className:'btn btn-warning', id:'btn-save-obsoleto', onClick:saveRecord},
              h('i',{className:'fas fa-box-archive'}), 'Guardar y Enviar Versión Anterior a Obsoletos');
            btn.disabled = !(STATE.obsoletoMotivo && STATE.obsoletoMotivo.trim());
            return btn;
          }
          return h('button', {className:'btn btn-primary', onClick:saveRecord},
            h('i',{className:'fas fa-floppy-disk'}), isAdd ? 'Agregar Registro' : 'Guardar Cambios');
        })()
      )
    )
  );
}

function renderSalidaModal() {
  const rec = STATE.selectedRecord;
  const form = STATE.salidaForm;
  if (!rec) return null;
  
  return h('div', {className:'modal-overlay', onClick:(e)=>{if(e.target.className==='modal-overlay')closeModal();}},
    h('div', {className:'modal'},
      h('div', {className:'modal-header'},
        h('h2', null, h('i',{className:'fas fa-sign-out-alt', style:{marginRight:'8px',color:'var(--purple)'}}), 'Registro de Salida'),
        h('button', {className:'modal-close', onClick:closeModal}, h('i',{className:'fas fa-times'}))
      ),
      h('div', {className:'modal-body'},
        h('div', {style:{background:'var(--bg-input)', borderRadius:'10px', padding:'14px', marginBottom:'20px', border:'1px solid var(--border)'}},
          h('div', {style:{fontSize:'13px',color:'var(--text-muted)',marginBottom:'4px'}}, 'Documento:'),
          h('div', {style:{fontSize:'15px',fontWeight:'600'}}, rec.nombreDoc || rec.codManual || rec.codFormato),
          h('div', {style:{fontSize:'12px',color:'var(--text-muted)',marginTop:'4px'}}, `Versión: ${rec.version || '—'} | Emisión: ${rec.fechaEmision || '—'}`)
        ),
        h('div', {className:'form-grid'},
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Área *'),
            h('input', {className:'form-input', value: form.area||'', onInput:(e)=>{STATE.salidaForm.area=e.target.value;}})
          ),
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Destinatario *'),
            h('input', {className:'form-input', placeholder:'Nombre completo', value: form.destinatario||'', onInput:(e)=>{STATE.salidaForm.destinatario=e.target.value;}})
          ),
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Correo del Destinatario *'),
            h('input', {className:'form-input', type:'email', placeholder:'correo@ejemplo.com', value: form.correo||'', onInput:(e)=>{STATE.salidaForm.correo=e.target.value;}})
          ),
          h('div', {className:'form-group full'},
            h('label', {className:'form-label'}, 'Motivo de Entrega *'),
            h('textarea', {className:'form-textarea', placeholder:'Describe el motivo de la entrega...', value: form.motivo||'', onInput:(e)=>{STATE.salidaForm.motivo=e.target.value;}})
          )
        )
      ),
      h('div', {className:'modal-footer'},
        h('button', {className:'btn btn-secondary', onClick:closeModal}, 'Cancelar'),
        h('button', {className:'btn btn-primary', onClick:confirmSalida}, h('i',{className:'fas fa-paper-plane'}), 'Registrar Salida')
      )
    )
  );
}

function renderObsoletoModal() {
  const rec = STATE.selectedRecord;
  if (!rec) return null;
  
  return h('div', {className:'modal-overlay', onClick:(e)=>{if(e.target.className==='modal-overlay')closeModal();}},
    h('div', {className:'modal'},
      h('div', {className:'modal-header'},
        h('h2', null, h('i',{className:'fas fa-archive', style:{marginRight:'8px',color:'var(--orange)'}}), 'Enviar a Obsoletos'),
        h('button', {className:'modal-close', onClick:closeModal}, h('i',{className:'fas fa-times'}))
      ),
      h('div', {className:'modal-body'},
        h('div', {style:{background:'var(--red-bg)', borderRadius:'10px', padding:'14px', marginBottom:'20px', border:'1px solid rgba(239,68,68,.2)'}},
          h('div', {style:{display:'flex',alignItems:'center',gap:'8px',color:'var(--red)',fontWeight:'600',fontSize:'13px'}},
            h('i', {className:'fas fa-exclamation-triangle'}),
            'Este documento será movido a obsoletos'
          ),
          h('div', {style:{fontSize:'13px',marginTop:'8px',color:'var(--text-secondary)'}}, `${rec.nombreDoc || rec.codManual || rec.codFormato} — Versión ${rec.version||'—'}`)
        ),
        h('div', {className:'form-group'},
          h('label', {className:'form-label'}, 'Motivo del cambio *'),
          h('textarea', {
            className:'form-textarea',
            placeholder:'Describe el motivo por el cual este documento pasa a obsoleto...',
            style:{minHeight:'100px'},
            value: STATE.obsoletoMotivo,
            onInput:(e)=>{STATE.obsoletoMotivo=e.target.value;}
          }),
          h('div', {className:'form-hint'}, 'Este campo es obligatorio para confirmar el envío a obsoletos')
        )
      ),
      h('div', {className:'modal-footer'},
        h('button', {className:'btn btn-secondary', onClick:closeModal}, 'Cancelar'),
        h('button', {
          className:'btn btn-warning',
          disabled: !STATE.obsoletoMotivo.trim(),
          onClick: confirmObsoleto
        }, h('i',{className:'fas fa-box-archive'}), 'Confirmar y Enviar a Obsoletos')
      )
    )
  );
}

// ========================================
// LOGIN SCREEN
// ========================================

const LOGO_SRC = '';

function renderLogin() {
  const app = document.getElementById('app');
  app.innerHTML = '';

  let usernameVal = '';
  let passwordVal = '';

  // Count online users from Firebase presence
  const onlineCount = (typeof SYNC !== 'undefined' && SYNC.onlineCount) ? SYNC.onlineCount : 0;

  const card = h('div', {className: 'login-wrapper'},
    h('div', {className: 'login-card'},
      h('div', {className: 'logo-area'},
        h('img', {src: DEBBIOM_LOGO, alt: 'DEBBIOM'}),
        h('div', {className: 'brand-name'}, 'DEBBIOM'),
        h('div', {className: 'brand-subtitle'}, 'Listado de estudios'),
        h('div', {className: 'sync-badge'},
          h('i', {className: 'fas fa-cloud'}),
          'Sincronización en la Nube'
        )
      ),
      AUTH.loginError ? h('div', {className: 'login-error'},
        h('i', {className: 'fas fa-exclamation-circle'}),
        AUTH.loginError
      ) : null,
      h('div', {className: 'login-field'},
        h('label', null,
          h('i', {className: 'fas fa-user'}),
          'Usuario'
        ),
        h('div', {className: 'input-wrap'},
          h('input', {
            type: 'text',
            placeholder: '',
            id: 'login-user',
            autocomplete: 'off',
            maxLength: 50,
            onInput: (e) => { usernameVal = e.target.value; },
            onKeydown: (e) => { if(e.key === 'Enter') document.getElementById('login-pw').focus(); }
          })
        )
      ),
      h('div', {className: 'login-field'},
        h('label', null,
          h('i', {className: 'fas fa-lock'}),
          'Contraseña'
        ),
        h('div', {className: 'input-wrap'},
          h('input', {
            type: AUTH.showPassword ? 'text' : 'password',
            placeholder: '',
            id: 'login-pw',
            onInput: (e) => { passwordVal = e.target.value; },
            onKeydown: async (e) => {
              if(e.key === 'Enter') {
                await attemptLogin(usernameVal || document.getElementById('login-user').value, passwordVal || e.target.value);
                render();
              }
            }
          }),
          h('button', {className: 'toggle-pw', onClick: () => { AUTH.showPassword = !AUTH.showPassword; renderLogin(); setTimeout(()=>{const el=document.getElementById('login-pw');if(el)el.focus();},50); }},
            h('i', {className: AUTH.showPassword ? 'fas fa-eye-slash' : 'fas fa-eye'})
          )
        )
      ),
      h('button', {className: 'login-btn', onClick: async () => {
        const u = document.getElementById('login-user').value;
        const p = document.getElementById('login-pw').value;
        await attemptLogin(u, p);
        render();
      }},
        'Iniciar Sesión →'
      ),
      h('div', {className: 'login-online-users'},
        h('div', {className: 'online-count'}, String(onlineCount)),
        h('div', {className: 'online-label'}, 'usuarios en línea')
      )
    )
  );

  app.appendChild(card);

  // Auto-focus username
  setTimeout(() => { const el = document.getElementById('login-user'); if(el) el.focus(); }, 100);
}

// ========================================
// USER MANAGEMENT (Admin only)
// ========================================

function renderUserManagementModal() {
  let newUser = { username:'', password:'', fullName:'', role:'user' };
  let changePwUser = null;
  let changePwVal = '';

  function refreshUMBody() {
    const body = document.getElementById('um-body');
    if (!body) return;
    body.innerHTML = '';
    body.appendChild(buildUMContent());
  }

  function buildUMContent() {
    const container = h('div', null,
      // User list table
      h('table', {className: 'um-table'},
        h('thead', null,
          h('tr', null,
            h('th', null, 'Usuario'),
            h('th', null, 'Nombre'),
            h('th', null, 'Rol'),
            h('th', {style:{minWidth:'220px'}}, 'Acciones')
          )
        ),
        h('tbody', null,
          ...AUTH.users.map(u => h('tr', null,
            h('td', null, h('span', {style:{fontFamily:'JetBrains Mono, monospace', fontWeight:'600'}}, u.username)),
            h('td', null, u.fullName),
            h('td', null, h('span', {className: 'um-role-badge ' + (u.role==='admin'?'um-role-admin':'um-role-user')}, u.role==='admin'?'Administrador':'Usuario')),
            h('td', null,
              h('div', {style:{display:'flex',gap:'6px',flexWrap:'wrap'}},
                // Change password
                h('button', {className:'btn btn-sm btn-warning', onClick:() => {
                  changePwUser = u.username;
                  changePwVal = '';
                  refreshUMBody();
                }}, h('i',{className:'fas fa-key'}), ' Contraseña'),
                // Delete (not self, not admin if not admin)
                u.username !== AUTH.currentUser.username
                  ? h('button', {className:'btn btn-sm btn-danger', onClick:() => {
                      if(confirm('¿Eliminar al usuario ' + u.username + '?')) {
                        AUTH.users = AUTH.users.filter(x => x.username !== u.username);
                        saveUsers(AUTH.users);
                        addLog('userDel', u.username); showToast('Usuario ' + u.username + ' eliminado');
                        refreshUMBody();
                      }
                    }}, h('i',{className:'fas fa-trash-can'}), ' Eliminar')
                  : null
              )
            )
          ))
        )
      ),

      // Change password inline
      changePwUser ? h('div', {style:{marginTop:'20px',padding:'16px',background:'var(--bg-input)',borderRadius:'10px',border:'1px solid var(--border)'}},
        h('div', {style:{fontWeight:'600',fontSize:'13px',marginBottom:'10px',color:'var(--yellow)'}},
          h('i', {className:'fas fa-key', style:{marginRight:'6px'}}),
          'Cambiar contraseña de: ', changePwUser
        ),
        h('div', {style:{display:'flex',gap:'8px',alignItems:'center'}},
          h('input', {
            className:'form-input',
            type:'password',
            placeholder:'Nueva contraseña (mín. 6 caracteres)',
            style:{flex:'1'},
            id:'pw-change-input',
            value: changePwVal,
            onInput: (e) => { changePwVal = e.target.value; }
          }),
          h('button', {className:'btn btn-sm btn-success', onClick: async () => {
            const val = document.getElementById('pw-change-input').value;
            if (!val || val.length < 6) { showToast('La contraseña debe tener al menos 6 caracteres','error'); return; }
            if (val.length > 128) { showToast('La contraseña es demasiado larga','error'); return; }
            const u = AUTH.users.find(x => x.username === changePwUser);
            if (u) {
              u._h = await _SEC.sha256(val);
              delete u.password; // Asegurar que no quede texto plano
              saveUsers(AUTH.users);
              addLog('userPw', changePwUser);
              saveState();
              showToast('Contraseña de ' + changePwUser + ' actualizada');
            }
            changePwUser = null;
            refreshUMBody();
          }}, h('i',{className:'fas fa-check'}), ' Guardar'),
          h('button', {className:'btn btn-sm btn-secondary', onClick:() => { changePwUser = null; refreshUMBody(); }}, 'Cancelar')
        )
      ) : null,

      // Add new user form
      h('div', {style:{marginTop:'24px',padding:'18px',background:'var(--bg-input)',borderRadius:'10px',border:'1px solid var(--accent)'}},
        h('div', {style:{fontWeight:'600',fontSize:'14px',marginBottom:'14px',color:'var(--accent)'}},
          h('i', {className:'fas fa-user-plus', style:{marginRight:'8px'}}),
          'Agregar Nuevo Usuario'
        ),
        h('div', {className:'form-grid'},
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Usuario'),
            h('input', {className:'form-input', placeholder:'Ej: JPerez', id:'new-user-name', onInput:(e)=>{newUser.username=e.target.value;}})
          ),
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Nombre Completo'),
            h('input', {className:'form-input', placeholder:'Ej: J. Pérez', id:'new-user-full', onInput:(e)=>{newUser.fullName=e.target.value;}})
          ),
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Contraseña'),
            h('input', {className:'form-input', type:'password', placeholder:'Contraseña inicial (mín. 6 chars)', id:'new-user-pw', onInput:(e)=>{newUser.password=e.target.value;}})
          ),
          h('div', {className:'form-group'},
            h('label', {className:'form-label'}, 'Rol'),
            h('select', {className:'form-select', id:'new-user-role', onChange:(e)=>{newUser.role=e.target.value;}},
              h('option', {value:'user'}, 'Usuario'),
              h('option', {value:'admin'}, 'Administrador')
            )
          )
        ),
        h('button', {className:'btn btn-primary', style:{marginTop:'14px'}, onClick: async () => {
          const uname = document.getElementById('new-user-name').value.trim();
          const fname = document.getElementById('new-user-full').value.trim();
          const pw = document.getElementById('new-user-pw').value;
          const role = document.getElementById('new-user-role').value;
          if (!uname || !validateUsername(uname)) { showToast('Usuario inválido (letras, números, 2-30 chars)','error'); return; }
          if (!pw || !validatePassword(pw)) { showToast('La contraseña debe tener entre 6 y 128 caracteres','error'); return; }
          if (AUTH.users.find(x => x.username.toLowerCase() === uname.toLowerCase())) { showToast('Ese usuario ya existe','error'); return; }
          const hashedPw = await _SEC.sha256(pw);
          AUTH.users.push({ username: sanitizeInput(uname), _h: hashedPw, fullName: sanitizeInput(fname) || sanitizeInput(uname), role: role });
          saveUsers(AUTH.users);
          addLog('userAdd', uname); saveState(); showToast('Usuario ' + sanitizeInput(uname) + ' creado exitosamente');
          newUser = { username:'', password:'', fullName:'', role:'user' };
          refreshUMBody();
        }}, h('i',{className:'fas fa-user-plus'}), ' Crear Usuario')
      )
    );
    return container;
  }

  return h('div', {className:'modal-overlay', onClick:(e)=>{if(e.target.className==='modal-overlay')closeModal();}},
    h('div', {className:'modal modal-lg'},
      h('div', {className:'modal-header'},
        h('h2', null, h('i',{className:'fas fa-users-gear', style:{marginRight:'8px',color:'var(--accent)'}}), 'Administración de Usuarios'),
        h('button', {className:'modal-close', onClick:closeModal}, h('i',{className:'fas fa-times'}))
      ),
      h('div', {className:'modal-body', id:'um-body'},
        buildUMContent()
      ),
      h('div', {className:'modal-footer'},
        h('button', {className:'btn btn-secondary', onClick:closeModal}, 'Cerrar')
      )
    )
  );
}

// ========================================
// MAIN RENDER
// ========================================

// ========================================
// MODAL-ONLY REFRESH (no full page rebuild)
// ========================================

function refreshModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (!STATE.modal) { root.innerHTML = ''; return; }

  // Save focus + cursor + scroll before rebuild
  const active = document.activeElement;
  const focusId = active ? active.id : null;
  let focusIdx = null;
  let cursorPos = null;
  let scrollTop = 0;

  // Find the modal body scroll position
  const modalBody = root.querySelector('.modal-body');
  if (modalBody) scrollTop = modalBody.scrollTop;

  // For inputs without id, find by index among all inputs in modal
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
    cursorPos = active.selectionStart;
    if (!focusId) {
      const allInputs = root.querySelectorAll('input, textarea, select');
      focusIdx = Array.from(allInputs).indexOf(active);
    }
  }

  // Rebuild modal atomically
  let modal = null;
  if (STATE.modal === 'view') modal = renderViewModal();
  else if (STATE.modal === 'edit' || STATE.modal === 'add') modal = renderEditModal();
  else if (STATE.modal === 'salida') modal = renderSalidaModal();
  else if (STATE.modal === 'obsoleto') modal = renderObsoletoModal();
  else if (STATE.modal === 'users') modal = renderUserManagementModal();
  if (modal) root.replaceChildren(modal); else root.replaceChildren();

  // Restore focus + cursor + scroll
  requestAnimationFrame(() => {
    // Restore scroll
    const newBody = root.querySelector('.modal-body');
    if (newBody && scrollTop) newBody.scrollTop = scrollTop;

    // Restore focus
    let target = null;
    if (focusId) target = document.getElementById(focusId);
    if (!target && focusIdx !== null && focusIdx >= 0) {
      const allInputs = root.querySelectorAll('input, textarea, select');
      target = allInputs[focusIdx] || null;
    }
    if (target) {
      target.focus();
      if (cursorPos !== null && typeof target.setSelectionRange === 'function') {
        try { target.setSelectionRange(cursorPos, cursorPos); } catch(e) {}
      }
    }
  });
}

// ========================================
// MAIN RENDER (page structure only)
// ========================================

function render() {
  // Gate behind login
  if (!AUTH.currentUser) {
    document.getElementById('modal-root').innerHTML = '';
    renderLogin();
    return;
  }

  const app = document.getElementById('app');
  // Build offscreen then swap atomically
  const frag = document.createDocumentFragment();
  const sidebar = renderSidebar();
  
  let sectionTitle;
  let content;
  
  switch(STATE.currentSection) {
    case 'areas':
      sectionTitle = STATE.currentArea;
      content = renderAreasTable();
      break;
    case 'obsoletos':
      sectionTitle = 'Documentos Obsoletos';
      content = renderObsoletosTable();
      break;
    case 'salidas':
      sectionTitle = 'Registro de Salidas';
      content = renderSalidasTable();
      break;
    case 'papelera':
      sectionTitle = 'Papelera de Reciclaje';
      content = renderPapeleraTable();
      break;
    case 'logs':
      sectionTitle = 'Registro de Actividad';
      content = renderLogsTable();
      break;
  }
  
  const topbar = h('div', {className: 'topbar'},
    h('div', {className: 'topbar-title'}, sectionTitle),
    h('div', {className: 'topbar-actions'},
      // Botón sincronizar (siempre visible)
      typeof SYNC !== 'undefined' && SYNC.initialized ? h('button', {
        className: 'btn btn-sync', id: 'btn-sync',
        onClick: function() { if (typeof forceSync === 'function') forceSync(); }
      }, h('i', {className: 'fas fa-arrows-rotate'}), 'Sincronizar') : null,
      // Último chequeo
      typeof SYNC !== 'undefined' && SYNC.connected ? h('span', {className: 'sync-time-label', id: 'sync-last-time'}, '') : null,
      STATE.currentSection === 'areas' ? h('button', {className:'btn btn-primary', onClick:openAdd}, h('i',{className:'fas fa-circle-plus'}), 'Nuevo Registro') : null,
      h('button', {className:'btn btn-secondary', onClick:exportToExcel}, h('i',{className:'fas fa-file-excel', style:{color:'#10b981'}}), 'Exportar Excel')
    )
  );
  
  const main = h('div', {className:'main'},
    topbar,
    content
  );
  
  frag.appendChild(sidebar);
  frag.appendChild(main);
  app.replaceChildren(frag);
  
  // Modals go to separate root
  refreshModal();
  
  // Render toasts
  renderToasts();
}

function renderToasts() {
  let tc = document.getElementById('toast-container');
  if (tc) tc.remove();
  if (STATE.toasts.length > 0) {
    tc = h('div', {className:'toast-container', id:'toast-container'},
      ...STATE.toasts.map(t => h('div', {className:'toast toast-'+t.type},
        h('i', {className: t.type==='success'?'fas fa-check-circle':t.type==='error'?'fas fa-exclamation-circle':'fas fa-info-circle'}),
        h('span', null, t.msg)
      ))
    );
    document.body.appendChild(tc);
  }
}

// ========================================
// INITIALIZATION
// ========================================

// Data will be loaded inline below

// ── CAPA 9: Inicialización segura y limpieza de datos legacy ──
(function securityInit() {
  // Migrar datos legacy inseguros
  try {
    const oldUsers = localStorage.getItem('debbiom_users');
    if (oldUsers) {
      console.warn('[SEGURIDAD] Se detectaron datos de usuario no cifrados. Limpiando...');
      localStorage.removeItem('debbiom_users');
    }
    const oldSession = sessionStorage.getItem('debbiom_session');
    if (oldSession) {
      sessionStorage.removeItem('debbiom_session');
    }
  } catch(e) {}

  // Verificar expiración de sesión periódicamente (cada 60s)
  setInterval(() => {
    if (AUTH.currentUser) {
      const session = loadSession();
      if (!session) {
        AUTH.currentUser = null;
        if (typeof unregisterPresence === 'function') unregisterPresence();
        showToast('Sesión expirada. Inicia sesión de nuevo.', 'error');
        render();
      }
    }
  }, 60000);

  // Deshabilitar inspección de objetos sensibles en consola
  try {
    Object.defineProperty(AUTH, '_internal', {
      get() { console.warn('[SEGURIDAD] Acceso no autorizado detectado'); return undefined; },
      enumerable: false,
      configurable: false
    });
  } catch(e) {}
})();

// ── Inicialización principal (async para sincronización) ──
(async function mainInit() {
  // 1. Cargar datos locales primero (rápido)
  const hasLocalState = loadSavedState();
  
  if (!hasLocalState) {
    loadExcelData();
  }

  // 2. Render inicial rápido
  render();

  // 3. Inicializar sincronización en segundo plano
  if (typeof initSync === 'function') {
    const syncReady = await initSync();
    
    if (syncReady) {
      // 4. Cargar estado remoto (puede ser más reciente)
      const loaded = await syncLoadState();
      
      if (!loaded && !hasLocalState) {
        // Si no hay datos en la nube ni local, subir datos iniciales
        loadExcelData();
        saveState(); // Esto enviará a JSONBin
      } else if (loaded) {
        // Re-renderizar con datos de la nube
        render();
      }

      // 5. Escuchar cambios periódicamente (polling)
      listenStateChanges();
      
      showToast('Sincronización en la nube activa', 'info');
    }
  } else {
    // Sin sincronización, guardar estado local si es nuevo
    if (!hasLocalState) {
      localSaveState();
    }
  }
})();