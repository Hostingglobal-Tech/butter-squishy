// 바삭 버터 말랑이 — 누르면 찌그러지고, 잡아당기면 늘어나고, 놓으면 출렁 돌아온다.
(function () {
  'use strict';

  // ---------- 저장값 ----------
  const SAVE_KEY = 'butter-squishy-v1';
  const save = Object.assign({ best: 0, total: 0, stretch: 0 }, safeLoad());
  function safeLoad() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* 저장 불가 무시 */ } }

  const GOALS = [30, 80, 150];
  const RAINBOW_AT = 150;

  const BUTTERS = [
    { id: 'pink', name: '딸기', color: '#f6a9c6', ink: '#2348b8' },
    { id: 'mint', name: '민트', color: '#9fe4d2', ink: '#2348b8' },
    { id: 'yellow', name: '버터', color: '#ffe07a', ink: '#c0392b' },
    { id: 'rainbow', name: '무지개', color: '#ffffff', ink: '#6a3db8', locked: true },
  ];

  // ---------- 렌더러·장면 ----------
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  const camTarget = new THREE.Vector3(0, 0.3, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xffd9e8, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(3, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xfff0f6, 0.35);
  rim.position.set(-4, 3, -3);
  scene.add(rim);

  // 접시
  const plate = new THREE.Mesh(
    new THREE.CylinderGeometry(3.2, 2.9, 0.18, 64),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
  );
  plate.position.y = -0.69;
  plate.receiveShadow = true;
  scene.add(plate);
  const PLATE_TOP = plate.position.y + 0.09;

  // ---------- 버터바 말랑이 몸체 ----------
  const W = 3.2, H = 1.1, D = 1.45, R = 0.38;
  const geo = new THREE.BoxGeometry(W, H, D, 40, 14, 18);
  const pos = geo.attributes.position;
  const N = pos.count;
  const rest = new Float32Array(N * 3);
  const inner = new THREE.Vector3(W / 2 - R, H / 2 - R, D / 2 - R);
  {
    const p = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      p.fromBufferAttribute(pos, i);
      c.set(clamp(p.x, -inner.x, inner.x), clamp(p.y, -inner.y, inner.y), clamp(p.z, -inner.z, inner.z));
      p.sub(c).normalize().multiplyScalar(R).add(c);
      rest[i * 3] = p.x; rest[i * 3 + 1] = p.y; rest[i * 3 + 2] = p.z;
      pos.setXYZ(i, p.x, p.y, p.z);
    }
  }
  geo.computeVertexNormals();
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
  const restNormal = Float32Array.from(geo.attributes.normal.array);

  // 면 경계에서 겹친 꼭짓점을 묶어 법선을 평균낸다(이음매 없애기)
  const seamGroups = (function () {
    const map = new Map();
    for (let i = 0; i < N; i++) {
      const k = Math.round(rest[i * 3] * 1e4) + ',' + Math.round(rest[i * 3 + 1] * 1e4) + ',' + Math.round(rest[i * 3 + 2] * 1e4);
      const g = map.get(k);
      if (g) g.push(i); else map.set(k, [i]);
    }
    return Array.from(map.values()).filter(g => g.length > 1);
  })();

  const off = new Float32Array(N * 3);   // 쉬는 자리에서 벗어난 양
  const vel = new Float32Array(N * 3);

  const butter = new THREE.Mesh(geo, []);
  butter.castShadow = true;
  butter.rotation.y = -0.32;
  butter.position.y = PLATE_TOP + H / 2 - 0.02;
  scene.add(butter);

  function labelTexture(b) {
    const cv = document.createElement('canvas');
    cv.width = 1024; cv.height = 464;
    const g = cv.getContext('2d');
    paintBase(g, cv.width, cv.height, b);
    g.fillStyle = b.ink;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '900 190px "Arial Black", Arial, sans-serif';
    g.fillText('BUTTER', 512, 250);
    g.font = 'bold 48px Arial, sans-serif';
    g.fillText('4OZ.  NET WT (113G)', 512, 95);
    g.font = 'bold 40px Arial, sans-serif';
    g.fillText('SALTED', 512, 385);
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = 4;
    return t;
  }
  function plainTexture(b) {
    if (b.id !== 'rainbow') return null;
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    paintBase(cv.getContext('2d'), 512, 64, b);
    const t = new THREE.CanvasTexture(cv);
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function paintBase(g, w, h, b) {
    if (b.id === 'rainbow') {
      const gr = g.createLinearGradient(0, 0, w, 0);
      ['#ffb3c7', '#ffd59e', '#fff59e', '#b9f5c4', '#a6dcff', '#d3b8ff'].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
      g.fillStyle = gr;
    } else {
      g.fillStyle = b.color;
    }
    g.fillRect(0, 0, w, h);
  }
  function makeMaterials(b) {
    const base = {
      roughness: 0.55, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff),
      clearcoat: 0.25, clearcoatRoughness: 0.5,
    };
    const tex = plainTexture(b);
    const side = new THREE.MeshPhysicalMaterial(Object.assign({}, base, tex ? { map: tex } : { color: b.color }));
    const top = new THREE.MeshPhysicalMaterial(Object.assign({}, base, { map: labelTexture(b) }));
    return [side, side, top, side, side, side];
  }

  let currentButter = 0;
  function setButter(i) {
    if (BUTTERS[i].id === 'rainbow' && save.best < RAINBOW_AT && save.total < RAINBOW_AT) {
      toast('바삭 ' + RAINBOW_AT + '번 하면 열려요!');
      return;
    }
    currentButter = i;
    (Array.isArray(butter.material) ? butter.material : []).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
    butter.material = makeMaterials(BUTTERS[i]);
    clearSprinkles();
    // 새 버터가 톡 떨어지며 출렁
    for (let k = 0; k < N; k++) { vel[k * 3 + 1] -= 3.5; }
    sfx.boing();
    renderSwatches();
  }

  // ---------- 물리 ----------
  const K_REST = 60, DAMP = 6.5, K_GRAB = 520;
  const grabs = new Map(); // pointerId -> 잡기 상태

  function step(dt) {
    const gs = Array.from(grabs.values());
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      const rx = rest[i3], ry = rest[i3 + 1], rz = rest[i3 + 2];
      let ax = -K_REST * off[i3] - DAMP * vel[i3];
      let ay = -K_REST * off[i3 + 1] - DAMP * vel[i3 + 1];
      let az = -K_REST * off[i3 + 2] - DAMP * vel[i3 + 2];
      for (let g = 0; g < gs.length; g++) {
        const s = gs[g];
        const dx = rx - s.p.x, dy = ry - s.p.y, dz = rz - s.p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const w = Math.exp(-d2 / (2 * s.sigma * s.sigma));
        if (w > 0.002) {
          const k = K_GRAB * w;
          ax += k * (s.t.x - off[i3]);
          ay += k * (s.t.y - off[i3 + 1]);
          az += k * (s.t.z - off[i3 + 2]);
        }
        if (s.mode === 'squish' && s.depth > 0) {
          // 눌린 둘레가 옆으로 불룩 — 부피가 있는 느낌
          const ring = Math.exp(-d2 / (2 * 0.9 * 0.9)) - w;
          if (ring > 0.01) {
            const b = s.depth * 0.5 * ring * K_REST;
            ax += restNormal[i3] * b; ay += restNormal[i3 + 1] * b; az += restNormal[i3 + 2] * b;
          }
        }
      }
      vel[i3] += ax * dt; vel[i3 + 1] += ay * dt; vel[i3 + 2] += az * dt;
      off[i3] += vel[i3] * dt; off[i3 + 1] += vel[i3 + 1] * dt; off[i3 + 2] += vel[i3 + 2] * dt;
      // 바닥(접시) 아래로 뚫고 들어가지 않게
      const worldBottom = ry + off[i3 + 1] + butter.position.y;
      if (worldBottom < PLATE_TOP) { off[i3 + 1] += PLATE_TOP - worldBottom; if (vel[i3 + 1] < 0) vel[i3 + 1] *= -0.2; }
    }
  }

  function writeMesh(time) {
    // 숨 쉬듯 살짝 말랑
    const breathe = 1 + Math.sin(time * 2.2) * 0.012;
    for (let i = 0; i < N; i++) {
      const i3 = i * 3;
      pos.array[i3] = rest[i3] * breathe + off[i3];
      pos.array[i3 + 1] = rest[i3 + 1] / breathe + off[i3 + 1];
      pos.array[i3 + 2] = rest[i3 + 2] * breathe + off[i3 + 2];
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal.array;
    for (let g = 0; g < seamGroups.length; g++) {
      const grp = seamGroups[g];
      let x = 0, y = 0, z = 0;
      for (const i of grp) { x += nrm[i * 3]; y += nrm[i * 3 + 1]; z += nrm[i * 3 + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      for (const i of grp) { nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l; }
    }
    geo.attributes.normal.needsUpdate = true;
  }

  // ---------- 입력 ----------
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmpV = new THREE.Vector3();

  function toNdc(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  canvas.addEventListener('pointerdown', e => {
    if (!started) return;
    toNdc(e);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(butter, false)[0];
    if (!hit) return;
    canvas.setPointerCapture(e.pointerId);
    const localHit = butter.worldToLocal(hit.point.clone());
    // 잡은 곳의 "쉬는 자리" 좌표를 찾는다(가장 가까운 꼭짓점의 rest)
    const vi = nearestVertex(localHit);
    const p = new THREE.Vector3(rest[vi * 3], rest[vi * 3 + 1], rest[vi * 3 + 2]);
    const n = new THREE.Vector3(restNormal[vi * 3], restNormal[vi * 3 + 1], restNormal[vi * 3 + 2]);
    const camN = camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camN, hit.point);
    grabs.set(e.pointerId, {
      p, n, plane, startWorld: hit.point.clone(), mode: 'squish', depth: 0.28, sigma: 0.42,
      t: n.clone().multiplyScalar(-0.28), held: 0, lastCrackle: 0, maxPull: 0, crackleAt: 0.35,
    });
    crunch(hit.point, 1);
  });

  canvas.addEventListener('pointermove', e => {
    const s = grabs.get(e.pointerId);
    if (!s) return;
    toNdc(e);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(s.plane, tmpV)) return;
    const a = butter.worldToLocal(s.startWorld.clone());
    const b = butter.worldToLocal(tmpV.clone());
    const d = b.sub(a);
    const len = d.length();
    if (len > 0.22) {
      if (s.mode !== 'stretch') { s.mode = 'stretch'; s.sigma = 0.62; sfx.squelch(0.5); }
      if (len > 3.2) d.multiplyScalar(3.2 / len);
      s.t.copy(d);
      const pull = Math.min(len, 3.2);
      if (pull > s.maxPull) s.maxPull = pull;
      if (pull > s.crackleAt) { s.crackleAt += 0.35; crunch(tmpV, 0.5); }
      setStretch(pull);
    } else if (s.mode === 'stretch') {
      s.t.copy(d);
    }
  });

  function release(e) {
    const s = grabs.get(e.pointerId);
    if (!s) return;
    grabs.delete(e.pointerId);
    if (s.mode === 'stretch' && s.maxPull > 0.6) {
      sfx.squelch(0.9);
      vibrate(25);
    }
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function nearestVertex(lp) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const dx = pos.array[i * 3] - lp.x, dy = pos.array[i * 3 + 1] - lp.y, dz = pos.array[i * 3 + 2] - lp.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function updateHolds(dt) {
    for (const s of grabs.values()) {
      if (s.mode !== 'squish') continue;
      s.held += dt;
      s.depth = Math.min(0.62, 0.28 + s.held * 0.35);
      s.t.copy(s.n).multiplyScalar(-s.depth);
      s.lastCrackle += dt;
      if (s.lastCrackle > 0.32) {
        s.lastCrackle = 0;
        const w = butter.localToWorld(s.p.clone());
        crunch(w, 0.45);
      }
    }
  }

  // ---------- 바삭 점수 ----------
  let count = 0;
  const elCount = document.getElementById('count');
  const elStars = document.getElementById('stars');
  const elStretch = document.getElementById('stretch');

  function crunch(worldPoint, power) {
    count++;
    save.total++;
    if (count > save.best) save.best = count;
    elCount.textContent = count;
    elCount.classList.remove('pop'); void elCount.offsetWidth; elCount.classList.add('pop');
    sfx.crunch(power);
    spawnCrumbs(worldPoint, Math.round(6 + power * 10));
    vibrate(power > 0.8 ? 18 : 8);
    // 톡 치면 몸 전체가 살짝 출렁
    for (let i = 0; i < N; i++) vel[i * 3 + 1] -= 0.25 * power;
    checkGoals();
    if (count % 10 === 0) persist();
  }

  function checkGoals() {
    renderStars();
    const hit = GOALS.indexOf(count);
    if (hit >= 0) {
      celebrate(['좋아요!', '대단해요!', '바삭 대장!'][hit]);
      if (count === RAINBOW_AT) setTimeout(() => toast('무지개 버터가 열렸어요!'), 1400);
      renderSwatches();
      persist();
    }
  }
  function renderStars() {
    elStars.innerHTML = GOALS.map(g => '<span class="star ' + (count >= g ? 'on' : '') + '">★</span>').join('');
    const next = GOALS.find(g => count < g);
    document.getElementById('goal').textContent = next ? '다음 별까지 ' + (next - count) + '번' : '별 3개 다 모았어요!';
  }
  let stretchShown = 0;
  function setStretch(pull) {
    const cm = Math.round(pull * 10);
    if (cm > stretchShown) {
      stretchShown = cm;
      elStretch.textContent = '쭉~ ' + cm + 'cm';
      if (cm > save.stretch) { save.stretch = cm; elStretch.textContent += ' 신기록!'; }
    }
  }

  // ---------- 부스러기·축하 꽃가루 ----------
  const MAXP = 400;
  const crumbGeo = new THREE.BoxGeometry(0.07, 0.05, 0.06);
  const crumbMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  const crumbs = new THREE.InstancedMesh(crumbGeo, crumbMat, MAXP);
  crumbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  crumbs.castShadow = true;
  scene.add(crumbs);
  const parts = [];
  for (let i = 0; i < MAXP; i++) parts.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), s: 1, rest: false });
  let pNext = 0;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), col = new THREE.Color();
  for (let i = 0; i < MAXP; i++) { mtx.makeScale(0, 0, 0); crumbs.setMatrixAt(i, mtx); crumbs.setColorAt(i, col.set(0xffffff)); }

  function spawnCrumbs(at, n, palette) {
    const b = BUTTERS[currentButter];
    for (let k = 0; k < n; k++) {
      const P = parts[pNext]; pNext = (pNext + 1) % MAXP;
      P.life = palette ? 3.2 : 1.6;
      P.p.copy(at);
      P.v.set((Math.random() - 0.5) * 3, 1.5 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      if (palette) P.v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 4, (Math.random() - 0.5) * 3);
      P.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      P.s = palette ? 1.6 : 0.6 + Math.random() * 0.9;
      P.rest = false;
      const c = palette ? palette[Math.floor(Math.random() * palette.length)]
        : (b.id === 'rainbow' ? ['#ffb3c7', '#fff59e', '#a6dcff', '#b9f5c4'][k % 4] : b.color);
      crumbs.setColorAt((pNext + MAXP - 1) % MAXP, col.set(c));
    }
    crumbs.instanceColor.needsUpdate = true;
  }

  function updateParts(dt) {
    for (let i = 0; i < MAXP; i++) {
      const P = parts[i];
      if (P.life <= 0) continue;
      P.life -= dt;
      if (!P.rest) {
        P.v.y -= 9 * dt;
        P.p.addScaledVector(P.v, dt);
        P.r.x += dt * 8; P.r.y += dt * 6;
        const onPlate = Math.hypot(P.p.x, P.p.z) < 3.1;
        if (onPlate && P.p.y < PLATE_TOP + 0.025) { P.p.y = PLATE_TOP + 0.025; P.v.set(0, 0, 0); P.rest = true; }
        if (P.p.y < -4) P.life = 0;
      }
      const s = P.life <= 0 ? 0 : P.s * Math.min(1, P.life * 2);
      q.setFromEuler(P.r); sc.set(s, s, s);
      mtx.compose(P.p, q, sc);
      crumbs.setMatrixAt(i, mtx);
    }
    crumbs.instanceMatrix.needsUpdate = true;
  }

  const banner = document.getElementById('banner');
  function celebrate(text) {
    banner.textContent = text;
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
    spawnCrumbs(new THREE.Vector3(0, 2.2, 0), 90, ['#ff6b9a', '#ffd23f', '#3ec1ff', '#7ee081', '#b38bff', '#ff9f43']);
    sfx.fanfare();
    vibrate([40, 60, 40, 60, 80]);
  }

  // ---------- 토핑(스프링클) — 몸이 출렁여도 붙어서 같이 움직인다 ----------
  const sprinkles = [];
  const sprGeo = new THREE.CapsuleGeometry(0.03, 0.13, 4, 8);
  const topVerts = [];
  for (let i = 0; i < N; i++) if (restNormal[i * 3 + 1] > 0.9) topVerts.push(i);

  function addSprinkles() {
    if (sprinkles.length >= 90) { toast('토핑이 가득해요!'); return; }
    const colors = [0xff5c8a, 0xffd23f, 0x3ec1ff, 0x7ee081, 0xb38bff, 0xffffff, 0x8b5a2b];
    for (let k = 0; k < 15; k++) {
      const vi = topVerts[Math.floor(Math.random() * topVerts.length)];
      const m = new THREE.Mesh(sprGeo, new THREE.MeshStandardMaterial({ color: colors[k % colors.length], roughness: 0.4 }));
      m.castShadow = true;
      m.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI);
      butter.add(m);
      sprinkles.push({ m, vi, drop: 2.5 + Math.random() * 1.5, delay: k * 0.04 });
    }
    sfx.sprinkle();
  }
  function clearSprinkles() {
    for (const s of sprinkles) { butter.remove(s.m); s.m.material.dispose(); }
    sprinkles.length = 0;
  }
  function updateSprinkles(dt) {
    const nrm = geo.attributes.normal.array;
    for (const s of sprinkles) {
      if (s.delay > 0) { s.delay -= dt; s.m.visible = false; continue; }
      s.m.visible = true;
      if (s.drop > 0) s.drop = Math.max(0, s.drop - dt * 7);
      const i3 = s.vi * 3;
      s.m.position.set(
        pos.array[i3] + nrm[i3] * 0.03,
        pos.array[i3 + 1] + nrm[i3 + 1] * 0.03 + s.drop,
        pos.array[i3 + 2] + nrm[i3 + 2] * 0.03
      );
    }
  }

  // ---------- 소리(WebAudio로 직접 합성) ----------
  const sfx = (function () {
    let ac = null, master = null, noise = null, muted = false;
    function init() {
      if (ac) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function ok() { return ac && !muted; }
    function burst(t, dur, freq, q, gain, type) {
      const src = ac.createBufferSource();
      src.buffer = noise;
      const f = ac.createBiquadFilter();
      f.type = type || 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.8, dur + 0.02);
    }
    function tone(t, f0, f1, dur, gain, type) {
      const o = ac.createOscillator();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    return {
      init,
      setMuted(m) { muted = m; },
      get muted() { return muted; },
      crunch(power) {
        if (!ok()) return;
        const t = ac.currentTime;
        const n = Math.round(5 + power * 9);
        for (let i = 0; i < n; i++) {
          burst(t + Math.random() * (0.05 + power * 0.12), 0.008 + Math.random() * 0.02,
            1800 + Math.random() * 5200, 1.2 + Math.random() * 3, (0.35 + Math.random() * 0.5) * power);
        }
        burst(t, 0.12 * power + 0.04, 500, 0.7, 0.18 * power, 'lowpass');
      },
      squelch(power) {
        if (!ok()) return;
        const t = ac.currentTime;
        const src = ac.createBufferSource(); src.buffer = noise;
        const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
        f.frequency.setValueAtTime(300, t);
        f.frequency.exponentialRampToValueAtTime(1400, t + 0.12);
        f.frequency.exponentialRampToValueAtTime(250, t + 0.3);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.5 * power, t + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.32);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t, Math.random() * 0.5, 0.35);
      },
      boing() {
        if (!ok()) return;
        const t = ac.currentTime;
        tone(t, 180, 90, 0.35, 0.35, 'sine');
        tone(t + 0.05, 420, 260, 0.25, 0.12, 'triangle');
      },
      sprinkle() {
        if (!ok()) return;
        const t = ac.currentTime;
        for (let i = 0; i < 12; i++) tone(t + i * 0.035, 1800 + Math.random() * 1600, 1500, 0.06, 0.08, 'sine');
      },
      fanfare() {
        if (!ok()) return;
        const t = ac.currentTime;
        [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.12, f, f * 1.01, 0.28, 0.22, 'triangle'));
      },
      resume() { if (ac && ac.state === 'suspended') ac.resume(); },
    };
  })();

  function vibrate(p) { if (!sfx.muted && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) { /* 미지원 */ } } }

  // ---------- 화면 UI ----------
  const swatches = document.getElementById('swatches');
  function renderSwatches() {
    const unlocked = save.best >= RAINBOW_AT || save.total >= RAINBOW_AT;
    swatches.innerHTML = '';
    BUTTERS.forEach((b, i) => {
      const btn = document.createElement('button');
      btn.className = 'sw' + (i === currentButter ? ' sel' : '') + (b.locked && !unlocked ? ' locked' : '');
      btn.style.background = b.id === 'rainbow'
        ? 'linear-gradient(90deg,#ffb3c7,#ffd59e,#fff59e,#b9f5c4,#a6dcff,#d3b8ff)' : b.color;
      btn.innerHTML = '<span>' + (b.locked && !unlocked ? RAINBOW_AT : b.name) + '</span>';
      btn.addEventListener('click', () => setButter(i));
      swatches.appendChild(btn);
    });
  }

  let toastTimer = 0;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  document.getElementById('btnTop').addEventListener('click', addSprinkles);
  document.getElementById('btnSound').addEventListener('click', e => {
    sfx.setMuted(!sfx.muted);
    e.currentTarget.textContent = sfx.muted ? '소리 꺼짐' : '소리 켜짐';
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    count = 0; stretchShown = 0;
    elCount.textContent = '0';
    elStretch.textContent = '';
    clearSprinkles();
    renderStars();
    sfx.boing();
  });
  document.getElementById('btnFull').addEventListener('click', toggleFull);
  function toggleFull() {
    const d = document;
    if (!d.fullscreenElement) { (d.documentElement.requestFullscreen || function () {}).call(d.documentElement); }
    else if (d.exitFullscreen) d.exitFullscreen();
  }

  let started = false;
  document.getElementById('start').addEventListener('click', () => {
    sfx.init(); sfx.resume();
    started = true;
    document.getElementById('intro').classList.add('hide');
    try { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); } catch (e) { /* 무시 */ }
    try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) { /* 무시 */ }
    setTimeout(() => toast('눌러 보고, 잡아서 쭉~ 당겨 봐!'), 500);
    sfx.boing();
  });
  // 주소에 ?start 를 붙이면 시작 화면 없이 바로 논다(소리는 첫 터치 때 켜진다)
  if (new URLSearchParams(location.search).has('start')) {
    started = true;
    document.getElementById('intro').classList.add('hide');
    canvas.addEventListener('pointerdown', () => { sfx.init(); sfx.resume(); }, { once: true, capture: true });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sfx.resume(); });
  document.getElementById('best').textContent = save.best;

  // ---------- 화면 크기(접기·펼치기 대응) ----------
  const bar = document.querySelector('.bar');
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 아래 버튼줄이 버터를 가리지 않게: 버튼줄을 뺀 높이에 맞추고, 그만큼 장면을 위로 올린다
    const barH = Math.min(bar.offsetHeight, h * 0.45);
    const freeH = Math.max(h - barH, h * 0.55);
    camera.setViewOffset(w, h, 0, barH / 2, w, h);
    // 버터가 가로·세로 어느 화면에서도 꽉 차게
    const needW = 5.4, needH = 3.6 * (h / freeH);
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const distH = (needH / 2) / Math.tan(vf / 2);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const distW = (needW / 2) / Math.tan(hf / 2);
    const dist = Math.max(distH, distW);
    camera.position.set(0, dist * 0.55, dist * 0.84);
    camera.lookAt(camTarget);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(document.body);
  resize();

  // ---------- 루프 ----------
  setButter(0);
  renderStars();
  let last = performance.now();
  function frame(now) {
    let dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const time = now / 1000;
    updateHolds(dt);
    const sub = 3;
    for (let i = 0; i < sub; i++) step(dt / sub);
    writeMesh(time);
    updateParts(dt);
    updateSprinkles(dt);
    if (save.best > Number(document.getElementById('best').textContent)) document.getElementById('best').textContent = save.best;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.addEventListener('pagehide', persist);

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
})();
