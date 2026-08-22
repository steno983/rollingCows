import * as THREE from 'three';
import { CONFIG } from '../game/config';
import type { PlayerState } from '../game/player';
import { WORLD_SLOPE } from './camera-rig';
import { starTrail } from './debris';
import { buildGeometry, MODELS, PALETTE } from './models';
import type { VoxelPool } from './voxel-pool';

/**
 * Tutto ciò che la vista della mucca deve sapere di un frame. È un oggetto e
 * non una lista di parametri perché erano già sei e ne servono nove: una
 * chiamata con nove posizionali dello stesso tipo (number, number, boolean,
 * number...) è il posto dove si scambiano due argomenti e non se ne accorge
 * nessuno finché non si guarda il gioco.
 */
export interface PlayerFrame {
  player: PlayerState;
  /** Taglia NOMINALE (game.avalanche.size): la scala renderizzata la insegue,
   *  non la copia — vedi la nota su SIZE_RATE. */
  size: number;
  /** Velocità del mondo, per il rotolamento senza slittamento. */
  speed: number;
  /** Passo temporale. Chi chiama passa 0 quando il gioco è fermo (menu,
   *  pausa): tutte le animazioni di questo modulo si congelano insieme. */
  dt: number;
  shielded: boolean;
  /** Piegata sul fianco durante un bivio (render/curve.ts, playerTiltFor). */
  tilt: number;
  /** Secondi residui della stella (game.buffs.starTimeLeft), 0 = spenta. */
  starTimeLeft: number;
  /** Secondi residui della calamita (game.buffs.magnetTimeLeft), 0 = spenta. */
  magnetTimeLeft: number;
  /** Fattore particellare del degrado prestazionale (main.ts, particleScale):
   *  la scia della stella è l'unica cosa qui dentro che spawna particelle. */
  particleScale: number;
}

export interface PlayerView {
  sync(frame: PlayerFrame): void;
  /** Scatto elastico di scala: da chiamare sull'evento 'size:changed'. */
  punchSize(): void;
  /** Deformazione di stacco: evento 'player:jumped'. */
  squashJump(): void;
  /** Deformazione di atterraggio: evento 'player:landed'. */
  squashLand(): void;
  group: THREE.Group;
}

/**
 * Crescita visiva per taglia. È una costante di resa, non di bilanciamento:
 * la collisione reale (game/collisions.ts, playerBox) non ha affatto una
 * larghezza laterale — verifica solo quota e profondità, perché il
 * giocatore è sempre al centro del ramo attivo — quindi non esiste un
 * equivalente in CONFIG.player da tenere sincronizzato con questa costante.
 */
const PLAYER_SCALE_PER_SIZE = 0.18;
/** Quanto il modello si allarga in scivolata, come frazione dell'altezza
 *  perduta: 0.5 vuol dire che metà del volume "schiacciato" via dall'altezza
 *  si ridistribuisce su larghezza e profondità — il classico squash-and-
 *  stretch, che evita che la mucca sembri solo compressa e basta. */
const SLIDE_WIDEN_RATIO = 0.5;
/** Velocità di rotazione (rad/s) dell'alone dello scudo: lenta, non deve
 *  distrarre dall'azione. */
const SHIELD_SPIN_SPEED = 1.4;
/** Quanto l'alone è più grande della sagoma della mucca (in scala). */
const SHIELD_SCALE = 1.35;
const SHIELD_COLOR = PALETTE[12] ?? 0x9fd8ff;
/** Intensità del Fresnel additivo. Non è più un'opacità: con AdditiveBlending
 *  il valore si SOMMA a ciò che c'è sotto, quindi 0.32 di opacità su neve che
 *  rende 186-206 (pochi livelli di delta, cioè l'informazione "questo colpo
 *  non ti uccide" invisibile proprio quando serve) diventa qui un contributo
 *  che si vede anche sopra il bianco. */
const SHIELD_STRENGTH = 0.85;
/** Segmenti della sfera dello scudo. Alzati da 12×8: il Fresnel mette in
 *  evidenza proprio il BORDO della sfera, che è dove si vedeva la
 *  sfaccettatura — con la vecchia tinta piatta non si notava perché non c'era
 *  niente da notare. */
const SHIELD_SEGMENTS_W = 20;
const SHIELD_SEGMENTS_H = 14;

/** Contorno a shell invertita: stessa geometria, faccia posteriore, un filo
 *  più grande. La mucca è bianca su terreno bianco (meno di trenta livelli di
 *  separazione dal fondo) e la sua ombra cade DIETRO di lei rispetto alla
 *  camera (sole a (14,26,-10), camera a -z), quindi neanche quella la stacca.
 *  Costa una sola draw call in più perché la mucca è una Mesh singola e non
 *  un'InstancedMesh. */
const OUTLINE_SCALE = 1.04;
const OUTLINE_COLOR = PALETTE[1] ?? 0x1c1c22;

/** Con quale velocità (1/s) la scala renderizzata insegue quella nominale.
 *  È RIG_RATE di render/scene.ts, cioè CONFIG.render.shakeDecay: la camera
 *  impiega ~0,6 s a rientrare dopo una salita di taglia, mentre il modello
 *  saltava di dimensione IN UN FRAME — due movimenti scoordinati sullo stesso
 *  evento. Usando la stessa costante di tempo diventano un movimento solo. */
const SIZE_RATE = CONFIG.render.shakeDecay;
/** Risalita dalla scivolata. La scivolata è l'azione con la tolleranza più
 *  asimmetrica del gioco (parte istantanea: perdona chi anticipa e non chi
 *  reagisce), quindi l'INIZIO resta istantaneo — smorzarlo toglierebbe
 *  reattività dove serve — ma la FINE diventa una risalita, così si vede
 *  quando sta per finire invece di scoprirlo dall'ostacolo che arriva. */
const SLIDE_RECOVER_SECONDS = 0.12;

/** Anello della calamita: raggio reale del buff, spessore della banda e quota
 *  sopra il pavimento del corridoio. Il raggio è CONFIG.buffs.magnetRangeZ, il
 *  numero di gioco che finora era completamente invisibile. */
const MAGNET_RING_THICKNESS = 0.55;
const MAGNET_RING_SEGMENTS = 72;
const MAGNET_RING_Y = 0.05;
const MAGNET_RING_COLOR = PALETTE[17] ?? 0xe6483c;
const MAGNET_RING_OPACITY = 0.55;
/** Respiro dell'anello: lento, è uno stato che dura 8 secondi. */
const MAGNET_PULSE_HZ = 1.1;

/** Ultimo secondo di un buff: entrambi gli effetti nel mondo lampeggiano,
 *  perché la scadenza è un'informazione che oggi arriva solo dall'HUD (e
 *  dall'audio, buffExpire). Frequenza alta: deve leggersi come "sta per
 *  finire", non come una pulsazione decorativa. */
const BUFF_BLINK_SECONDS = 1;
const BUFF_BLINK_HZ = 6;
/** Quanto resta acceso nella fase "spenta" del lampeggio: non zero, altrimenti
 *  la scia della stella si interrompe del tutto e sembra già finita. */
const BUFF_BLINK_FLOOR = 0.25;

/** Da dove nascono le scintille della stella, rispetto alla mucca. */
const STAR_TRAIL_Y = 0.35;
const STAR_TRAIL_Z = -0.5;

/** Fresnel: opaco dove la sfera è tangente alla vista (il bordo), trasparente
 *  al centro, dove nasconderebbe la mucca che sta proteggendo. È la terza
 *  opzione che il commento del codice precedente non aveva considerato: costa
 *  esattamente come la sfera a tinta unita — una draw call, nessun secondo
 *  passaggio — ma comunica la forma invece di appiattirsi in un disco. */
const SHIELD_VERTEX_SHADER = `
  varying vec3 vViewNormal;
  varying vec3 vToCamera;
  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vToCamera = normalize(-viewPosition.xyz);
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const SHIELD_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uStrength;
  varying vec3 vViewNormal;
  varying vec3 vToCamera;
  void main() {
    // abs(): la sfera è disegnata su entrambe le facce, e senza valore
    // assoluto le facce posteriori (normale opposta alla vista) darebbero un
    // rim negativo, cioè un buco nero al centro dell'alone.
    float facing = abs(dot(normalize(vViewNormal), normalize(vToCamera)));
    float rim = pow(1.0 - facing, 2.5);
    float pulse = 0.82 + 0.18 * sin(uTime * 5.0);
    // Additivo: il colore si SOMMA al fondo invece di miscelarsi, quindi
    // resta visibile anche sopra la neve, che è il caso in cui serve.
    gl_FragColor = vec4(uColor * rim * pulse * uStrength, 1.0);
  }
`;

export interface PlayerScale {
  x: number;
  y: number;
  z: number;
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Rientro di uno scatto elastico: 1 all'inizio (deformazione piena),
 * attraversa lo zero e rimbalza brevemente dall'altra parte prima di
 * spegnersi esattamente a t = 1. È il rimbalzo che distingue uno "scatto" da
 * una interpolazione lineare, che a queste durate (0,11-0,14 s) si legge come
 * un errore di frame invece che come un'intenzione.
 */
function elasticFalloff(t: number): number {
  const c = clamp01(t);
  return (1 - c) * Math.cos(c * Math.PI * 1.5);
}

/**
 * Fattore di scala (x, y, z) del modello dato la taglia e lo stato di
 * scivolata. Logica pura, testabile senza three: Y si schiaccia esattamente
 * di CONFIG.player.slideHeightRatio (la sagoma di collisione fa lo stesso,
 * vedi game/collisions.ts — playerBox), X e Z si allargano un poco per
 * compensare visivamente il volume perso.
 *
 * Resta la scala NOMINALE, cioè l'obiettivo: quella davvero applicata al
 * modello la insegue nel tempo (SIZE_RATE, SLIDE_RECOVER_SECONDS) e ci
 * moltiplica sopra gli scatti elastici.
 */
export function playerModelScale(size: number, sliding: boolean): PlayerScale {
  const base = 1 + (size - 1) * PLAYER_SCALE_PER_SIZE;
  if (!sliding) {
    return { x: base, y: base, z: base };
  }
  const lost = 1 - CONFIG.player.slideHeightRatio;
  const widened = base * (1 + lost * SLIDE_WIDEN_RATIO);
  return { x: widened, y: base * CONFIG.player.slideHeightRatio, z: widened };
}

/**
 * Intensità 0..1 di un effetto di buff nel mondo: 0 se spento, 1 mentre è
 * pieno, e un lampeggio nell'ultimo secondo. `time` è il tempo accumulato
 * dalla vista (non performance.now): con dt = 0 in pausa il lampeggio si
 * ferma insieme a tutto il resto, invece di continuare dietro le schermate.
 */
export function buffEffectLevel(remaining: number, time: number): number {
  if (remaining <= 0) return 0;
  if (remaining > BUFF_BLINK_SECONDS) return 1;
  return Math.sin(time * BUFF_BLINK_HZ * Math.PI * 2) > 0 ? 1 : BUFF_BLINK_FLOOR;
}

/**
 * `pool` serve solo alla scia dorata della stella: passando null (i test, o
 * una vista costruita prima del pool) tutto il resto continua a funzionare.
 * Attenzione all'ordine in main.ts: il pool va creato PRIMA della vista.
 */
export function createPlayerView(pool: VoxelPool | null = null): PlayerView {
  const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
  const box = geometry.boundingBox;
  const halfHeight = box === null ? 0.5 : (box.max.y - box.min.y) / 2;

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Il modello poggia a y = 0: abbassandolo di mezza altezza, il centro
  // geometrico finisce esattamente sull'origine del perno (che ruota).
  mesh.position.y = -halfHeight;

  // Contorno a shell invertita, figlio dello STESSO pivot del modello: così
  // segue per costruzione la scala della taglia, lo schiacciamento della
  // scivolata, il rotolamento e la piegata nei bivi, senza una sola riga che
  // ricopi quelle trasformazioni (ricopiarle è il modo in cui un contorno si
  // stacca dal modello al primo stato che qualcuno dimentica).
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: OUTLINE_COLOR,
    side: THREE.BackSide,
    // Il contorno non deve prendere la nebbia: sbiancandosi tornerebbe a
    // confondersi con la neve proprio nell'unico caso che deve risolvere.
    fog: false,
  });
  const outline = new THREE.Mesh(geometry, outlineMaterial);
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.scale.setScalar(OUTLINE_SCALE);
  // La geometria ha la base a y = 0: scalandola attorno alla propria origine
  // il guscio crescerebbe solo verso l'alto. Riabbassandolo di halfHeight *
  // OUTLINE_SCALE il guscio resta concentrico al modello.
  outline.position.y = -halfHeight * OUTLINE_SCALE;

  // Alone dello scudo: sfera a Fresnel additivo attorno alla mucca, nascosta
  // quando lo scudo non è attivo. È figlia di `group`, non di `pivot`: non
  // deve rotolare con la mucca, solo ruotare lentamente per conto suo.
  const shieldGeometry = new THREE.SphereGeometry(1, SHIELD_SEGMENTS_W, SHIELD_SEGMENTS_H);
  // Riferimento diretto all'uniform invece di shieldMaterial.uniforms.uTime:
  // con noUncheckedIndexedAccess l'indicizzazione di uniforms restituisce
  // IUniform | undefined, e l'alternativa sarebbe un non-null assertion.
  const shieldTime = { value: 0 };
  const shieldMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(SHIELD_COLOR) },
      uTime: shieldTime,
      uStrength: { value: SHIELD_STRENGTH },
    },
    vertexShader: SHIELD_VERTEX_SHADER,
    fragmentShader: SHIELD_FRAGMENT_SHADER,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const shield = new THREE.Mesh(shieldGeometry, shieldMaterial);
  shield.visible = false;

  // Anello della calamita: il raggio REALE del buff, disegnato a terra.
  // Nota onesta sulla regola di gioco: game.ts (applyMagnet) raccoglie i
  // fiocchi con 0 <= z <= magnetRangeZ, cioè una fascia DAVANTI alla mucca,
  // non un disco attorno a lei. L'anello chiuso è la lettura "aura" di quel
  // numero: sui lati e dietro promette poco più di quanto mantenga, ma lì non
  // nasce comunque nulla (il corridoio è largo 4 unità).
  const magnetRadius = CONFIG.buffs.magnetRangeZ;
  const ringGeometry = new THREE.RingGeometry(
    Math.max(0.1, magnetRadius - MAGNET_RING_THICKNESS),
    magnetRadius,
    MAGNET_RING_SEGMENTS,
  );
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: MAGNET_RING_COLOR,
    transparent: true,
    opacity: MAGNET_RING_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const magnetRing = new THREE.Mesh(ringGeometry, ringMaterial);
  magnetRing.rotation.x = -Math.PI / 2;
  // Il perno intermedio annulla la piegata del bivio: un anello appoggiato a
  // terra che si inclina di 32° con la mucca affonderebbe da un lato e
  // volerebbe dall'altro. Il perno serve perché la compensazione dev'essere
  // applicata PRIMA della rotazione di -90° attorno a X, e un singolo nodo
  // non può comporre due rotazioni in quell'ordine.
  const magnetPivot = new THREE.Group();
  magnetPivot.add(magnetRing);
  magnetPivot.visible = false;

  const pivot = new THREE.Group();
  pivot.add(mesh);
  pivot.add(outline);
  const group = new THREE.Group();
  group.add(pivot);
  group.add(shield);
  group.add(magnetPivot);
  // La mucca sta FUORI dal gruppo-mondo (è tutto il resto a muoversi attorno a
  // lei, vedi main.ts), quindi l'inclinazione del pendio non le arriva da
  // sola: senza questa riga resterebbe verticale su un pendio inclinato, come
  // un birillo. Uno sciatore in discesa è inclinato quanto la pista.
  //
  // Si scrive UNA volta e non in sync perché non cambia mai. Regge perché sync
  // tocca solo rotation.z (la piegata dei bivi): con l'ordine di Eulero
  // predefinito (XYZ) la piegata viene applicata PRIMA dell'inclinazione, cioè
  // nel sistema del pendio — che è l'ordine giusto, ed è lo stesso con cui
  // main.ts compone lo sterzo del bivio sul gruppo-mondo. Chi in futuro
  // riscrivesse sync con un group.rotation.set(...) cancellerebbe questa riga:
  // c'è un test apposta (player-view.test.ts).
  group.rotation.x = WORLD_SLOPE;

  let roll = 0;
  let shieldSpin = 0;
  /** Tempo accumulato dai soli frame giocati: guida pulsazioni e lampeggi.
   *  NON performance.now(), che continuerebbe a correre in pausa e farebbe
   *  saltare l'alone di fase alla ripresa. */
  let effectTime = 0;
  /** Scala di taglia davvero renderizzata: insegue quella nominale. */
  let renderedBase = playerModelScale(1, false).x;
  /** 0 = in piedi, 1 = completamente in scivolata. */
  let slideBlend = 0;
  /** Scatto di squash in corso: valore di picco e tempo trascorso. */
  let squashPeak = 1;
  // Annotati esplicitamente: CONFIG è `as const`, quindi senza `: number`
  // TypeScript inferirebbe il tipo letterale (0.11) e i reset a 0 non
  // compilerebbero.
  let squashElapsed: number = CONFIG.feel.squashSeconds;
  let punchElapsed: number = CONFIG.feel.sizePunchSeconds;

  function punchSize(): void {
    punchElapsed = 0;
  }

  function squashJump(): void {
    squashPeak = CONFIG.feel.jumpSquash;
    squashElapsed = 0;
  }

  function squashLand(): void {
    squashPeak = CONFIG.feel.landSquash;
    squashElapsed = 0;
  }

  function sync(frame: PlayerFrame): void {
    const { player, size, speed, dt, shielded, tilt } = frame;
    effectTime += dt;
    squashElapsed += dt;
    punchElapsed += dt;

    // Taglia: inseguimento esponenziale con la costante di tempo del rig
    // della camera. Vale anche in discesa, cioè alla fine della valanga,
    // quando la mucca rimpiccioliva di colpo da 1,72 a 1,00.
    const targetBase = playerModelScale(size, false).x;
    renderedBase += (targetBase - renderedBase) * Math.min(1, dt * SIZE_RATE);

    // Scivolata: giù di scatto (la finestra utile parte istantanea e non si
    // tocca), su in SLIDE_RECOVER_SECONDS.
    if (player.sliding) {
      slideBlend = 1;
    } else if (slideBlend > 0 && dt > 0) {
      slideBlend = Math.max(0, slideBlend - dt / SLIDE_RECOVER_SECONDS);
    }
    const lost = 1 - CONFIG.player.slideHeightRatio;
    const slideY = 1 + (CONFIG.player.slideHeightRatio - 1) * slideBlend;
    const slideXZ = 1 + lost * SLIDE_WIDEN_RATIO * slideBlend;

    // Squash di stacco/atterraggio e scatto di taglia: MOLTIPLICANO le due
    // scale precedenti invece di sostituirle, così saltare durante una
    // scivolata o crescere a mezz'aria non cancella l'altra deformazione.
    const squashY =
      1 + (squashPeak - 1) * elasticFalloff(squashElapsed / CONFIG.feel.squashSeconds);
    // Allargamento compensativo a volume costante: senza, la mucca sembra
    // solo schiacciata (o solo allungata) invece che elastica.
    const squashXZ = 1 / Math.sqrt(Math.max(0.01, squashY));
    const punch =
      1 + (CONFIG.feel.sizePunch - 1) * elasticFalloff(punchElapsed / CONFIG.feel.sizePunchSeconds);

    const scaleY = renderedBase * slideY * squashY * punch;
    const scaleXZ = renderedBase * slideXZ * squashXZ * punch;
    pivot.scale.set(scaleXZ, scaleY, scaleXZ);

    const radius = Math.max(halfHeight * scaleY, 0.001);
    // Segno POSITIVO, non invertirlo (era il difetto segnalato in v1: la
    // mucca sembrava rotolare all'indietro). Il mondo scorre verso la
    // camera lungo -z mentre la mucca resta ferma a schermo, come su un
    // tapis roulant: perché rotoli in avanti senza slittare, il suo punto
    // di contatto deve muoversi in accordo con quello scorrimento.
    roll = (roll + (speed * dt) / radius) % (Math.PI * 2);
    pivot.rotation.x = roll;

    // La mucca del giocatore è sempre a x = 0 in v2 (è il tracciato che si
    // sposta, non lei): nessun worldToViewX qui, a differenza di v1.
    group.position.set(0, player.y + radius, 0);
    // Piegata sul fianco durante un bivio (render/curve.ts, playerTiltFor):
    // sul GRUPPO esterno, non sul pivot che rotola in avanti (rotation.x
    // sopra), altrimenti le due rotazioni si mescolerebbero sullo stesso
    // nodo. Lo scudo (figlio di group, non di pivot) si piega insieme al
    // resto dell'assieme: essendo una sfera, non si nota, ed è comunque
    // corretto che segua la mucca che protegge.
    //
    // SOLO z: group.rotation.x porta l'inclinazione del pendio, scritta una
    // volta alla costruzione e da non toccare qui.
    group.rotation.z = tilt;

    shield.visible = shielded;
    if (shielded) {
      shieldSpin += dt * SHIELD_SPIN_SPEED;
      shield.rotation.y = shieldSpin;
      shieldTime.value = effectTime;
      // L'alone segue la sagoma reale (compresa la scivolata): un raggio
      // fisso sembrerebbe fluttuante quando la mucca si appiattisce.
      shield.scale.set(scaleXZ * SHIELD_SCALE, scaleY * SHIELD_SCALE, scaleXZ * SHIELD_SCALE);
    }

    // Stella: scintille dorate nel mondo, non solo un chip nell'HUD che il
    // giocatore non sta guardando.
    const starLevel = buffEffectLevel(frame.starTimeLeft, effectTime);
    if (pool !== null && starLevel > 0) {
      starTrail(
        pool,
        dt,
        0,
        player.y + STAR_TRAIL_Y,
        STAR_TRAIL_Z,
        starLevel * frame.particleScale,
      );
    }

    // Calamita: l'anello resta appoggiato al pavimento del corridoio,
    // qualunque cosa faccia la mucca sopra di esso (salta, si piega, cresce).
    // La compensazione annulla la sola piegata del bivio: l'inclinazione del
    // pendio invece deve restare, perché il pavimento è inclinato anche lui —
    // ed essendo su group, resta per costruzione.
    const magnetLevel = buffEffectLevel(frame.magnetTimeLeft, effectTime);
    magnetPivot.visible = magnetLevel > 0;
    if (magnetLevel > 0) {
      magnetPivot.rotation.z = -tilt;
      magnetPivot.position.y = MAGNET_RING_Y - (player.y + radius);
      const pulse = 0.78 + 0.22 * Math.sin(effectTime * MAGNET_PULSE_HZ * Math.PI * 2);
      ringMaterial.opacity = MAGNET_RING_OPACITY * pulse * magnetLevel;
    }
  }

  return { sync, punchSize, squashJump, squashLand, group };
}
