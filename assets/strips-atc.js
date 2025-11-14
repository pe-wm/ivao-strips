(function(){
  "use strict";

  // ================================
  //   Constantes de comportamiento
  // ================================
  const DEBUG = false; // <<< Activar para ver logs detallados
  const INBOX_POLL_MS = 4000; // <<< cada 4 s
  let currentPos = '';
  let suppressSave = false;
  let saveDebounce = null;
  let lastRemoteUpdated = null;
  let inboxTimer = null;
  let ivaoId = ''; // Will be set during initATCInstance

  if (DEBUG) console.info('[strips-atc] script cargado');

  // ================================
  //   (Legacy) Estado ATC: SIN USO
  //   -> ya NO se consulta IVAO
  // ================================
  window.IVAOPE_ATC = window.IVAOPE_ATC || {
    activos: [],
    lastFetched: 0,
    timerId: null,
    startPolling: ()=>{},  // noop
    stopPolling:  ()=>{},  // noop
    fetchOnce:    ()=>{},  // noop
    calcularPosicionesTransferir: ()=>[] // noop legacy
  };
  
  // === Helper visual: toast de aviso rápido ===
	function toast(msg, isError = false) {
	  const div = document.createElement('div');
	  div.textContent = msg;
	  div.className = 'se-toast';
	  div.style.position = 'fixed';
	  div.style.bottom = '20px';
	  div.style.left = '50%';
	  div.style.transform = 'translateX(-50%)';
	  div.style.background = isError ? '#c0392b' : '#2ecc71';
	  div.style.color = '#fff';
	  div.style.padding = '8px 14px';
	  div.style.borderRadius = '8px';
	  div.style.boxShadow = '0 2px 6px rgba(0,0,0,.3)';
	  div.style.zIndex = 9999;
	  div.style.fontSize = '14px';
	  div.style.transition = 'opacity .3s';

	  document.body.appendChild(div);
	  setTimeout(() => { div.style.opacity = '0'; }, 2000);
	  setTimeout(() => { div.remove(); }, 2500);
	}


  // ================================
  //          HELPERS STRIPS
  // ================================
  async function refreshPosLock(eps, pos, ownerId) {
	  const base = (eps && (eps.poslock || eps.posLock || eps.lock)) || '/wp-json/ivaope/v1/poslock';
	  const posStr = String(pos || '').toUpperCase().trim();
	  const ownerStr = String(ownerId || '').trim();
	  if (!posStr || !ownerStr) return { ok: false, error: 'pos/owner vacíos' };

	  try {
		// Try a simple POST form op=lock which should update timestamp on most backends
		const r = await fetch(base, {
		  method: 'POST',
		  credentials: 'same-origin',
		  headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
		  body: new URLSearchParams({ op:'lock', pos: posStr, owner: ownerStr }).toString()
		});
		const bodyText = await r.text().catch(()=>null);
		return { ok: r.ok, status: r.status, bodyText };
	  } catch (e) {
		return { ok: false, error: e && e.message || String(e) };
	  }
	}

  async function saveSessionState(endpoints, stage, pos){
	  if (!pos) return; // sin posición no guardamos
		  const url = (endpoints && endpoints.stripsave) || '/wp-json/ivaope/v1/stripsave';
		  const strips = collectAllStrips(stage);
		  //if (!strips.length) return; // no persistas vacío
		  const payload = {
		    pos,
		    strips,
		    payload: strips,
		    file: `${pos}.save`
		  };

		  try{
			const res = await fetch(url, {
			  method:'POST',
			  credentials:'same-origin',
			  headers:{ 'Content-Type':'application/json' },
			  body: JSON.stringify(payload)
			});
			if (!res.ok) {
			  const t = await res.text();
			  console.warn('[strips-atc] saveSessionState fallo', res.status, t);
			  return;
			}
			console.info(`[strips-atc] guardado OK -> ${pos}.save (${strips.length} strips)`);
		  }catch(e){
			console.warn('[strips-atc] saveSessionState error:', e && e.message || e);
		  }
		}
  function normalizeNewlines(str){ return (str||'').replace(/\r\n?/g, '\n'); }

  function afterImagesLoaded(container, cb){
    const imgs = Array.from(container.querySelectorAll('img'));
    if (imgs.length===0){ requestAnimationFrame(cb); return; }
    let pending = imgs.length;
    const done = ()=>{ if(--pending<=0) cb(); };
    imgs.forEach(img=>{
      if (img.complete) done();
      else { img.addEventListener('load', done, {once:true}); img.addEventListener('error', done, {once:true}); }
    });
  }

  // Layout utils: evitar solapados y bloquear X
  const GAP = 20;
  // Inserta un layer en la parte superior y desplaza el resto hacia abajo
	function placeLayerAtTop(stage, newLayer){
	  afterImagesLoaded(newLayer, ()=>{
		const firstH = newLayer.offsetHeight;
		let y = firstH + GAP;

		const others = Array.from(stage.querySelectorAll('.se-layer'))
		  .filter(el => el !== newLayer)
		  .sort((a,b) => a.offsetTop - b.offsetTop);

		others.forEach(el => {
		  el.style.top = y + 'px';
		  y += el.offsetHeight + GAP;
		});

		stage.style.height = Math.max(y, 120) + 'px';
	  });
	}

  function getLayers(stage){
    return Array.from(stage.querySelectorAll('.se-layer'));
  }
  function nextTop(stage){
    const layers = getLayers(stage);
    const bottom = layers.reduce((m,el)=>Math.max(m, el.offsetTop + el.offsetHeight), 0);
    return bottom + GAP;
  }
  function reflowAll(stage){
    const layers = getLayers(stage).sort((a,b)=>a.offsetTop - b.offsetTop);
    let y = 0;
    layers.forEach(el=>{
      el.style.top = y + 'px';
      y += el.offsetHeight + GAP;
    });
    const h = Math.max(y, 120);
    stage.style.height = h + 'px';
  }
  function saveNow(endpoints, stage) {
	  if (suppressSave || !currentPos) return;
	  if (saveDebounce) clearTimeout(saveDebounce);
	  saveDebounce = setTimeout(async () => {
		// First save the strips state
		await saveSessionState(endpoints, stage, currentPos);

		// Then update the lock file to refresh its timestamp (use top-level refresh helper)
		try {
		  const lockRes = await refreshPosLock(endpoints, currentPos, ivaoId);
		  if (!lockRes.ok) {
			console.warn('[poslock] Error updating lock timestamp:', lockRes);
		  }
		} catch (e) {
		  console.warn('[poslock] Failed to update lock timestamp:', e);
		}
	  }, 200);
	}
  function reorderAfterDrag(stage, dragged, endpoints){
		const items = getLayers(stage).map(el=>{
		  const r = el.getBoundingClientRect();
		  return { el, center: r.top + r.height / 2 };
		}).sort((a,b)=>a.center - b.center);

		let y = 0;
		items.forEach(it=>{
		  it.el.style.top = y + 'px';
		  y += it.el.offsetHeight + GAP;
		});
		stage.style.height = Math.max(y, 120) + 'px';

		// Use requestAnimationFrame to ensure DOM updates before saving
		requestAnimationFrame(() => {
			saveNow(endpoints, stage);
		});
	}

  // Drag ligero con callback onEnd y bloqueo X opcional
  function makeDraggable(nodes, container, opts, endpoints){
    const raiseOnDrag = !!(opts && opts.raiseOnDrag);
    const constrain   = !!(opts && opts.constrain);
    const lockX       = !!(opts && opts.lockX);
    const onEndCb     = (opts && typeof opts.onEnd==='function') ? opts.onEnd : null;
    let zCounter = 1;

    nodes.forEach(node=>{
      let dragging=false, offsetX=0, offsetY=0, fixedLeft=0;

      function start(e,cx,cy){
        dragging=true;
        const rect=node.getBoundingClientRect();
        offsetX = cx-rect.left; offsetY = cy-rect.top;
        fixedLeft = parseFloat(node.style.left||'0')||0;
        if (raiseOnDrag) node.style.zIndex = ++zCounter;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', end);
        document.addEventListener('touchmove', onTouchMove, {passive:false});
        document.addEventListener('touchend', end);
      }
      function onMove(e){ if(!dragging) return; e.preventDefault(); place(e.clientX,e.clientY); }
      function onTouchMove(e){ if(!dragging) return; e.preventDefault(); const t=e.touches[0]; place(t.clientX,t.clientY); }
      function end(){
		document.removeEventListener('mousemove', onMove);
		document.removeEventListener('mouseup', end);
		document.removeEventListener('touchmove', onTouchMove);
		document.removeEventListener('touchend', end);
		dragging=false;
		if (onEndCb) onEndCb(node);
		
		// Add save trigger after drag ends
		saveNow(endpoints, container);
	}
      function place(cx,cy){
        const contRect = container.getBoundingClientRect();
        const x = cx - contRect.left - offsetX;
        const y = cy - contRect.top  - offsetY;
        let nx=x, ny=y;
        if (lockX) nx = fixedLeft; // bloquea X
        if (constrain){
          const maxX = contRect.width  - node.offsetWidth;
          const maxY = contRect.height - node.offsetHeight;
          nx = Math.max(0, Math.min(nx, maxX));
          ny = Math.max(0, Math.min(ny, maxY));
        }
        node.style.left = nx+'px';
        node.style.top  = ny+'px';
      }

      node.addEventListener('mousedown', (e)=>{
        if (node.classList.contains('se-note')){
          if (!(e.altKey||e.ctrlKey||e.metaKey)) return; // mover nota solo con modificador
          e.preventDefault();
        }
        start(e, e.clientX, e.clientY);
      });
      node.addEventListener('touchstart', (e)=>{
        const t=e.touches[0]; start(e,t.clientX,t.clientY);
      }, {passive:true});
      node.addEventListener('dragstart', e=>e.preventDefault());
    });
  }

  function createStrip(stage, cfgType, cfg, withTransferBtn, onTransfer, saveFn, endpoints){
    const type = (cfgType==='arr'?'arr':'dep');
    const isArr = type==='arr';
    const imgSrc = isArr ? (cfg.arr && cfg.arr.img) : (cfg.dep && cfg.dep.img);
    const coords = isArr ? (cfg.arr && cfg.arr.coords || []) : (cfg.dep && cfg.dep.coords || []);
    const baseLeft = isArr ? (cfg.arr && cfg.arr.x || 0) : (cfg.dep && cfg.dep.x || 0);

    const layer = document.createElement('div');
    layer.className='se-layer';
    layer.dataset.layer=type;
    layer.style.left = baseLeft+'px';
    layer.style.top  = nextTop(stage) + 'px';

    const img = document.createElement('img');
    img.src = imgSrc; img.alt = isArr?'Strip Llegadas':'Strip Salidas';
    img.className='se-img'; img.draggable=false;
    layer.appendChild(img);

    // botón cerrar
    const close = document.createElement('button');
    close.type='button'; close.className='se-close'; close.title='Eliminar';
     close.addEventListener('click', (e) => {
        if (confirm('¿Estás seguro de borrar este strip?')) {
            layer.remove(); 
            reflowAll(stage);
            // Keep the save trigger after confirmed deletion
            if (typeof saveFn === 'function') saveFn();
        }
    });
    layer.appendChild(close);

    // botón transferir
    if (withTransferBtn){
      const btn = document.createElement('button');
      btn.type='button';
      btn.className='se-btn';
      btn.textContent='Transferir';
      // posición separada para no tapar campos
      btn.style.position='absolute'; btn.style.right='-106px'; btn.style.bottom='90px';
      btn.addEventListener('click', ()=>{ onTransfer && onTransfer(layer); });
      layer.appendChild(btn);
    }

    coords.forEach((pt,i)=>{
      const idx=i+1;
      const note=document.createElement('div');
      note.className='se-note';
      note.contentEditable='true';
      note.style.left = parseInt(pt[0],10)+'px';
      note.style.top  = parseInt(pt[1],10)+'px';
      note.textContent='';
	note.style.setProperty('color', '#000', 'important');                 // opcional
	note.style.setProperty('-webkit-text-fill-color', '#000', 'important'); // CLAVE
      if (isArr && (idx===5 || idx===19)) {
        note.style.fontSize='54px'; note.style.lineHeight='1.2';
      }
	  // === NUEVO: primera nota de strip de salidas (no editable y alterna B/C)
	  if (!isArr && idx === 1) {
		note.contentEditable = 'false';
		note.textContent = ' '; // empieza en blanco
		note.style.cursor = 'pointer';
		note.style.fontSize='24px'; note.style.lineHeight='1.2';
		note.addEventListener('click', () => {
		  const v = note.textContent.trim();
		  if (v === 'B') note.textContent = 'Ⓑ';
		  else if (v === 'Ⓑ') note.textContent = ' ';
		  else note.textContent = 'B';
		});
	  }
      layer.appendChild(note);
    });

    stage.appendChild(layer);

    afterImagesLoaded(layer, ()=>{
		  const notes = Array.from(layer.querySelectorAll('.se-note'));
		  // layer: bloquea X y reordena al soltar para evitar solapados
		  makeDraggable([layer], stage, {
			raiseOnDrag:true,
			lockX:true,
			onEnd: ()=>{
			  reorderAfterDrag(stage, layer, endpoints);   // Pass endpoints here
			  if (typeof saveFn==='function') saveFn();
			}
		  }, endpoints); // Pass endpoints here

		  // notas: sólo dentro del strip, no afectan layout
		  makeDraggable(notes, layer, {
			constrain:true,
			onEnd: ()=>{ if (typeof saveFn==='function') saveFn(); }
		  }, endpoints); // Pass endpoints here
		  
		  reflowAll(stage);
		});
		
		return layer;
	}

  function serializeStrip(layer){
    const type = layer.dataset.layer;
    const left = parseFloat(layer.style.left)||0;
    const top  = parseFloat(layer.style.top)||0;
    const notes=[];
    layer.querySelectorAll('.se-note').forEach(n=>{
      notes.push({
        left: parseFloat(n.style.left)||0,
        top:  parseFloat(n.style.top)||0,
        text: normalizeNewlines(n.innerText||'')
      });
    });
    return { type, left, top, notes };
  }

  function applyStripToLayer(layer, rec){
    if (!rec) return;
    if (Number.isFinite(rec.left)) layer.style.left = rec.left+'px';
    if (Number.isFinite(rec.top))  layer.style.top  = rec.top +'px';
    const notes = Array.from(layer.querySelectorAll('.se-note'));
    (rec.notes||[]).forEach((nRec,idx)=>{
      const n=notes[idx]; if (!n) return;
      if (Number.isFinite(nRec.left)) n.style.left = nRec.left+'px';
      if (Number.isFinite(nRec.top))  n.style.top  = nRec.top +'px';
      if (typeof nRec.text==='string') n.textContent = nRec.text;
    });
  }

  function collectAllStrips(stage){
    const layers = Array.from(stage.querySelectorAll('.se-layer'))
        .sort((a, b) => {
            // Sort by vertical position (top)
            const aTop = parseFloat(a.style.top) || 0;
            const bTop = parseFloat(b.style.top) || 0;
            return aTop - bTop;
        });
    return layers.map(serializeStrip);
}

  // ================================
  //       INICIALIZACIÓN UI
  // ================================
  document.addEventListener('DOMContentLoaded', ()=>{
    if (DEBUG) console.info('[strips-atc] DOM listo');
    document.querySelectorAll('[data-ivao-strips-atc="1"]').forEach(initATCInstance);
  });

  function initATCInstance(root){
    if (DEBUG) console.info('[strips-atc] init instancia', root.id || root);

    // 1) Config / Endpoints / FRA desde data-attrs
    let cfg = {};
    let endpoints = {};
    let fraUrl = '';
	let lastRemoteUpdated = null; // ISO string del backend, p.ej. "2025-10-24T05:22:13Z"
    ivaoId = (root.getAttribute('data-ivao-id') || '').trim(); 

    try { cfg = JSON.parse(root.getAttribute('data-config')||'{}'); } catch(e){ cfg={}; }
    try { endpoints = JSON.parse(root.getAttribute('data-endpoints')||'{}'); } catch(e){ endpoints={}; }
    fraUrl = root.getAttribute('data-fra') || '';

    // fallback a IVAOPE si existiera
    if (!endpoints.atcActive && window.IVAOPE && IVAOPE.rest) endpoints = IVAOPE.rest;
    if (!fraUrl && window.IVAOPE && IVAOPE.fraUrl) fraUrl = IVAOPE.fraUrl;

    if (DEBUG) console.info('[strips-atc] endpoints=', endpoints);
    if (DEBUG) console.info('[strips-atc] fraUrl=', fraUrl, 'ivaoId=', ivaoId);

    // 2) Elementos de la instancia
    const stage      = root.querySelector('.se-stage');
    const elClock    = cfg.clockId ? document.getElementById(cfg.clockId) : null;
    const btnAddArr  = root.querySelector('.se-btn.add-arr');
    const btnAddDep  = root.querySelector('.se-btn.add-dep');	

    const transferStatus = root.querySelector('.se-transfer-status');
    const selectPos  = root.querySelector('.se-select');
    const metarBtn   = root.querySelector('.se-metar-btn');
    const metarInput = root.querySelector('.se-metar-input');
    const metarMsg   = root.querySelector('.se-metar-msg');
	// --- NUEVO: refs para presets y auto-refresh
    let btnPresetSave = null;
    let btnPresetLoad = null;
	let btnPresetDelete = null;
    let autoRefreshChk = null;
    let autoRefreshTimer = null;
    let autoRefreshOn = false;
	
	// Small loading indicator shown while a position is being loaded
    function showLoading(msg = 'Cargando…') {
      // create a single global loading element attached to body so it's centered in viewport
      let el = document.querySelector('.se-loading');
      if (!el) {
        el = document.createElement('div');
        el.className = 'se-loading';
        // center in viewport
        el.style.position = 'fixed';
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.background = 'rgba(0,0,0,0.75)';
        el.style.color = '#fff';
        el.style.padding = '8px 14px';
        el.style.borderRadius = '8px';
        el.style.fontSize = '14px';
        el.style.zIndex = 2147483647; // very top
        el.style.pointerEvents = 'none';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.display = '';
    }

    function hideLoading() {
      const el = document.querySelector('.se-loading');
      if (el) el.remove();
    }

    // Lista con todas las posiciones del FRA para el modal de transferencia
    let fraList = [];

	// === Botones de Preset (encima del reloj)
	if (endpoints.presets) {
	  const wrap = document.createElement('div');
	  wrap.style.display = 'flex';
	  wrap.style.justifyContent = 'center';   // <<< centrado horizontal
	  wrap.style.alignItems = 'center';       // <<< alineado vertical
	  wrap.style.gap = '8px';
	  wrap.style.marginBottom = '8px';

	  const btnSave = document.createElement('button');
	  btnSave.type='button';
	  btnSave.className='se-btn';
	  btnSave.textContent='Guardar Preset';

	  const btnLoad = document.createElement('button');
	  btnLoad.type='button';
	  btnLoad.className='se-btn';
	  btnLoad.textContent='Cargar Preset';
	  
	  const btnDel = document.createElement('button');
		btnDel.type='button';
		btnDel.className='se-btn';
		btnDel.textContent='Borrar Preset';
		btnPresetDelete = btnDel;
	  
	  // guardar refs globales para poder deshabilitar/rehabilitar
	  btnPresetSave = btnSave;
	  btnPresetLoad = btnLoad;

	  wrap.appendChild(btnSave);
	  wrap.appendChild(btnLoad);
	  wrap.appendChild(btnDel);

	  const horaBox = elClock.parentNode; // contenedor de “HORA:” + reloj
	  horaBox.parentNode.insertBefore(wrap, horaBox); // arriba de toda la línea

	  btnSave.addEventListener('click', onClickSavePreset);
	  btnLoad.addEventListener('click', onClickLoadPreset);
	  btnDel.addEventListener('click', onClickDeletePreset);
	}
	
	// === Crear botón "Liberar Posición" ===
	let btnRelease = document.getElementById('btnReleasePos');
	if (!btnRelease){
	  btnRelease = document.createElement('button');
	  btnRelease.id = 'btnReleasePos';
	  btnRelease.type = 'button';
	  btnRelease.className = 'btn btn--danger'; // usa tu clase que ya tengas (p.ej. btn, btn--secondary)
	  btnRelease.textContent = 'Liberar Posición';
	  btnRelease.style.display = 'none';
	}

	// Intentar insertarlo justo ANTES del botón "Agregar Llegada"
	(function placeReleaseButton(){
	  const btnAddArrival =
		document.querySelector('[data-action="add-arrival"]') ||
		Array.from(document.querySelectorAll('button'))
		  .find(b => (b.textContent||'').trim().toLowerCase() === 'agregar llegada');

	  if (btnAddArrival && btnAddArrival.parentNode) {
		btnAddArrival.parentNode.insertBefore(btnRelease, btnAddArrival);
	  } else {
		// fallback: mételo en el mismo contenedor de controles si lo tienes
		const controls = document.querySelector('.se-controls') || document.body;
		controls.appendChild(btnRelease);
	  }
	})();



	
    // 3) Reloj UTC
    if (elClock){
      const pad=n=>n<10?'0'+n:''+n;
      function tick(){
        const d=new Date();
        const hh=pad(d.getUTCHours()), mm=pad(d.getUTCMinutes()), ss=pad(d.getUTCSeconds());
        elClock.textContent = (cfg.showSeconds?`${hh}:${mm}:${ss}Z`:`${hh}:${mm}Z`);
        elClock.style.color = cfg.clockColor || elClock.style.color;
      }
      tick(); setInterval(tick, 1000);
      console.info('[strips-atc] reloj iniciado');
    } else {
      console.warn('[strips-atc] clock element no encontrado', cfg.clockId);
    }		


    // 4) Carga FRA en el select principal
    if (selectPos) loadFRA(selectPos, fraUrl);

    // 5) Habilitar UI al seleccionar Posición
	if (selectPos) {
	  selectPos.addEventListener('change', async ()=>{
		currentPos = String(selectPos.value||'').toUpperCase().trim();
		const posEnabled = !!currentPos;
		lastRemoteUpdated = null;
		
		// If user selected the default/empty option, do nothing (no loading, no side-effects)
        if (!posEnabled) {
          // clear board, keep UI inactive, stop saves/polling
          suppressSave = true;
          // remove all strips from the stage and reset layout
          if (stage) {
            stage.querySelectorAll('.se-layer').forEach(el=>el.remove());
            reflowAll(stage);
          }
          setUiEnabledForPos(false);
          setStageEditable(false);
          stopInboxPolling();
          hideLoading(); // ensure any leftover loader is hidden
          return;
        }
		
		// Show loading immediately when user selects a position
        showLoading();

		// Disable UI first
		setUiEnabledForPos(false);
		setStageEditable(false);

		if (posEnabled) {
		  // Check existing lock first
		  const lockStatus = await checkPosLock(endpoints, currentPos);
		  
		  if (lockStatus.locked) {
			toast(`Posición en uso por ${lockStatus.owner} - Modo solo lectura`, true);
			
			// Keep position selected but set read-only mode
			setUiEnabledForPos(true); // Enable UI elements
			setStageEditable(false);  // But keep strips non-editable
			
			// Load strips in read-only mode
			stage.querySelectorAll('.se-layer').forEach(el=>el.remove());
			reflowAll(stage);
			await loadStateForPos(endpoints, stage, addStrip, applyStripToLayer, currentPos);
			startInboxPolling(endpoints, currentPos);
			suppressSave = true; // Prevent any saves in read-only mode
			hideLoading();
			return;
		  }

		  // Position not locked - try to acquire lock
		  try {
			const lockRes = await writePosLock(endpoints, currentPos, ivaoId);
			if (!lockRes.ok) {
			  console.warn('[poslock] fallo creando lock', lockRes);
			  toast('No se pudo obtener el lock de posición', true);
			   hideLoading();
			  return;
			}
			
			// Lock acquired successfully - enable full editing
			console.info('[poslock] lock creado para', currentPos, 'owner=', ivaoId);
			setUiEnabledForPos(true);
			setStageEditable(true);
			
			// Load state and start polling
			stage.querySelectorAll('.se-layer').forEach(el=>el.remove());
			reflowAll(stage);
			await loadStateForPos(endpoints, stage, addStrip, applyStripToLayer, currentPos);
			startInboxPolling(endpoints, currentPos);
			suppressSave = false;
			 hideLoading();
		  } catch(e) {
			console.warn('[poslock] error creando lock:', e?.message || e);
			toast('Error creando el lock de posición', true);
			 hideLoading();
			return;
		  }
		} else {
		  suppressSave = true;
		   hideLoading();
		}
	  });
	}


    
    // 6) Botones crear strips
	 if (btnAddArr) btnAddArr.addEventListener('click', ()=> { addStrip('arr'); reflowAll(stage); saveNow(endpoints, stage); });
	 if (btnAddDep) btnAddDep.addEventListener('click', ()=> { addStrip('dep'); reflowAll(stage); saveNow(endpoints, stage); });

	
    // 7) METAR
    function normICAO(v){ return (v||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4); }
    async function fetchMetar(icao){
      const endpoint = endpoints.metar || '';
      if (!endpoint){ console.warn('[strips-atc] sin endpoint metar'); return; }
      if (metarMsg) { metarMsg.classList.remove('is-error'); metarMsg.classList.add('is-loading'); metarMsg.textContent = `Consultando ${icao}…`; }
      try{
        const res = await fetch(`${endpoint}?icao=${encodeURIComponent(icao)}`, {credentials:'same-origin'});
        const txt = await res.text();
        if(!res.ok){ if (metarMsg){ metarMsg.classList.add('is-error'); metarMsg.textContent = txt || `Error obteniendo METAR de ${icao}.`; } return; }
        if (metarMsg) metarMsg.textContent = (txt||'').trim();
      }catch(e){
        if (metarMsg){ metarMsg.classList.add('is-error'); metarMsg.textContent = `Error: ${e && e.message || e}`; }
      }finally{ if (metarMsg) metarMsg.classList.remove('is-loading'); }
    }
    if (metarInput) metarInput.addEventListener('input', ()=>{ metarInput.value = normICAO(metarInput.value); });
    if (metarInput && metarBtn) {
      metarBtn.addEventListener('click', ()=>{
        const icao = normICAO(metarInput.value);
        if (icao.length!==4){ if (metarMsg){ metarMsg.classList.add('is-error'); metarMsg.textContent='Introduce ICAO (4 letras).'; } return; }
        fetchMetar(icao);
      });
    }

    // ================================
    //         FUNCIONES UI
    // ================================
    async function loadFRA(selectEl, url){
      try{
        if (!url) throw new Error('fraUrl vacío');
        const res = await fetch(url, {cache:'no-store'});
        if (!res.ok) throw new Error('HTTP '+res.status);
        const txt = await res.text();
        const lines = txt.split(/\r?\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('#'));
        fraList = lines.slice(); // <<< guardamos toda la lista para el modal

        const frag = document.createDocumentFragment();
        lines.forEach(line=>{
          const opt = document.createElement('option');
          opt.value=line; opt.textContent=line;
          frag.appendChild(opt);
        });
        selectEl.appendChild(frag);
        if (DEBUG) console.info('[strips-atc] FRA cargado', lines.length, 'posiciones');
      }catch(e){
        console.error('[strips-atc] Error cargando FRAs.txt:', e);
      }
    }

    function addStrip(type, opts){
	  const layer = createStrip(
		stage, type, cfg, true, onTransferClick,
		()=> saveNow(endpoints, stage),
		endpoints  // Pass endpoints here
	  );

	  // Guardado cuando edites contenidos
	  layer.addEventListener('input', ()=>{ saveNow(endpoints, stage); });

	  // Colocación: arriba si se pide, si no, al final (comportamiento actual)
	  if (opts && opts.atTop){
		layer.style.top = '0px';
		placeLayerAtTop(stage, layer);
	  } else {
		reflowAll(stage);
	  }
	  return layer;
	}


    async function onTransferClick(layer){
      // Destinos = TODAS las posiciones del FRA (menos la actual si existe)
      const origen = currentPos || '';
      const destinos = fraList.filter(cs => cs && cs.toUpperCase().trim() !== origen);

      if (!Array.isArray(destinos) || destinos.length === 0){
        if (transferStatus){
          transferStatus.style.color = '#b00020';
          transferStatus.textContent = 'No hay destinos disponibles (FRA vacío).';
          setTimeout(()=> transferStatus.textContent = '', 3000);
        }
        return;
      }

      openTransferModal({
        origen,
        destinos,
        onSubmit: async (to)=>{
          const url = endpoints.atcMessage || '';
          if (!url){
            if (transferStatus){ transferStatus.style.color='#b00020'; transferStatus.textContent='Endpoint de mensajes no configurado'; }
            return;
          }

          const payload = serializeStrip(layer);
          try{
            if (transferStatus){ transferStatus.style.color='#222'; transferStatus.textContent='Transfiriendo…'; }
            const res = await fetch(url, {
              method:'POST', credentials:'same-origin',
              headers:{ 'Content-Type':'application/json' },
              body: JSON.stringify({ to, payload })
            });
            if (!res.ok){
              const t = await res.text();
              if (transferStatus){ transferStatus.style.color='#b00020'; transferStatus.textContent = `Error ${res.status}: ${t||''}`; }
              return;
            }
            if (transferStatus){
              transferStatus.style.color='#007700';
              transferStatus.textContent = `Enviado a ${to} ✅`;
              setTimeout(()=> transferStatus.textContent='', 3000);
            }

            // Quita el strip y reordena para evitar solapados
            layer.remove();
            reflowAll(stage);
            // Guarda tras transferencia
            saveSessionState(endpoints, stage, currentPos);
          }catch(e){
            if (transferStatus){ transferStatus.style.color='#b00020'; transferStatus.textContent = `Error de red: ${e && e.message || e}`; }
          }
        }
      });
    }

    // Modal de transferencia (destinos vienen del FRA)
    function openTransferModal({ origen, destinos, onSubmit }){
      // Backdrop
      const bd = document.createElement('div');
      bd.className = 'se-modal-backdrop';

      // Caja
      const box = document.createElement('div');
      box.className = 'se-modal';
      box.innerHTML = `
        <h3>Transferir strip</h3>
        <p><strong>Origen:</strong> <code>${origen || '—'}</code></p>
        <div class="fld">
          <label for="se-transfer-select">Destino</label>
          <select id="se-transfer-select" autocomplete="off"></select>
        </div>
        <div class="hint">Lista completa de posiciones (FRAs). No se filtra por activos.</div>
        <div class="actions">
          <button type="button" class="se-btn se-btn--ghost">Cancelar</button>
          <button type="button" class="se-btn se-btn--ok">Transferir</button>
        </div>
      `;
      bd.appendChild(box);

      // Opciones
      const sel = box.querySelector('#se-transfer-select');
      destinos.forEach(cs=>{
        const opt = document.createElement('option');
        opt.value = cs; opt.textContent = cs;
        sel.appendChild(opt);
      });

      const btnCancel = box.querySelector('.se-btn--ghost');
      const btnOk     = box.querySelector('.se-btn--ok');

      function close(){
        document.removeEventListener('keydown', onKey);
        bd.remove();
      }
      function onKey(e){
        if (e.key === 'Escape'){ e.preventDefault(); close(); }
        if (e.key === 'Enter'){ e.preventDefault(); btnOk.click(); }
      }

      btnCancel.addEventListener('click', close);
      btnOk.addEventListener('click', ()=>{
        const to = String(sel.value || '').toUpperCase().trim();
        if (!to){ sel.focus(); return; }
        close();
        onSubmit && onSubmit(to);
      });

      document.addEventListener('keydown', onKey);
      document.body.appendChild(bd);
      sel.focus();
    }

    // ================================
    //   Persistencia por <pos>.save
    // ================================
    let _loadedFromSaveOnce = false;
	


			
		async function loadStateForPos(endpoints, stage, addStrip, applyStripToLayer, pos) {
		  if (!pos) return {changed:false, updated:null};

		  const base = (endpoints && endpoints.stripsave) || '/wp-json/ivaope/v1/stripsave';
		  const url = `${base}?pos=${encodeURIComponent(pos)}&only=1`;

		  try {
			if (DEBUG) console.info('[strips-atc] loading state for', pos, 'from', url);
			
			const r = await fetch(url, { 
			  credentials:'same-origin', 
			  cache:'no-store'
			});

			// Log raw response for debugging
			const rawText = await r.text();
			if (DEBUG) console.debug('[strips-atc] raw response:', rawText.substring(0, 500)); // First 500 chars only

			if (!r.ok) { 
			  console.warn('[strips-atc] loadStateForPos HTTP', r.status); 
			  return {changed:false, updated:null}; 
			}

			// Try to parse as JSON
			let data;
			try {
			  data = JSON.parse(rawText);
			} catch(e) {
			  console.error('[strips-atc] Failed to parse response as JSON:', {
				error: e,
				responseStart: rawText.substring(0, 100),
				contentType: r.headers.get('content-type')
			  });
			  return {changed:false, updated:null};
			}

			// updated viene del backend (rest-stripsave.php -> filemtime)
			const updated = (data && data.updated) ? String(data.updated) : null;

			// Si la marca no ha cambiado, no recargues nada
			if (updated && lastRemoteUpdated && updated === lastRemoteUpdated){
			  // console.debug('[strips-atc] sin cambios en', pos, updated);
			  return {changed:false, updated};
			}

			// Normalización ultra tolerante
			let list = [];
			if (Array.isArray(data)) list = data;
			else if (data && Array.isArray(data.strips)) list = data.strips;
			else if (data && Array.isArray(data.files)) {
			  const hit = data.files.find(f => String(f.name) === `${pos}.save`);
			  if (hit) {
				if (Array.isArray(hit.strips)) list = hit.strips;
				else if (typeof hit.content === 'string') {
				  try { list = JSON.parse(hit.content).strips || []; } catch(e){}
				}
			  }
			}

			// Reconstruir solo si hay cambio (o desconocemos updated)
			// Limpia y repinta (aunque la lista venga vacía: también es un cambio real)
			stage.querySelectorAll('.se-layer').forEach(el=>el.remove());
			if (Array.isArray(list) && list.length){
			  list.forEach(rec=>{
				const layer = addStrip(rec.type==='dep'?'dep':'arr');
				applyStripToLayer(layer, rec);
			  });
			}
			reflowAll(stage);

			// Actualiza firma remota
			if (updated) lastRemoteUpdated = updated;

			const n = Array.isArray(list) ? list.length : 0;
			if (DEBUG) console.info(`[strips-atc] ${n} strips cargados desde ${pos}.save ${updated?('('+updated+')'):''}`);
			return {changed:true, updated: updated || null};
		  }catch(e){
			if (DEBUG) console.warn('[strips-atc] loadStateForPos error:', e && e.message || e);
			return {changed:false, updated:null};
		  }
		}



    // 1ª carga de la última sesión al cargar la página (no esperar a elegir posición)
    //loadSessionStateOnce(endpoints, stage, addStrip, applyStripToLayer, ivaoId);

    // Guardar al cerrar/ocultar
	window.addEventListener('beforeunload', ()=>{ saveNow(endpoints, stage); });
	document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState === 'hidden') saveNow(endpoints, stage); });

    // ================================
    //     Polling “inbox” de posición
    // ================================
    // Modify startInboxPolling function to include lock checking
	function startInboxPolling(eps, pos) {
	  stopInboxPolling();
	  if (DEBUG) console.info('[strips-atc] inbox polling ON para', pos);
	  
	  inboxTimer = setInterval(async () => {
		if (!pos) return;
		
		// Debug log to verify polling is active
		if (DEBUG) console.debug('[strips-atc] polling cycle start');
		
		// Check if we're in read-only mode
		const isReadOnly = stage.getAttribute('aria-disabled') === 'true';
		if (DEBUG) console.debug('[strips-atc] read-only mode:', isReadOnly);
		
		if (isReadOnly) {
		  const lockStatus = await checkPosLock(eps, pos);
		  if (DEBUG) console.debug('[strips-atc] lock check result:', {
			pos,
			locked: lockStatus.locked,
			owner: lockStatus.owner,
			age: lockStatus.age,
			currentUser: ivaoId
		  });
		  
		  // Position is no longer locked - try to acquire it
		  if (!lockStatus.locked) {
			if (DEBUG) console.info('[strips-atc] position available, attempting to acquire lock');
			try {
			  const lockRes = await writePosLock(eps, pos, ivaoId);
			  if (lockRes.ok) {
				if (DEBUG) console.info('[strips-atc] successfully acquired lock during polling');
				toast('Control de posición adquirido ✅');
				
				// Enable editing
				setUiEnabledForPos(true);
				setStageEditable(true);
				suppressSave = false;
			  } else {
				if (DEBUG) console.warn('[strips-atc] failed to acquire lock:', lockRes);
			  }
			} catch(e) {
			  if (DEBUG) console.warn('[strips-atc] error acquiring lock:', e);
			}
		  }
		   lastRemoteUpdated = null;
			await loadStateForPos(eps, stage, addStrip, applyStripToLayer, pos);
		}

		// Continue with regular inbox polling
		const url = eps.atcMessage || '';
		if (!url) return;
		
		try {
		  // Check for incoming messages
		  const res = await fetch(`${url}?pos=${encodeURIComponent(pos)}`, {
			credentials: 'same-origin', 
			cache: 'no-store'
		  });
		  
		  if (!res.ok) return;
		  const data = await res.json();
		  const msgs = (data && Array.isArray(data.messages)) ? data.messages : [];
		  if (msgs.length === 0) return;

		  // Process messages as before...
		  msgs.forEach(msg => {
			// Single strip transfer
			if (msg.type || msg.callsign) {
				const layer = addStrip(msg.type === 'dep' ? 'dep' : 'arr', { atTop: true });
				applyStripToLayer(layer, msg);
			}
			// Multiple strips (preset transfer)
			else if (Array.isArray(msg.strips)) {
				msg.strips.forEach(st => {
				const layer = addStrip(st.type === 'dep' ? 'dep' : 'arr', { atTop: true });
				applyStripToLayer(layer, st);
				});
			}
			});

			if (msgs.length > 0) {
			console.log(`[ATC-Msg] ${msgs.length} mensaje(s) recibido(s) para ${pos}`);
			toast(`${msgs.length} strip(s) recibidos ✅`);
			}
		  
		  saveNow(eps, stage);

		} catch(e) {
		  console.warn('[strips-atc] inbox poll error:', e);
		}
	  }, INBOX_POLL_MS);
	}

    function stopInboxPolling(){
      if (inboxTimer){ clearInterval(inboxTimer); inboxTimer=null; if (DEBUG) console.info('[strips-atc] inbox polling OFF'); }
    }
	
	async function onClickSavePreset(){
	  if (!currentPos){ toast('Elige una posición antes de guardar un preset', true); return; }
	  const scope = derivePresetScope(currentPos);
	  const def = ivaoId ? `preset_${ivaoId}` : 'preset';

	  // modal con pista de dónde se guardará
	  openPresetSaveModal(def, async (name)=>{
		const strips = collectAllStrips(stage);
		try{
		  const res = await fetch(`${endpoints.presets}`, {
			method:'POST',
			credentials:'same-origin',
			headers:{ 'Content-Type':'application/json' },
			body: JSON.stringify({ name, strips, scope })  // <-- scope incluido
		  });
		  if (!res.ok){
			const t = await res.text();
			toast(`Error guardando: ${t||res.status}`, true);
			return;
		  }
		  const data = await res.json();
		  toast(`Preset guardado: ${data.file} (${data.count} strips)`);
		}catch(e){
		  toast(`Error de red guardando: ${e && e.message || e}`, true);
		}
	  }, /*hintOverride:*/ `Se guardará en stripsaves/presets/${scope}/ como <em>nombre</em>.preset.json`);
	}


	async function onClickLoadPreset(){
	  if (!currentPos){ toast('Elige una posición antes de cargar presets', true); return; }
	  const scope = derivePresetScope(currentPos);
	  try{
		const r = await fetch(`${endpoints.presets}?op=list&scope=${encodeURIComponent(scope)}`, {
		  credentials:'same-origin', cache:'no-store'
		});
		if (!r.ok){ toast('Error listando presets', true); return; }
		const data = await r.json();
		const files = (data && data.files) || [];
		if (!files.length){ toast(`No hay presets en ${scope} todavía`); return; }

		openPresetLoadModal(files, async (choice)=>{
		  // Cargar contenido del preset elegido
		  const scope = derivePresetScope(currentPos);
		  const base = `${endpoints.presets}`;
		  const basename = choice.replace(/\.preset\.json$/i, '').replace(/\.json$/i, '');

		  // Intentos tolerantes (similar filosofía al delete)
		  async function tryLoad(){
			// A) GET ?op=get&scope=&name=full
			{
			  const url = `${base}?op=load&scope=${encodeURIComponent(scope)}&name=${encodeURIComponent(choice)}`;
			  const r = await fetch(url, { credentials:'same-origin', cache:'no-store' });
			  if (r.ok) return r;
			}
			// B) GET ?op=get&scope=&preset=full
			{
			  const url = `${base}?op=load&scope=${encodeURIComponent(scope)}&preset=${encodeURIComponent(choice)}`;
			  const r = await fetch(url, { credentials:'same-origin', cache:'no-store' });
			  if (r.ok) return r;
			}
			// C) GET ?op=get&scope=&preset=basename
			{
			  const url = `${base}?op=load&scope=${encodeURIComponent(scope)}&preset=${encodeURIComponent(basename)}`;
			  const r = await fetch(url, { credentials:'same-origin', cache:'no-store' });
			  if (r.ok) return r;
			}
			// D) POST JSON {op:'get', scope, name}
			{
			  const r = await fetch(base, {
				method:'POST', credentials:'same-origin',
				headers:{ 'Content-Type':'application/json' },
				body: JSON.stringify({ op:'load', scope, name: choice })
			  });
			  if (r.ok) return r;
			}
			return null;
		  }

		  const rr = await tryLoad();
		  if (!rr){ toast('Error cargando preset', true); return; }

		  // El backend puede devolver {strips:[...]}, o el JSON del fichero
		  const raw = await rr.text();
		  let obj = null;
		  try { obj = JSON.parse(raw); } catch(_){}
		  const list =
			(obj && Array.isArray(obj.strips)) ? obj.strips :
			(obj && obj.content && Array.isArray(obj.content.strips)) ? obj.content.strips :
			(obj && typeof obj.content==='string' ? (()=>{
				try { const tmp = JSON.parse(obj.content); return Array.isArray(tmp.strips)?tmp.strips:[]; } catch(_){ return []; }
			 })() : []);

		  if (!Array.isArray(list) || !list.length){ toast('Preset vacío'); return; }

		  list.forEach(rec=>{
			const layer = addStrip(rec.type==='dep'?'dep':'arr');
			applyStripToLayer(layer, rec);
		  });
		  reflowAll(stage);
		  if (typeof saveSessionState === 'function') saveSessionState(endpoints, stage, currentPos);
		  toast(`Preset "${choice}" cargado (${list.length})`);
		});

	  }catch(e){
		toast(`Error de red listando/cargando: ${e && e.message || e}`, true);
	  }
	}
	
		// --- Helpers comunes para presets ---
	async function safeRead(resp){
	  const t = await resp.text().catch(()=>null);
	  try { return t ? JSON.stringify(JSON.parse(t)) : ''; } catch(_){ return t || ''; }
	}

	async function tryDeletePreset(endpoints, scope, fullName){
	  const base = `${endpoints.presets}`;
	  // Asegura sufijo .preset.json
	  const name = /\.preset\.json$/i.test(fullName) ? fullName : (fullName + '.preset.json');

	  const r = await fetch(base, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ op: 'delete', scope, name }) // <-- usar 'name', no 'choice'
	  });

	  const body = await (async ()=>{ try{ return await r.text(); }catch(_){ return ''; } })();
	  if (!r.ok){
		console.warn('[presets.delete] fail', r.status, body);
		return { ok:false, error: body || String(r.status) };
	  }
	  return { ok:true, variant:'POST-JSON', body };
	}



	
	async function onClickDeletePreset(){
	  if (!currentPos){ toast('Elige una posición antes de borrar presets', true); return; }
	  const scope = derivePresetScope(currentPos);

	  try{
		// 1) Listar presets disponibles del scope actual
		const r = await fetch(`${endpoints.presets}?op=list&scope=${encodeURIComponent(scope)}`, {
		  credentials:'same-origin', cache:'no-store'
		});
		if (!r.ok){ toast('Error listando presets', true); return; }
		const data = await r.json();
		const files = (data && data.files) || [];
		if (!files.length){ toast(`No hay presets en ${scope} todavía`); return; }

		// 2) Abrir modal de borrado y pedir confirmación
		openPresetDeleteModal(files, async (choice)=>{
		  const { ok, variant, body, error } = await tryDeletePreset(endpoints, scope, choice);
			if (!ok){
			  toast(`No se pudo borrar. Revisa consola.`, true);
			  console.error('[presets.delete] all attempts failed:', error);
			  return;
			}
			console.info('[presets.delete] OK via', variant, body);
			toast(`Preset "${choice}" borrado ✅`);

		});

	  }catch(e){
		toast(`Error de red: ${e && e.message || e}`, true);
	  }
	}



	function openPresetSaveModal(defaultName, onSubmit, hintOverride){
	  const bd = document.createElement('div'); bd.className='se-modal-backdrop';
	  const box = document.createElement('div'); box.className='se-modal';
	  box.innerHTML = `
		<h3>Guardar preset</h3>
		<div class="fld">
		  <label for="se-preset-name">Nombre</label>
		  <input id="se-preset-name" type="text" class="se-input" autocomplete="off" />
		  <div class="hint">${hintOverride || 'Se guardará en <code>stripsaves/presets/</code> como <em>nombre</em>.preset.json'}</div>
		</div>
		<div class="actions">
		  <button type="button" class="se-btn se-btn--ghost">Cancelar</button>
		  <button type="button" class="se-btn se-btn--ok">Guardar</button>
		</div>
	  `;
	  bd.appendChild(box);

	  const inp = box.querySelector('#se-preset-name');
	  const btnCancel = box.querySelector('.se-btn--ghost');
	  const btnOk     = box.querySelector('.se-btn--ok');

	  function close(){ document.removeEventListener('keydown', onKey); bd.remove(); }
	  function onKey(e){ if (e.key==='Escape'){ e.preventDefault(); close(); }
						 if (e.key==='Enter'){ e.preventDefault(); btnOk.click(); } }

	  btnCancel.addEventListener('click', close);
	  btnOk.addEventListener('click', ()=>{
		const name = (inp.value||'').trim();
		if (!name){ inp.focus(); return; }
		close();
		onSubmit && onSubmit(name);
	  });

	  document.addEventListener('keydown', onKey);
	  document.body.appendChild(bd);
	  inp.value = defaultName || '';
	  inp.focus(); inp.select();
	}

	function openPresetLoadModal(files, onSubmit){
	  const bd = document.createElement('div'); bd.className='se-modal-backdrop';
	  const box = document.createElement('div'); box.className='se-modal';
	  box.innerHTML = `
		<h3>Cargar preset</h3>
		<div class="fld">
		  <label for="se-preset-select">Selecciona un preset</label>
		  <select id="se-preset-select" class="se-select"></select>
		</div>
		<div class="hint">Se cargarán en pantalla (no se borra el preset original).</div>
		<div class="actions">
		  <button type="button" class="se-btn se-btn--ghost">Cancelar</button>
		  <button type="button" class="se-btn se-btn--ok">Cargar</button>
		</div>
	  `;
	  bd.appendChild(box);

	  const sel = box.querySelector('#se-preset-select');
	  files.forEach(f=>{
		const opt = document.createElement('option');
		opt.value = f.name;
		const when = f.mtime ? ` — ${new Date(f.mtime*1000).toISOString().slice(0,19).replace('T',' ')}` : '';
		opt.textContent = f.name + when;
		sel.appendChild(opt);
	  });

	  const btnCancel = box.querySelector('.se-btn--ghost');
	  const btnOk     = box.querySelector('.se-btn--ok');

	  function close(){ document.removeEventListener('keydown', onKey); bd.remove(); }
	  function onKey(e){ if (e.key==='Escape'){ e.preventDefault(); close(); }
						 if (e.key==='Enter'){ e.preventDefault(); btnOk.click(); } }

	  btnCancel.addEventListener('click', close);
	  btnOk.addEventListener('click', ()=>{
		const choice = String(sel.value||'').trim();
		if (!choice){ sel.focus(); return; }
		close();
		onSubmit && onSubmit(choice);
	  });

	  document.addEventListener('keydown', onKey);
	  document.body.appendChild(bd);
	  sel.focus();
	}
	
	function openPresetDeleteModal(files, onSubmit){
	  const bd = document.createElement('div'); bd.className='se-modal-backdrop';
	  const box = document.createElement('div'); box.className='se-modal';
	  box.innerHTML = `
		<h3>Borrar preset</h3>
		<div class="fld">
		  <label for="se-preset-del">Selecciona un preset</label>
		  <select id="se-preset-del" class="se-select"></select>
		</div>
		<p class="hint">Esta acción elimina el fichero del servidor. No se puede deshacer.</p>
		<div class="actions">
		  <button type="button" class="se-btn se-btn--ghost">Cancelar</button>
		  <button type="button" class="se-btn se-btn--ok">Borrar</button>
		</div>
	  `;
	  bd.appendChild(box);

	  const sel = box.querySelector('#se-preset-del');
	  files.forEach(f=>{
		const opt = document.createElement('option');
		opt.value = f.name;
		const when = f.mtime ? ` — ${new Date(f.mtime*1000).toISOString().slice(0,19).replace('T',' ')}` : '';
		opt.textContent = f.name + when;
		sel.appendChild(opt);
	  });

	  const btnCancel = box.querySelector('.se-btn--ghost');
	  const btnOk     = box.querySelector('.se-btn--ok');

	  function close(){ document.removeEventListener('keydown', onKey); bd.remove(); }
	  function onKey(e){
		if (e.key==='Escape'){ e.preventDefault(); close(); }
		if (e.key==='Enter'){ e.preventDefault(); btnOk.click(); }
	  }

	  btnCancel.addEventListener('click', close);
	  btnOk.addEventListener('click', ()=>{
		const choice = String(sel.value||'').trim();
		if (!choice){ sel.focus(); return; }
		// Confirmación extra
		const sure = confirm(`¿Seguro que quieres borrar "${choice}"?`);
		if (!sure) return;
		close();
		onSubmit && onSubmit(choice);
	  });

	  document.addEventListener('keydown', onKey);
	  document.body.appendChild(bd);
	  sel.focus();
	}

	
	function setUiEnabledForPos(enabled){
      // habilita/inhabilita por selección de posición
      if (btnAddArr) btnAddArr.disabled = !enabled || autoRefreshOn;
      if (btnAddDep) btnAddDep.disabled = !enabled || autoRefreshOn;
      if (metarBtn)  metarBtn.disabled  = !enabled; // el METAR no se bloquea por auto-refresh
      if (btnPresetSave) btnPresetSave.disabled = !enabled || autoRefreshOn;
      if (btnPresetLoad) btnPresetLoad.disabled = !enabled || autoRefreshOn;
	  if (btnPresetDelete) btnPresetDelete.disabled = !enabled || autoRefreshOn;
		if (btnRelease) btnRelease.style.display = enabled ? '' : 'none';

      // stage.setAttribute('aria-disabled', enabled && !autoRefreshOn ? 'false' : 'true');
      // stage.style.opacity = (enabled && !autoRefreshOn) ? '' : '.5';
      // stage.style.pointerEvents = (enabled && !autoRefreshOn) ? '' : 'none';

      if (autoRefreshChk) autoRefreshChk.disabled = !enabled;
    }

    async function startAutoRefresh(){
      if (!currentPos) return;
      stopAutoRefresh();           // limpia por si acaso
      autoRefreshOn = true;
      //suppressSave = true;         // no guardar mientras refresca
      stopInboxPolling();          // evita carrera con el inbox
      setUiEnabledForPos(true);    // reevalúa con autoRefreshOn=true (bloquea edición/botones)
	  // primera sincronización (actualiza lastRemoteUpdated)
		loadStateForPos(endpoints, stage, addStrip, applyStripToLayer, currentPos);
      const {changed} = await loadStateForPos(endpoints, stage, addStrip, applyStripToLayer, currentPos);
   autoRefreshTimer = setInterval(async ()=>{
    const {changed} = await loadStateForPos(endpoints, stage, addStrip, applyStripToLayer, currentPos);
    // Si en el futuro habilitas edición “en caliente”, aquí podrías
    // hacer un merge en vez de reemplazo completo cuando !changed.
  }, INBOX_POLL_MS);
      console.info('[strips-atc] auto-refresh ON para', currentPos);
    }

    function stopAutoRefresh(){
      if (autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
      if (autoRefreshOn){
        autoRefreshOn = false;
        suppressSave = false;
        setUiEnabledForPos(!!currentPos);  // reactivar edición y botones
        if (currentPos) startInboxPolling(endpoints, currentPos);
        console.info('[strips-atc] auto-refresh OFF');
      }
    }
	
	// === Helper nuevo: derivar scope a partir de la posición actual
	function derivePresetScope(pos){
	  const p = String(pos||'').trim();
	  if (!p) return 'GLOBAL';              // fallback si no hay posición seleccionada
	  const i = p.indexOf('_');
	  return (i > 0) ? p.slice(0, i) : p;   // SPJC_APP -> SPJC ; ATC1 -> ATC1
	}
	
	async function writePosLock(eps, pos, ownerId) {
	  const base = (eps && (eps.poslock || eps.posLock || eps.lock)) || '/wp-json/ivaope/v1/poslock';
	  const posStr   = String(pos || '').toUpperCase().trim();
	  const ownerStr = String(ownerId || '').trim();

	  if (DEBUG) console.info('[poslock] intento crear lock', { base, pos: posStr, owner: ownerStr, method: 'PUT' });

	  if (!posStr || !ownerStr) {
		throw new Error(`pos/owner vacíos: pos='${posStr}' owner='${ownerStr}'`);
	  }

	  async function parseRes(res) {
		  try {
			const text = await res.text();
			try {
			  // Look for JSON content at the end of response
			  const jsonStart = text.lastIndexOf('{');
			  const jsonEnd = text.lastIndexOf('}');
			  
			  if (jsonStart >= 0 && jsonEnd > jsonStart) {
				// Extract just the JSON part
				const jsonText = text.substring(jsonStart, jsonEnd + 1);
				console.debug('[poslock] extracted JSON:', jsonText);
				return { ...JSON.parse(jsonText), bodyText: text };
			  }
			  
			  // If no JSON found, return the full text
			  return { bodyText: text };
			} catch(e) {
			  console.warn('[poslock] failed to parse JSON response:', text);
			  return { bodyText: text };
			}
		  } catch(e) {
			console.error('[poslock] failed to read response:', e);
			return { error: e?.message || 'Failed to read response' };
		  }
		}

	  // 1) PUT JSON
	  try{
		const r = await fetch(base, {
		  method: 'PUT',
		  credentials: 'same-origin',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({ pos: posStr, owner: ownerStr })
		});
		const pr = await parseRes(r);
		if (pr.ok) return { ok:true, via:'PUT-JSON', res: pr.body || pr.bodyText };
		if (DEBUG) console.warn('[poslock] PUT-JSON falló', pr);
		// Si el hosting bloquea PUT (405/400/403 típicos), probamos POST:
	  }catch(e){
		if (DEBUG) console.warn('[poslock] PUT-JSON exception', e);
	  }

	  // 2) POST JSON
	  try{
		const r = await fetch(base, {
		  method: 'POST',
		  credentials: 'same-origin',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({ op: 'lock', pos: posStr, owner: ownerStr })
		});
		const pr = await parseRes(r);
		if (pr.ok) return { ok:true, via:'POST-JSON', res: pr.body || pr.bodyText };
		if (DEBUG) console.warn('[poslock] POST-JSON falló', pr);
	  }catch(e){
		if (DEBUG) console.warn('[poslock] POST-JSON exception', e);
	  }

	  // 3) POST FORM
	  try{
		const r = await fetch(base, {
		  method: 'POST',
		  credentials: 'same-origin',
		  headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
		  body: new URLSearchParams({ op:'lock', pos: posStr, owner: ownerStr }).toString()
		});
		const pr = await parseRes(r);
		if (pr.ok) return { ok:true, via:'POST-FORM', res: pr.body || pr.bodyText };
		if (DEBUG) console.warn('[poslock] POST-FORM falló', pr);
		throw new Error(`poslock fallo: status=${pr.status} body=${pr.bodyText||'(vacío)'}`);
	  }catch(e){
		if (DEBUG) console.warn('[poslock] POST-FORM exception', e);
		throw e;
	  }
	}
	
	// === UNLOCK: borrar POSICION.lock ===
	async function releasePosLock(eps, pos){
	  const base   = (eps && (eps.poslock || eps.posLock || eps.lock)) || '/wp-json/ivaope/v1/poslock';
	  const posStr = String(pos||'').toUpperCase().trim();
	  if (!posStr) throw new Error('releasePosLock: pos vacío');

	  // Utilidad para parsear respuesta (JSON o texto)
	  async function parseRes(res){
		let bodyText = '';
		try { bodyText = await res.text(); } catch(_){}
		let body = null;
		try { body = bodyText ? JSON.parse(bodyText) : null; } catch(_){}
		return { ok: res.ok, status: res.status, bodyText, body };
	  }

	  // 1) DELETE con querystring (WP REST acepta ?pos=..)
	  try{
		const r  = await fetch(`${base}?pos=${encodeURIComponent(posStr)}`, {
		  method: 'DELETE',
		  credentials: 'same-origin',
		  cache: 'no-store'
		});
		const pr = await parseRes(r);
		if (pr.ok) return { ok:true, via:'DELETE', res:pr.body||pr.bodyText };
	  }catch(e){ console.warn('[poslock] DELETE exception', e); }

	  // 2) POST JSON op=unlock
	  try{
		const r  = await fetch(base, {
		  method: 'POST',
		  credentials: 'same-origin',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({ op:'unlock', pos: posStr })
		});
		const pr = await parseRes(r);
		if (pr.ok) return { ok:true, via:'POST-JSON', res:pr.body||pr.bodyText };
	  }catch(e){ console.warn('[poslock] POST-JSON unlock exception', e); }

	  // 3) POST form op=unlock
	  const body = new URLSearchParams({ op:'unlock', pos: posStr }).toString();
	  const r  = await fetch(base, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
		body
	  });
	  const pr = await parseRes(r);
	  if (pr.ok) return { ok:true, via:'POST-FORM', res:pr.body||pr.bodyText };
	  throw new Error(`releasePosLock fallo: status=${pr.status} body=${pr.bodyText||'(vacío)'}`);
	}
	
	function setStageEditable(editable){
	  // Stage clickable / no-clickable
	  stage.style.pointerEvents = editable ? '' : 'none';
	  stage.style.opacity = editable ? '' : '.5';
	  stage.setAttribute('aria-disabled', editable ? 'false' : 'true');

	  // Show/hide all control buttons based on edit rights
	  if (btnRelease) {
		btnRelease.style.display = editable ? '' : 'none';
	  }
	  if (btnPresetSave) {
		btnPresetSave.style.display = editable ? '' : 'none';
	  }
	  if (btnPresetLoad) {
		btnPresetLoad.style.display = editable ? '' : 'none';
	  }
	  if (btnPresetDelete) {
		btnPresetDelete.style.display = editable ? '' : 'none';
	  }
	  if (btnAddArr) {
		btnAddArr.style.display = editable ? '' : 'none';
	  }
	  if (btnAddDep) {
		btnAddDep.style.display = editable ? '' : 'none';
	  }

	  // Notes editable or not (deep defense)
	  stage.querySelectorAll('.se-note').forEach(n => {
		n.contentEditable = editable ? 'true' : 'false';
	  });
	}
	
	async function checkPosLock(eps, pos) {
	  const base = (eps && (eps.poslock || eps.posLock || eps.lock)) || '/wp-json/ivaope/v1/poslock';
	  const posStr = String(pos || '').toUpperCase().trim();
	  
	  if (DEBUG) console.info('[poslock] checking lock status for', posStr);
	  
	  if (!posStr) {
		if (DEBUG) console.warn('[poslock] no position specified');
		return { locked: false, error: 'No position specified' };
	  }

	  async function parseRes(res) {
		try {
		  const text = await res.text();
		  try {
			return { ...JSON.parse(text), bodyText: text };
		  } catch(_) {
			if (DEBUG) console.warn('[poslock] failed to parse JSON response:', text);
			return { bodyText: text };
		  }
		} catch(e) {
		  console.error('[poslock] failed to read response:', e);
		  return { error: e?.message || 'Failed to read response' };
		}
	  }

	  try {
		const url = `${base}?pos=${encodeURIComponent(posStr)}`;
		if (DEBUG) console.info('[poslock] fetching', url);
		
		const r = await fetch(url, {
		  credentials: 'same-origin'
		});
		
		const result = await parseRes(r);

		if (!r.ok) {
		  if (DEBUG) console.warn('[poslock] HTTP error:', r.status, result.bodyText);
		  return { locked: false, error: result.bodyText || `HTTP ${r.status}` };
		}

		if (DEBUG) console.info('[poslock] raw response:', result);

		if (!result.exists) {
		  if (DEBUG) console.info('[poslock]', posStr, 'is not locked (no file)');
		  return { locked: false };
		}

		// Changed: Consider position locked if file exists and owner is different
		const isDifferentOwner = (result.owner && result.owner !== ivaoId) ? true : false;
		const isActive = typeof result.age === 'number' && result.age < 300;

		if (DEBUG) console.info('[poslock] status for', posStr, {
		  isActive,
		  isDifferentOwner,
		  age: result.age,
		  owner: result.owner,
		  currentUser: ivaoId
		});

		return {
		  locked: isActive && isDifferentOwner, // Only locked if active AND different owner
		  owner: result.owner,
		  age: result.age,
		  isOwner: !isDifferentOwner
		};

	  } catch(e) {
		console.error('[poslock] network error:', e);
		return { 
		  locked: false,
		  error: e?.message || 'Network error checking lock'
		};
	  }
	}
	
	
	btnRelease.addEventListener('click', async ()=>{
      try{
        if (!currentPos) return; // por seguridad
        if (DEBUG) console.info('[poslock] liberando', currentPos);

        const r = await releasePosLock(endpoints, currentPos);
        if (DEBUG) console.info('[poslock] liberado via', r.via, r);

        // Deshabilitar edición al liberar (recomendado)
        suppressSave = true;
        setUiEnabledForPos && setUiEnabledForPos(false);
        setStageEditable(false);
        stopInboxPolling();

        // Clear the board (remove strips) and reset layout
        if (stage) {
          stage.querySelectorAll('.se-layer').forEach(el=>el.remove());
          reflowAll(stage);
        }

        // Reset internal selection state and select element WITHOUT firing change
        currentPos = '';
        if (selectPos) selectPos.value = '';

        // Ocultar el botón
        if (btnRelease) btnRelease.style.display = 'none';

        // Ensure any loader is hidden
        hideLoading && hideLoading();
      }catch(e){
        if (DEBUG) console.warn('[poslock] liberar falló:', e?.message || e);
      }
    });



  }

})();
