(function(){
  "use strict";

  // Inicializa cada instancia del shortcode en la página
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-ivao-strips="1"]').forEach(initInstance);
  });

  function initInstance(root){
    let cfg = {};
    try { cfg = JSON.parse(root.getAttribute('data-config') || '{}'); } catch(e){ cfg = {}; }
    if (!cfg || !cfg.uid) return;

    const stage = root.querySelector('.se-stage');
    const elClock = document.getElementById(cfg.clockId);
    const btnAddArr = root.querySelector('.se-btn.add-arr');
    const btnAddDep = root.querySelector('.se-btn.add-dep');
    const btnTransfer = root.querySelector('.se-btn.transfer');
    const btnReceive  = root.querySelector('.se-btn.receive');
    const transferStatus = root.querySelector('.se-transfer-status');

    let zCounter = 1;
    let stripCount = 0;
    let BULK_LOAD = false;
    const STORAGE_KEY = cfg.storageKey || 'se_state_default';
    const SAVE_DEBOUNCE_MS = 500;
    let saveTimer = null;

    // ----- Reloj UTC -----
    if (elClock) {
      const pad = n => (n<10 ? '0'+n : ''+n);
      function tick(){
        const d = new Date();
        const hh = pad(d.getUTCHours()), mm = pad(d.getUTCMinutes()), ss = pad(d.getUTCSeconds());
        elClock.textContent = (cfg.showSeconds ? `${hh}:${mm}:${ss}Z` : `${hh}:${mm}Z`);
        elClock.style.color = cfg.clockColor || elClock.style.color;
      }
      tick(); setInterval(tick, 1000);
    }

    // ===== Tamaño dinámico del stage =====
    const STAGE_MIN = 120, STAGE_PAD = 20;
    function updateStageSize(){
      const layers = Array.from(stage.querySelectorAll('.se-layer'));
      let bottom = 0;
      layers.forEach(el => { bottom = Math.max(bottom, el.offsetTop + el.offsetHeight); });
      const h = Math.max(bottom + STAGE_PAD, STAGE_MIN);
      stage.style.height = h + 'px';
    }

    // ===== METAR =====
    (function metarSetup(){
      const input = root.querySelector('.se-metar-input');
      const btn   = root.querySelector('.se-metar-btn');
      const out   = root.querySelector('.se-metar-msg');

      function normICAO(v){ return (v||'').toUpperCase().replace(/[^A-Z]/g,'').slice(0,4); }

      async function fetchMetar(icao){
        const endpoint = (window.IVAOPE && IVAOPE.rest && IVAOPE.rest.metar) ? IVAOPE.rest.metar : '';
        const url = `${endpoint}?icao=${encodeURIComponent(icao)}`;

        out.classList.remove('is-error');
        out.classList.add('is-loading');
        out.textContent = `Consultando ${icao}…`;

        try{
          const res = await fetch(url, { credentials: 'same-origin' });
          const txt = await res.text();
          if(!res.ok){
            out.classList.add('is-error');
            out.textContent = txt || `Error obteniendo METAR de ${icao}.`;
            return;
          }
          out.textContent = (txt || '').trim();
        }catch(err){
          out.classList.add('is-error');
          out.textContent = `Error obteniendo METAR de ${icao}. ${err && err.message ? err.message : ''}`.trim();
        }finally{
          out.classList.remove('is-loading');
        }
      }

      function handleRequest(){
        const icao = normICAO(input.value);
        input.value = icao;
        if(icao.length !== 4){
          out.classList.add('is-error');
          out.textContent = 'Introduce un ICAO de 4 letras (p. ej. LEBB).';
          return;
        }
        fetchMetar(icao);
      }

      if (input && btn && out) {
        input.addEventListener('input', () => { input.value = normICAO(input.value); });
        input.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); handleRequest(); } });
        btn.addEventListener('click', handleRequest);
      }
    })();

    // ===== Persistencia Local =====
    function normalizeNewlines(str){ return (str || '').replace(/\r\n?/g, '\n'); }

    function serializeState(){
      const data = [];
      stage.querySelectorAll('.se-layer').forEach(layer => {
        const type = layer.dataset.layer; // 'arr' | 'dep'
        const left = parseFloat(layer.style.left) || 0;
        const top  = parseFloat(layer.style.top)  || 0;
        const notes = [];
        layer.querySelectorAll('.se-note').forEach(n => {
          notes.push({
            left: parseFloat(n.style.left) || 0,
            top:  parseFloat(n.style.top)  || 0,
            text: normalizeNewlines(n.innerText || '')
          });
        });
        data.push({ type, left, top, notes });
      });
      return { v:1, strips:data };
    }

    function applyState(state){
      if (!state || !Array.isArray(state.strips)) return;

      BULK_LOAD = true;
      stage.innerHTML = '';
      stripCount = 0; zCounter = 1;

      state.strips.forEach(rec => {
        const type = (rec.type === 'dep') ? 'dep' : 'arr';
        const layer = createStrip(type, { silent:true });
        if (Number.isFinite(rec.left)) layer.style.left = rec.left + 'px';
        if (Number.isFinite(rec.top))  layer.style.top  = rec.top  + 'px';

        const notes = Array.from(layer.querySelectorAll('.se-note'));
        (rec.notes || []).forEach((nRec, idx) => {
          const n = notes[idx]; if (!n) return;
          if (Number.isFinite(nRec.left)) n.style.left = nRec.left + 'px';
          if (Number.isFinite(nRec.top))  n.style.top  = nRec.top  + 'px';
          if (typeof nRec.text === 'string') n.textContent = nRec.text;
        });
      });

      afterImagesLoaded(stage, () => {
        enforceNoteDark();
        updateStageSize();
        BULK_LOAD = false;
        saveStateNow();
      });
    }

    function saveStateNow(){
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState())); } catch(e){}
    }
    function scheduleSave(){
      if (BULK_LOAD) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveStateNow, SAVE_DEBOUNCE_MS);
    }
    function loadState(){
      try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if(!raw) return false;
        applyState(JSON.parse(raw));
        return true;
      }catch(e){ return false; }
    }
    setInterval(saveStateNow, 30000);

    // ===== Utilidades =====
    function enforceNoteDark(){
      stage.querySelectorAll('.se-note').forEach(n=>{
        n.style.setProperty('--wp-dark-mode-inline-color', '#111', 'important');
        n.style.setProperty('--wp-dark-mode-inline-bg', 'transparent', 'important');
        n.style.setProperty('color', '#111', 'important');
        n.style.setProperty('-webkit-text-fill-color', '#111', 'important');
        n.style.setProperty('text-shadow', 'none', 'important');
      });
    }

    const GAP = 20;
    function getLayerItems() {
      const layers = Array.from(stage.querySelectorAll('.se-layer'));
      return layers.map(el => {
        const r = el.getBoundingClientRect();
        return { el, top: el.offsetTop, height: el.offsetHeight, center: r.top + r.height / 2 };
      });
    }
    function reflowAll(){
      const layers = Array.from(stage.querySelectorAll('.se-layer'));
      layers.sort((a,b) => a.offsetTop - b.offsetTop);
      let y = 0;
      layers.forEach(el => { el.style.top = y + 'px'; y += el.offsetHeight + GAP; });
      updateStageSize();
    }
    function reorderAfterDrag(dragged) {
      let items = getLayerItems().sort((a, b) => a.top - b.top);
      const draggedIndex = items.findIndex(i => i.el === dragged);

      const draggedRect = dragged.getBoundingClientRect();
      const draggedCenter = draggedRect.top + draggedRect.height / 2;

      let targetIndex = items.findIndex(i => draggedCenter < i.center);
      if (targetIndex === -1) targetIndex = items.length;

      if (targetIndex !== draggedIndex) {
        const [moved] = items.splice(draggedIndex, 1);
        items.splice(targetIndex > draggedIndex ? targetIndex - 1 : targetIndex, 0, moved);
      }

      let y = 0;
      items.forEach((it) => { it.el.style.top = y + 'px'; y += it.el.offsetHeight + GAP; });
      updateStageSize(); scheduleSave();
    }

    function nextTop() {
      const layers = Array.from(stage.querySelectorAll('.se-layer'));
      const bottom = layers.reduce((m,el) => Math.max(m, el.offsetTop + el.offsetHeight), 0);
      return bottom + 20;
    }
    function selectAll(el){
      const range = document.createRange(); range.selectNodeContents(el);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    }
    function centerLayerHoriz(layer, img){
      const imgW = (img && img.getBoundingClientRect().width) || layer.offsetWidth || 0;
      const stageW = stage.clientWidth || 0;
      const left = Math.max(0, (stageW - imgW) / 2);
      layer.style.left = left + 'px';
    }

    // Drag genérico
    function makeDraggable(nodes, container, opts){
      const raiseOnDrag = !!(opts && opts.raiseOnDrag);
      const constrain   = !!(opts && opts.constrain);
      const lockX       = !!(opts && opts.lockX);

      nodes.forEach(node => {
        let dragging = false, offsetX=0, offsetY=0, fixedLeft=0;

        function start(e, cx, cy){
          dragging = true;
          const rect = node.getBoundingClientRect();
          offsetX = cx - rect.left; offsetY = cy - rect.top;
          fixedLeft = parseFloat(node.style.left || '0') || 0;
          if(raiseOnDrag) node.style.zIndex = ++zCounter;
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', end);
          document.addEventListener('touchmove', onTouchMove, {passive:false});
          document.addEventListener('touchend', end);
        }
        function onMove(e){ if(!dragging) return; e.preventDefault(); place(e.clientX, e.clientY); }
        function onTouchMove(e){
          if(!dragging) return; e.preventDefault();
          const t = e.touches[0]; place(t.clientX, t.clientY);
        }
        function end(){
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', end);
          document.removeEventListener('touchmove', onTouchMove);
          document.removeEventListener('touchend', end);
          dragging = false;
          if (node.classList.contains('se-layer')) reorderAfterDrag(node);
        }
        function place(cx, cy){
          const contRect = container.getBoundingClientRect();
          const x = cx - contRect.left - offsetX;
          const y = cy - contRect.top  - offsetY;
          let nx = x, ny = y;
          if (lockX) nx = fixedLeft;
          if(constrain){
            const maxX = contRect.width  - node.offsetWidth;
            const maxY = contRect.height - node.offsetHeight;
            nx = Math.max(0, Math.min(nx, maxX));
            ny = Math.max(0, Math.min(ny, maxY));
          }
          node.style.left = nx + 'px';
          node.style.top  = ny + 'px';
        }

        node.addEventListener('mousedown', (e) => {
          if (node.classList.contains('se-note')) {
            if (!(e.altKey || e.ctrlKey || e.metaKey)) return; // notas solo con modificador
            e.preventDefault();
          }
          start(e, e.clientX, e.clientY);
        });

        node.addEventListener('touchstart', (e) => {
          const t = e.touches[0];
          start(e, t.clientX, t.clientY);
        }, { passive: true });

        node.addEventListener('dragstart', e => e.preventDefault());
      });
    }

    function afterImagesLoaded(container, cb){
      const imgs = Array.from(container.querySelectorAll('img'));
      if (imgs.length === 0) { requestAnimationFrame(cb); return; }
      let pending = imgs.length;
      const done = () => { if (--pending <= 0) cb(); };
      imgs.forEach(img => {
        if (img.complete) { done(); }
        else { img.addEventListener('load', done, { once:true }); img.addEventListener('error', done, { once:true }); }
      });
    }

    // Crear strip
    function createStrip(type, opts = {}) {
      const isArr = type === 'arr';
      const imgSrc   = isArr ? (cfg.arr && cfg.arr.img) : (cfg.dep && cfg.dep.img);
      const coords   = isArr ? (cfg.arr && cfg.arr.coords || []) : (cfg.dep && cfg.dep.coords || []);
      const baseLeft = isArr ? (cfg.arr && cfg.arr.x || 0) : (cfg.dep && cfg.dep.x || 0);
      const topPos   = nextTop();
      const stripId  = `${type}_s${++stripCount}`;
      const silent   = !!opts.silent;

      const layer = document.createElement('div');
      layer.className = 'se-layer';
      layer.dataset.name  = isArr ? 'Llegadas' : 'Salidas';
      layer.dataset.layer = type;
      layer.style.left = baseLeft + 'px';
      layer.style.top  = topPos + 'px';
      layer.style.zIndex = ++zCounter;

      const img = document.createElement('img');
      img.src = imgSrc; img.alt = isArr ? 'Strip Llegadas' : 'Strip Salidas';
      img.className = 'se-img'; img.draggable = false;
      layer.appendChild(img);

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'se-close';
      close.setAttribute('aria-label', 'Eliminar strip');
      close.textContent = '';
      close.addEventListener('click', () => { layer.remove(); reflowAll(); scheduleSave(); });
      layer.appendChild(close);

      coords.forEach((pt, i) => {
        const idx = i + 1;
        const note = document.createElement('div');
        note.className = 'se-note';
        note.id = `${type}${idx}_${stripId}`;
        note.dataset.id = note.id;
        note.contentEditable = 'true';
        note.title = 'Escribe para editar. ALT/Ctrl/Cmd + arrastrar para mover';
        note.style.left = parseInt(pt[0],10) + 'px';
        note.style.top  = parseInt(pt[1],10) + 'px';
        note.textContent = '-';
        if (isArr && (idx === 5 || idx === 19)) { note.style.fontSize = '54px'; note.style.lineHeight = '1.2'; }
        layer.appendChild(note);
      });

      stage.appendChild(layer);
      centerLayerHoriz(layer, img);
      enforceNoteDark();
      updateStageSize();

      img.addEventListener('load', () => { centerLayerHoriz(layer, img); enforceNoteDark(); updateStageSize(); });

      Array.from(stage.querySelectorAll('.se-layer')).forEach(l=>l.classList.remove('is-active'));
      layer.classList.add('is-active');

      makeDraggable([layer], stage, { raiseOnDrag:true, lockX:true });
      const notes = Array.from(layer.querySelectorAll('.se-note'));
      makeDraggable(notes, layer, { constrain:true, raiseOnDrag:false });

      notes.forEach(n => {
        n.addEventListener('focus', () => selectAll(n));
        n.addEventListener('input', scheduleSave);
        n.addEventListener('blur', scheduleSave);
      });

      if (!silent) scheduleSave();
      return layer;
    }

    // Botones
    if (btnAddArr) btnAddArr.addEventListener('click', () => createStrip('arr'));
    if (btnAddDep) btnAddDep.addEventListener('click', () => createStrip('dep'));

    // Transferir/Recibir (REST)
    const API_STRIPS = (window.IVAOPE && IVAOPE.rest && IVAOPE.rest.stripsave) ? IVAOPE.rest.stripsave : '';

    if (btnTransfer) btnTransfer.addEventListener('click', async () => {
      try {
        transferStatus.style.color = '#222';
        transferStatus.textContent = 'Transfiriendo…';

        const payload = serializeState();
        const res = await fetch(API_STRIPS, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text();
          let msg = `❌ Error ${res.status}`;
          if (res.status === 401) msg += ': No logueado en IVAO.';
          if (txt) msg += ` — ${txt.substring(0, 500)}`;
          transferStatus.style.color = '#b00020';
          transferStatus.textContent = msg;
          return;
        }

        const json = await res.json().catch(() => null);
        transferStatus.style.color = '#007700';
        transferStatus.textContent = `✅ Guardado correctamente (${json && json.file || 'supervisor.json'})`;
        setTimeout(() => transferStatus.textContent = '', 5000);
      } catch (e) {
        transferStatus.style.color = '#b00020';
        transferStatus.textContent = `⚠️ Error de red al transferir: ${e && e.message || e}`;
      }
    });

    if (btnReceive) btnReceive.addEventListener('click', async () => {
      if (!confirm('Esto reemplazará todos los strips activos por la versión del servidor.\n¿Continuar?')) return;
      try{
        transferStatus.textContent = 'Recibiendo…';
        const res = await fetch(API_STRIPS, { method:'GET', credentials:'same-origin' });
        if (!res.ok) {
          const txt = await res.text();
          if (res.status === 401) transferStatus.textContent = 'No logueado en IVAO (401).';
          else transferStatus.textContent = 'Error al recibir: ' + (txt || res.status);
          return;
        }
        const data = await res.json();
        if (!data || !Array.isArray(data.strips)) { transferStatus.textContent = 'Formato inesperado.'; return; }
        applyState(data);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e){}
        transferStatus.textContent = 'Estado recibido y aplicado ✅';
        setTimeout(()=> transferStatus.textContent = '', 3000);
      }catch(e){
        transferStatus.textContent = 'Error de red al recibir.';
      }
    });

    // Restaurar
    if (!loadState()) updateStageSize();
  }

})();
