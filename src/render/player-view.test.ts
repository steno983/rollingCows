import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPlayer, type PlayerState } from '../game/player';
import { WORLD_SLOPE } from './camera-rig';
import { resetDebris } from './debris';
import {
  buffEffectLevel,
  createPlayerView,
  type PlayerFrame,
  type PlayerView,
  playerModelScale,
} from './player-view';
import { createVoxelPool } from './voxel-pool';

const SCALE_PER_SIZE = 0.18;

describe('playerModelScale', () => {
  it('a taglia 1 e senza scivolata la scala è uniforme e pari a 1', () => {
    expect(playerModelScale(1, false)).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('la taglia scala uniformemente le tre dimensioni fuori dalla scivolata', () => {
    const scale = playerModelScale(5, false);
    const expected = 1 + 4 * SCALE_PER_SIZE;
    expect(scale.x).toBeCloseTo(expected, 6);
    expect(scale.y).toBeCloseTo(expected, 6);
    expect(scale.z).toBeCloseTo(expected, 6);
  });

  it('in scivolata Y si schiaccia esattamente di slideHeightRatio rispetto alla base', () => {
    const base = 1 + 4 * SCALE_PER_SIZE;
    const scale = playerModelScale(5, true);
    expect(scale.y).toBeCloseTo(base * CONFIG.player.slideHeightRatio, 6);
  });

  it('in scivolata X e Z si allargano rispetto alla base, ma restano meno del doppio', () => {
    const base = 1 + 4 * SCALE_PER_SIZE;
    const scale = playerModelScale(5, true);
    expect(scale.x).toBeGreaterThan(base);
    expect(scale.x).toBeLessThan(base * 2);
    expect(scale.z).toBe(scale.x);
  });

  it('la scivolata non introduce mai una torsione laterale (X e Z restano uguali)', () => {
    for (const size of [1, 2, 3, 4, 5]) {
      const scale = playerModelScale(size, true);
      expect(scale.x).toBe(scale.z);
    }
  });
});

/** Frame minimo: nessun buff, nessuna piegata, un passo di 60 fps. */
function frame(overrides: Partial<PlayerFrame> = {}): PlayerFrame {
  return {
    player: createPlayer(),
    size: 1,
    speed: 0,
    dt: 1 / 60,
    shielded: false,
    tilt: 0,
    starTimeLeft: 0,
    magnetTimeLeft: 0,
    particleScale: 1,
    ...overrides,
  };
}

/** Il perno che porta modello e contorno: primo figlio del gruppo, vedi
 *  createPlayerView. Con noUncheckedIndexedAccess l'accesso va comunque
 *  verificato, e un throw qui è più leggibile di un `?.` in ogni asserzione. */
function pivotOf(view: PlayerView): THREE.Object3D {
  const pivot = view.group.children[0];
  if (pivot === undefined) throw new Error('perno del modello mancante');
  return pivot;
}

function magnetPivotOf(view: PlayerView): THREE.Object3D {
  const ring = view.group.children[2];
  if (ring === undefined) throw new Error('anello della calamita mancante');
  return ring;
}

function sliding(): PlayerState {
  return { ...createPlayer(), sliding: true };
}

describe('buffEffectLevel', () => {
  it('è zero a buff spento', () => {
    expect(buffEffectLevel(0, 0)).toBe(0);
    expect(buffEffectLevel(-1, 3)).toBe(0);
  });

  it('è pieno finché manca più di un secondo', () => {
    expect(buffEffectLevel(CONFIG.buffs.starSeconds, 0)).toBe(1);
    expect(buffEffectLevel(1.01, 12.3)).toBe(1);
  });

  it('lampeggia nell ultimo secondo: alterna pieno e attenuato, senza mai spegnersi del tutto', () => {
    const levels = new Set<number>();
    for (let i = 0; i < 60; i += 1) levels.add(buffEffectLevel(0.5, i / 60));
    expect(levels.size).toBe(2);
    for (const level of levels) {
      expect(level).toBeGreaterThan(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });
});

describe('createPlayerView', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('il contorno è figlio dello stesso perno del modello, così ne segue tutte le trasformazioni', () => {
    const view = createPlayerView();
    const pivot = pivotOf(view);
    expect(pivot.children.length).toBe(2);
    const outline = pivot.children[1];
    if (!(outline instanceof THREE.Mesh)) throw new Error('contorno mancante');
    const material = outline.material;
    expect(Array.isArray(material)).toBe(false);
    if (Array.isArray(material)) return;
    // Shell invertita: è la faccia POSTERIORE a essere disegnata, altrimenti
    // il guscio coprirebbe la mucca invece di contornarla.
    expect(material.side).toBe(THREE.BackSide);
    expect(outline.scale.x).toBeGreaterThan(1);
    expect(outline.castShadow).toBe(false);
  });

  it('a taglia 1, in piedi e senza scatti in corso, la scala è esattamente quella nominale', () => {
    const view = createPlayerView();
    view.sync(frame({ dt: 0 }));
    const pivot = pivotOf(view);
    expect(pivot.scale.x).toBeCloseTo(1, 10);
    expect(pivot.scale.y).toBeCloseTo(1, 10);
  });

  it('la crescita di taglia non salta in un frame: la scala insegue quella nominale', () => {
    const view = createPlayerView();
    view.sync(frame({ dt: 0 }));
    const target = playerModelScale(5, false).y;

    view.sync(frame({ size: 5 }));
    const afterOneFrame = pivotOf(view).scale.y;
    expect(afterOneFrame).toBeGreaterThan(1);
    // Dopo un frame ha coperto meno di un quinto della strada: la mucca non
    // salta di dimensione mentre la camera impiega ~0,6 s a rientrare.
    expect(afterOneFrame).toBeLessThan(1 + (target - 1) * 0.2);

    for (let i = 0; i < 120; i += 1) view.sync(frame({ size: 5 }));
    expect(pivotOf(view).scale.y).toBeCloseTo(target, 3);
  });

  it('anche il rimpicciolimento di fine valanga è interpolato, non istantaneo', () => {
    const view = createPlayerView();
    for (let i = 0; i < 120; i += 1) view.sync(frame({ size: 5 }));
    view.sync(frame({ size: 1 }));
    const shrunk = pivotOf(view).scale.y;
    expect(shrunk).toBeLessThan(playerModelScale(5, false).y);
    expect(shrunk).toBeGreaterThan(1.4);
  });

  it('squashJump schiaccia in verticale allargando, e rientra entro squashSeconds', () => {
    const view = createPlayerView();
    view.sync(frame({ dt: 0 }));
    view.squashJump();
    view.sync(frame({ dt: CONFIG.feel.squashSeconds / 4 }));
    const squashed = pivotOf(view).scale;
    expect(squashed.y).toBeLessThan(1);
    expect(squashed.x).toBeGreaterThan(1);

    view.sync(frame({ dt: CONFIG.feel.squashSeconds }));
    expect(pivotOf(view).scale.y).toBeCloseTo(1, 6);
  });

  it('squashLand deforma nel verso opposto allo stacco', () => {
    const view = createPlayerView();
    view.sync(frame({ dt: 0 }));
    view.squashLand();
    view.sync(frame({ dt: CONFIG.feel.squashSeconds / 4 }));
    const landed = pivotOf(view).scale;
    expect(landed.y).toBeGreaterThan(1);
    expect(landed.x).toBeLessThan(1);
  });

  it('punchSize dà uno scatto uniforme che poi si spegne', () => {
    const view = createPlayerView();
    view.sync(frame({ dt: 0 }));
    view.punchSize();
    view.sync(frame({ dt: CONFIG.feel.sizePunchSeconds / 4 }));
    const punched = pivotOf(view).scale;
    expect(punched.y).toBeGreaterThan(1);
    // Uniforme: uno scatto di TAGLIA, non una deformazione.
    expect(punched.x).toBeCloseTo(punched.y, 10);

    view.sync(frame({ dt: CONFIG.feel.sizePunchSeconds }));
    expect(pivotOf(view).scale.y).toBeCloseTo(1, 6);
  });

  it('lo scatto di taglia si compone con lo squash invece di sovrascriverlo', () => {
    const view = createPlayerView();
    view.sync(frame({ dt: 0 }));
    view.punchSize();
    const onlyPunch = (() => {
      view.sync(frame({ dt: CONFIG.feel.squashSeconds / 4 }));
      return pivotOf(view).scale.y;
    })();

    const other = createPlayerView();
    other.sync(frame({ dt: 0 }));
    other.punchSize();
    other.squashJump();
    other.sync(frame({ dt: CONFIG.feel.squashSeconds / 4 }));
    // Con lo squash in più la stessa scala è più bassa: le due deformazioni
    // si moltiplicano, la seconda non ha cancellato la prima.
    expect(pivotOf(other).scale.y).toBeLessThan(onlyPunch);
  });

  it('la scivolata parte istantanea e finisce con una risalita', () => {
    const view = createPlayerView();
    const slid = playerModelScale(1, true);
    view.sync(frame({ player: sliding(), dt: 1 / 60 }));
    expect(pivotOf(view).scale.y).toBeCloseTo(slid.y, 6);
    expect(pivotOf(view).scale.x).toBeCloseTo(slid.x, 6);

    // Rialzandosi la scala NON torna subito a 1: sta a metà strada.
    view.sync(frame({ dt: 0.06 }));
    const rising = pivotOf(view).scale.y;
    expect(rising).toBeGreaterThan(slid.y);
    expect(rising).toBeLessThan(1);

    view.sync(frame({ dt: 0.2 }));
    expect(pivotOf(view).scale.y).toBeCloseTo(1, 6);
  });

  it('la scia dorata esce solo con la stella attiva', () => {
    const pool = createVoxelPool(400, 0.25);
    const view = createPlayerView(pool);
    for (let i = 0; i < 60; i += 1) view.sync(frame());
    expect(pool.activeCount).toBe(0);

    for (let i = 0; i < 60; i += 1) view.sync(frame({ starTimeLeft: CONFIG.buffs.starSeconds }));
    expect(pool.activeCount).toBeGreaterThan(0);
  });

  it('senza pool la stella non fa esplodere nulla (vista costruita prima del pool, o test)', () => {
    const view = createPlayerView();
    expect(() => view.sync(frame({ starTimeLeft: CONFIG.buffs.starSeconds }))).not.toThrow();
  });

  it('l anello della calamita compare solo col buff, resta orizzontale e appoggiato a terra', () => {
    const view = createPlayerView();
    view.sync(frame());
    expect(magnetPivotOf(view).visible).toBe(false);

    const tilt = 0.4;
    const airborne: PlayerState = { ...createPlayer(), y: 2.5, airborne: true };
    view.sync(frame({ magnetTimeLeft: CONFIG.buffs.magnetSeconds, tilt, player: airborne }));
    const pivot = magnetPivotOf(view);
    expect(pivot.visible).toBe(true);
    // Annulla la piegata del bivio: un anello a terra non si inclina di 32°.
    expect(pivot.rotation.z).toBeCloseTo(-tilt, 10);
    // ...e resta appoggiato anche con la mucca a mezz'aria.
    expect(view.group.position.y + pivot.position.y).toBeCloseTo(0.05, 10);
  });

  it('l anello ha il raggio REALE del buff, non un raggio decorativo', () => {
    const view = createPlayerView();
    const ring = magnetPivotOf(view).children[0];
    if (!(ring instanceof THREE.Mesh)) throw new Error('anello mancante');
    ring.geometry.computeBoundingBox();
    const box = ring.geometry.boundingBox;
    expect(box).not.toBeNull();
    if (box === null) return;
    expect(box.max.x).toBeCloseTo(CONFIG.buffs.magnetRangeZ, 3);
  });

  it('lo scudo è una sfera additiva a Fresnel, non un disco di tinta piatta', () => {
    const view = createPlayerView();
    const shield = view.group.children[1];
    if (!(shield instanceof THREE.Mesh)) throw new Error('scudo mancante');
    expect(shield.visible).toBe(false);
    const material = shield.material;
    if (Array.isArray(material)) throw new Error('materiale multiplo inatteso');
    expect(material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(material.blending).toBe(THREE.AdditiveBlending);
    expect(material.depthWrite).toBe(false);

    view.sync(frame({ shielded: true }));
    expect(shield.visible).toBe(true);
  });

  it('il tempo dello scudo avanza col dt, non con l orologio di sistema', () => {
    const view = createPlayerView();
    const shield = view.group.children[1];
    if (!(shield instanceof THREE.Mesh)) throw new Error('scudo mancante');
    const material = shield.material;
    if (Array.isArray(material) || !(material instanceof THREE.ShaderMaterial)) {
      throw new Error('materiale dello scudo inatteso');
    }
    const uniform = material.uniforms['uTime'];
    expect(uniform).toBeDefined();
    if (uniform === undefined) return;

    view.sync(frame({ shielded: true, dt: 0.5 }));
    expect(uniform.value).toBeCloseTo(0.5, 10);
    // dt = 0 (pausa, menu): il tempo dell'effetto si ferma con tutto il resto.
    view.sync(frame({ shielded: true, dt: 0 }));
    expect(uniform.value).toBeCloseTo(0.5, 10);
  });
});

describe('inclinazione sul pendio', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('la mucca è inclinata quanto il pendio: sta fuori dal gruppo-mondo, quindi non la eredita', () => {
    const view = createPlayerView();
    expect(view.group.rotation.x).toBeCloseTo(WORLD_SLOPE, 10);
  });

  it('sync non tocca l inclinazione, nemmeno mentre piega nei bivi', () => {
    // Regressione: la piegata del bivio si scrive su rotation.z, e chi la
    // riscrivesse con un rotation.set(...) azzererebbe la pendenza lasciando
    // la mucca verticale su un pendio inclinato.
    const view = createPlayerView();
    view.sync(frame({ tilt: 0.4 }));
    expect(view.group.rotation.x).toBeCloseTo(WORLD_SLOPE, 10);
    expect(view.group.rotation.z).toBeCloseTo(0.4, 10);
    view.sync(frame({ tilt: -0.4, dt: 0.5 }));
    expect(view.group.rotation.x).toBeCloseTo(WORLD_SLOPE, 10);
    expect(view.group.rotation.z).toBeCloseTo(-0.4, 10);
  });

  it('la piegata del bivio agisce nel sistema del pendio, non sopra la pendenza', () => {
    // Ordine di Eulero XYZ: la matrice risultante è Rx(pendenza)·Rz(piegata),
    // cioè la piegata viene applicata PRIMA. È lo stesso ordine con cui
    // main.ts compone lo sterzo (rotation.y) sotto la pendenza del
    // gruppo-mondo: se i due divergessero, mucca e pista si piegherebbero in
    // modo diverso nello stesso bivio.
    const view = createPlayerView();
    expect(view.group.rotation.order).toBe('XYZ');
  });

  it('l anello della calamita resta parallelo al pendio, non all orizzonte', () => {
    const view = createPlayerView();
    view.sync(frame({ magnetTimeLeft: 3, tilt: 0.3 }));
    const pivot = magnetPivotOf(view);
    // Il perno annulla la sola piegata del bivio; la pendenza resta, perché
    // il pavimento del corridoio è inclinato quanto il pendio.
    expect(pivot.rotation.z).toBeCloseTo(-0.3, 10);
    expect(pivot.rotation.x).toBe(0);
  });
});
