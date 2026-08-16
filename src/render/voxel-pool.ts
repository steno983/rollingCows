import * as THREE from 'three';

export interface VoxelPool {
  readonly capacity: number;
  readonly activeCount: number;
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: number, life: number,
  ): boolean;
  update(dt: number, worldSpeed: number): void;
  reset(): void;
  mesh: THREE.InstancedMesh;
}

/** Costanti puramente visive dei detriti: vedi la nota del task. */
const GRAVITY = 26;
const RESTITUTION = 0.35;
const GROUND_FRICTION = 0.82;
const SLEEP_SPEED = 0.7;
const SPIN_RATE = 1.2;

export function createVoxelPool(capacity: number, voxelSize: number): VoxelPool {
  // Tutto preallocato una volta sola: durante il gioco non nasce un solo oggetto.
  const px = new Float32Array(capacity);
  const py = new Float32Array(capacity);
  const pz = new Float32Array(capacity);
  const vx = new Float32Array(capacity);
  const vy = new Float32Array(capacity);
  const vz = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const spin = new Float32Array(capacity);

  // Free list a indici: `free[0..freeCount)` sono gli slot disponibili.
  // Inizializzata in ordine decrescente così le prime spawn prendono gli slot
  // bassi e mesh.count resta compatto.
  const free = new Int32Array(capacity);
  for (let i = 0; i < capacity; i += 1) free[i] = capacity - 1 - i;
  let freeCount = capacity;
  let activeCount = 0;

  const geometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
  // Attributo color bianco costante: insieme a vertexColors garantisce che il
  // colore per istanza venga applicato su qualunque versione di three.
  const white = new Float32Array(geometry.getAttribute('position').count * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(capacity * 3),
    3,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.count = 0;

  const dummy = new THREE.Object3D();
  const scratchColor = new THREE.Color();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

  function writeMatrix(slot: number): void {
    dummy.position.set(px[slot] ?? 0, py[slot] ?? 0, pz[slot] ?? 0);
    const angle = (life[slot] ?? 0) * (spin[slot] ?? 0);
    dummy.rotation.set(angle, angle * 0.7, angle * 0.4);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    mesh.setMatrixAt(slot, dummy.matrix);
  }

  function release(slot: number): void {
    life[slot] = 0;
    mesh.setMatrixAt(slot, hiddenMatrix);
    free[freeCount] = slot;
    freeCount += 1;
    activeCount -= 1;
  }

  function spawn(
    x: number, y: number, z: number,
    velX: number, velY: number, velZ: number,
    color: number, lifeSeconds: number,
  ): boolean {
    if (lifeSeconds <= 0 || freeCount === 0) return false;
    freeCount -= 1;
    const slot = free[freeCount] ?? 0;

    px[slot] = x;
    py[slot] = y;
    pz[slot] = z;
    vx[slot] = velX;
    vy[slot] = velY;
    vz[slot] = velZ;
    life[slot] = lifeSeconds;
    // Rotazione deterministica per slot: varietà senza numeri casuali.
    spin[slot] = ((slot % 7) - 3) * SPIN_RATE;
    activeCount += 1;

    scratchColor.setHex(color, THREE.SRGBColorSpace);
    const colors = mesh.instanceColor;
    if (colors !== null) {
      colors.setXYZ(slot, scratchColor.r, scratchColor.g, scratchColor.b);
      colors.needsUpdate = true;
    }

    writeMatrix(slot);
    if (slot + 1 > mesh.count) mesh.count = slot + 1;
    return true;
  }

  function update(dt: number, worldSpeed: number): void {
    let highWater = 0;

    for (let i = 0; i < capacity; i += 1) {
      const remaining = (life[i] ?? 0) - dt;
      if ((life[i] ?? 0) <= 0) continue;

      if (remaining <= 0) {
        release(i);
        continue;
      }
      life[i] = remaining;

      let nextVy = (vy[i] ?? 0) - GRAVITY * dt;
      const nextX = (px[i] ?? 0) + (vx[i] ?? 0) * dt;
      let nextY = (py[i] ?? 0) + nextVy * dt;
      const nextZ = (pz[i] ?? 0) + ((vz[i] ?? 0) - worldSpeed) * dt;

      if (nextY < 0) {
        nextY = 0;
        if (nextVy < 0) nextVy = -nextVy * RESTITUTION;
        if (Math.abs(nextVy) < SLEEP_SPEED) nextVy = 0;
        vx[i] = (vx[i] ?? 0) * GROUND_FRICTION;
        vz[i] = (vz[i] ?? 0) * GROUND_FRICTION;
      }

      px[i] = nextX;
      py[i] = nextY;
      pz[i] = nextZ;
      vy[i] = nextVy;

      writeMatrix(i);
      if (i + 1 > highWater) highWater = i + 1;
    }

    mesh.count = highWater;
    mesh.instanceMatrix.needsUpdate = true;
  }

  function reset(): void {
    for (let i = 0; i < capacity; i += 1) {
      life[i] = 0;
      free[i] = capacity - 1 - i;
      mesh.setMatrixAt(i, hiddenMatrix);
    }
    freeCount = capacity;
    activeCount = 0;
    mesh.count = 0;
    mesh.instanceMatrix.needsUpdate = true;
  }

  return {
    capacity,
    get activeCount(): number {
      return activeCount;
    },
    mesh,
    spawn,
    update,
    reset,
  };
}
