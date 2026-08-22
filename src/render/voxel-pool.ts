import * as THREE from 'three';

export interface VoxelPool {
  readonly capacity: number;
  readonly activeCount: number;
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    life: number,
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
/**
 * Vita residua massima di un cubetto che si è fermato a terra.
 *
 * Perché esiste: `update` applica la deriva del mondo (`- worldSpeed`) ai
 * detriti ESATTAMENTE come il resto della scena la applica agli ostacoli,
 * quindi la posizione RELATIVA fra un cubetto e l'ostacolo sopra al quale si è
 * fermato non cambia mai. Un cubetto addormentato sotto un masso ci resta
 * infilato, intero e immobile, per tutta la sua vita residua e viaggia via
 * insieme al masso: è il difetto dei "fiocchi di neve incastrati negli
 * oggetti". Da fermo non ha più nulla da raccontare, quindi la sua vita viene
 * troncata qui e la dissolvenza se lo porta via in fretta.
 */
const GROUND_REST_LIFE = 0.35;
/** Velocità orizzontale sotto la quale un cubetto a terra è considerato
 *  fermo. L'attrito la abbatte in pochi frame (0.82 per frame). */
const REST_SPEED = 0.35;
/** Durata della dissolvenza finale. Un cubetto non svanisce più di scatto: si
 *  rimpicciolisce negli ultimi istanti. La scala finisce già nella matrice di
 *  istanza scritta a ogni frame, quindi non costa un byte né un ciclo in più. */
const FADE_SECONDS = 0.25;

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
  // Angolo accumulato, non più derivato da `life`: la vita di un cubetto ora
  // può essere TRONCATA quando si ferma (vedi GROUND_REST_LIFE) e un angolo
  // legato alla vita farebbe scattare la rotazione di un quarto di giro nel
  // frame del troncamento. Accumularlo permette anche di congelarlo da fermo.
  const spinAngle = new Float32Array(capacity);

  // Free list a indici: `free[0..freeCount)` sono gli slot disponibili.
  // Inizializzata in ordine decrescente così le prime spawn prendono gli slot
  // bassi e mesh.count resta compatto.
  const free = new Int32Array(capacity);
  for (let i = 0; i < capacity; i += 1) free[i] = capacity - 1 - i;
  let freeCount = capacity;
  let activeCount = 0;
  // Slot più alto (+1) che può contenere un detrito: PERSISTE fra le chiamate,
  // ed è il limite del ciclo di update. Poiché la free list parte in ordine
  // decrescente, gli slot occupati sono sempre un sottoinsieme dei più bassi e
  // sopra highWater non c'è mai nulla da aggiornare. Prima update() scandiva
  // tutti i `capacity` slot a ogni frame anche a pool vuoto — cioè il caso
  // normale, non l'eccezione.
  let highWater = 0;

  const geometry = new THREE.BoxGeometry(voxelSize, voxelSize, voxelSize);
  // Attributo color bianco costante: insieme a vertexColors garantisce che il
  // colore per istanza venga applicato su qualunque versione di three.
  const white = new Float32Array(geometry.getAttribute('position').count * 3).fill(1);
  geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
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
    const angle = spinAngle[slot] ?? 0;
    dummy.rotation.set(angle, angle * 0.7, angle * 0.4);
    // Dissolvenza per rimpicciolimento: vedi FADE_SECONDS.
    const remaining = life[slot] ?? 0;
    dummy.scale.setScalar(remaining < FADE_SECONDS ? remaining / FADE_SECONDS : 1);
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
    x: number,
    y: number,
    z: number,
    velX: number,
    velY: number,
    velZ: number,
    color: number,
    lifeSeconds: number,
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
    spinAngle[slot] = 0;
    activeCount += 1;

    scratchColor.setHex(color, THREE.SRGBColorSpace);
    const colors = mesh.instanceColor;
    if (colors !== null) {
      colors.setXYZ(slot, scratchColor.r, scratchColor.g, scratchColor.b);
      // Solo i tre float appena scritti: stesso motivo delle matrici in
      // update(), un needsUpdate senza regioni ricarica l'intero attributo.
      colors.addUpdateRange(slot * 3, 3);
      colors.needsUpdate = true;
    }

    writeMatrix(slot);
    if (slot + 1 > highWater) highWater = slot + 1;
    mesh.count = highWater;
    return true;
  }

  function update(dt: number, worldSpeed: number): void {
    const scanned = highWater;
    let live = 0;
    // Una matrice riscritta (da writeMatrix o dalla release, che scrive la
    // matrice nulla) è l'unica cosa che rende necessario un upload: a pool
    // vuoto non se ne tocca nessuna e il buffer non va nemmeno sfiorato.
    let touched = false;

    for (let i = 0; i < scanned; i += 1) {
      const current = life[i] ?? 0;
      if (current <= 0) continue;
      touched = true;

      const remaining = current - dt;
      if (remaining <= 0) {
        release(i);
        continue;
      }
      life[i] = remaining;

      let nextVy = (vy[i] ?? 0) - GRAVITY * dt;
      const nextX = (px[i] ?? 0) + (vx[i] ?? 0) * dt;
      let nextY = (py[i] ?? 0) + nextVy * dt;
      const nextZ = (pz[i] ?? 0) + ((vz[i] ?? 0) - worldSpeed) * dt;
      let resting = false;

      if (nextY < 0) {
        nextY = 0;
        if (nextVy < 0) nextVy = -nextVy * RESTITUTION;
        if (Math.abs(nextVy) < SLEEP_SPEED) nextVy = 0;
        const dragX = (vx[i] ?? 0) * GROUND_FRICTION;
        const dragZ = (vz[i] ?? 0) * GROUND_FRICTION;
        vx[i] = dragX;
        vz[i] = dragZ;
        resting = nextVy === 0 && Math.abs(dragX) + Math.abs(dragZ) < REST_SPEED;
      }

      px[i] = nextX;
      py[i] = nextY;
      pz[i] = nextZ;
      vy[i] = nextVy;

      if (resting) {
        // Fermo a terra: non ha più moto proprio, quindi da qui in poi si
        // limita a viaggiare incastrato in ciò che gli sta sopra. Vita
        // troncata e rotazione congelata (un dado che gira su se stesso
        // appoggiato alla neve è l'altra metà del difetto).
        if (remaining > GROUND_REST_LIFE) life[i] = GROUND_REST_LIFE;
      } else {
        spinAngle[i] = (spinAngle[i] ?? 0) + (spin[i] ?? 0) * dt;
      }

      writeMatrix(i);
      live = i + 1;
    }

    highWater = live;
    mesh.count = live;

    if (touched) {
      // Senza updateRanges three ricarica l'INTERO array a ogni needsUpdate
      // (WebGLAttributes.updateBuffer: un bufferSubData dell'array completo,
      // indipendente da mesh.count): con voxelPoolSize 4000 sono 4000 × 16
      // float × 4 byte = 256 KB per frame, cioè 15 MB/s, e su un'architettura
      // a memoria unificata è banda tolta a texture e framebuffer. La regione
      // parte sempre da 0 e arriva a `scanned` — non a `live` — perché anche
      // gli slot appena liberati sopra la soglia hanno ricevuto la matrice
      // nulla e vanno caricati: uno di essi può tornare in uso (la free list è
      // LIFO) e verrebbe disegnato con la matrice vecchia.
      mesh.instanceMatrix.addUpdateRange(0, scanned * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function reset(): void {
    for (let i = 0; i < capacity; i += 1) {
      life[i] = 0;
      free[i] = capacity - 1 - i;
      mesh.setMatrixAt(i, hiddenMatrix);
    }
    freeCount = capacity;
    activeCount = 0;
    highWater = 0;
    mesh.count = 0;
    // Qui la riscrittura è di tutti gli slot: nessuna regione, così three
    // ricarica l'array intero. Succede una volta per corsa, non per frame.
    mesh.instanceMatrix.clearUpdateRanges();
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
