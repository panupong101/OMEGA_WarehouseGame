/**
 * OMEGA Warehouse Planner — Advanced Renderer Layer
 * ──────────────────────────────────────────────────
 * • Konva.js   → 2D Layout  (OOP canvas, drag/hover, smart events)
 * • Three.js   → 3D View    (WebGL, real perspective, orbit camera)
 * • PixiJS     → Footprint  (GPU-accelerated treemap)
 * • Chart.js   → Bundle & S/N + Report  (modern dashboard cards)
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════

  function dd(it) {
    if (window.getDD) return window.getDD(it);
    const dW = it.is_long ? it.L : it.W;
    const dH = it.is_long ? it.W : it.L;
    const effStack = Math.min(it.stack || 1, Math.ceil((it.bundles || 1) / (it.floor_pos || 1)));
    return { dW, dH, cols: 1, rows: 1, effStack };
  }

  function sh(it) {
    if (window.stackH) return window.stackH(it);
    return it.H * Math.min(it.stack || 1, Math.ceil((it.bundles || 1) / (it.floor_pos || 1)));
  }

  // Returns CSS hex color string matching the 2D palette exactly
  function zColor(it, idx) {
    const FALLBACK = ['#3b82f6','#06b6d4','#8b5cf6','#ec4899','#22c55e',
                      '#f59e0b','#ef4444','#6366f1','#0ea5e9','#10b981'];
    const pal = window.ZONE_PALETTE;
    if (pal && window.zoneColorMap && (it.id in window.zoneColorMap)) {
      const zi = window.zoneColorMap[it.id];
      return (pal[zi] && pal[zi][0]) || FALLBACK[idx % FALLBACK.length];
    }
    return FALLBACK[idx % FALLBACK.length];
  }

  // Shade a CSS color by factor (0–1)
  function shadeColor(css, factor) {
    const hex = parseInt(css.replace('#', ''), 16);
    const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.round(((hex >>  8) & 0xff) * factor));
    const b = Math.min(255, Math.round((hex          & 0xff) * factor));
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  }

  function cssToHex(css) { return parseInt(css.replace('#', ''), 16); }

  // Returns all placed items — tries every safe method to access item data
  function allItems() {
    const ly  = window.layout;
    const its = window.items;
    if (!its || !its.length) return [];
    if (!ly) {
      // No layout yet — return all items that have positions
      const pos = window.pos;
      if (pos) return its.filter(it => pos[it.id]);
      return [];
    }
    const lSet = ly.leftItems  instanceof Set ? ly.leftItems  : new Set(ly.leftItems  || []);
    const rSet = ly.rightItems instanceof Set ? ly.rightItems : new Set(ly.rightItems || []);
    const all  = lSet.size + rSet.size;
    if (all > 0) return its.filter(it => lSet.has(it.id) || rSet.has(it.id));
    // Sets are empty — fall back to position map
    const pos = window.pos;
    if (pos && Object.keys(pos).length > 0) return its.filter(it => pos[it.id]);
    return its; // last resort: return everything
  }

  // True if a layout has been applied and items are placed
  function hasLayout() { return !!(window.layout && window.pos && allItems().length > 0); }

  let currentTab = '2d';

  // ═══════════════════════════════════════════════════════════
  // LEGEND & PANEL MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  function manageLegend(tab) {
    const leg  = document.getElementById('legend');
    const tgl  = document.querySelector('.leg-toggle');
    if (!leg) return;
    if (tab === '2d') {
      // Let main.js control it normally — just remove the forced hide
      leg.style.removeProperty('display');
      if (tgl) tgl.style.removeProperty('display');
    } else {
      // Force hide in 3D / FP / other tabs
      leg.style.display = 'none';
      if (tgl) tgl.style.display = 'none';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // KONVA.JS — 2D Layout
  // ═══════════════════════════════════════════════════════════

  const K = { stage: null, bg: null, layer: null, annot: null, mount: null, _fitted: false };

  function initKonva() {
    const wrap = document.querySelector('.cv-wrap');
    K.mount = document.createElement('div');
    K.mount.id = 'konva-mount';
    K.mount.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;';
    wrap.appendChild(K.mount);

    K.stage = new Konva.Stage({ container: 'konva-mount', width: wrap.clientWidth, height: wrap.clientHeight, draggable: true });
    K.bg    = new Konva.Layer();
    K.layer = new Konva.Layer();
    K.annot = new Konva.Layer();
    K.stage.add(K.bg, K.layer, K.annot);

    K.stage.on('wheel', e => {
      e.evt.preventDefault();
      const f   = e.evt.deltaY < 0 ? 1.13 : 1 / 1.13;
      const old = K.stage.scaleX();
      const ptr = K.stage.getPointerPosition();
      const ax  = (ptr.x - K.stage.x()) / old;
      const ay  = (ptr.y - K.stage.y()) / old;
      const ns  = Math.max(4, Math.min(300, old * f));
      K.stage.scale({ x: ns, y: ns });
      K.stage.position({ x: ptr.x - ax * ns, y: ptr.y - ay * ns });
    });

    K.mount.style.cursor = 'grab';
    K.stage.on('dragstart', () => (K.mount.style.cursor = 'grabbing'));
    K.stage.on('dragend',   () => (K.mount.style.cursor = 'grab'));
    K.stage.on('click', e => {
      if (e.target === K.stage) { window.selId = null; renderKonva(); }
    });
  }

  function renderKonva() {
    if (!K.stage || !window.layout || !window.pos) return;
    K.bg.destroyChildren(); K.layer.destroyChildren(); K.annot.destroyChildren();

    const ly  = window.layout;
    const pos = window.pos;
    const PX  = 30;
    const W   = ly.totalW * PX;
    const H   = ly.totalH * PX;

    // Background
    K.bg.add(new Konva.Rect({ width: W, height: H, fill: '#f8fafc' }));

    // Grid
    for (let x = 0; x <= Math.ceil(ly.totalW); x++) {
      K.bg.add(new Konva.Line({ points:[x*PX,0,x*PX,H], stroke: x%5===0?'#99aabb':'#d8e4f0', strokeWidth: x%5===0?.7:.3 }));
    }
    for (let y = 0; y <= Math.ceil(ly.totalH); y++) {
      K.bg.add(new Konva.Line({ points:[0,y*PX,W,y*PX], stroke: y%5===0?'#99aabb':'#d8e4f0', strokeWidth: y%5===0?.7:.3 }));
    }

    // Corridor
    const cL = ly.corrL * PX, cR = ly.corrR * PX, cW = cR - cL;
    K.bg.add(new Konva.Rect({ x: cL, y: 0, width: cW, height: H, fill: 'rgba(234,179,8,.09)' }));
    K.bg.add(new Konva.Line({ points:[cL+cW/2,0,cL+cW/2,H], stroke:'rgba(234,179,8,.45)', strokeWidth:1.2, dash:[8,5] }));

    // Border
    K.bg.add(new Konva.Rect({ width:W, height:H, stroke:'#1e3a5f', strokeWidth:2.5, fill:'transparent', cornerRadius:1 }));

    // Axis labels
    for (let x=0; x<=Math.ceil(ly.totalW); x+=5)
      K.annot.add(new Konva.Text({ x:x*PX-9, y:H+4, text:x+'m', fontSize:8, fill:'#94a3b8' }));
    for (let y=0; y<=Math.ceil(ly.totalH); y+=5)
      K.annot.add(new Konva.Text({ x:-22, y:y*PX-5, text:y+'m', fontSize:8, fill:'#94a3b8' }));
    K.annot.add(new Konva.Text({ x:W+6, y:H-20, text:'▲ N', fontSize:10, fill:'#1e3a5f', fontStyle:'bold' }));

    // Items
    allItems().forEach((it, idx) => {
      const p = pos[it.id]; if (!p) return;
      const { dW, dH, cols, rows } = dd(it);
      const x=p.x*PX, y=p.y*PX, w=dW*PX, h=dH*PX;
      const isSel = window.selId === it.id;
      const color = zColor(it, idx);
      const stH   = sh(it);
      const grp   = new Konva.Group({ x, y });

      const box = new Konva.Rect({
        width:w, height:h, fill:color, cornerRadius:3,
        opacity: isSel ? 1 : 0.82,
        stroke: isSel ? '#fbbf24' : 'rgba(0,0,0,.22)', strokeWidth: isSel ? 2.5 : 1,
        shadowColor: isSel ? '#fbbf24' : '#000',
        shadowBlur: isSel ? 16 : 6, shadowOpacity: isSel ? .55 : .18, shadowOffset:{x:1,y:2},
      });
      grp.add(box);

      if (w>22 && cols>1) for (let c=1;c<cols;c++)
        grp.add(new Konva.Line({ points:[c*w/cols,0,c*w/cols,h], stroke:'rgba(255,255,255,.3)', strokeWidth:.8, dash:[2,2] }));
      if (h>22 && rows>1) for (let r=1;r<rows;r++)
        grp.add(new Konva.Line({ points:[0,r*h/rows,w,r*h/rows], stroke:'rgba(255,255,255,.3)', strokeWidth:.8, dash:[2,2] }));

      const fs = Math.max(6, Math.min(11, Math.min(w,h)*.18));
      const lbl = it.item.length>16 ? it.item.slice(0,14)+'…' : it.item;
      grp.add(new Konva.Text({ x:0, y:0, width:w, height:Math.min(h,h*.6), text:lbl, fontSize:fs, fill:'#fff', fontStyle:'bold', align:'center', verticalAlign:'middle', wrap:'none', listening:false }));

      if (it.stack>1 && w>28 && h>18) {
        grp.add(new Konva.Rect({ x:w-24, y:2, width:22, height:13, fill:'rgba(0,0,0,.45)', cornerRadius:2 }));
        grp.add(new Konva.Text({ x:w-24, y:2, width:22, height:13, text:`×${it.stack}`, fontSize:8, fill:'#fff', align:'center', verticalAlign:'middle', listening:false }));
      }
      if (h>28 && w>30)
        grp.add(new Konva.Text({ x:0, y:h-12, width:w, text:`${it.L}×${it.W}m`, fontSize:7, fill:'rgba(255,255,255,.75)', align:'center', listening:false }));

      grp.on('click tap', () => { if (window.selItem) window.selItem(it.id); renderKonva(); });
      grp.on('mouseover', e => {
        K.mount.style.cursor = 'pointer'; box.shadowBlur(18); box.opacity(1); K.layer.batchDraw();
        const tip = document.getElementById('tip');
        if (tip) { tip.style.display='block'; tip.innerHTML=`<strong>${it.item}</strong><br>${it.L}×${it.W}×${it.H} m | stack ×${it.stack} (h:${stH.toFixed(2)}m)<br>${it.bundles} bundles · ${it.sqm} m²`; tip.style.left=(e.evt.clientX+14)+'px'; tip.style.top=(e.evt.clientY-8)+'px'; }
      });
      grp.on('mouseout', () => {
        K.mount.style.cursor='grab'; box.shadowBlur(isSel?16:6); box.opacity(isSel?1:.82); K.layer.batchDraw();
        const tip=document.getElementById('tip'); if(tip) tip.style.display='none';
      });
      K.layer.add(grp);
    });

    if (window.updateMetrics) window.updateMetrics();
    K.bg.batchDraw(); K.layer.batchDraw(); K.annot.batchDraw();
    if (!K._fitted) { fitKonva(W, H); K._fitted = true; }
  }

  function fitKonva(W, H) {
    if (!K.stage) return;
    const pad=44, sw=K.stage.width()-pad*2, sh_=K.stage.height()-pad*2;
    const sc = Math.min(sw/W, sh_/H, 2);
    K.stage.scale({x:sc,y:sc});
    K.stage.position({x:pad+(sw-W*sc)/2, y:pad+(sh_-H*sc)/2});
  }

  // ═══════════════════════════════════════════════════════════
  // THREE.JS — 3D Warehouse
  // ═══════════════════════════════════════════════════════════

  const T = {
    scene:null, camera:null, renderer:null, mount:null, hud:null, statusBar:null,
    objs:[],
    theta: -0.6, phi: 0.85, r: 50, panX: 0, panZ: 0,
    drag:false, panDrag:false, ds:{x:0,y:0}, ps:{x:0,y:0,px:0,pz:0}
  };

  function initThree() {
    const wrap = document.querySelector('.cv-wrap');
    T.mount = document.createElement('div');
    T.mount.id = 'three-mount';
    T.mount.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;overflow:hidden;';
    wrap.appendChild(T.mount);

    const W = wrap.clientWidth, H = wrap.clientHeight;
    T.scene = new THREE.Scene();
    T.scene.background = new THREE.Color(0x0d1b2e);
    T.scene.fog = new THREE.FogExp2(0x0d1b2e, 0.007);

    T.camera = new THREE.PerspectiveCamera(45, W/H, 0.1, 1000);
    T.renderer = new THREE.WebGLRenderer({ antialias: true });
    T.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    T.renderer.setSize(W, H);
    T.renderer.shadowMap.enabled = true;
    T.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    T.mount.appendChild(T.renderer.domElement);

    // Lighting rig
    T.scene.add(new THREE.AmbientLight(0x8aa8cc, 0.65));
    const sun = new THREE.DirectionalLight(0xfff8e8, 1.1);
    sun.position.set(50, 80, 40); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near:.5, far:300, left:-120, right:120, top:120, bottom:-120 });
    T.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x3366cc, 0.25);
    rim.position.set(-30, 20, -25); T.scene.add(rim);

    // Permanent floor + grid
    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshLambertMaterial({ color: 0x0a1525 })
    );
    floorMesh.rotation.x = -Math.PI/2; floorMesh.receiveShadow = true; floorMesh.position.y = -0.02;
    T.scene.add(floorMesh);
    T.scene.add(new THREE.GridHelper(500, 100, 0x162236, 0x111e2e));

    // Mouse orbit
    const el = T.renderer.domElement;
    el.addEventListener('mousedown', e => {
      if (e.button===0) { T.drag=true; T.ds={x:e.clientX,y:e.clientY}; el.style.cursor='grabbing'; }
      if (e.button===2) { T.panDrag=true; T.ps={x:e.clientX,y:e.clientY,px:T.panX,pz:T.panZ}; el.style.cursor='move'; }
    });
    el.addEventListener('mousemove', e => {
      if (T.drag) {
        T.theta += (e.clientX-T.ds.x)*0.008;
        T.phi = Math.max(0.08, Math.min(1.5, T.phi-(e.clientY-T.ds.y)*0.008));
        T.ds = {x:e.clientX,y:e.clientY}; refreshCamera();
      }
      if (T.panDrag) {
        T.panX = T.ps.px+(e.clientX-T.ps.x)*0.06;
        T.panZ = T.ps.pz+(e.clientY-T.ps.y)*0.06;
        refreshCamera();
      }
    });
    el.addEventListener('mouseup',    () => { T.drag=T.panDrag=false; el.style.cursor='grab'; });
    el.addEventListener('mouseleave', () => { T.drag=T.panDrag=false; el.style.cursor='grab'; });
    el.addEventListener('wheel', e => { T.r=Math.max(3,Math.min(200,T.r+e.deltaY*.06)); refreshCamera(); }, {passive:true});
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.style.cursor = 'grab';

    // Touch
    let _ts=null;
    el.addEventListener('touchstart',  e=>{if(e.touches.length===1){T.drag=true;_ts=T.ds={x:e.touches[0].clientX,y:e.touches[0].clientY};}},{passive:true});
    el.addEventListener('touchmove',   e=>{if(T.drag&&e.touches.length===1){const t=e.touches[0];T.theta+=(t.clientX-T.ds.x)*.008;T.phi=Math.max(.08,Math.min(1.5,T.phi-(t.clientY-T.ds.y)*.008));T.ds={x:t.clientX,y:t.clientY};refreshCamera();}},{passive:true});
    el.addEventListener('touchend',    ()=>{T.drag=false;});

    // Controls hint
    const hint = document.createElement('div');
    hint.className = 'eng-hint';
    hint.textContent = '⟳ Left-drag: orbit  ·  Right-drag: pan  ·  Scroll: zoom  ·  Dbl-click: reset';
    T.mount.appendChild(hint);
    el.addEventListener('dblclick', () => { resetThreeCamera(); });

    // HUD overlay
    T.hud = document.createElement('div');
    T.hud.className = 'eng-hud';
    T.mount.appendChild(T.hud);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.className = 'eng-btn';
    resetBtn.style.cssText += 'top:10px;left:12px;';
    resetBtn.innerHTML = '⟲ &nbsp;Reset View';
    resetBtn.addEventListener('click', () => resetThreeCamera());
    T.mount.appendChild(resetBtn);

    // Engineering status bar at bottom
    T.statusBar = document.createElement('div');
    T.statusBar.className = 'eng-statusbar';
    T.mount.appendChild(T.statusBar);

    // Render loop
    (function loop() { requestAnimationFrame(loop); if (T.renderer) T.renderer.render(T.scene, T.camera); })();
  }

  function resetThreeCamera() {
    const ly = window.layout;
    T.panX=0; T.panZ=0; T.theta=-0.6; T.phi=0.85;
    T.r = ly ? Math.max(ly.totalW, ly.totalH) * 1.8 : 50;
    refreshCamera();
  }

  function refreshCamera() {
    if (!T.camera) return;
    const ly = window.layout;
    const cx = (ly ? ly.totalW/2 : 10) + T.panX;
    const cz = (ly ? ly.totalH/2 : 10) + T.panZ;
    T.camera.position.set(
      cx + T.r * Math.sin(T.phi) * Math.cos(T.theta),
      T.r * Math.cos(T.phi),
      cz + T.r * Math.sin(T.phi) * Math.sin(T.theta)
    );
    T.camera.lookAt(cx, 0, cz);
  }

  function clearScene3() {
    T.objs.forEach(o => T.scene.remove(o));
    T.objs = [];
  }

  function add3(obj) { T.scene.add(obj); T.objs.push(obj); }

  function buildThreeScene() {
    if (!T.scene) return;
    clearScene3();

    // Update HUD & status bar
    if (!window.layout) {
      if (T.hud) T.hud.innerHTML = '<b>⚠ No layout</b><br><span class="dim">Run a scenario first</span>';
      if (T.statusBar) T.statusBar.innerHTML = '<span><span class="dot" style="background:#ef4444"></span> No layout loaded</span>';
      return;
    }

    const its = allItems();
    const n   = its.length;
    const ly  = window.layout;

    if (T.hud) {
      const totalVol = its.reduce((s, it) => { const {dW,dH}=dd(it); return s+dW*dH*sh(it); }, 0);
      T.hud.innerHTML =
        `<b>📦 ${n} item${n!==1?'s':''} placed</b><br>` +
        `<span class="dim">Floor: ${ly.totalW.toFixed(1)} × ${ly.totalH.toFixed(1)} m</span><br>` +
        `<span class="dim">Corridor: ${(ly.corrR-ly.corrL).toFixed(1)} m wide</span><br>` +
        `<span class="dim">Volume: ${totalVol.toFixed(1)} m³</span>`;
    }
    if (T.statusBar) {
      T.statusBar.innerHTML =
        `<span><span class="dot"></span> 3D View</span>` +
        `<span>W: ${ly.totalW.toFixed(2)} m</span>` +
        `<span>D: ${ly.totalH.toFixed(2)} m</span>` +
        `<span>Items: ${n}</span>` +
        `<span style="margin-left:auto;color:#2a5080">OMEGA Warehouse Planner</span>`;
    }

    const pos = window.pos || {};
    const W   = ly.totalW;
    const H   = ly.totalH;

    // Warehouse slab
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.15, H),
      new THREE.MeshLambertMaterial({ color: 0x14253a })
    );
    slab.position.set(W/2, -0.075, H/2); slab.receiveShadow = true;
    add3(slab);

    // Floor markings (5m grid lines on slab)
    const lineMat = new THREE.MeshLambertMaterial({ color: 0x1c3354, transparent:true, opacity:.55 });
    for (let xi=0; xi<=Math.ceil(W); xi+=5) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(.04,.01,H),lineMat);
      m.position.set(xi,.002,H/2); add3(m);
    }
    for (let zi=0; zi<=Math.ceil(H); zi+=5) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(W,.01,.04),lineMat);
      m.position.set(W/2,.002,zi); add3(m);
    }

    // Walls (translucent panels)
    const wallMat = new THREE.MeshLambertMaterial({ color:0x2a4878, transparent:true, opacity:.18, side:THREE.DoubleSide });
    const wH = 9, wT = .18;
    [[W/2,wH/2,  0,    W+wT,wH,wT],
     [W/2,wH/2,  H,    W+wT,wH,wT],
     [0,  wH/2,  H/2,  wT,  wH, H],
     [W,  wH/2,  H/2,  wT,  wH, H]].forEach(([x,y,z,w,h,d]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), wallMat);
      m.position.set(x,y,z); add3(m);
    });

    // Roof trusses
    const trussMat = new THREE.MeshLambertMaterial({ color:0x1e3a5f, transparent:true, opacity:.4 });
    for (let tz=0; tz<=Math.ceil(H); tz += Math.max(4, H/Math.round(H/5))) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(W, .14, .14), trussMat);
      t.position.set(W/2, wH+.07, tz); add3(t);
    }

    // Corridor stripe
    const cW = ly.corrR - ly.corrL;
    const corrMat = new THREE.MeshLambertMaterial({ color:0xfbbf24, transparent:true, opacity:.14 });
    const corrMesh = new THREE.Mesh(new THREE.BoxGeometry(cW,.03,H),corrMat);
    corrMesh.position.set(ly.corrL+cW/2,.015,H/2); add3(corrMesh);

    // Corridor centre dashes
    const dashMat = new THREE.MeshLambertMaterial({ color:0xfbbf24, transparent:true, opacity:.55 });
    for (let dz=.4; dz<H; dz+=1.8) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(.12,.02,.9),dashMat);
      d.position.set(ly.corrL+cW/2,.025,dz); add3(d);
    }

    // ── ITEMS ───────────────────────────────────────────────────
    its.forEach((it, idx) => {
      const p = pos[it.id];
      if (!p) return;

      const { dW, dH, cols:rawCols, rows:rawRows, effStack:rawEff } = dd(it);
      const cols     = Math.max(rawCols  || 1, 1);
      const rows     = Math.max(rawRows  || 1, 1);
      const effStack = Math.max(rawEff   || 1, 1);
      const isSel    = window.selId === it.id;
      const cssColor = zColor(it, idx);

      // Bundle dimensions with visible gaps
      const GAP = 0.06;
      const bW  = Math.max(0.08, (dW / cols)  - GAP);
      const bD  = Math.max(0.08, (dH / rows)  - GAP);
      const bH  = Math.max(0.08, it.H * 0.92);

      // One geometry per item (shared across all bundles of same item)
      const bundleGeo = new THREE.BoxGeometry(bW, bH, bD);
      const edgeGeo   = new THREE.EdgesGeometry(bundleGeo);

      for (let layer = 0; layer < effStack; layer++) {
        // Darker on higher layers → stack depth visible
        const shade = Math.max(0.42, 1 - layer * 0.11);
        const col   = cssToHex(shadeColor(cssColor, shade));
        const mat   = new THREE.MeshLambertMaterial({ color: isSel ? 0xfbbf24 : col, transparent:true, opacity: .94 });
        const eMat  = new THREE.LineBasicMaterial({ color: isSel ? 0xffdd44 : 0xffffff, transparent:true, opacity: isSel ? .6 : .25 });

        for (let row = 0; row < rows; row++) {
          for (let col2 = 0; col2 < cols; col2++) {
            if (layer * rows * cols + row * cols + col2 >= it.bundles) continue;

            const bx = p.x + col2 * (dW/cols) + GAP/2 + bW/2;
            const bz = p.y + row  * (dH/rows) + GAP/2 + bD/2;
            const by = layer * it.H + bH/2 + .005;

            const mesh = new THREE.Mesh(bundleGeo, mat);
            mesh.position.set(bx, by, bz);
            mesh.castShadow = mesh.receiveShadow = true;
            add3(mesh);

            const wire = new THREE.LineSegments(edgeGeo, eMat);
            wire.position.set(bx, by, bz);
            add3(wire);
          }
        }
      }

      // Selection cap glow on top
      if (isSel) {
        const totalH_ = effStack * it.H;
        const cap = new THREE.Mesh(
          new THREE.PlaneGeometry(dW*.95, dH*.95),
          new THREE.MeshLambertMaterial({ color:0xfbbf24, transparent:true, opacity:.4 })
        );
        cap.rotation.x = -Math.PI/2;
        cap.position.set(p.x+dW/2, totalH_+.01, p.y+dH/2);
        add3(cap);
      }

      // Floating item label (thin dark plate)
      const totalH_ = effStack * it.H + .12;
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(dW*.88,2.4), .06, Math.min(dH*.7, .55)),
        new THREE.MeshLambertMaterial({ color:0x000d1a, transparent:true, opacity:.55 })
      );
      plate.position.set(p.x+dW/2, totalH_, p.y+dH/2);
      add3(plate);
    });

    // ── Engineering dimension lines ──────────────────────────
    const dimMat = new THREE.LineBasicMaterial({ color: 0x4488cc, transparent:true, opacity:.7 });
    const mkLine = (pts) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      add3(new THREE.Line(g, dimMat));
    };
    const DY = .5;
    mkLine([[0,DY,-1],[W,DY,-1]]);
    mkLine([[0,DY,-1.4],[0,DY,-.4]]);
    mkLine([[W,DY,-1.4],[W,DY,-.4]]);
    mkLine([[W+1,DY,0],[W+1,DY,H]]);
    mkLine([[W+.6,DY,0],[W+1.4,DY,0]]);
    mkLine([[W+.6,DY,H],[W+1.4,DY,H]]);

    // Small axis cross at origin
    const axR = new THREE.LineBasicMaterial({ color:0xff4444, transparent:true, opacity:.8 });
    const axG = new THREE.LineBasicMaterial({ color:0x44ff88, transparent:true, opacity:.8 });
    const axB = new THREE.LineBasicMaterial({ color:0x4488ff, transparent:true, opacity:.8 });
    const axL = Math.max(W, H) * .06;
    [[axR,[0,0,0],[axL,0,0]],[axG,[0,0,0],[0,axL,0]],[axB,[0,0,0],[0,0,axL]]].forEach(([m,a,b])=>{
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]);
      add3(new THREE.Line(g, m));
    });

    // Reset camera for this layout
    resetThreeCamera();
  }

  // ═══════════════════════════════════════════════════════════
  // PIXI.JS — Footprint Treemap
  // ═══════════════════════════════════════════════════════════

  const PIX = { app: null, mount: null };

  function initPixi() {
    const wrap = document.querySelector('.cv-wrap');
    PIX.mount = document.createElement('div');
    PIX.mount.id = 'pixi-mount';
    PIX.mount.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:none;';
    wrap.appendChild(PIX.mount);

    PIX.app = new PIXI.Application({
      width: wrap.clientWidth, height: wrap.clientHeight,
      backgroundColor: 0xeceff4, antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true,
    });
    PIX.app.view.style.cssText = 'width:100%;height:100%;display:block;';
    PIX.mount.appendChild(PIX.app.view);
  }

  function renderPixiFootprint() {
    if (!PIX.app || !window.layout) return;
    PIX.app.stage.removeChildren();

    const its = allItems();
    if (!its.length) {
      const e = new PIXI.Text('Select a scenario first', { fontSize:14, fill:0x64748b });
      e.anchor.set(.5,.5); e.x=PIX.app.screen.width/2; e.y=PIX.app.screen.height/2;
      PIX.app.stage.addChild(e); return;
    }

    const W=PIX.app.screen.width, H=PIX.app.screen.height, PAD=14, HDR=52;
    const bg=new PIXI.Graphics(); bg.beginFill(0xeceff4); bg.drawRect(0,0,W,H); bg.endFill();
    PIX.app.stage.addChild(bg);

    const total = its.reduce((s,it)=>s+it.sqm,0);
    const t1 = new PIXI.Text('Material Footprint  (PixiJS WebGL)',{fontSize:13,fontWeight:'bold',fill:0x1e3a5f,fontFamily:'Segoe UI,Arial'});
    t1.x=PAD; t1.y=PAD; PIX.app.stage.addChild(t1);
    const t2 = new PIXI.Text(`${its.length} items · ${total.toFixed(1)} m² total · click to select`,{fontSize:10,fill:0x64748b,fontFamily:'Segoe UI,Arial'});
    t2.x=PAD; t2.y=PAD+20; PIX.app.stage.addChild(t2);

    const sorted = [...its].sort((a,b)=>b.sqm-a.sqm);
    const nodes  = squarify(sorted, PAD, HDR, W-PAD*2, H-HDR-PAD);

    nodes.forEach((node, i) => {
      if (!node||node.w<3||node.h<3) return;
      const it=node.item, isSel=window.selId===it.id;
      const color=cssToHex(zColor(it,i)), ip=3;
      const g=new PIXI.Graphics();
      if (isSel) { g.lineStyle(3,0xfbbf24,.9); g.beginFill(0xfbbf24,.18); g.drawRoundedRect(node.x-3,node.y-3,node.w+6,node.h+6,5); g.endFill(); }
      g.beginFill(color, isSel?1:.82); g.drawRoundedRect(node.x+ip,node.y+ip,node.w-ip*2,node.h-ip*2,4); g.endFill();
      g.lineStyle(1,0xffffff,.22); g.drawRoundedRect(node.x+ip,node.y+ip,node.w-ip*2,node.h-ip*2,4);
      g.eventMode='static'; g.cursor='pointer'; g.hitArea=new PIXI.Rectangle(node.x,node.y,node.w,node.h);
      g.on('pointerover',()=>{ g.clear(); g.beginFill(color,1); g.drawRoundedRect(node.x+ip,node.y+ip,node.w-ip*2,node.h-ip*2,4); g.endFill(); g.lineStyle(2,0xffffff,.5); g.drawRoundedRect(node.x+ip,node.y+ip,node.w-ip*2,node.h-ip*2,4); });
      g.on('pointerout',()=>{ g.clear(); if(isSel){g.lineStyle(3,0xfbbf24,.9);g.beginFill(0xfbbf24,.18);g.drawRoundedRect(node.x-3,node.y-3,node.w+6,node.h+6,5);g.endFill();} g.beginFill(color,isSel?1:.82); g.drawRoundedRect(node.x+ip,node.y+ip,node.w-ip*2,node.h-ip*2,4); g.endFill(); g.lineStyle(1,0xffffff,.22); g.drawRoundedRect(node.x+ip,node.y+ip,node.w-ip*2,node.h-ip*2,4); });
      g.on('pointertap',()=>{ if(window.selItem) window.selItem(it.id); renderPixiFootprint(); });
      PIX.app.stage.addChild(g);
      if (node.w>44&&node.h>26) {
        const lbl=new PIXI.Text(it.item.length>16?it.item.slice(0,14)+'…':it.item,{fontSize:Math.min(11,Math.max(7,node.w*.09)),fontWeight:'bold',fill:0xffffff,fontFamily:'Segoe UI,Arial'});
        lbl.anchor.set(.5,node.h>48?.7:.5); lbl.x=node.x+node.w/2; lbl.y=node.y+node.h/2; lbl.interactive=false; PIX.app.stage.addChild(lbl);
      }
      if (node.w>60&&node.h>44) {
        const area=new PIXI.Text(`${it.sqm.toFixed(1)} m²`,{fontSize:Math.min(9,node.w*.07),fill:0xffffff,fontFamily:'Segoe UI,Arial'});
        area.alpha=.8; area.anchor.set(.5,0); area.x=node.x+node.w/2; area.y=node.y+node.h/2+4; PIX.app.stage.addChild(area);
      }
    });
  }

  function squarify(items, x, y, w, h) {
    const result=[]; let rem=[...items],cx=x,cy=y,cw=w,ch=h;
    while (rem.length>0) {
      const isH=cw>=ch, stripL=isH?ch:cw, stripW=isH?cw:ch;
      const remTot=rem.reduce((s,it)=>s+it.sqm,0);
      const rowItms=[]; let rowArea=0;
      for (let i=0;i<rem.length;i++) {
        const test=[...rowItms,rem[i]], testA=rowArea+rem[i].sqm, rowW=(testA/remTot)*stripW;
        let worst=0; test.forEach(ti=>{const il=(ti.sqm/testA)*stripL;worst=Math.max(worst,Math.max(rowW/il,il/rowW));});
        if (rowItms.length>=1&&worst>3.5) break;
        rowItms.push(rem[i]); rowArea+=rem[i].sqm; if(rowItms.length>=7) break;
      }
      rem=rem.slice(rowItms.length);
      const rowW=(rowArea/remTot)*stripW; let offset=0;
      rowItms.forEach(it=>{ const frac=it.sqm/rowArea,itemL=frac*stripL;
        result.push(isH?{item:it,x:cx,y:cy+offset,w:rowW,h:itemL}:{item:it,x:cx+offset,y:cy,w:itemL,h:rowW}); offset+=itemL; });
      if (isH){cx+=rowW;cw-=rowW;}else{cy+=rowW;ch-=rowW;}
      if (cw<2||ch<2) break;
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // CHART.JS — Bundle & S/N View
  // ═══════════════════════════════════════════════════════════

  const BD = { mount: null, chartInst: null };

  const CHART_COLORS = [
    '#3b82f6','#06b6d4','#8b5cf6','#ec4899','#22c55e',
    '#f59e0b','#ef4444','#6366f1','#0ea5e9','#10b981',
    '#f97316','#84cc16','#a78bfa','#fb7185','#34d399'
  ];

  function initBD() {
    const wrap = document.querySelector('.cv-wrap');
    BD.mount = document.createElement('div');
    BD.mount.id = 'bd-mount';
    BD.mount.style.cssText = [
      'position:absolute;top:0;left:0;width:100%;height:100%;',
      'display:none;overflow-y:auto;background:#f1f5f9;',
      'font-family:Segoe UI,Arial,sans-serif;'
    ].join('');
    wrap.appendChild(BD.mount);
  }

  function renderBD() {
    if (!BD.mount) return;
    const its = window.items || [];
    BD.mount.innerHTML = '';

    // ── Header bar ──────────────────────────────────────────
    const totalBundles = its.reduce((s,it)=>s+(it.bundles||0),0);
    const totalSqm     = its.reduce((s,it)=>s+(it.sqm||0),0);
    const totalSNs     = its.reduce((s,it)=>s+(it._allSns?it._allSns.length:0),0);
    const hdr = document.createElement('div');
    hdr.style.cssText = 'background:#1e3a5f;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;';
    hdr.innerHTML = `
      <div style="font-size:15px;font-weight:700;flex:1;min-width:200px;">📦 Bundle &amp; S/N Register</div>
      ${[ ['Items',its.length,''], ['Bundles',totalBundles,'units'], ['Floor Area',totalSqm.toFixed(1),'m²'], ['Serial Nos.',totalSNs,'SNs'] ]
        .map(([l,v,u])=>`<div style="text-align:center;"><div style="font-size:22px;font-weight:700;line-height:1">${v}</div><div style="font-size:10px;color:#93c5fd;">${l}${u?' ('+u+')':''}</div></div>`).join('')}
    `;
    BD.mount.appendChild(hdr);

    if (!its.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:60px;color:#94a3b8;font-size:14px;';
      empty.textContent = 'Select a scenario to view bundle data.';
      BD.mount.appendChild(empty);
      return;
    }

    // ── Chart area ──────────────────────────────────────────
    const chartWrap = document.createElement('div');
    chartWrap.style.cssText = 'padding:16px 20px 8px;background:#fff;border-bottom:1px solid #e2e8f0;';
    chartWrap.innerHTML = '<div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;">Bundle Distribution</div>';
    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'height:160px;position:relative;';
    const cvs = document.createElement('canvas');
    cvs.id = 'bd-chart-cvs';
    canvasWrap.appendChild(cvs);
    chartWrap.appendChild(canvasWrap);
    BD.mount.appendChild(chartWrap);

    // Destroy previous chart instance
    if (BD.chartInst) { try { BD.chartInst.destroy(); } catch(e){} BD.chartInst = null; }

    if (window.Chart) {
      const labels  = its.map(it => it.item.length>18 ? it.item.slice(0,16)+'…' : it.item);
      const bundles = its.map(it => it.bundles||0);
      BD.chartInst = new Chart(cvs, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'Bundles',
            data: bundles,
            backgroundColor: its.map((_,i) => CHART_COLORS[i % CHART_COLORS.length] + 'cc'),
            borderColor:     its.map((_,i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 1.5,
            borderRadius: 4,
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${ctx.raw} bundles` } }
          },
          scales: {
            x: { ticks: { font: { size: 9 }, color: '#64748b', maxRotation: 35 }, grid: { display: false } },
            y: { ticks: { font: { size: 9 }, color: '#64748b' }, grid: { color: '#f1f5f9' }, beginAtZero: true }
          }
        }
      });
    }

    // ── Item cards ──────────────────────────────────────────
    const grid = document.createElement('div');
    grid.style.cssText = 'padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;';
    BD.mount.appendChild(grid);

    its.forEach((it, idx) => {
      const color = CHART_COLORS[idx % CHART_COLORS.length];
      const card = document.createElement('div');
      card.style.cssText = [
        'background:#fff;border-radius:8px;border:1px solid #e2e8f0;overflow:hidden;',
        'box-shadow:0 1px 4px rgba(0,0,0,.07);'
      ].join('');

      // Card header
      const cHdr = document.createElement('div');
      cHdr.style.cssText = `background:${color}18;border-bottom:2px solid ${color};padding:10px 12px;display:flex;align-items:center;gap:8px;`;
      cHdr.innerHTML = `
        <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
        <div style="font-size:11.5px;font-weight:700;color:#1e293b;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;">${it.item}</div>
        <div style="background:${color};color:#fff;font-size:9px;font-weight:700;padding:2px 7px;border-radius:10px;">${it.bundles} bndl</div>
      `;
      card.appendChild(cHdr);

      // Specs row
      const specs = document.createElement('div');
      specs.style.cssText = 'padding:8px 12px;display:flex;gap:16px;border-bottom:1px solid #f1f5f9;';
      specs.innerHTML = [
        `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Dims</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${it.L}×${it.W}×${it.H} m</div></div>`,
        `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Stack</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">×${it.stack}</div></div>`,
        `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Area</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${it.sqm.toFixed(1)} m²</div></div>`,
        it._containers && it._containers.length ?
          `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Container</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${it._containers.join(', ')}</div></div>` : ''
      ].join('');
      card.appendChild(specs);

      // Bundle dots
      const dotArea = document.createElement('div');
      dotArea.style.cssText = 'padding:8px 12px;border-bottom:1px solid #f1f5f9;';
      const maxDots = Math.min(it.bundles, 40);
      let dotsHtml = '<div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Bundles</div>';
      dotsHtml += '<div style="display:flex;flex-wrap:wrap;gap:3px;">';
      for (let b = 0; b < maxDots; b++) {
        dotsHtml += `<div style="width:12px;height:12px;border-radius:2px;background:${color};opacity:${0.5 + (b/(maxDots*1.5))};"></div>`;
      }
      if (it.bundles > 40) dotsHtml += `<div style="font-size:9px;color:#64748b;align-self:center;margin-left:2px;">+${it.bundles-40}</div>`;
      dotsHtml += '</div>';
      dotArea.innerHTML = dotsHtml;
      card.appendChild(dotArea);

      // S/N badges
      if (it._allSns && it._allSns.length > 0) {
        const snArea = document.createElement('div');
        snArea.style.cssText = 'padding:8px 12px;';
        const maxSN = Math.min(it._allSns.length, 24);
        let snHtml = '<div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Serial Numbers</div>';
        snHtml += '<div style="display:flex;flex-wrap:wrap;gap:3px;">';
        for (let s = 0; s < maxSN; s++) {
          snHtml += `<span style="font-size:9px;font-weight:600;background:#f1f5f9;border:1px solid #e2e8f0;color:#475569;padding:1px 5px;border-radius:3px;">${it._allSns[s]}</span>`;
        }
        if (it._allSns.length > 24) snHtml += `<span style="font-size:9px;color:#94a3b8;padding:1px 4px;">+${it._allSns.length-24} more</span>`;
        snHtml += '</div>';
        snArea.innerHTML = snHtml;
        card.appendChild(snArea);
      }

      grid.appendChild(card);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // CHART.JS — Report View
  // ═══════════════════════════════════════════════════════════

  const RPT = { mount: null, donutInst: null, barInst: null };

  function initRPT() {
    const wrap = document.querySelector('.cv-wrap');
    RPT.mount = document.createElement('div');
    RPT.mount.id = 'rpt-mount';
    RPT.mount.style.cssText = [
      'position:absolute;top:0;left:0;width:100%;height:100%;',
      'display:none;overflow-y:auto;background:#f1f5f9;',
      'font-family:Segoe UI,Arial,sans-serif;'
    ].join('');
    wrap.appendChild(RPT.mount);
  }

  function renderRPT() {
    if (!RPT.mount) return;
    const its = window.items || [];
    const ly  = window.layout;
    const rc  = window.rptCache;
    RPT.mount.innerHTML = '';

    // Destroy previous charts
    if (RPT.donutInst) { try { RPT.donutInst.destroy(); } catch(e){} RPT.donutInst = null; }
    if (RPT.barInst)   { try { RPT.barInst.destroy();   } catch(e){} RPT.barInst   = null; }

    // ── Header ──────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.style.cssText = 'background:#1e3a5f;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;';
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
    hdr.innerHTML = `
      <div style="font-size:15px;font-weight:700;flex:1;min-width:200px;">📋 Warehouse Analysis Report</div>
      <div style="font-size:10px;color:#93c5fd;">Generated: ${dateStr}</div>
    `;
    RPT.mount.appendChild(hdr);

    if (!its.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:60px;color:#94a3b8;font-size:14px;';
      empty.textContent = 'Select a scenario to view the report.';
      RPT.mount.appendChild(empty);
      return;
    }

    // ── Metric cards ────────────────────────────────────────
    const totalSqm    = its.reduce((s,it)=>s+(it.sqm||0),0);
    const totalVol    = its.reduce((s,it)=>{ const {dW,dH}=dd(it); return s+dW*dH*sh(it); },0);
    const totalBndl   = its.reduce((s,it)=>s+(it.bundles||0),0);
    const floorArea   = ly ? (ly.totalW * ly.totalH).toFixed(1) : '—';
    const gbPct       = rc ? rc.gbPct.toFixed(1) : '—';

    const metricsRow = document.createElement('div');
    metricsRow.style.cssText = 'padding:16px 20px 8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;';
    RPT.mount.appendChild(metricsRow);

    const metricDefs = [
      { icon:'📦', label:'Total Items',    val: its.length,                unit: 'items',    color:'#3b82f6' },
      { icon:'🔢', label:'Total Bundles',  val: totalBndl,                 unit: 'units',    color:'#8b5cf6' },
      { icon:'📐', label:'Material Area',  val: totalSqm.toFixed(1),       unit: 'm²',       color:'#06b6d4' },
      { icon:'📦', label:'Volume Est.',    val: totalVol.toFixed(1),       unit: 'm³',       color:'#22c55e' },
      { icon:'🏭', label:'Floor Area',     val: floorArea,                 unit: 'm²',       color:'#f59e0b' },
      { icon:'⚙️', label:'GB/T Standards', val: gbPct+'%',                 unit: 'of pcs',   color:'#ec4899' },
    ];
    metricDefs.forEach(m => {
      const card = document.createElement('div');
      card.style.cssText = `background:#fff;border-radius:8px;border-left:3px solid ${m.color};padding:12px 14px;box-shadow:0 1px 4px rgba(0,0,0,.07);`;
      card.innerHTML = `
        <div style="font-size:18px;margin-bottom:4px;">${m.icon}</div>
        <div style="font-size:20px;font-weight:700;color:#1e293b;line-height:1;">${m.val}</div>
        <div style="font-size:9px;color:#94a3b8;margin-top:2px;">${m.unit}</div>
        <div style="font-size:10px;color:#64748b;margin-top:3px;font-weight:600;">${m.label}</div>
      `;
      metricsRow.appendChild(card);
    });

    // ── Charts row ──────────────────────────────────────────
    const chartsRow = document.createElement('div');
    chartsRow.style.cssText = 'padding:8px 20px 16px;display:grid;grid-template-columns:220px 1fr;gap:16px;';
    RPT.mount.appendChild(chartsRow);

    // Donut chart — area breakdown
    const donutCard = document.createElement('div');
    donutCard.style.cssText = 'background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);';
    donutCard.innerHTML = '<div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;">Zone Breakdown</div>';
    const donutWrap = document.createElement('div');
    donutWrap.style.cssText = 'height:160px;position:relative;';
    const donutCvs = document.createElement('canvas');
    donutCvs.id = 'rpt-donut-cvs';
    donutWrap.appendChild(donutCvs);
    donutCard.appendChild(donutWrap);
    chartsRow.appendChild(donutCard);

    // Bar chart — per item area
    const barCard = document.createElement('div');
    barCard.style.cssText = 'background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);';
    barCard.innerHTML = '<div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;">Area per Item (m²)</div>';
    const barWrap = document.createElement('div');
    barWrap.style.cssText = 'height:160px;position:relative;';
    const barCvs = document.createElement('canvas');
    barCvs.id = 'rpt-bar-cvs';
    barWrap.appendChild(barCvs);
    barCard.appendChild(barWrap);
    chartsRow.appendChild(barCard);

    if (window.Chart) {
      // Donut: zone area breakdown
      const leftSqm  = rc ? rc.structArea : totalSqm * 0.5;
      const gbSqm    = rc ? rc.gbArea     : totalSqm * 0.3;
      const restSqm  = Math.max(0, totalSqm - leftSqm - gbSqm);
      RPT.donutInst = new Chart(donutCvs, {
        type: 'doughnut',
        data: {
          labels: ['Structural', 'GB/T Items', 'Other'],
          datasets: [{ data: [leftSqm.toFixed(1), gbSqm.toFixed(1), restSqm.toFixed(1)],
            backgroundColor: ['#3b82f6cc','#22c55ecc','#f59e0bcc'],
            borderColor: ['#3b82f6','#22c55e','#f59e0b'], borderWidth: 2 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, cutout: '60%',
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 9 }, padding: 8, color: '#64748b' } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.raw} m²` } }
          }
        }
      });

      // Bar: per-item area
      const sorted = [...its].sort((a,b) => b.sqm - a.sqm).slice(0, 12);
      RPT.barInst = new Chart(barCvs, {
        type: 'bar',
        data: {
          labels: sorted.map(it => it.item.length>18 ? it.item.slice(0,16)+'…' : it.item),
          datasets: [{
            label: 'm²',
            data: sorted.map(it => it.sqm.toFixed(2)),
            backgroundColor: sorted.map((_,i) => CHART_COLORS[i % CHART_COLORS.length] + 'bb'),
            borderColor:     sorted.map((_,i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderWidth: 1.5, borderRadius: 4,
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => ` ${ctx.raw} m²` } }
          },
          scales: {
            x: { ticks: { font: { size: 9 }, color: '#64748b' }, grid: { color: '#f8fafc' }, beginAtZero: true },
            y: { ticks: { font: { size: 9 }, color: '#64748b' }, grid: { display: false } }
          }
        }
      });
    }

    // ── GB/T Analysis section ───────────────────────────────
    if (rc) {
      const gbSec = document.createElement('div');
      gbSec.style.cssText = 'padding:0 20px 16px;';
      const gbCard = document.createElement('div');
      gbCard.style.cssText = 'background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);';
      gbCard.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;">GB/T Standard Analysis</div>
        <div style="display:flex;gap:20px;margin-bottom:12px;flex-wrap:wrap;">
          <div style="background:#eff6ff;border-radius:6px;padding:10px 14px;text-align:center;min-width:110px;">
            <div style="font-size:22px;font-weight:700;color:#1d4ed8;">${rc.totalGBpcs}</div>
            <div style="font-size:9px;color:#3b82f6;font-weight:600;text-transform:uppercase;">GB/T Pieces</div>
          </div>
          <div style="background:#f0fdf4;border-radius:6px;padding:10px 14px;text-align:center;min-width:110px;">
            <div style="font-size:22px;font-weight:700;color:#16a34a;">${rc.totalNonGBpcs}</div>
            <div style="font-size:9px;color:#22c55e;font-weight:600;text-transform:uppercase;">Non-GB/T Pieces</div>
          </div>
          <div style="background:#fef3c7;border-radius:6px;padding:10px 14px;text-align:center;min-width:110px;">
            <div style="font-size:22px;font-weight:700;color:#d97706;">${rc.gbPct.toFixed(1)}%</div>
            <div style="font-size:9px;color:#f59e0b;font-weight:600;text-transform:uppercase;">GB/T Ratio</div>
          </div>
        </div>
      `;
      // GB family table
      if (rc.gbFamilies && rc.gbFamilies.length) {
        const tbl = document.createElement('table');
        tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;';
        tbl.innerHTML = `
          <thead>
            <tr style="background:#f8fafc;">
              <th style="text-align:left;padding:5px 8px;color:#64748b;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0;">Standard</th>
              <th style="text-align:right;padding:5px 8px;color:#64748b;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0;">Qty</th>
              <th style="text-align:right;padding:5px 8px;color:#64748b;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;border-bottom:2px solid #e2e8f0;">Spec Variants</th>
            </tr>
          </thead>
          <tbody>
            ${rc.gbFamilies.slice(0,10).map((f,i) => `
              <tr style="border-bottom:1px solid #f1f5f9;${i%2===1?'background:#f8fafc;':''}">
                <td style="padding:5px 8px;color:#1e293b;font-weight:500;">${f.std}</td>
                <td style="padding:5px 8px;text-align:right;color:#1d4ed8;font-weight:700;">${f.qty}</td>
                <td style="padding:5px 8px;text-align:right;color:#64748b;">${f.specs}</td>
              </tr>
            `).join('')}
          </tbody>
        `;
        gbCard.appendChild(tbl);
        if (rc.gbFamilies.length > 10) {
          const more = document.createElement('div');
          more.style.cssText = 'font-size:9.5px;color:#94a3b8;padding:5px 0;text-align:right;';
          more.textContent = `+ ${rc.gbFamilies.length - 10} more standards`;
          gbCard.appendChild(more);
        }
      }
      gbSec.appendChild(gbCard);
      RPT.mount.appendChild(gbSec);
    }

    // ── Full item data table ─────────────────────────────────
    const tblSec = document.createElement('div');
    tblSec.style.cssText = 'padding:0 20px 20px;';
    const tblCard = document.createElement('div');
    tblCard.style.cssText = 'background:#fff;border-radius:8px;padding:14px;box-shadow:0 1px 4px rgba(0,0,0,.07);overflow-x:auto;';
    tblCard.innerHTML = '<div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;">Item Detail Table</div>';
    const tbl = document.createElement('table');
    tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;min-width:600px;';
    tbl.innerHTML = `
      <thead>
        <tr style="background:#1e3a5f;color:#fff;">
          <th style="text-align:left;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">#</th>
          <th style="text-align:left;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">Item</th>
          <th style="text-align:center;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">L×W×H (m)</th>
          <th style="text-align:center;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">Bundles</th>
          <th style="text-align:center;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">Stack</th>
          <th style="text-align:right;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">Area m²</th>
          <th style="text-align:right;padding:7px 10px;font-weight:600;font-size:9px;text-transform:uppercase;letter-spacing:.5px;">S/Ns</th>
        </tr>
      </thead>
      <tbody>
        ${its.map((it,i) => `
          <tr style="border-bottom:1px solid #f1f5f9;${i%2===1?'background:#f8fafc;':''}">
            <td style="padding:6px 10px;color:#94a3b8;font-size:9px;">${i+1}</td>
            <td style="padding:6px 10px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <div style="width:8px;height:8px;border-radius:50%;background:${CHART_COLORS[i%CHART_COLORS.length]};flex-shrink:0;"></div>
                <span style="font-weight:600;color:#1e293b;">${it.item}</span>
              </div>
            </td>
            <td style="padding:6px 10px;text-align:center;color:#475569;">${it.L}×${it.W}×${it.H}</td>
            <td style="padding:6px 10px;text-align:center;font-weight:700;color:#1d4ed8;">${it.bundles}</td>
            <td style="padding:6px 10px;text-align:center;color:#475569;">×${it.stack}</td>
            <td style="padding:6px 10px;text-align:right;font-weight:600;color:#1e293b;">${it.sqm.toFixed(2)}</td>
            <td style="padding:6px 10px;text-align:right;color:#64748b;">${it._allSns?it._allSns.length:0}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    tblCard.appendChild(tbl);
    tblSec.appendChild(tblCard);
    RPT.mount.appendChild(tblSec);
  }

  // ═══════════════════════════════════════════════════════════
  // TAB SWITCHER
  // ═══════════════════════════════════════════════════════════

  function showTab(tab) {
    currentTab = tab;

    // Hide all renderer containers
    const cvs    = document.getElementById('cvs');
    const konva  = document.getElementById('konva-mount');
    const three  = document.getElementById('three-mount');
    const pixi   = document.getElementById('pixi-mount');
    const bdMnt  = document.getElementById('bd-mount');
    const rptMnt = document.getElementById('rpt-mount');
    [cvs, konva, three, pixi, bdMnt, rptMnt].forEach(el => el && (el.style.display = 'none'));

    // Legend: show only for 2D
    manageLegend(tab);

    if (tab === '2d' && konva) {
      konva.style.display = 'block';
      K._fitted = false;
      renderKonva();
    } else if (tab === 'three' && three) {
      three.style.display = 'block';
      buildThreeScene();
    } else if (tab === 'fp' && pixi) {
      pixi.style.display = 'block';
      renderPixiFootprint();
    } else if (tab === 'bd' && bdMnt) {
      bdMnt.style.display = 'block';
      renderBD();
    } else if (tab === 'rpt' && rptMnt) {
      rptMnt.style.display = 'block';
      renderRPT();
    } else if (cvs) {
      cvs.style.display = 'block';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // BOOT
  // ═══════════════════════════════════════════════════════════

  window.addEventListener('load', function () {
    setTimeout(function () {

      if (window.Konva) { try { initKonva(); } catch(e) { console.warn('[Konva]',e); } }
      if (window.THREE) { try { initThree(); } catch(e) { console.warn('[Three]',e); } }
      if (window.PIXI)  { try { initPixi();  } catch(e) { console.warn('[PixiJS]',e); } }
      // BD and RPT always init (Chart.js check is inside render)
      try { initBD();  } catch(e) { console.warn('[BD]',e); }
      try { initRPT(); } catch(e) { console.warn('[RPT]',e); }

      // Intercept switchTab — update currentTab FIRST, then call original, then refresh renderer
      const _origSwitchTab = window.switchTab;
      window.switchTab = function (tab) {
        currentTab = tab; // update BEFORE original runs so our draw override works
        manageLegend(tab);
        if (typeof _origSwitchTab === 'function') _origSwitchTab(tab);
        showTab(tab);
      };

      // Override window.draw — called from HTML event handlers
      const cvs_      = document.getElementById('cvs');
      const _origDraw = window.draw;
      window.draw = function () {
        if (currentTab === '2d')         { K._fitted=false; renderKonva(); }
        else if (currentTab === 'three') { buildThreeScene(); }
        else if (currentTab === 'fp')    { renderPixiFootprint(); }
        else if (currentTab === 'bd')    { renderBD(); }
        else if (currentTab === 'rpt')   { renderRPT(); }
        else {
          if (cvs_) cvs_.style.display = 'block';
          if (typeof _origDraw === 'function') _origDraw();
        }
      };

      showTab('2d');

    }, 250);
  });

})();
