import * as THREE from './vendor/three/three.module.js';
import { createWallGeometry, MM_PER_UNIT, DIMENSIONS } from './maze-geometry.mjs';

// The board pivots at the origin; camera stays fixed in world space.
export function projectBoardInput(camera, quaternion, rect, clientX, clientY, cardinal = false) {
  const x = (clientX - rect.left) / rect.width * 2 - 1, y = 1 - (clientY - rect.top) / rect.height * 2;
  if (![x, y].every(Number.isFinite)) return { x: 0, y: 0 };
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion), 0);
  const inverse = quaternion.clone().invert(), raycaster = new THREE.Raycaster();
  function hitAt(nx, ny) {
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3())?.applyQuaternion(inverse);
  }
  const center = hitAt(0, 0), selected = hitAt(x, y);
  if (!center || !selected) return { x: 0, y: 0 };
  selected.sub(center); const length = selected.length();
  if (!length) return { x: 0, y: 0 };
  const magnitude = cardinal ? 1 : Math.max(0, Math.min(1, (Math.hypot(x, y) - .04) / .96)) ** 2;
  if (!magnitude) return { x: 0, y: 0 };
  return { x: selected.x / length * magnitude, y: -selected.y / length * magnitude };
}

export function goalCallout(point, width, height) {
  if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) return null;
  const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
  const left = Math.max(2, Math.min(width - 44, x + (x > width / 2 ? -82 : 42)));
  const top = Math.max(2, Math.min(height - 22, y - 48));
  const startX = left + (left < x ? 40 : 0), startY = top + 16;
  const dx = x - startX, dy = y - startY, length = Math.hypot(dx, dy) || 1;
  const ux = dx / length, uy = dy / length;
  return { left, top, x, y, path: `M ${startX} ${startY} Q ${startX + dx * .65 - 5} ${startY + dy * .15} ${x} ${y} M ${x - ux * 5 - uy * 2.5} ${y - uy * 5 + ux * 2.5} L ${x} ${y} L ${x - ux * 5 + uy * 2.5} ${y - uy * 5 - ux * 2.5}` };
}

export function createMazeRenderer({ canvas, geometry: g, goalLabel, onContextLost, onContextRestored, observe }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  const owned = new Set(), scene = new THREE.Scene(), board = new THREE.Group();
  const own = resource => (owned.add(resource), resource);
  let disposed = false, lost = false, previous, width = 1, height = 1;
  const lostContext = event => { event.preventDefault(); lost = true; onContextLost(); };
  const restoredContext = () => { lost = false; onContextRestored(); };
  canvas.addEventListener('webglcontextlost', lostContext);
  canvas.addEventListener('webglcontextrestored', restoredContext);
  function dispose() {
    if (disposed) return; disposed = true;
    canvas.removeEventListener('webglcontextlost', lostContext);
    canvas.removeEventListener('webglcontextrestored', restoredContext);
    for (const resource of owned) resource.dispose();
    renderer.dispose(); if (goalLabel) goalLabel.hidden = true;
  }
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(max-width: 600px)').matches ? 1.5 : 2));
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.add(board);
    const radius = g.extent * MM_PER_UNIT, ballRadius = g.radius * MM_PER_UNIT;
    const camera = new THREE.PerspectiveCamera(36, 1, 1, 2500); camera.up.set(0, 1, 0);
    const point = new THREE.Vector3(), target = new THREE.Vector3(), offset = new THREE.Vector3();
    const axis = new THREE.Vector3(), roll = new THREE.Quaternion(), delta = new THREE.Vector3();
    const local = p => new THREE.Vector3((p.x - g.center.x) * MM_PER_UNIT, -(p.y - g.center.y) * MM_PER_UNIT, 0);
    const woodCanvas = document.createElement('canvas'); woodCanvas.width = woodCanvas.height = 512;
    const ctx = woodCanvas.getContext('2d'); if (!ctx) throw new Error('Wood texture unavailable');
    ctx.fillStyle = '#cfb184'; ctx.fillRect(0, 0, 512, 512);
    // Original procedural colour grain, ~1–3 mm bands. Geometry alone supplies relief.
    for (let i = 0; i < 180; i++) {
      const y = i * 2.85; ctx.beginPath(); ctx.moveTo(0, y);
      ctx.bezierCurveTo(160, y + Math.sin(i * .08) * 11, 350, y - Math.cos(i * .06) * 9, 512, y);
      ctx.strokeStyle = `rgba(91,55,24,${.05 + (Math.sin(i * 2.17) + 1) * .065})`; ctx.lineWidth = .65 + (i % 3) * .4; ctx.stroke();
    }
    const grain = own(new THREE.CanvasTexture(woodCanvas)); grain.colorSpace = THREE.SRGBColorSpace;
    grain.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    const floorMaterial = own(new THREE.MeshStandardMaterial({ map: grain, color: 0xfff2dc, roughness: .67, metalness: 0 }));
    const wallMaterial = own(new THREE.MeshStandardMaterial({ map: grain, color: 0xe7cba1, roughness: .48, metalness: 0 }));
    const cylinder = (depth, overhang = 0) => { const shape = own(new THREE.CylinderGeometry(radius + overhang, radius + overhang, depth, 192)); shape.rotateX(Math.PI / 2); shape.scale(1, 370.5 / 371, 1); return shape; };
    function planarGrain(shape) {
      const positions = shape.attributes.position, uv = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) { uv[i * 2] = (positions.getX(i) + radius) / (radius * 2); uv[i * 2 + 1] = (positions.getY(i) + radius) / (radius * 2); }
      shape.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return shape;
    }
    const base = new THREE.Mesh(planarGrain(cylinder(DIMENSIONS.baseDepth)), floorMaterial); base.position.z = -DIMENSIONS.baseDepth / 2; base.receiveShadow = true; base.castShadow = true; board.add(base);
    const wallsGeometry = planarGrain(own(createWallGeometry(g)));
    const walls = new THREE.Mesh(wallsGeometry, wallMaterial); walls.castShadow = walls.receiveShadow = true; board.add(walls);
    const steelMaterial = own(new THREE.MeshStandardMaterial({ color: 0xe1e5e8, metalness: 1, roughness: .105, envMapIntensity: 1.35 }));
    const ball = new THREE.Mesh(own(new THREE.SphereGeometry(ballRadius, 32, 20)), steelMaterial); ball.castShadow = true; board.add(ball);
    const shadowCanvas = document.createElement('canvas'); shadowCanvas.width = shadowCanvas.height = 64;
    const shadowCtx = shadowCanvas.getContext('2d'), gradient = shadowCtx.createRadialGradient(32, 32, 2, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(20,12,5,.65)'); gradient.addColorStop(.45, 'rgba(20,12,5,.28)'); gradient.addColorStop(1, 'rgba(20,12,5,0)');
    shadowCtx.fillStyle = gradient; shadowCtx.fillRect(0, 0, 64, 64);
    const contactMaterial = own(new THREE.MeshBasicMaterial({ map: own(new THREE.CanvasTexture(shadowCanvas)), transparent: true, depthWrite: false }));
    const contact = new THREE.Mesh(own(new THREE.PlaneGeometry(ballRadius * 3.5, ballRadius * 3.5)), contactMaterial); contact.position.z = .025; board.add(contact);
    const goalMaterial = own(new THREE.MeshBasicMaterial({ color: 0x27b5aa }));
    const goal = new THREE.Mesh(own(new THREE.CircleGeometry(1, 48)), goalMaterial);
    goal.scale.set(4.5 * MM_PER_UNIT, 8 * MM_PER_UNIT, 1);
    goal.position.copy(local({ x: g.goal.x, y: g.goal.y - 1.5 })); goal.position.z = .04; board.add(goal);
    const goalOutline = new THREE.Mesh(own(new THREE.RingGeometry(.88, 1, 48)), own(new THREE.MeshBasicMaterial({ color: 0x275b55 })));
    goalOutline.scale.copy(goal.scale); goalOutline.position.copy(goal.position); goalOutline.position.z += .005; board.add(goalOutline);
    const glassMaterial = own(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: .008, transmission: 1, thickness: DIMENSIONS.glassThickness, ior: 1.5, opacity: 1, envMapIntensity: 1, reflectivity: .5 }));
    const glassSideMaterial = own(new THREE.MeshPhysicalMaterial({ color: 0xc5ddd3, roughness: .06, transmission: .5, thickness: DIMENSIONS.glassThickness, ior: 1.5, envMapIntensity: 1.3 }));
    const glass = new THREE.Mesh(cylinder(DIMENSIONS.glassThickness, 1.2), [glassSideMaterial, glassMaterial, glassMaterial]); glass.position.z = DIMENSIONS.glassBottom + DIMENSIONS.glassThickness / 2; board.add(glass);
    const edgeMaterial = own(new THREE.LineBasicMaterial({ color: 0xc0d3cf, transparent: true, opacity: .45 }));
    const rimGeometry = own(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 193 }, (_, i) => new THREE.Vector3(radius * Math.cos(i / 192 * Math.PI * 2), radius * 370.5 / 371 * Math.sin(i / 192 * Math.PI * 2), DIMENSIONS.glassBottom + DIMENSIONS.glassThickness))));
    board.add(new THREE.Line(rimGeometry, edgeMaterial));
    const bottomRim = new THREE.Line(rimGeometry, edgeMaterial); bottomRim.position.z = -DIMENSIONS.glassThickness; board.add(bottomRim);
    const glassEdgeMaterial = own(new THREE.MeshPhysicalMaterial({ color: 0xd9e7e3, roughness: .08, metalness: .1, transmission: .65, thickness: .3, ior: 1.5 }));
    const glassLip = new THREE.Mesh(own(new THREE.TorusGeometry(radius - .15, .18, 6, 192)), glassEdgeMaterial); glassLip.scale.y = 370.5 / 371; glassLip.position.z = DIMENSIONS.glassBottom + DIMENSIONS.glassThickness - .18; board.add(glassLip);
    const supportMaterial = own(new THREE.MeshStandardMaterial({ color: 0x3b3025, roughness: .78 }));
    // Spherical underside seat shares the tilt origin: z=-6 attachment, z=-14
    // pedestal contact stays invariant through all permitted 30° inclinations.
    const seatAngle = Math.acos(-DIMENSIONS.baseDepth / 14);
    const seat = new THREE.Mesh(own(new THREE.SphereGeometry(14, 48, 16, 0, Math.PI * 2, seatAngle, Math.PI - seatAngle)), supportMaterial); seat.geometry.rotateX(Math.PI / 2); board.add(seat);
    const support = new THREE.Mesh(own(new THREE.CylinderGeometry(5, 30, 24, 48)), supportMaterial); support.geometry.rotateX(Math.PI / 2); support.position.z = -26; support.castShadow = true; scene.add(support);
    const stand = new THREE.Mesh(own(new THREE.CylinderGeometry(30, 34, 8, 96)), supportMaterial); stand.geometry.rotateX(Math.PI / 2); stand.position.z = -42; stand.receiveShadow = true; scene.add(stand);
    const studio = new THREE.Scene(); studio.background = new THREE.Color(0x747b80);
    const studioMaterials = [], studioGeometries = [];
    function panel(x, y, z, sx, sy, sz, color, intensity = 1) {
      const geometry = new THREE.BoxGeometry(sx, sy, sz), material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) });
      studioMaterials.push(material); studioGeometries.push(geometry); const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); studio.add(mesh);
    }
    panel(-180, 80, 230, 140, 260, 8, 0xffffff); panel(200, -50, 100, 10, 230, 240, 0xced8df);
    panel(-65, 105, 250, 14, 120, 8, 0xffffff, 5);
    panel(0, 0, -90, 900, 900, 8, 0x68513b); panel(0, -300, 80, 480, 12, 180, 0x20262e);
    const pmrem = new THREE.PMREMGenerator(renderer);
    try { scene.environment = own(pmrem.fromScene(studio, .006, 1, 1000)).texture; }
    finally { pmrem.dispose(); for (const resource of [...studioMaterials, ...studioGeometries]) resource.dispose(); }
    const key = new THREE.DirectionalLight(0xfff1dc, 3.2); key.position.set(-160, 220, 360); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = key.shadow.camera.bottom = -230; key.shadow.camera.right = key.shadow.camera.top = 230;
    key.shadow.camera.near = 20; key.shadow.camera.far = 900; key.shadow.bias = -.0003; key.shadow.normalBias = .12; key.shadow.radius = 2; scene.add(key);
    owned.add({ dispose() { key.shadow.dispose(); } });
    scene.add(new THREE.HemisphereLight(0xe7f0ff, 0x6f4a28, .7));
    let forcedBefore, lightBefore;
    function appearance() {
      const forced = matchMedia('(forced-colors: active)').matches, light = document.documentElement.dataset.theme === 'light';
      if (forced === forcedBefore && light === lightBefore) return;
      forcedBefore = forced; lightBefore = light;
      renderer.setClearColor(forced ? 0x161616 : light ? 0xe5e1d9 : 0x11181d, 1);
      floorMaterial.map = forced ? null : grain; wallMaterial.map = forced ? null : grain;
      floorMaterial.color.setHex(forced ? 0xffffff : 0xfff2dc); wallMaterial.color.setHex(forced ? 0x202020 : 0xe7cba1);
      steelMaterial.color.setHex(forced ? 0xffd900 : 0xe1e5e8); steelMaterial.metalness = forced ? 0 : 1;
      goalMaterial.color.setHex(forced ? 0x0069ff : 0x27b5aa); glass.visible = glassLip.visible = !forced; edgeMaterial.color.setHex(forced ? 0xffffff : 0xc0d3cf);
      for (const material of [floorMaterial, wallMaterial, steelMaterial]) material.needsUpdate = true;
    }
    function render(state, { zoomed = false } = {}) {
      if (disposed || lost) return;
      const rect = canvas.getBoundingClientRect(); width = Math.max(1, rect.width); height = Math.max(1, rect.height || rect.width);
      const dpr = Math.min(window.devicePixelRatio || 1, matchMedia('(max-width: 600px)').matches ? 1.5 : 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { renderer.setPixelRatio(dpr); renderer.setSize(width, height, false); }
      appearance(); board.quaternion.fromArray(state.orientation); board.updateMatrixWorld(true);
      point.copy(local(state)); point.z = ballRadius;
      if (previous) { delta.subVectors(point, previous); delta.z = 0; const distance = delta.length(); if (distance && distance < radius) { axis.set(-delta.y, delta.x, 0).normalize(); roll.setFromAxisAngle(axis, distance / ballRadius); ball.quaternion.premultiply(roll); } }
      else ball.quaternion.identity();
      previous = point.clone(); ball.position.copy(point); contact.position.x = point.x; contact.position.y = point.y;
      target.set(0, 0, 0); if (zoomed) target.copy(point).applyQuaternion(board.quaternion);
      const distance = radius * 1.16 / Math.tan(THREE.MathUtils.degToRad(18)) / (zoomed ? 2.1 : 1);
      offset.set(0, 0, distance); // directly overhead: tilt looks the same in every direction
      camera.position.copy(target).add(offset); camera.aspect = width / height; camera.lookAt(target); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      renderer.render(scene, camera);
      if (goalLabel) {
        point.copy(goal.position).applyQuaternion(board.quaternion).project(camera);
        const callout = goalCallout(point, width, height); goalLabel.hidden = !callout;
        if (callout) {
          const label = goalLabel.querySelector('.maze-goal-label');
          label.style.left = `${callout.left}px`; label.style.top = `${callout.top}px`;
          goalLabel.querySelector('path').setAttribute('d', callout.path);
        }
      }
      observe?.({ orientation: [...state.orientation], zoomed, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });
    }
    function project(clientX, clientY, cardinal = false) {
      return disposed || lost ? { x: 0, y: 0 } : projectBoardInput(camera, board.quaternion, canvas.getBoundingClientRect(), clientX, clientY, cardinal);
    }
    function direction(x, y) {
      if (!x && !y) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect(); return project(rect.left + rect.width * (.5 + x * .5), rect.top + rect.height * (.5 + y * .5), true);
    }
    return { render, project, direction, reset() { previous = null; }, dispose };
  } catch (error) { dispose(); throw error; }
}
