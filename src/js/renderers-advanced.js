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
    // ── Construction drawing: blueprint-white drafting paper ──
    T.scene.background = new THREE.Color(0xd8dde8);  // cool blue-gray — matches 2D layout bg
    T.scene.fog = new THREE.Fog(0xd8dde8, 300, 580);

    T.camera = new THREE.PerspectiveCamera(46, W/H, 0.1, 1000);
    T.renderer = new THREE.WebGLRenderer({ antialias: true });
    T.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    T.renderer.setSize(W, H);
    T.renderer.shadowMap.enabled = false;
    T.mount.appendChild(T.renderer.domElement);

    // ── Drafting-room light: bright, cool, even ──
    T.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const sun = new THREE.DirectionalLight(0xf0f4ff, 0.7);
    sun.position.set(50, 90, 40); T.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd8e8ff, 0.3);
    fill.position.set(-40, 30, -25); T.scene.add(fill);

    // ── Ground: crisp white with bold 1m graph-paper grid ──
    const groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshLambertMaterial({ color: 0xc4cad8 })  // muted blue-gray ground
    );
    groundMesh.rotation.x = -Math.PI/2; groundMesh.position.y = -0.04;
    T.scene.add(groundMesh);
    // 5m major grid — dark navy matching 2D border
    T.scene.add(new THREE.GridHelper(600, 120, 0x4a5a72, 0x4a5a72));
    // 1m minor grid — medium blue-gray
    T.scene.add(new THREE.GridHelper(600, 600, 0x8a96aa, 0x8a96aa));

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
    hint.style.cssText = 'position:absolute;bottom:36px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,.75);color:#334155;border:1px solid rgba(0,0,0,.12);border-radius:20px;padding:4px 14px;font-size:10px;white-space:nowrap;pointer-events:none;';
    hint.textContent = '⟳ Left-drag: orbit  ·  Right-drag: pan  ·  Scroll: zoom  ·  Dbl-click: reset';
    T.mount.appendChild(hint);
    el.addEventListener('dblclick', () => { resetThreeCamera(); });

    // HUD overlay — light card style
    T.hud = document.createElement('div');
    T.hud.style.cssText = 'position:absolute;top:10px;right:12px;background:rgba(255,255,255,.88);color:#1e293b;border:1px solid rgba(0,0,0,.12);border-radius:8px;padding:10px 14px;font:12px/1.6 Segoe UI,Arial,sans-serif;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,.15);min-width:170px;';
    T.mount.appendChild(T.hud);

    // Reset button — light style
    const resetBtn = document.createElement('button');
    resetBtn.style.cssText = 'position:absolute;top:10px;left:12px;background:rgba(255,255,255,.88);color:#1e293b;border:1px solid rgba(0,0,0,.2);border-radius:6px;padding:5px 12px;font:11px Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15);';
    resetBtn.innerHTML = '⟲ &nbsp;Reset View';
    resetBtn.addEventListener('click', () => resetThreeCamera());
    T.mount.appendChild(resetBtn);

    // Zoom buttons — + / −
    const zoomWrap = document.createElement('div');
    zoomWrap.style.cssText = 'position:absolute;top:10px;left:128px;display:flex;gap:4px;';
    [['＋', -1], ['－', 1]].forEach(([label, dir]) => {
      const btn = document.createElement('button');
      btn.style.cssText = 'background:rgba(255,255,255,.88);color:#1e293b;border:1px solid rgba(0,0,0,.2);border-radius:6px;padding:5px 11px;font:13px Segoe UI,Arial,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.15);line-height:1;';
      btn.textContent = label;
      btn.addEventListener('click', () => { T.r = Math.max(4, Math.min(220, T.r + dir * 6)); refreshCamera(); });
      zoomWrap.appendChild(btn);
    });
    T.mount.appendChild(zoomWrap);

    // Status bar — light style
    T.statusBar = document.createElement('div');
    T.statusBar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:24px;background:rgba(255,255,255,.82);border-top:1px solid rgba(0,0,0,.1);display:flex;align-items:center;gap:18px;padding:0 14px;font:10px Segoe UI,Arial,sans-serif;color:#475569;';
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
        `<b style="font-size:13px;">📦 ${n} item${n!==1?'s':''} placed</b><br>` +
        `<span style="color:#64748b;">Floor: ${ly.totalW.toFixed(1)} × ${ly.totalH.toFixed(1)} m</span><br>` +
        `<span style="color:#64748b;">Corridor: ${(ly.corrR-ly.corrL).toFixed(1)} m wide</span><br>` +
        `<span style="color:#64748b;">Volume: ${totalVol.toFixed(1)} m³</span>`;
    }
    if (T.statusBar) {
      T.statusBar.innerHTML =
        `<span style="display:flex;align-items:center;gap:5px;"><span style="width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;"></span> 3D View</span>` +
        `<span>W: ${ly.totalW.toFixed(1)} m</span>` +
        `<span>D: ${ly.totalH.toFixed(1)} m</span>` +
        `<span>Items: ${n}</span>` +
        `<span style="margin-left:auto;color:#94a3b8;">OMEGA Warehouse Planner</span>`;
    }

    const pos = window.pos || {};
    const W   = ly.totalW;
    const H   = ly.totalH;

    // ── Warehouse floor slab: white drafting paper ────────────
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(W, 0.10, H),
      new THREE.MeshLambertMaterial({ color: 0xeef0f6 })  // very light cool gray — matches 2D floor bg
    );
    slab.position.set(W/2, -0.05, H/2);
    add3(slab);

    // Grid on slab — cool blue-gray like 2D layout grid
    const majorLineMat = new THREE.MeshLambertMaterial({ color: 0x3a4a60 });
    const minorLineMat = new THREE.MeshLambertMaterial({ color: 0x8a96b0, transparent:true, opacity:.5 });
    for (let xi=0; xi<=Math.ceil(W); xi++) {
      const isMaj = xi%5===0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(isMaj?.07:.028,.012,H), isMaj?majorLineMat:minorLineMat);
      m.position.set(xi,.006,H/2); add3(m);
    }
    for (let zi=0; zi<=Math.ceil(H); zi++) {
      const isMaj = zi%5===0;
      const m = new THREE.Mesh(new THREE.BoxGeometry(W,.012,isMaj?.07:.028), isMaj?majorLineMat:minorLineMat);
      m.position.set(W/2,.006,zi); add3(m);
    }

    // ── NO walls, NO roof — open-plan view ───────────────────
    // Just a clean perimeter edge trim on the slab
    const edgeMat = new THREE.MeshLambertMaterial({ color: 0x1e3050 });  // dark navy — 2D border color
    const eT = 0.08, eH = 0.28;
    [[W/2, eH/2, 0,   W, eH, eT],
     [W/2, eH/2, H,   W, eH, eT],
     [0,   eH/2, H/2, eT,eH, H ],
     [W,   eH/2, H/2, eT,eH, H ]].forEach(([x,y,z,w,h,d])=>{
      const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), edgeMat);
      m.position.set(x,y,z); add3(m);
    });

    // ── Corridor — clean white lane, blue centre dash ─────────
    const cW = ly.corrR - ly.corrL;
    const corrMat = new THREE.MeshLambertMaterial({ color:0x7a8490, transparent:true, opacity:.82 });  // road asphalt gray
    const corrMesh = new THREE.Mesh(new THREE.BoxGeometry(cW, .022, H), corrMat);
    corrMesh.position.set(ly.corrL+cW/2, .014, H/2); add3(corrMesh);

    // Soft blue centre-line dashes
    const dashMat = new THREE.MeshLambertMaterial({ color:0xffffff, transparent:true, opacity:.7 });  // white road centre line
    for (let dz=0.5; dz<H; dz+=1.6) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(.08,.03,.7), dashMat);
      dash.position.set(ly.corrL+cW/2, .024, dz); add3(dash);
    }

    // ── Scale tick marks — thin dark bars every 5 m ──────────
    const tickMat = new THREE.MeshLambertMaterial({ color: 0x1e3050 });
    for (let xi=0; xi<=Math.ceil(W); xi+=5) {
      const ph = xi%10===0 ? 0.55 : 0.32;
      const tk = new THREE.Mesh(new THREE.BoxGeometry(.06, ph, .06), tickMat);
      tk.position.set(xi, ph/2, -0.5); add3(tk);
    }
    for (let zi=0; zi<=Math.ceil(H); zi+=5) {
      const ph = zi%10===0 ? 0.55 : 0.32;
      const tk = new THREE.Mesh(new THREE.BoxGeometry(.06, ph, .06), tickMat);
      tk.position.set(-0.5, ph/2, zi); add3(tk);
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

      for (let layer = 0; layer < effStack; layer++) {
        // Slightly lighter shade on top layers for stacking depth
        // Match 2D theme: full vivid zone color, slight shade per stack layer
        const shade = Math.max(0.72, 1 - layer * 0.08);
        const col = cssToHex(shadeColor(cssColor, shade));
        const mat = new THREE.MeshLambertMaterial({ color: isSel ? 0xffd700 : col });
        // Dark navy outline like 2D item border
        const outlineMat = new THREE.LineBasicMaterial({ color: isSel ? 0xb45309 : 0x1a2840, transparent:true, opacity: isSel ? 1.0 : 0.85 });

        for (let row = 0; row < rows; row++) {
          for (let col2 = 0; col2 < cols; col2++) {
            if (layer * rows * cols + row * cols + col2 >= it.bundles) continue;

            const bx = p.x + col2 * (dW/cols) + GAP/2 + bW/2;
            const bz = p.y + row  * (dH/rows) + GAP/2 + bD/2;
            const by = layer * it.H + bH/2 + .005;

            const mesh = new THREE.Mesh(bundleGeo, mat);
            mesh.position.set(bx, by, bz);
            add3(mesh);
            // Construction drawing outline
            const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bundleGeo), outlineMat);
            edges.position.set(bx, by, bz);
            add3(edges);
          }
        }
      }

      // Selection: clean bright outline ring on top face only
      if (isSel) {
        const totalH_ = effStack * it.H;
        const ring = new THREE.Mesh(
          new THREE.PlaneGeometry(dW*.96, dH*.96),
          new THREE.MeshLambertMaterial({ color:0xfbbf24, transparent:true, opacity:.55 })
        );
        ring.rotation.x = -Math.PI/2;
        ring.position.set(p.x+dW/2, totalH_+.012, p.y+dH/2);
        add3(ring);
      }
    });

    // ── Dimension lines + text labels ─────────────────────────
    const dimLineMat = new THREE.LineBasicMaterial({ color: 0x1e3050, transparent:true, opacity:.8 });
    const mkLine = (pts) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(...p)));
      add3(new THREE.Line(g, dimLineMat));
    };
    // Width dim line (front)
    const dimY = 0.5;
    mkLine([[0,dimY,-1.8],[W,dimY,-1.8]]);
    mkLine([[0,dimY,-2.2],[0,dimY,-1.2]]);    // tick left
    mkLine([[W,dimY,-2.2],[W,dimY,-1.2]]);    // tick right
    // Depth dim line (right side)
    mkLine([[W+1.6,dimY,0],[W+1.6,dimY,H]]);
    mkLine([[W+1.2,dimY,0],[W+2.0,dimY,0]]);  // tick top
    mkLine([[W+1.2,dimY,H],[W+2.0,dimY,H]]);  // tick bottom

    // Canvas text sprite helper
    const dimSprite = (text, x, y, z, sw) => {
      const c = document.createElement('canvas');
      c.width = 192; c.height = 40;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 192, 40);
      ctx.fillStyle = 'rgba(238,240,246,0.95)';
      ctx.fillRect(2, 2, 188, 36);
      ctx.strokeStyle = '#1e3050';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, 188, 36);
      ctx.fillStyle = '#1e3050';
      ctx.font = 'bold 18px Arial,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 96, 20);
      const tex = new THREE.CanvasTexture(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(sw || 4, 1.0, 1);
      spr.position.set(x, y, z);
      add3(spr);
    };

    dimSprite(`${W.toFixed(1)} m`, W/2, dimY+0.9, -1.8, 4.2);
    dimSprite(`${H.toFixed(1)} m`, W+1.6, dimY+0.9, H/2, 4.2);

    // Per-item label — floats ABOVE the stack, always readable
    its.forEach((it) => {
      const p = pos[it.id];
      if (!p) return;
      const { dW, dH, effStack: rawEff } = dd(it);
      const effStack = Math.max(rawEff || 1, 1);
      const stackH   = effStack * (it.H || 0.4);  // total height of stack
      const cx = p.x + dW/2, cz = p.y + dH/2;
      const labelY = stackH + 0.55;  // above the top of the stack

      const c = document.createElement('canvas');
      c.width = 220; c.height = 52;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, 220, 52);
      // Zone color strip on left
      const zCol = zColor(it, 0);
      ctx.fillStyle = zCol;
      ctx.fillRect(0, 0, 8, 52);
      // White card background
      ctx.fillStyle = 'rgba(238,240,246,0.96)';
      ctx.fillRect(8, 0, 212, 52);
      // Navy border
      ctx.strokeStyle = '#1e3050';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, 218, 50);
      // Item name
      ctx.fillStyle = '#0f172a';
      ctx.font = 'bold 14px Arial,sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const name = it.item && it.item.length > 15 ? it.item.slice(0,13)+'…' : (it.item||it.id);
      ctx.fillText(name, 14, 6);
      // Dims + bundles
      ctx.font = '11px Arial,sans-serif';
      ctx.fillStyle = '#3a5080';
      ctx.fillText(`${dW.toFixed(1)}×${dH.toFixed(1)} m  ×${it.bundles||1}`, 14, 28);
      const tex = new THREE.CanvasTexture(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(Math.max(3.2, dW * 1.1), 0.82, 1);
      spr.position.set(cx, labelY, cz);
      add3(spr);
    });

    // ── Compact axis cross at origin (just thin lines) ────────
    const axL = Math.max(W, H) * .055;
    [[0xe53935,[0,.05,0],[axL,.05,0]],
     [0x43a047,[0,.05,0],[0,axL,.05]],
     [0x1e88e5,[0,.05,0],[0,.05,axL]]].forEach(([c,a,b])=>{
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]);
      add3(new THREE.Line(g, new THREE.LineBasicMaterial({ color:c })));
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
    // Total pcs across all items
    let grandTotalPcs = 0;
    its.forEach(it => {
      const snc2 = it.sn_contents || {};
      const keys2 = Object.keys(snc2);
      if (keys2.length) {
        let sq = 0; keys2.forEach(k=>{ (snc2[k]||[]).forEach(e=>{ sq+=(e.qty||0); }); });
        grandTotalPcs += Math.round(sq / keys2.length) * (it.bundles||0);
      }
    });
    const hdr = document.createElement('div');
    hdr.style.cssText = 'background:#1A1A1A;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;border-bottom:3px solid #CC0000;';
    hdr.innerHTML = `
      <div style="font-size:15px;font-weight:700;flex:1;min-width:200px;">📦 Bundle &amp; S/N Register</div>
      ${[ ['Items',its.length,''], ['Bundles',totalBundles,'bndl'], ['Total Pcs',grandTotalPcs.toLocaleString(),'pcs'], ['Floor Area',totalSqm.toFixed(1),'m²'], ['Serial Nos.',totalSNs,'SNs'] ]
        .map(([l,v,u])=>`<div style="text-align:center;"><div style="font-size:20px;font-weight:700;line-height:1">${v}</div><div style="font-size:10px;color:#ff9999;">${l}${u?' ('+u+')':''}</div></div>`).join('')}
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

      // ── All packed items (from sn_contents) ──────────────────
      const snc = it.sn_contents || {};
      const sncKeys = Object.keys(snc);
      // Collect ALL unique item codes across every SN in this item group
      const allItemNames = [];
      const seenItems = new Set();
      const isProjCode = s => /^\d{7}-\d+/.test(String(s||'').trim());
      sncKeys.forEach(k => {
        (snc[k] || []).forEach(e => {
          if (e.item && !seenItems.has(e.item) && !isProjCode(e.item)) {
            seenItems.add(e.item);
            allItemNames.push({ item: e.item, desc: e.desc || '', qty: e.qty || 0 });
          }
        });
      });
      if (allItemNames.length > 1) {
        // Multiple items packed in one bundle — show them all
        const contentsDiv = document.createElement('div');
        contentsDiv.style.cssText = 'padding:6px 12px 4px;border-bottom:1px solid #f1f5f9;background:#fafbfc;';
        let cHtml = `<div style="font-size:8px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Packed Items (${allItemNames.length})</div>`;
        allItemNames.forEach((n, idx) => {
          const isBold = idx === 0;
          cHtml += `<div style="display:flex;align-items:baseline;gap:5px;padding:1px 0;">
            <span style="font-size:8.5px;color:${color};flex-shrink:0;">▸</span>
            <span style="font-size:9.5px;font-weight:${isBold?'700':'500'};color:${isBold?'#1e293b':'#475569'};line-height:1.3;">${n.item}</span>
            ${n.qty ? `<span style="font-size:8.5px;color:#94a3b8;margin-left:auto;flex-shrink:0;">×${n.qty.toLocaleString()}</span>` : ''}
          </div>`;
        });
        contentsDiv.innerHTML = cHtml;
        card.appendChild(contentsDiv);
      }

      // ── Derived values ──────────────────────────────────────
      const floorPos    = it.floor_pos || 1;
      const actualStack = Math.ceil(it.bundles / floorPos);   // real stacks in use
      const maxStack    = it.stack || 1;                       // rated max capacity

      // pcs per bundle — read from sn_contents
      let pcsPerBndl = 0, totalPcs = 0;
      if (sncKeys.length) {
        let sumQty = 0;
        sncKeys.forEach(k => { (snc[k]||[]).forEach(e => { sumQty += (e.qty||0); }); });
        pcsPerBndl = Math.round(sumQty / sncKeys.length);
        totalPcs   = pcsPerBndl * it.bundles;
      }

      // Specs row
      const specs = document.createElement('div');
      specs.style.cssText = 'padding:8px 12px;display:flex;flex-wrap:wrap;gap:8px 16px;border-bottom:1px solid #f1f5f9;';
      specs.innerHTML = [
        `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Dims</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${it.L}×${it.W}×${it.H} m</div></div>`,
        `<div title="Actual stacks used / max rated capacity"><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Stack</div><div style="font-size:10.5px;font-weight:700;color:#1e293b;">×${actualStack}<span style="font-size:9px;color:#cbd5e1;font-weight:400;"> /max ${maxStack}</span></div></div>`,
        `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Floor Pos</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${floorPos}</div></div>`,
        pcsPerBndl ? `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Pcs / Bndl</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${pcsPerBndl.toLocaleString()}</div></div>` : '',
        pcsPerBndl ? `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Total Pcs</div><div style="font-size:11px;font-weight:700;color:${color};">${totalPcs.toLocaleString()}</div></div>` : '',
        `<div><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Area</div><div style="font-size:10.5px;font-weight:600;color:#1e293b;">${it.sqm.toFixed(1)} m²</div></div>`,
        it._containers && it._containers.length ?
          `<div style="flex-basis:100%"><div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;">Container</div><div style="font-size:10px;font-weight:600;color:#1e293b;">${it._containers.join(', ')}</div></div>` : ''
      ].join('');
      card.appendChild(specs);

      // Bundle dots — grid: columns = floor_pos, rows = actual stack layers
      const dotArea = document.createElement('div');
      dotArea.style.cssText = 'padding:8px 12px;border-bottom:1px solid #f1f5f9;';
      const maxDots = Math.min(it.bundles, 60);
      const gridCols = Math.min(floorPos, 20);
      let dotsHtml = `<div style="font-size:8.5px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;">Bundles <span style="color:#64748b;font-weight:600;font-size:9px;text-transform:none;">${it.bundles} bndl · ${floorPos} col · ×${actualStack} high</span></div>`;
      dotsHtml += `<div style="display:grid;grid-template-columns:repeat(${gridCols},14px);gap:3px;">`;
      for (let b = 0; b < maxDots; b++) {
        const row = Math.floor(b / floorPos);
        const layerShade = (1 - (row / Math.max(actualStack, 1)) * 0.45).toFixed(2);
        dotsHtml += `<div title="Col ${(b%floorPos)+1} · Layer ${row+1}" style="width:14px;height:14px;border-radius:2px;background:${color};opacity:${layerShade};"></div>`;
      }
      if (it.bundles > 60) dotsHtml += `<div style="font-size:9px;color:#64748b;align-self:center;padding:0 4px;grid-column:span 2;">+${it.bundles-60}</div>`;
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

    // ═══════════════════════════════════════════════════════════
    // RENTAL RECOMMENDATION SECTION — from 21-shipment analysis
    // ═══════════════════════════════════════════════════════════
    const SHIP_DATA = [
      [1,11,200,368.44,47.6],[2,13,238,377.35,50.0],[3,14,279,533.74,49.1],
      [4,14,303,334.20,21.2],[5,14,226,391.92,51.6],[6,14,277,382.27,50.0],
      [7,14,257,434.98,41.6],[8,14,292,346.94,26.2],[9,13,221,402.68,57.6],
      [10,14,253,354.17,39.7],[11,14,266,388.74,34.6],[12,14,311,368.00,30.6],
      [13,14,256,357.02,43.5],[14,14,259,514.95,61.8],[15,14,291,392.22,34.6],
      [16,14,305,374.18,36.7],[17,14,230,387.41,54.4],[18,14,266,396.07,35.7],
      [19,14,265,443.06,51.0],[20,14,246,374.76,44.2],[21,14,213,402.91,68.4],
    ];

    const rentalSec = document.createElement('div');
    rentalSec.style.cssText = 'padding:0 20px 32px;';

    // ── Divider + section title ────────────────────────────
    const rentalTitle = document.createElement('div');
    rentalTitle.style.cssText = 'background:#1e3a5f;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;margin-top:8px;';
    rentalTitle.innerHTML = `
      <div style="font-size:13px;font-weight:700;letter-spacing:.5px;">🏭 WAREHOUSE RENTAL AREA RECOMMENDATION</div>
      <div style="font-size:10px;color:#93c5fd;margin-top:2px;">Based on full analysis of 21 completed shipments (OMEGA-TLS-002)</div>`;
    rentalSec.appendChild(rentalTitle);

    const rentalBody = document.createElement('div');
    rentalBody.style.cssText = 'background:#fff;border-radius:0 0 8px 8px;border:1px solid #e2e8f0;border-top:none;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,.06);';

    // ── Big answer boxes ───────────────────────────────────
    const answerRow = document.createElement('div');
    answerRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;';
    answerRow.innerHTML = `
      <div style="background:#eff6ff;border:3px solid #2563eb;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:40px;font-weight:800;color:#2563eb;line-height:1;">600 m²</div>
        <div style="font-size:10px;font-weight:700;color:#2563eb;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;">★ Recommended Rental</div>
        <div style="font-size:9px;color:#64748b;margin-top:4px;">Single shipment + 25% corridors + 20% safety</div>
      </div>
      <div style="background:#f0fdf4;border:3px solid #16a34a;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:40px;font-weight:800;color:#16a34a;line-height:1;">800 m²</div>
        <div style="font-size:10px;font-weight:700;color:#16a34a;margin-top:4px;text-transform:uppercase;letter-spacing:.5px;">★ Safe Peak Rental</div>
        <div style="font-size:9px;color:#64748b;margin-top:4px;">Two overlapping shipments + corridors + safety</div>
      </div>`;
    rentalBody.appendChild(answerRow);

    // ── Key averages grid ──────────────────────────────────
    const avgGrid = document.createElement('div');
    avgGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin-bottom:16px;';
    [
      { label:'Shipments Analysed', val:'21',     color:'#64748b', bg:'#f8fafc' },
      { label:'Avg Floor Area',     val:'396.5 m²', color:'#2563eb', bg:'#eff6ff' },
      { label:'Max Floor Area',     val:'533.7 m²', color:'#d97706', bg:'#fef3c7' },
      { label:'Min Floor Area',     val:'334.2 m²', color:'#64748b', bg:'#f8fafc' },
      { label:'Avg Containers',     val:'13.8',    color:'#64748b', bg:'#f8fafc' },
      { label:'Avg Bundles / Ship', val:'260',     color:'#64748b', bg:'#f8fafc' },
      { label:'95th Percentile',    val:'515 m²',  color:'#d97706', bg:'#fef3c7' },
      { label:'Avg Long Parts %',   val:'44.3%',   color:'#64748b', bg:'#f8fafc' },
    ].forEach(m => {
      const c = document.createElement('div');
      c.style.cssText = `background:${m.bg};border-radius:6px;padding:8px 10px;text-align:center;`;
      c.innerHTML = `<div style="font-size:15px;font-weight:700;color:${m.color};">${m.val}</div>
                     <div style="font-size:9px;color:#94a3b8;margin-top:2px;">${m.label}</div>`;
      avgGrid.appendChild(c);
    });
    rentalBody.appendChild(avgGrid);

    // ── Per-shipment mini table ────────────────────────────
    const tblTitle = document.createElement('div');
    tblTitle.style.cssText = 'font-size:10px;font-weight:700;color:#1e3a5f;letter-spacing:.6px;text-transform:uppercase;margin-bottom:6px;';
    tblTitle.textContent = 'Per-Shipment Floor Area — All 21 Shipments';
    rentalBody.appendChild(tblTitle);

    const miniTbl = document.createElement('table');
    miniTbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;margin-bottom:16px;';
    const hdrCols = ['Ship #','Containers','Bundles','Floor Area (m²)','Long %'];
    miniTbl.innerHTML = `<thead><tr style="background:#1e3a5f;color:#fff;">
      ${hdrCols.map(h=>`<th style="padding:5px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.4px;text-align:center;">${h}</th>`).join('')}
    </tr></thead><tbody>
      ${SHIP_DATA.map(([s,c,b,f,lp],i)=>{
        const hi = f > 430;
        const bg = hi ? '#fef3c7' : (i%2===0 ? '#fff' : '#f8fafc');
        const fc = hi ? '#b45309' : '#1e293b';
        return `<tr style="border-bottom:1px solid #f1f5f9;background:${bg};">
          <td style="padding:4px 8px;text-align:center;font-weight:700;color:#1e3a5f;">${s}</td>
          <td style="padding:4px 8px;text-align:center;">${c}</td>
          <td style="padding:4px 8px;text-align:center;">${b}</td>
          <td style="padding:4px 8px;text-align:center;font-weight:${hi?700:500};color:${fc};">${f.toFixed(1)}</td>
          <td style="padding:4px 8px;text-align:center;">${lp.toFixed(1)}%</td>
        </tr>`;
      }).join('')}
      <tr style="background:#e0e7ff;font-weight:700;border-top:2px solid #6366f1;">
        <td style="padding:5px 8px;text-align:center;color:#4338ca;">AVG</td>
        <td style="padding:5px 8px;text-align:center;color:#4338ca;">13.8</td>
        <td style="padding:5px 8px;text-align:center;color:#4338ca;">259.7</td>
        <td style="padding:5px 8px;text-align:center;color:#4338ca;">396.5</td>
        <td style="padding:5px 8px;text-align:center;color:#4338ca;">44.3%</td>
      </tr>
    </tbody>`;
    rentalBody.appendChild(miniTbl);

    // ── Decision guide ─────────────────────────────────────
    const decTitle = document.createElement('div');
    decTitle.style.cssText = 'font-size:10px;font-weight:700;color:#1e3a5f;letter-spacing:.6px;text-transform:uppercase;margin-bottom:6px;';
    decTitle.textContent = 'Rental Decision Guide';
    rentalBody.appendChild(decTitle);

    const decGrid = document.createElement('div');
    decGrid.style.cssText = 'display:grid;gap:6px;';
    [
      { opt:'A — Minimum',       area:'480 m²', bg:'#f8fafc', ac:'#475569', desc:'Strict sequential delivery — each ship fully cleared before next.',    bc:'#cbd5e1' },
      { opt:'B — Recommended ★', area:'600 m²', bg:'#f0fdf4', ac:'#16a34a', desc:'Normal ops — one shipment at a time. Covers 90% of all deliveries.',   bc:'#16a34a' },
      { opt:'C — Safe Peak ★',   area:'800 m²', bg:'#eff6ff', ac:'#2563eb', desc:'Two overlapping shipments. Recommended if schedule compression likely.',bc:'#2563eb' },
      { opt:'D — Absolute Max',  area:'1,260 m²',bg:'#fef2f2',ac:'#dc2626', desc:'Both largest ships (#3 + #14) on-site simultaneously. Extreme case.',  bc:'#dc2626' },
    ].forEach(d => {
      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:10px;background:${d.bg};border:1.5px solid ${d.bc}44;border-radius:6px;padding:8px 12px;`;
      row.innerHTML = `
        <div style="font-weight:700;font-size:11px;color:${d.ac};min-width:130px;">${d.opt}</div>
        <div style="font-size:10px;color:#475569;flex:1;">${d.desc}</div>
        <div style="font-size:16px;font-weight:800;color:${d.ac};white-space:nowrap;">${d.area}</div>`;
      decGrid.appendChild(row);
    });
    rentalBody.appendChild(decGrid);

    // ── Formula note ───────────────────────────────────────
    const formula = document.createElement('div');
    formula.style.cssText = 'margin-top:14px;background:#eff6ff;border:1px solid #93c5fd;border-radius:6px;padding:10px 14px;font-size:10px;color:#1e3a5f;';
    formula.innerHTML = `<strong>Formula:</strong> Rental Area = Material Floor Area × 1.25 <span style="color:#64748b;">(corridors)</span> × 1.20 <span style="color:#64748b;">(safety buffer)</span>`;
    rentalBody.appendChild(formula);

    rentalSec.appendChild(rentalBody);
    RPT.mount.appendChild(rentalSec);
  }

  // ═══════════════════════════════════════════════════════════
  // THREE.JS — 3D Truck Loading Simulator (EasyCargo-style)
  // ═══════════════════════════════════════════════════════════

  // Constants mirrored from main.js
  const DECK_L = 12.0, DECK_W = 2.45, DECK_H_OFF = 1.35; // deck height off ground

  const TL = {
    scene: null, camera: null, renderer: null,
    mount: null, sidebar: null, infoBar: null, canvasWrap: null,
    objs: [], selectedTrip: 0,
    drag: false, theta: -0.55, phi: 0.68, r: 16,
    ds: { x: 0, y: 0 }, itemColorMap: {}, _utilChart: null
  };

  function initTL() {
    const wrap = document.querySelector('.cv-wrap');
    TL.mount = document.createElement('div');
    TL.mount.id = 'tl-mount';
    TL.mount.style.cssText = [
      'position:absolute;top:0;left:0;width:100%;height:100%;display:none;',
      'overflow:hidden;font-family:Segoe UI,Arial,sans-serif;background:#f0f4f8;'
    ].join('');
    wrap.appendChild(TL.mount);

    // ── Left sidebar — trip list ─────────────────────────────
    TL.sidebar = document.createElement('div');
    TL.sidebar.style.cssText = [
      'position:absolute;top:0;left:0;width:200px;height:100%;',
      'background:#1e293b;overflow-y:auto;display:flex;flex-direction:column;'
    ].join('');
    TL.mount.appendChild(TL.sidebar);

    // ── Right area: header + 3D canvas ──────────────────────
    TL.infoBar = document.createElement('div');
    TL.infoBar.style.cssText = [
      'position:absolute;top:0;left:200px;right:0;height:52px;',
      'background:#fff;border-bottom:1px solid #e2e8f0;',
      'display:flex;align-items:center;padding:0 16px;gap:20px;',
      'box-shadow:0 1px 4px rgba(0,0,0,.08);'
    ].join('');
    TL.mount.appendChild(TL.infoBar);

    TL.canvasWrap = document.createElement('div');
    TL.canvasWrap.style.cssText = 'position:absolute;top:52px;left:200px;right:0;bottom:0;overflow:hidden;';
    TL.mount.appendChild(TL.canvasWrap);

    // ── Three.js scene ───────────────────────────────────────
    if (!window.THREE) return;
    const cw = wrap.clientWidth - 200, ch = wrap.clientHeight - 52;
    TL.scene    = new THREE.Scene();
    TL.scene.background = new THREE.Color(0xecf2f9);
    TL.scene.fog = new THREE.Fog(0xecf2f9, 60, 130);

    TL.camera   = new THREE.PerspectiveCamera(42, Math.max(cw,1)/Math.max(ch,1), 0.1, 400);
    TL.renderer = new THREE.WebGLRenderer({ antialias: true });
    TL.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    TL.renderer.setSize(cw, ch);
    TL.renderer.shadowMap.enabled = false;
    TL.canvasWrap.appendChild(TL.renderer.domElement);

    // Lighting — bright factory floor
    TL.scene.add(new THREE.AmbientLight(0xffffff, 1.05));
    const sun = new THREE.DirectionalLight(0xfff8f0, 0.8);
    sun.position.set(20, 35, 15); TL.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xd8eeff, 0.3);
    fill.position.set(-15, 12, -10); TL.scene.add(fill);

    // Floor: clean asphalt
    const flr = new THREE.Mesh(new THREE.PlaneGeometry(300, 300),
      new THREE.MeshLambertMaterial({ color: 0xdad6cf }));
    flr.rotation.x = -Math.PI/2; flr.position.y = -0.01;
    TL.scene.add(flr);
    TL.scene.add(new THREE.GridHelper(300, 150, 0xccc8c0, 0xd4d0c8));

    // Controls hint
    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,.8);color:#475569;border:1px solid #e2e8f0;border-radius:20px;padding:3px 14px;font-size:10px;pointer-events:none;white-space:nowrap;';
    hint.textContent = '⟳ Left-drag: orbit  ·  Scroll: zoom  ·  Dbl-click: reset';
    TL.canvasWrap.appendChild(hint);

    // Orbit controls
    const el = TL.renderer.domElement;
    el.style.cursor = 'grab';
    el.addEventListener('mousedown', e => { TL.drag=true; TL.ds={x:e.clientX,y:e.clientY}; el.style.cursor='grabbing'; });
    el.addEventListener('mousemove', e => {
      if (!TL.drag) return;
      TL.theta += (e.clientX-TL.ds.x)*0.007;
      TL.phi = Math.max(0.08, Math.min(1.45, TL.phi-(e.clientY-TL.ds.y)*0.007));
      TL.ds = {x:e.clientX,y:e.clientY}; tlRefreshCam();
    });
    el.addEventListener('mouseup',    () => { TL.drag=false; el.style.cursor='grab'; });
    el.addEventListener('mouseleave', () => { TL.drag=false; el.style.cursor='grab'; });
    el.addEventListener('wheel', e => { TL.r=Math.max(4,Math.min(55,TL.r+e.deltaY*0.03)); tlRefreshCam(); }, {passive:true});
    el.addEventListener('dblclick', () => { TL.theta=-0.55; TL.phi=0.68; TL.r=16; tlRefreshCam(); });

    // Render loop
    (function loop() { requestAnimationFrame(loop); if (TL.renderer) TL.renderer.render(TL.scene, TL.camera); })();
  }

  function tlRefreshCam() {
    if (!TL.camera) return;
    const cx = DECK_L/2, cy = DECK_H_OFF + 1, cz = DECK_W/2;
    TL.camera.position.set(
      cx + TL.r * Math.sin(TL.phi) * Math.cos(TL.theta),
      DECK_H_OFF + TL.r * Math.cos(TL.phi),
      cz + TL.r * Math.sin(TL.phi) * Math.sin(TL.theta)
    );
    TL.camera.lookAt(cx, cy, cz);
  }

  function clearTL3() { TL.objs.forEach(o => TL.scene.remove(o)); TL.objs = []; }
  function addTL(obj) { TL.scene.add(obj); TL.objs.push(obj); }

  function renderTL() {
    if (!TL.mount) return;
    const trips = (window.getCachedTruckTrips && window.items && window.items.length)
      ? window.getCachedTruckTrips() : [];

    // Clear and rebuild as a modern 2D dashboard (Chart.js + HTML)
    TL.mount.innerHTML = '';
    TL.mount.style.cssText = [
      'position:absolute;top:0;left:0;width:100%;height:100%;',
      'overflow-y:auto;background:#f1f5f9;',
      'font-family:Segoe UI,Arial,sans-serif;'
    ].join('');

    const nTrips    = trips.length;
    const totalBdl  = (window.items||[]).reduce((s,it)=>s+it.bundles,0);
    const avgUtil   = nTrips ? Math.round(trips.reduce((s,t)=>{
      const ua=t.loads.reduce((ss,ld)=>ss+ld.w*ld.h,0);
      return s + ua/(DECK_L*DECK_W)*100;
    },0)/nTrips) : 0;
    const roundTrip = 95;
    const tripsPerDay = 4;
    const days = nTrips ? Math.ceil(nTrips/tripsPerDay) : 0;

    // ── Header ─────────────────────────────────────────────
    const hdr = document.createElement('div');
    hdr.style.cssText = 'background:#1e3a5f;color:#fff;padding:14px 20px;display:flex;align-items:center;gap:24px;flex-wrap:wrap;';
    hdr.innerHTML = `
      <div style="font-size:15px;font-weight:700;flex:1;min-width:200px;">🚛 Truck Loading Plan — 12m Flatbed (${DECK_L}×${DECK_W}m)</div>
      ${[['Trips',nTrips,''],['Bundles',totalBdl,''],['Avg Util.',avgUtil+'%',''],['Working Days',days,''],['Round Trip',roundTrip+' min','']]
        .map(([l,v])=>`<div style="text-align:center;"><div style="font-size:20px;font-weight:700;line-height:1;">${v}</div><div style="font-size:9px;color:#93c5fd;text-transform:uppercase;letter-spacing:.5px;">${l}</div></div>`).join('')}
    `;
    TL.mount.appendChild(hdr);

    if (!nTrips) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:60px;color:#94a3b8;font-size:14px;';
      empty.textContent = 'Select a scenario to view truck loading plan.';
      TL.mount.appendChild(empty);
      return;
    }

    // ── Utilisation chart ──────────────────────────────────
    const chartSec = document.createElement('div');
    chartSec.style.cssText = 'padding:16px 20px 8px;background:#fff;border-bottom:1px solid #e2e8f0;';
    chartSec.innerHTML = '<div style="font-size:11px;font-weight:700;color:#1e3a5f;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px;">Deck Utilisation per Trip (%)</div>';
    const chartH = document.createElement('div');
    chartH.style.cssText = `height:${Math.min(160, nTrips*22+40)}px;position:relative;`;
    const utilCvs = document.createElement('canvas');
    chartH.appendChild(utilCvs);
    chartSec.appendChild(chartH);
    TL.mount.appendChild(chartSec);

    // Destroy old chart if any
    if (TL._utilChart) { try { TL._utilChart.destroy(); } catch(e){} TL._utilChart = null; }
    if (window.Chart) {
      const utils = trips.map(t => {
        const ua = t.loads.reduce((s,ld)=>s+ld.w*ld.h,0);
        return Math.round(ua/(DECK_L*DECK_W)*100);
      });
      TL._utilChart = new Chart(utilCvs, {
        type: 'bar',
        data: {
          labels: trips.map((_,i)=>`Trip ${i+1}`),
          datasets: [{
            label: 'Utilisation %',
            data: utils,
            backgroundColor: utils.map(u => u>=80?'#22c55ecc':u>=60?'#f59e0bcc':'#ef4444cc'),
            borderColor:     utils.map(u => u>=80?'#16a34a':u>=60?'#d97706':'#dc2626'),
            borderWidth: 1.5, borderRadius: 4,
          }]
        },
        options: {
          indexAxis: 'y', responsive:true, maintainAspectRatio:false,
          plugins: { legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${ctx.raw}%`}} },
          scales: {
            x: { min:0, max:100, ticks:{font:{size:9},color:'#64748b',callback:v=>v+'%'}, grid:{color:'#f1f5f9'} },
            y: { ticks:{font:{size:9},color:'#64748b'}, grid:{display:false} }
          },
          onClick: (_e, els) => {
            if (!els.length) return;
            const ti = els[0].index;
            // Re-render with new selection (lightweight — just call renderTL again)
            TL.selectedTrip = (TL.selectedTrip === ti) ? -1 : ti;
            renderTL();
            // Scroll to card
            setTimeout(() => {
              const cards = TL.mount.querySelectorAll('[data-ti]');
              if (cards[ti]) cards[ti].scrollIntoView({ behavior:'smooth', block:'center' });
            }, 60);
          }
        }
      });
    }

    // ── Selection state ────────────────────────────────────
    if (TL.selectedTrip === undefined || TL.selectedTrip >= trips.length) TL.selectedTrip = -1;
    const allCards = [];

    // ── Trip cards grid ────────────────────────────────────
    const grid = document.createElement('div');
    grid.style.cssText = 'padding:16px 20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;';
    TL.mount.appendChild(grid);

    trips.forEach((trip, ti) => {
      const usedArea = trip.loads.reduce((s,ld)=>s+ld.w*ld.h,0);
      const util     = Math.round(usedArea/(DECK_L*DECK_W)*100);
      const usedVol  = trip.loads.reduce((s,ld)=>s+ld.w*ld.h*(ld.sH||0.4),0);
      const uColor   = util>=80?'#22c55e':util>=60?'#f59e0b':'#ef4444';
      const uBg      = util>=80?'#f0fdf4':util>=60?'#fffbeb':'#fef2f2';

      const card = document.createElement('div');
      const isSel = TL.selectedTrip === ti;
      card.style.cssText = `background:#fff;border-radius:10px;border:${isSel?'2px solid #3b82f6':'1px solid #e2e8f0'};overflow:hidden;box-shadow:${isSel?'0 0 0 3px #3b82f633,0 4px 16px rgba(59,130,246,.2)':'0 1px 4px rgba(0,0,0,.07)'};transform:${isSel?'translateY(-2px)':'none'};transition:all .15s ease;cursor:pointer;`;
      card.title = `Click to ${isSel?'deselect':'select'} Trip ${ti+1}`;
      card.setAttribute('data-ti', ti);
      card.addEventListener('click', () => { TL.selectedTrip = isSel ? -1 : ti; renderTL(); });
      allCards.push(card);

      // Card header
      const cHdr = document.createElement('div');
      cHdr.style.cssText = `background:#1e3a5f;padding:10px 14px;display:flex;align-items:center;gap:10px;`;
      cHdr.innerHTML = `
        <span style="color:#fff;font-size:12px;font-weight:700;">Trip ${ti+1}</span>
        <span style="color:#93c5fd;font-size:10px;">${trip.loads.length} pcs · ${usedVol.toFixed(1)} m³</span>
        <div style="margin-left:auto;background:${uColor};color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;">${util}%</div>`;
      card.appendChild(cHdr);

      // Utilisation bar
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'height:5px;background:#e2e8f0;';
      const barFill = document.createElement('div');
      barFill.style.cssText = `height:100%;width:${util}%;background:${uColor};transition:width .4s;`;
      barWrap.appendChild(barFill);
      card.appendChild(barWrap);

      // ── 2D deck diagram via Canvas ─────────────────────
      const deckWrap = document.createElement('div');
      deckWrap.style.cssText = 'padding:10px 14px 6px;background:#f8fafc;';
      const dCvs = document.createElement('canvas');
      const SCALE = 24; // px per metre
      dCvs.width  = Math.round(DECK_L * SCALE);
      dCvs.height = Math.round(DECK_W * SCALE);
      dCvs.style.cssText = `width:100%;height:auto;max-width:${DECK_L*SCALE}px;border:1.5px solid #cbd5e1;border-radius:4px;display:block;`;
      deckWrap.appendChild(dCvs);
      card.appendChild(deckWrap);

      // Draw deck diagram after mount
      setTimeout(() => {
        const dc = dCvs.getContext('2d');
        const sw = dCvs.width, sh = dCvs.height;
        // Deck background — timber colour
        dc.fillStyle = '#e8e0cc'; dc.fillRect(0,0,sw,sh);
        // Plank lines
        dc.strokeStyle = '#d4c8ae'; dc.lineWidth = 0.8;
        for (let y=0; y<=sh; y+=6) { dc.beginPath(); dc.moveTo(0,y); dc.lineTo(sw,y); dc.stroke(); }
        // 1m grid lines
        dc.strokeStyle = '#bbb0a0'; dc.lineWidth = 0.5;
        for (let x=0; x<=DECK_L; x++) { const px=x*SCALE; dc.beginPath(); dc.moveTo(px,0); dc.lineTo(px,sh); dc.stroke(); }
        // Items
        trip.loads.forEach((ld, li) => {
          const c   = TL.itemColorMap && TL.itemColorMap[ld.item] ? TL.itemColorMap[ld.item] : CHART_COLORS[li%CHART_COLORS.length];
          const px  = ld.x*SCALE, pz = ld.y*SCALE;
          const pw  = ld.w*SCALE, ph = ld.h*SCALE;
          // Fill
          dc.globalAlpha = 0.88;
          dc.fillStyle = c;
          dc.fillRect(px+1, pz+1, pw-2, ph-2);
          // Border
          dc.globalAlpha = 1;
          dc.strokeStyle = '#1e3a5f'; dc.lineWidth = 1.2;
          dc.strokeRect(px+1, pz+1, pw-2, ph-2);
          // Label
          if (pw > 28 && ph > 10) {
            dc.fillStyle = '#fff';
            dc.font = `bold ${Math.min(9, pw*0.14)}px Segoe UI,Arial`;
            dc.textAlign = 'center'; dc.textBaseline = 'middle';
            const short = ld.item.length>12 ? ld.item.slice(0,10)+'…' : ld.item;
            dc.fillText(short, px+pw/2, pz+ph/2);
          }
        });
        // Deck border
        dc.strokeStyle = '#334155'; dc.lineWidth = 2;
        dc.strokeRect(0,0,sw,sh);
        // Dimension label: DECK_L
        dc.fillStyle = '#475569'; dc.font = '8px Segoe UI,Arial';
        dc.textAlign = 'center'; dc.textBaseline = 'top';
        dc.fillText(`${DECK_L} m`, sw/2, 2);
        dc.save(); dc.translate(4, sh/2); dc.rotate(-Math.PI/2);
        dc.textAlign = 'center'; dc.fillText(`${DECK_W} m`, 0, 0); dc.restore();
      }, 0);

      // Item tags
      const tagArea = document.createElement('div');
      tagArea.style.cssText = 'padding:8px 14px 10px;display:flex;flex-wrap:wrap;gap:4px;';
      const seen = {};
      trip.loads.forEach((ld, li) => {
        if (seen[ld.item]) return; seen[ld.item] = true;
        const c = TL.itemColorMap && TL.itemColorMap[ld.item] ? TL.itemColorMap[ld.item] : CHART_COLORS[li%CHART_COLORS.length];
        const cnt = trip.loads.filter(x=>x.item===ld.item).length;
        const short = ld.item.length>18 ? ld.item.slice(0,16)+'…' : ld.item;
        const tag = document.createElement('span');
        tag.style.cssText = `font-size:9px;font-weight:600;background:${c}22;color:${c};border:1px solid ${c}55;border-radius:4px;padding:2px 6px;`;
        tag.textContent = `${short}${cnt>1?' ×'+cnt:''}`;
        tagArea.appendChild(tag);
      });
      card.appendChild(tagArea);

      // Expanded detail row — shown only when selected
      if (TL.selectedTrip === ti) {
        const detail = document.createElement('div');
        detail.style.cssText = 'border-top:1px solid #e0e8f8;background:#f0f6ff;padding:10px 14px;font-size:10px;color:#1e3a5f;';
        const rows = trip.loads.map((ld,li) => {
          const c = TL.itemColorMap&&TL.itemColorMap[ld.item]?TL.itemColorMap[ld.item]:CHART_COLORS[li%CHART_COLORS.length];
          return `<div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #dde8f5;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c};flex-shrink:0;"></span>
            <span style="font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${ld.item}</span>
            <span style="color:#475569;">${ld.w.toFixed(1)}×${ld.h.toFixed(1)} m</span>
            <span style="color:#64748b;">${ld.bdlCount||1} bdl</span>
            <span style="color:#3b82f6;font-weight:600;">${Math.round(ld.w*ld.h/(DECK_L*DECK_W)*100)}%</span>
          </div>`;
        }).join('');
        detail.innerHTML = `<div style="font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-bottom:6px;">Item breakdown</div>${rows}
          <div style="margin-top:8px;display:flex;gap:16px;font-size:9px;color:#64748b;">
            <span>🟩 Used: ${usedArea.toFixed(1)} m²</span>
            <span>⬜ Free: ${(DECK_L*DECK_W-usedArea).toFixed(1)} m²</span>
            <span>📦 Vol: ${usedVol.toFixed(1)} m³</span>
          </div>`;
        card.appendChild(detail);
      }

      grid.appendChild(card);
    });

    // ── Logistics summary ──────────────────────────────────
    const logSec = document.createElement('div');
    logSec.style.cssText = 'padding:0 20px 20px;';
    logSec.innerHTML = `
      <div style="background:#1e3a5f;border-radius:10px;padding:16px 20px;color:#fff;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;margin-bottom:12px;color:#93c5fd;">Mobilization &amp; Logistics Analysis</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
          ${[
            ['🚛 Truck trips',nTrips],
            ['📦 Total bundles',totalBdl],
            ['📊 Avg utilisation',avgUtil+'%'],
            ['⏱ Round trip','~'+roundTrip+' min'],
            ['🔄 Trips/day',tripsPerDay+' (450 min ÷ '+roundTrip+' min)'],
            ['📅 Working days',days+' day'+(days!==1?'s':'')],
            ['🏗 Forklifts','2 × 5T'],
            ['🚌 Trailers','1 × 12m flatbed'],
          ].map(([l,v])=>`
            <div style="background:rgba(255,255,255,.08);border-radius:6px;padding:8px 12px;">
              <div style="font-size:11px;color:#93c5fd;">${l}</div>
              <div style="font-size:14px;font-weight:700;margin-top:2px;">${v}</div>
            </div>`).join('')}
        </div>
      </div>`;
    TL.mount.appendChild(logSec);
  }

  function updateTLView(trips, pgInd) {
    if (!TL.scene) return;
    if (pgInd) pgInd.textContent = `Trip ${TL.selectedTrip+1}/${trips.length}`;

    // Highlight active trip card
    Array.from(TL.sidebar.children).forEach((c, i) => {
      if (i === 0) return; // header
      c.style.background = (i-1 === TL.selectedTrip) ? '#334155' : 'transparent';
    });

    clearTL3();
    const trip = trips[TL.selectedTrip];
    if (!trip) return;

    // ── Ground pad ───────────────────────────────────────────
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(DECK_L+6, 0.08, DECK_W+10),
      new THREE.MeshLambertMaterial({ color: 0xc8c4bc })
    );
    pad.position.set(DECK_L/2, -0.04, DECK_W/2); addTL(pad);

    // ── Truck chassis ────────────────────────────────────────
    const chassisMat = new THREE.MeshLambertMaterial({ color: 0x1c2b3a });
    // Main frame rails
    [[DECK_L/2, DECK_H_OFF-0.32, 0.28],[DECK_L/2, DECK_H_OFF-0.32, DECK_W-0.28]].forEach(([x,y,z])=>{
      const rail = new THREE.Mesh(new THREE.BoxGeometry(DECK_L+0.6, 0.18, 0.22), chassisMat);
      rail.position.set(x, y, z); addTL(rail);
    });
    // Cross-members every 2m
    for (let xi=0; xi<=DECK_L; xi+=2) {
      const xm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, DECK_W), chassisMat);
      xm.position.set(xi, DECK_H_OFF-0.32, DECK_W/2); addTL(xm);
    }

    // ── Wheels ───────────────────────────────────────────────
    const wheelMat = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    const rimMat   = new THREE.MeshLambertMaterial({ color: 0xb0b8c4 });
    [[0.9,0.28],[0.9,DECK_W-0.28],[DECK_L-0.9,0.28],[DECK_L-0.9,DECK_W-0.28],
     [DECK_L-2.4,0.28],[DECK_L-2.4,DECK_W-0.28]].forEach(([wx,wz])=>{
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46,0.46,0.26,16), wheelMat);
      w.rotation.x = Math.PI/2; w.position.set(wx, 0.46, wz); addTL(w);
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.26,0.26,0.28,8), rimMat);
      rim.rotation.x = Math.PI/2; rim.position.set(wx, 0.46, wz); addTL(rim);
    });

    // ── Cab ──────────────────────────────────────────────────
    const cabMat    = new THREE.MeshLambertMaterial({ color: 0x1e3a5f });
    const glassMat  = new THREE.MeshLambertMaterial({ color: 0x7dd3fc, transparent:true, opacity:.7 });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, DECK_W+0.1), cabMat);
    cab.position.set(-1.3, DECK_H_OFF+0.85, DECK_W/2); addTL(cab);
    // Windshield
    const ws = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, DECK_W-0.2), glassMat);
    ws.position.set(-0.01, DECK_H_OFF+1.35, DECK_W/2); addTL(ws);
    // Side windows
    [[0.06,DECK_H_OFF+1.3,0.15],[0.06,DECK_H_OFF+1.3,DECK_W-0.15]].forEach(([x,y,z])=>{
      const sw = new THREE.Mesh(new THREE.BoxGeometry(1.4,0.65,0.06), glassMat);
      sw.position.set(-1.0, y, z); addTL(sw);
    });
    // Front bumper + grill
    const bump = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.42, DECK_W+0.15),
      new THREE.MeshLambertMaterial({ color: 0x0f172a }));
    bump.position.set(-2.72, DECK_H_OFF+0.21, DECK_W/2); addTL(bump);
    // Exhaust pipe
    const exh = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,1.8,8),
      new THREE.MeshLambertMaterial({ color: 0x475569 }));
    exh.position.set(-1.9, DECK_H_OFF+1.7, DECK_W+0.15); addTL(exh);

    // ── Flatbed deck ─────────────────────────────────────────
    const deckMat = new THREE.MeshLambertMaterial({ color: 0xc8bfa8 }); // timber planks
    const deck = new THREE.Mesh(new THREE.BoxGeometry(DECK_L, 0.14, DECK_W), deckMat);
    deck.position.set(DECK_L/2, DECK_H_OFF, DECK_W/2); addTL(deck);

    // Deck plank lines
    const plankMat = new THREE.MeshLambertMaterial({ color: 0xb0a890, transparent:true, opacity:.6 });
    for (let z=0; z<=DECK_W; z+=0.3) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(DECK_L,.02,.02),plankMat);
      p.position.set(DECK_L/2, DECK_H_OFF+0.072, z); addTL(p);
    }

    // Side stake pockets / rails
    const stakeMat = new THREE.MeshLambertMaterial({ color: 0x64748b });
    [[DECK_L/2,DECK_H_OFF+0.22,0],[DECK_L/2,DECK_H_OFF+0.22,DECK_W]].forEach(([x,y,z])=>{
      const rail = new THREE.Mesh(new THREE.BoxGeometry(DECK_L+0.04,.14,.06),stakeMat);
      rail.position.set(x,y,z); addTL(rail);
    });
    // Vertical stakes every ~2m
    for (let sx=0; sx<=DECK_L; sx+=2) {
      [[0],[DECK_W]].forEach(([sz])=>{
        const st = new THREE.Mesh(new THREE.BoxGeometry(.06,.55,.06),stakeMat);
        st.position.set(sx, DECK_H_OFF+0.35, sz); addTL(st);
      });
    }
    // Rear gate
    const gate = new THREE.Mesh(new THREE.BoxGeometry(.08, 0.55, DECK_W+0.1), stakeMat);
    gate.position.set(DECK_L+0.04, DECK_H_OFF+0.35, DECK_W/2); addTL(gate);

    // ── Items on deck ─────────────────────────────────────────
    const ITEM_Y = DECK_H_OFF + 0.07;
    trip.loads.forEach((ld, li) => {
      const cssC  = TL.itemColorMap[ld.item] || CHART_COLORS[li % CHART_COLORS.length];
      const hexC  = cssToHex(cssC);
      const iH    = Math.max(0.12, ld.sH || 0.4);

      // Item body — slight gap on each side
      const gap   = 0.04;
      const iMat  = new THREE.MeshLambertMaterial({ color: hexC });
      const box   = new THREE.Mesh(new THREE.BoxGeometry(ld.w-gap, iH, ld.h-gap), iMat);
      box.position.set(ld.x + ld.w/2, ITEM_Y + iH/2, ld.y + ld.h/2);
      addTL(box);

      // Top face lighter sheen
      const topMat = new THREE.MeshLambertMaterial({ color: cssToHex(shadeColor(cssC, 1.18)) });
      const top = new THREE.Mesh(new THREE.BoxGeometry(ld.w-gap, 0.02, ld.h-gap), topMat);
      top.position.set(ld.x + ld.w/2, ITEM_Y + iH + 0.01, ld.y + ld.h/2);
      addTL(top);
    });

    // ── Measurement markers along deck edge ───────────────────
    const mrkMat = new THREE.MeshLambertMaterial({ color: 0xf97316 }); // orange
    for (let xi=0; xi<=DECK_L; xi+=2) {
      const mk = new THREE.Mesh(new THREE.BoxGeometry(.04,.32,.04), mrkMat);
      mk.position.set(xi, DECK_H_OFF+0.16, -0.12); addTL(mk);
    }

    // ── Cinch strap lines across deck ────────────────────────
    const strapMat = new THREE.MeshLambertMaterial({ color: 0xf59e0b, transparent:true, opacity:.7 });
    const maxH = Math.max(...trip.loads.map(ld=>ld.sH||0.4), 0.4);
    [DECK_L*0.25, DECK_L*0.5, DECK_L*0.75].forEach(sx => {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(.04, maxH+0.22, DECK_W+0.08), strapMat);
      strap.position.set(sx, DECK_H_OFF+0.07+(maxH+0.22)/2-0.1, DECK_W/2); addTL(strap);
    });

    tlRefreshCam();
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
    const tlMnt  = document.getElementById('tl-mount');
    [cvs, konva, three, pixi, bdMnt, rptMnt, tlMnt].forEach(el => el && (el.style.display = 'none'));

    // Legend: show only for 2D
    manageLegend(tab);

    if (tab === '2d' && konva) {
      konva.style.display = 'block';
      K._fitted = false;
      renderKonva();
    } else if (tab === 'three' && three) {
      three.style.display = 'block';
      // Flash-of-old-scene guard: cover with opaque overlay, build, then fade out
      let _cover = three.querySelector('._flash_cover');
      if (!_cover) {
        _cover = document.createElement('div');
        _cover.className = '_flash_cover';
        _cover.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#d8dde8;z-index:99;pointer-events:none;transition:opacity 0.18s ease;';
        three.appendChild(_cover);
      }
      _cover.style.opacity = '1';
      buildThreeScene();
      // Fade out after scene is built
      requestAnimationFrame(() => requestAnimationFrame(() => { _cover.style.opacity = '0'; }));
    } else if (tab === 'fp' && pixi) {
      pixi.style.display = 'block';
      renderPixiFootprint();
    } else if (tab === 'tl' && tlMnt) {
      tlMnt.style.display = 'block';
      renderTL();
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
      if (window.THREE) { try { initTL();    } catch(e) { console.warn('[TL]',e); } }
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
        else if (currentTab === 'tl')    { renderTL(); }
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
