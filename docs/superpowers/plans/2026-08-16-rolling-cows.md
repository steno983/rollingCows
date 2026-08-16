# Rolling Cows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Costruire un endless runner voxel mobile-first, giocabile e pubblicato su GitHub Pages, in cui una mucca rotola giù da una montagna crescendo fino a esplodere in una fase di valanga distruttiva.

**Architecture:** Il mondo scorre verso un giocatore fermo (tapis roulant) con chunk di terreno riciclati da un pool; la logica gira a timestep fisso ed è scritta in TypeScript puro senza dipendenze da three.js o dal DOM, mentre i moduli di rendering leggono quello stato e lo riflettono. Le collisioni sono test AABB su tre corsie note, e ogni cubetto in volo (detriti, scia della valanga, disintegrazione) vive in un unico `InstancedMesh` con pool preallocato, senza allocazioni durante il gioco.

**Tech Stack:** TypeScript 5 (strict), Vite 5, three.js 0.16x, Vitest 2, GitHub Actions + GitHub Pages. Nessun asset esterno: modelli generati da codice, audio sintetizzato con WebAudio.

**Spec:** `docs/superpowers/specs/2026-08-16-rolling-cows-design.md`

## Global Constraints

- **Separazione logica/vista (non negoziabile):** `src/core/**` e `src/game/**` non importano mai `three`, non toccano il DOM e non usano `window`/`document`. `src/render/**`, `src/ui/**`, `src/input/**`, `src/audio/**` non contengono regole di gioco.
- **Ogni numero di bilanciamento sta in `src/game/config.ts`.** Zero costanti magiche negli altri moduli.
- **Zero allocazioni nel loop di gioco:** pool preallocati, array riusati con `length = 0`, compattazione in place.
- **TypeScript `strict: true` con `noUncheckedIndexedAccess: true`:** ogni accesso indicizzato ad array restituisce `T | undefined` e va gestito.
- **Test affiancati al codice:** `src/game/world.test.ts`, non una cartella `tests/`. Ambiente Vitest `node` di default; i file che toccano il DOM dichiarano `// @vitest-environment jsdom` in prima riga.
- **Budget di performance:** < 60 draw call e < 150k triangoli per frame, 60fps su telefono di fascia media.
- **Node 20+**, npm, base di Vite `'/rollingCows/'` per GitHub Pages.
- **Determinismo:** ogni sorgente di casualità passa da `createRng(seed)`. Mai `Math.random()` nella logica di gioco.
- **Comandi di verifica:** `npm run typecheck`, `npm run test:run`, `npm run build` devono restare verdi a ogni commit.
- Testo dell'interfaccia e dei commenti in italiano dove rivolto all'utente; identificatori e messaggi di commit in inglese.

## Indice dei task

I task sono ordinati per dipendenza: ognuno lascia il progetto verde
(`typecheck`, `test:run`, `build`) e produce un deliverable verificabile da solo.

| # | Task | Deliverable verificabile |
|---|---|---|
| 1 | Scaffolding e pipeline di deploy | `npm run dev/build/test` funzionanti, deploy su GitHub Pages attivo |
| 2 | PRNG deterministico con seed | Stessa sequenza a parità di seed |
| 3 | Tipi di gioco e bus di eventi tipizzato | Eventi consegnati, errori di un handler isolati |
| 4 | Loop a timestep fisso | Update a passo costante, clamp dei salti temporali |
| 5 | Macchina a stati | Transizioni permesse/vietate, hook enter/exit |
| 6 | Configurazione, corsie e curva di velocità | Tutti i numeri in un posto solo; velocità monotona e clampata |
| 7 | Mondo a tapis roulant | Chunk contigui dopo 60 s simulati, nessun buco |
| 8 | Spawner procedurale | Invariante di solvibilità: mai tutte e 3 le corsie bloccate |
| 9 | Movimento del giocatore | Cambio corsia interpolato, salto parabolico, schiacciata |
| 10 | Collisioni AABB | Salti sopra le staccionate, passaggi sotto i rami |
| 11 | Sistema valanga | Soglia, fase, avviso, ritorno a taglia 1 |
| 12 | Punteggio e record | Moltiplicatori, record persistito, storage assente gestito |
| 13 | Orchestratore + test headless | Una run completa simulata senza render: gioco funzionante |
| 14 | Scena, camera e prima immagine | Cielo e nebbia a schermo, nessun errore in console |
| 15 | Modelli voxel | Mucca riconoscibile, facce interne omesse |
| 16 | Terreno ed entità istanziate | Il mondo scorre e la mucca rotola |
| 17 | Pool di voxel e detriti | Gli ostacoli esplodono in cubetti, zero leak di slot |
| 18 | Input swipe e tastiera | **Il gioco diventa giocabile** |
| 19 | HUD, schermate e stati | Menu → partita → game over → rigioca |
| 20 | Audio sintetizzato | Muggito, impatto, raccolta, rombo della valanga |
| 21 | Performance, fallback e rifinitura | Degrado automatico, budget draw call verificato, README |

Il **Task 13** è il primo momento in cui il gioco è completo come sistema (senza
grafica); il **Task 18** è il primo in cui è davvero giocabile. Sono i due punti
in cui vale la pena fermarsi a valutare il risultato.

---

### Task 1: Scaffolding del progetto e pipeline di deploy

Il repository esiste già in `/Users/steno/Dev/rollingCows` con il solo `docs/` committato.
Questo task lo trasforma in un progetto Vite + TypeScript + Vitest funzionante e
pubblicabile su GitHub Pages. Non c'è ancora logica di gioco: solo la toolchain, e un
test di smoke che dimostra che la catena test → build → deploy funziona end-to-end.

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.ts`
- Create: `.gitignore`
- Create: `.github/workflows/deploy.yml`
- Test: `src/smoke.test.ts`

**Interfaces:**
- Consumes: niente (primo task).
- Produces:
  - script npm `dev`, `build`, `preview`, `test`, `test:run`, `typecheck`;
  - alias di import relativi (nessun path mapping: si usano percorsi relativi come `../game/types`);
  - `base: '/rollingCows/'` per il deploy su GitHub Pages;
  - ambiente Vitest `node` di default, `globals: false` (i test importano `describe`/`it`/`expect` da `vitest`).

- [ ] **Step 1: Scrivi il test che fallisce**

Il test di smoke non può nemmeno essere eseguito finché la toolchain non esiste: è
questo il "rosso" del task. Crea `src/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('toolchain', () => {
  it('esegue i test con vitest', () => {
    expect(1 + 1).toBe(2);
  });

  it('supporta la sintassi TypeScript moderna', () => {
    const values: readonly number[] = [1, 2, 3];
    const doubled = values.map((value) => value * 2);
    expect(doubled).toEqual([2, 4, 6]);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/smoke.test.ts`

Atteso: FAIL con `npm error Missing script: "test:run"` (oppure `ENOENT: no such file
or directory, open '.../package.json'`), perché la toolchain non è ancora installata.

- [ ] **Step 3: Implementa il minimo necessario**

`package.json`:

```json
{
  "name": "rolling-cows",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "three": "^0.169.0"
  },
  "devDependencies": {
    "@types/three": "^0.169.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false,
    "forceConsistentCasingInFileNames": true,
    "useDefineForClassFields": true
  },
  "include": ["src", "vite.config.ts"]
}
```

`vite.config.ts` (l'import di `defineConfig` viene da `vitest/config`, così il campo
`test` è tipizzato e `tsc --noEmit` non protesta):

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/rollingCows/',
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
  },
});
```

`index.html` (mobile-first: schermo intero, niente zoom, niente pull-to-refresh,
niente gesti di scroll che rubano gli swipe di gioco):

```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <meta name="theme-color" content="#0b1220" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <title>Rolling Cows</title>
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #0b1220;
        color: #e8f0ff;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
        touch-action: none;
        overscroll-behavior: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
      }

      body {
        position: fixed;
        inset: 0;
      }

      #app {
        position: absolute;
        inset: 0;
        overflow: hidden;
      }

      #game-canvas {
        display: block;
        width: 100%;
        height: 100%;
        touch-action: none;
      }

      #ui-root {
        position: absolute;
        inset: 0;
        pointer-events: none;
        padding: env(safe-area-inset-top) env(safe-area-inset-right)
          env(safe-area-inset-bottom) env(safe-area-inset-left);
      }
    </style>
  </head>
  <body>
    <div id="app">
      <canvas id="game-canvas"></canvas>
      <div id="ui-root"></div>
    </div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/main.ts` (per ora solo una traccia in console: la scena arriva in un task successivo):

```ts
console.info('[rolling-cows] bootstrap ok');
```

`.gitignore`:

```gitignore
node_modules
dist
.DS_Store
*.local
.vite
```

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm run test:run

      - name: Build
        run: npm run build

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

Installa le dipendenze (genera anche `package-lock.json`, indispensabile per `npm ci`
nel workflow):

```bash
cd /Users/steno/Dev/rollingCows
npm install
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comandi, in quest'ordine:

```bash
npm run typecheck
npm run test:run
npm run build
```

Atteso:
- `typecheck`: nessun output di errore, exit code 0.
- `test:run`: PASS, `2 passed` in `src/smoke.test.ts`.
- `build`: `dist/index.html` e `dist/assets/*.js` generati, nessun errore.

Verifica manuale del dev server:

```bash
npm run dev
```

Atteso: Vite stampa un URL locale; aprendolo si vede una pagina completamente scura a
schermo intero e nella console del browser compare `[rolling-cows] bootstrap ok`.
Su mobile (o in device emulation) la pagina non deve scrollare né fare pull-to-refresh.
Chiudi con `Ctrl+C`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html \
  src/main.ts src/smoke.test.ts .gitignore .github/workflows/deploy.yml
git commit -m "chore: scaffold vite + typescript + vitest project with pages deploy"
```

---

### Task 2: PRNG deterministico con seed

Il generatore casuale è a seed perché una run deve essere riproducibile in un test:
è il presupposto di tutti i test futuri su spawner e mondo.

**Files:**
- Create: `src/core/rng.ts`
- Test: `src/core/rng.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces:
```ts
export interface Rng {
  next(): number;
  int(minInclusive: number, maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}
export function createRng(seed: number): Rng;
```

- [ ] **Step 1: Scrivi il test che fallisce**

`src/core/rng.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

describe('createRng', () => {
  it('produce la stessa sequenza a parità di seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const sequenceA = [a.next(), a.next(), a.next(), a.next(), a.next()];
    const sequenceB = [b.next(), b.next(), b.next(), b.next(), b.next()];
    expect(sequenceA).toEqual(sequenceB);
  });

  it('produce sequenze diverse con seed diversi', () => {
    const a = createRng(1);
    const b = createRng(2);
    const sequenceA = [a.next(), a.next(), a.next()];
    const sequenceB = [b.next(), b.next(), b.next()];
    expect(sequenceA).not.toEqual(sequenceB);
  });

  it('next() resta sempre in [0, 1)', () => {
    const rng = createRng(99);
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('int() resta nei limiti e copre tutti i valori possibili', () => {
    const rng = createRng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const value = rng.int(2, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(2);
      expect(value).toBeLessThan(5);
      seen.add(value);
    }
    expect([...seen].sort()).toEqual([2, 3, 4]);
  });

  it('int() con intervallo vuoto o invertito restituisce minInclusive', () => {
    const rng = createRng(3);
    expect(rng.int(4, 4)).toBe(4);
    expect(rng.int(4, 1)).toBe(4);
  });

  it('chance(0) è sempre false e chance(1) è sempre true', () => {
    const rng = createRng(42);
    for (let i = 0; i < 500; i += 1) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it('chance(p) ha una frequenza vicina a p', () => {
    const rng = createRng(2024);
    let hits = 0;
    const samples = 20000;
    for (let i = 0; i < samples; i += 1) {
      if (rng.chance(0.3)) {
        hits += 1;
      }
    }
    const ratio = hits / samples;
    expect(ratio).toBeGreaterThan(0.28);
    expect(ratio).toBeLessThan(0.32);
  });

  it('pick() restituisce sempre un elemento dell\'array', () => {
    const rng = createRng(5);
    const items = ['rock', 'tree', 'fence'] as const;
    for (let i = 0; i < 500; i += 1) {
      expect(items).toContain(rng.pick(items));
    }
  });

  it('pick() su un array di un solo elemento restituisce quell\'elemento', () => {
    const rng = createRng(6);
    expect(rng.pick(['cabin'])).toBe('cabin');
  });

  it('pick() su array vuoto lancia un errore', () => {
    const rng = createRng(6);
    expect(() => rng.pick([])).toThrow('rng.pick: empty array');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/core/rng.test.ts`

Atteso: FAIL con `Failed to resolve import "./rng" from "src/core/rng.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

`src/core/rng.ts`:

```ts
export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** intero in [minInclusive, maxExclusive) */
  int(minInclusive: number, maxExclusive: number): number;
  /** true con probabilità p */
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/**
 * PRNG mulberry32: veloce, senza dipendenze, deterministico a parità di seed.
 * Stato a 32 bit, sufficiente per la generazione procedurale di una run.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxExclusive: number): number => {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxExclusive);
    const span = max - min;
    if (span <= 0) {
      return min;
    }
    return min + Math.floor(next() * span);
  };

  const chance = (p: number): boolean => next() < p;

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('rng.pick: empty array');
    }
    const item = items[int(0, items.length)];
    if (item === undefined) {
      throw new Error('rng.pick: empty array');
    }
    return item;
  };

  return { next, int, chance, pick };
}
```

Nota su `noUncheckedIndexedAccess`: l'accesso `items[...]` è tipizzato `T | undefined`,
per questo c'è il controllo esplicito. Il ramo è irraggiungibile con array densi, ma è
l'unico modo per restringere il tipo senza cast.

Nota su `chance`: `next()` sta in `[0, 1)`, quindi `chance(0)` è sempre `false` e
`chance(1)` è sempre `true` senza bisogno di casi speciali.

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS, tutti i test di `src/core/rng.test.ts` verdi (10 test) più i 2 di smoke.

Comando: `npm run typecheck`

Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/core/rng.ts src/core/rng.test.ts
git commit -m "feat(core): add seeded mulberry32 rng"
```

---

### Task 3: Tipi di gioco e bus di eventi tipizzato

Il bus è il collante fra logica e vista: audio, HUD ed effetti visivi sono consumatori,
la logica non li conosce. Poiché il bus tipizza i payload con i tipi di dominio, questo
task crea anche `src/game/types.ts`.

Requisito non ovvio: **un handler che lancia non deve impedire agli altri di ricevere
l'evento**. Un errore nell'audio non può uccidere il gioco.

**Files:**
- Create: `src/game/types.ts`
- Create: `src/core/events.ts`
- Test: `src/core/events.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces:
```ts
// src/game/types.ts
export type Lane = 0 | 1 | 2;
export type ObstacleKind = 'rock' | 'tree' | 'fence' | 'cabin' | 'crevasse' | 'branch';
export type PickupKind = 'snowflake' | 'hay' | 'cow';
export type EntityKind = ObstacleKind | PickupKind;
export type Action = 'MOVE_LEFT' | 'MOVE_RIGHT' | 'JUMP' | 'SLAM' | 'PAUSE';
export interface Entity { /* vedi Step 3 */ }

// src/core/events.ts
export interface GameEvents { /* vedi Step 3 */ }
export type EventName = keyof GameEvents;
export interface EventBus {
  on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}
export function createEventBus(): EventBus;
```

- [ ] **Step 1: Scrivi il test che fallisce**

`src/core/events.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventBus } from './events';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createEventBus', () => {
  it('consegna il payload all\'handler registrato', () => {
    const bus = createEventBus();
    const received: number[] = [];
    bus.on('run:started', (payload) => {
      received.push(payload.seed);
    });

    bus.emit('run:started', { seed: 4242 });

    expect(received).toEqual([4242]);
  });

  it('consegna lo stesso evento a più handler, nell\'ordine di registrazione', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.on('size:changed', () => {
      calls.push('first');
    });
    bus.on('size:changed', () => {
      calls.push('second');
    });

    bus.emit('size:changed', { size: 3, previous: 2 });

    expect(calls).toEqual(['first', 'second']);
  });

  it('la funzione restituita da on() disiscrive solo quell\'handler', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    const off = bus.on('avalanche:triggered', () => {
      calls.push('removed');
    });
    bus.on('avalanche:triggered', () => {
      calls.push('kept');
    });

    off();
    bus.emit('avalanche:triggered', { size: 5 });

    expect(calls).toEqual(['kept']);
  });

  it('chiamare due volte la funzione di disiscrizione non lancia', () => {
    const bus = createEventBus();
    const off = bus.on('avalanche:ended', () => undefined);

    off();

    expect(() => {
      off();
    }).not.toThrow();
  });

  it('clear() rimuove tutti gli handler di tutti gli eventi', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.on('run:started', () => {
      calls.push('started');
    });
    bus.on('run:ended', () => {
      calls.push('ended');
    });

    bus.clear();
    bus.emit('run:started', { seed: 1 });
    bus.emit('run:ended', { points: 10, distance: 20, isRecord: false });

    expect(calls).toEqual([]);
  });

  it('emit su un evento senza handler non lancia', () => {
    const bus = createEventBus();

    expect(() => {
      bus.emit('avalanche:ending', {});
    }).not.toThrow();
  });

  it('un handler che lancia non impedisce agli altri di ricevere l\'evento', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bus = createEventBus();
    const calls: string[] = [];

    bus.on('obstacle:hit', () => {
      calls.push('before');
    });
    bus.on('obstacle:hit', () => {
      throw new Error('handler esploso');
    });
    bus.on('obstacle:hit', () => {
      calls.push('after');
    });

    expect(() => {
      bus.emit('obstacle:hit', { kind: 'rock', outcome: 'death', lane: 1, z: 12 });
    }).not.toThrow();

    expect(calls).toEqual(['before', 'after']);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('gli eventi sono indipendenti fra loro', () => {
    const bus = createEventBus();
    const calls: string[] = [];
    bus.on('pickup:collected', () => {
      calls.push('pickup');
    });
    bus.on('avalanche:ended', () => {
      calls.push('ended');
    });

    bus.emit('pickup:collected', { kind: 'hay', charge: 5 });

    expect(calls).toEqual(['pickup']);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/core/events.test.ts`

Atteso: FAIL con `Failed to resolve import "./events" from "src/core/events.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/types.ts`:

```ts
export type Lane = 0 | 1 | 2;

export type ObstacleKind = 'rock' | 'tree' | 'fence' | 'cabin' | 'crevasse' | 'branch';
export type PickupKind = 'snowflake' | 'hay' | 'cow';
export type EntityKind = ObstacleKind | PickupKind;

export type Action = 'MOVE_LEFT' | 'MOVE_RIGHT' | 'JUMP' | 'SLAM' | 'PAUSE';

/** Un ostacolo o raccoglibile posizionato sul pendio. */
export interface Entity {
  id: number;
  kind: EntityKind;
  category: 'obstacle' | 'pickup';
  /** Corsia occupata. Per entità larghe 2, è la corsia più a sinistra. */
  lane: Lane;
  /** Corsie occupate. Solo 'cabin' usa 2. */
  width: 1 | 2;
  /** Distanza davanti al giocatore lungo l'asse di scorrimento. Cala nel tempo. */
  z: number;
  /** Quota della base dell'entità (0 = a terra). 'branch' è sospeso. */
  y: number;
  alive: boolean;
}
```

`src/core/events.ts`:

```ts
import type { Lane, ObstacleKind, PickupKind } from '../game/types';

export interface GameEvents {
  'run:started': { seed: number };
  'run:ended': { points: number; distance: number; isRecord: boolean };
  'pickup:collected': { kind: PickupKind; charge: number };
  'obstacle:hit': {
    kind: ObstacleKind;
    outcome: 'death' | 'forgiven' | 'smashed';
    lane: Lane;
    z: number;
  };
  'size:changed': { size: number; previous: number };
  'avalanche:triggered': { size: number };
  'avalanche:ending': Record<string, never>;
  'avalanche:ended': Record<string, never>;
}

export type EventName = keyof GameEvents;

export interface EventBus {
  /** Restituisce una funzione di disiscrizione. */
  on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void;
  emit<K extends EventName>(name: K, payload: GameEvents[K]): void;
  clear(): void;
}

/**
 * Firma interna, volutamente opaca: la mappa non può essere tipizzata per chiave
 * senza perdere la relazione nome→payload dell'API pubblica.
 */
type AnyHandler = (payload: unknown) => void;

export function createEventBus(): EventBus {
  const handlers = new Map<EventName, Set<AnyHandler>>();

  const on = <K extends EventName>(
    name: K,
    handler: (payload: GameEvents[K]) => void,
  ): (() => void) => {
    const wrapped = handler as AnyHandler;
    let set = handlers.get(name);
    if (set === undefined) {
      set = new Set<AnyHandler>();
      handlers.set(name, set);
    }
    const target = set;
    target.add(wrapped);
    return (): void => {
      target.delete(wrapped);
    };
  };

  const emit = <K extends EventName>(name: K, payload: GameEvents[K]): void => {
    const set = handlers.get(name);
    if (set === undefined) {
      return;
    }
    // Si itera il Set direttamente (nessuna copia, nessuna allocazione nel loop).
    // Un handler che lancia viene isolato: gli altri devono comunque ricevere l'evento.
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error(`[events] handler failed for "${name}"`, error);
      }
    }
  };

  const clear = (): void => {
    handlers.clear();
  };

  return { on, emit, clear };
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS, gli 8 test di `src/core/events.test.ts` verdi. Nessun `console.error`
rumoroso in output: quello atteso è catturato dallo spy.

Comando: `npm run typecheck`

Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/types.ts src/core/events.ts src/core/events.test.ts
git commit -m "feat(core): add typed event bus and game domain types"
```

---

### Task 4: Loop di gioco a timestep fisso

La logica deve avanzare a passi costanti di 1/60 s indipendentemente dal frame rate del
dispositivo, altrimenti difficoltà e punteggio dipenderebbero dall'hardware. Il tempo
accumulato viene clampato per evitare la "spirale della morte" al ritorno da background.

`advance(nowMs)` è esposto proprio per poter testare tutto senza `requestAnimationFrame`.

**Files:**
- Create: `src/core/loop.ts`
- Test: `src/core/loop.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces:
```ts
export interface LoopCallbacks {
  update(dt: number): void;
  render(alpha: number): void;
}
export interface Loop {
  readonly running: boolean;
  start(): void;
  stop(): void;
  advance(nowMs: number): void;
}
export function createLoop(
  callbacks: LoopCallbacks,
  options?: { step?: number; maxAccumulated?: number },
): Loop;
```
Default: `step = 1/60`, `maxAccumulated = 0.25`.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/core/loop.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createLoop } from './loop';

const STEP = 1 / 60;

function makeSpies(): {
  update: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
} {
  return { update: vi.fn(), render: vi.fn() };
}

describe('createLoop', () => {
  it('il primo advance inizializza il tempo e non esegue update', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(1000);

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.render).toHaveBeenCalledTimes(1);
  });

  it('avanzando di 16.7ms esegue un update con dt uguale allo step', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(16.7);

    expect(spies.update).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledWith(STEP);
  });

  it('avanzando di 100ms esegue sei update', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(100);

    expect(spies.update).toHaveBeenCalledTimes(6);
  });

  it('il tempo residuo si accumula tra chiamate successive', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(10);
    expect(spies.update).toHaveBeenCalledTimes(0);

    loop.advance(20);
    expect(spies.update).toHaveBeenCalledTimes(1);
  });

  it('un salto enorme viene clampato a maxAccumulated', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(5000);

    expect(spies.update.mock.calls.length).toBeGreaterThanOrEqual(14);
    expect(spies.update.mock.calls.length).toBeLessThanOrEqual(15);
  });

  it('render viene chiamato una volta per advance con alpha in [0, 1)', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(10);
    loop.advance(27);
    loop.advance(41);

    expect(spies.render).toHaveBeenCalledTimes(4);
    for (const call of spies.render.mock.calls) {
      const alpha = call[0] as number;
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('rispetta step e maxAccumulated passati via options', () => {
    const spies = makeSpies();
    const loop = createLoop(spies, { step: 0.1, maxAccumulated: 0.35 });

    loop.advance(0);
    loop.advance(1000);

    expect(spies.update).toHaveBeenCalledTimes(3);
    expect(spies.update).toHaveBeenCalledWith(0.1);
  });

  it('un timestamp che va indietro non produce update né errori', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(1000);
    loop.advance(900);

    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.render).toHaveBeenCalledTimes(2);
  });

  it('running riflette start/stop', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });

  it('start() reimposta il tempo: il primo advance dopo start non esegue update', () => {
    const spies = makeSpies();
    const loop = createLoop(spies);

    loop.advance(0);
    loop.advance(100);
    spies.update.mockClear();

    loop.start();
    loop.advance(5000);

    expect(spies.update).not.toHaveBeenCalled();
    loop.stop();
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/core/loop.test.ts`

Atteso: FAIL con `Failed to resolve import "./loop" from "src/core/loop.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

`src/core/loop.ts`:

```ts
export interface LoopCallbacks {
  /** dt è sempre uguale allo step configurato. */
  update(dt: number): void;
  /** alpha in [0, 1): residuo di interpolazione fra due update. */
  render(alpha: number): void;
}

export interface Loop {
  readonly running: boolean;
  /** Avvia il ciclo su requestAnimationFrame, se disponibile. */
  start(): void;
  stop(): void;
  /** Avanza il loop a un timestamp dato. Esposto per i test (niente rAF). */
  advance(nowMs: number): void;
}

const DEFAULT_STEP = 1 / 60;
const DEFAULT_MAX_ACCUMULATED = 0.25;

function getRaf(): ((cb: (nowMs: number) => void) => number) | null {
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    return null;
  }
  return globalThis.requestAnimationFrame.bind(globalThis);
}

function getCancelRaf(): ((handle: number) => void) | null {
  if (typeof globalThis.cancelAnimationFrame !== 'function') {
    return null;
  }
  return globalThis.cancelAnimationFrame.bind(globalThis);
}

export function createLoop(
  callbacks: LoopCallbacks,
  options?: { step?: number; maxAccumulated?: number },
): Loop {
  const step = options?.step ?? DEFAULT_STEP;
  const maxAccumulated = options?.maxAccumulated ?? DEFAULT_MAX_ACCUMULATED;

  let accumulated = 0;
  let lastMs: number | null = null;
  let running = false;
  let frameHandle: number | null = null;

  const advance = (nowMs: number): void => {
    if (lastMs === null) {
      // Primo frame: si registra solo il tempo di partenza, nessun update.
      lastMs = nowMs;
      callbacks.render(0);
      return;
    }

    let elapsed = (nowMs - lastMs) / 1000;
    lastMs = nowMs;
    if (elapsed < 0) {
      elapsed = 0;
    }

    accumulated += elapsed;
    if (accumulated > maxAccumulated) {
      // Clamp anti "spirale della morte" dopo una pausa lunga (tab in background).
      accumulated = maxAccumulated;
    }

    while (accumulated >= step) {
      accumulated -= step;
      callbacks.update(step);
    }

    callbacks.render(accumulated / step);
  };

  const tick = (nowMs: number): void => {
    if (!running) {
      return;
    }
    advance(nowMs);
    const raf = getRaf();
    frameHandle = raf === null ? null : raf(tick);
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    accumulated = 0;
    lastMs = null;
    const raf = getRaf();
    frameHandle = raf === null ? null : raf(tick);
  };

  const stop = (): void => {
    running = false;
    const cancel = getCancelRaf();
    if (frameHandle !== null && cancel !== null) {
      cancel(frameHandle);
    }
    frameHandle = null;
  };

  return {
    get running(): boolean {
      return running;
    },
    start,
    stop,
    advance,
  };
}
```

Nota: in ambiente node `requestAnimationFrame` non esiste, quindi `start()` si limita a
mettere `running = true` e i test pilotano il tempo con `advance()`. In browser il
binding a `globalThis` evita l'errore "Illegal invocation".

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS, i 10 test di `src/core/loop.test.ts` verdi.

Comando: `npm run typecheck`

Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/core/loop.ts src/core/loop.test.ts
git commit -m "feat(core): add fixed timestep game loop"
```

---

### Task 5: Macchina a stati del gioco

Gli stati sono `boot → menu → playing → paused → gameover → menu`. La tabella delle
transizioni permesse è chiusa: tutto ciò che non è elencato è vietato e `transition()`
restituisce `false` senza cambiare stato. Questo evita, per esempio, di finire in
`playing` da `boot` saltando il menu.

**Files:**
- Create: `src/core/state-machine.ts`
- Test: `src/core/state-machine.test.ts`

**Interfaces:**
- Consumes: niente.
- Produces:
```ts
export type GameStateName = 'boot' | 'menu' | 'playing' | 'paused' | 'gameover';
export interface StateMachine {
  readonly current: GameStateName;
  can(to: GameStateName): boolean;
  transition(to: GameStateName): boolean;
  onEnter(state: GameStateName, fn: () => void): void;
  onExit(state: GameStateName, fn: () => void): void;
}
export function createStateMachine(initial?: GameStateName): StateMachine;
```
Transizioni permesse: `boot→menu`, `menu→playing`, `playing→paused`,
`playing→gameover`, `paused→playing`, `paused→menu`, `gameover→playing`,
`gameover→menu`.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/core/state-machine.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createStateMachine } from './state-machine';

describe('createStateMachine', () => {
  it('parte da boot per default', () => {
    const machine = createStateMachine();

    expect(machine.current).toBe('boot');
  });

  it('accetta uno stato iniziale esplicito', () => {
    const machine = createStateMachine('menu');

    expect(machine.current).toBe('menu');
  });

  it('esegue una transizione permessa e aggiorna current', () => {
    const machine = createStateMachine();

    expect(machine.transition('menu')).toBe(true);
    expect(machine.current).toBe('menu');
    expect(machine.transition('playing')).toBe(true);
    expect(machine.current).toBe('playing');
  });

  it('rifiuta una transizione vietata senza cambiare stato', () => {
    const machine = createStateMachine();

    expect(machine.transition('playing')).toBe(false);
    expect(machine.current).toBe('boot');
    expect(machine.transition('gameover')).toBe(false);
    expect(machine.current).toBe('boot');
  });

  it('rifiuta la transizione verso sé stesso', () => {
    const machine = createStateMachine('playing');

    expect(machine.transition('playing')).toBe(false);
    expect(machine.current).toBe('playing');
  });

  it('can() riflette esattamente la tabella delle transizioni', () => {
    const boot = createStateMachine('boot');
    expect(boot.can('menu')).toBe(true);
    expect(boot.can('playing')).toBe(false);
    expect(boot.can('paused')).toBe(false);
    expect(boot.can('gameover')).toBe(false);

    const menu = createStateMachine('menu');
    expect(menu.can('playing')).toBe(true);
    expect(menu.can('paused')).toBe(false);
    expect(menu.can('gameover')).toBe(false);
    expect(menu.can('boot')).toBe(false);

    const playing = createStateMachine('playing');
    expect(playing.can('paused')).toBe(true);
    expect(playing.can('gameover')).toBe(true);
    expect(playing.can('menu')).toBe(false);
    expect(playing.can('boot')).toBe(false);

    const paused = createStateMachine('paused');
    expect(paused.can('playing')).toBe(true);
    expect(paused.can('menu')).toBe(true);
    expect(paused.can('gameover')).toBe(false);
    expect(paused.can('boot')).toBe(false);

    const gameover = createStateMachine('gameover');
    expect(gameover.can('playing')).toBe(true);
    expect(gameover.can('menu')).toBe(true);
    expect(gameover.can('paused')).toBe(false);
    expect(gameover.can('boot')).toBe(false);
  });

  it('invoca onExit del vecchio stato prima di onEnter del nuovo', () => {
    const machine = createStateMachine();
    const calls: string[] = [];

    machine.onExit('boot', () => {
      calls.push('exit:boot');
    });
    machine.onEnter('menu', () => {
      calls.push('enter:menu');
    });

    machine.transition('menu');

    expect(calls).toEqual(['exit:boot', 'enter:menu']);
  });

  it('durante onEnter il current è già il nuovo stato', () => {
    const machine = createStateMachine();
    const observed: string[] = [];

    machine.onExit('boot', () => {
      observed.push(machine.current);
    });
    machine.onEnter('menu', () => {
      observed.push(machine.current);
    });

    machine.transition('menu');

    expect(observed).toEqual(['boot', 'menu']);
  });

  it('non invoca alcun listener se la transizione è vietata', () => {
    const machine = createStateMachine();
    const calls: string[] = [];

    machine.onExit('boot', () => {
      calls.push('exit:boot');
    });
    machine.onEnter('playing', () => {
      calls.push('enter:playing');
    });

    expect(machine.transition('playing')).toBe(false);
    expect(calls).toEqual([]);
  });

  it('supporta più listener sullo stesso stato, in ordine di registrazione', () => {
    const machine = createStateMachine();
    const calls: string[] = [];

    machine.onEnter('menu', () => {
      calls.push('enter-a');
    });
    machine.onEnter('menu', () => {
      calls.push('enter-b');
    });
    machine.onExit('menu', () => {
      calls.push('exit-a');
    });
    machine.onExit('menu', () => {
      calls.push('exit-b');
    });

    machine.transition('menu');
    machine.transition('playing');

    expect(calls).toEqual(['enter-a', 'enter-b', 'exit-a', 'exit-b']);
  });

  it('copre il ciclo completo boot → menu → playing → paused → playing → gameover → menu', () => {
    const machine = createStateMachine();
    const path: string[] = [];

    for (const state of ['menu', 'playing', 'paused', 'playing', 'gameover', 'menu'] as const) {
      expect(machine.transition(state)).toBe(true);
      path.push(machine.current);
    }

    expect(path).toEqual(['menu', 'playing', 'paused', 'playing', 'gameover', 'menu']);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/core/state-machine.test.ts`

Atteso: FAIL con `Failed to resolve import "./state-machine" from
"src/core/state-machine.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

`src/core/state-machine.ts`:

```ts
export type GameStateName = 'boot' | 'menu' | 'playing' | 'paused' | 'gameover';

export interface StateMachine {
  readonly current: GameStateName;
  can(to: GameStateName): boolean;
  /** Esegue la transizione se permessa; restituisce true se avvenuta. */
  transition(to: GameStateName): boolean;
  onEnter(state: GameStateName, fn: () => void): void;
  onExit(state: GameStateName, fn: () => void): void;
}

/** Tabella chiusa: tutto ciò che non è elencato è vietato. */
const TRANSITIONS: Record<GameStateName, readonly GameStateName[]> = {
  boot: ['menu'],
  menu: ['playing'],
  playing: ['paused', 'gameover'],
  paused: ['playing', 'menu'],
  gameover: ['playing', 'menu'],
};

type Listener = () => void;

function createListenerMap(): Record<GameStateName, Listener[]> {
  return {
    boot: [],
    menu: [],
    playing: [],
    paused: [],
    gameover: [],
  };
}

export function createStateMachine(initial: GameStateName = 'boot'): StateMachine {
  let current: GameStateName = initial;
  const enterListeners = createListenerMap();
  const exitListeners = createListenerMap();

  const can = (to: GameStateName): boolean => TRANSITIONS[current].includes(to);

  const transition = (to: GameStateName): boolean => {
    if (!can(to)) {
      return false;
    }

    const from = current;
    for (const listener of exitListeners[from]) {
      listener();
    }

    current = to;

    for (const listener of enterListeners[to]) {
      listener();
    }

    return true;
  };

  const onEnter = (state: GameStateName, fn: Listener): void => {
    enterListeners[state].push(fn);
  };

  const onExit = (state: GameStateName, fn: Listener): void => {
    exitListeners[state].push(fn);
  };

  return {
    get current(): GameStateName {
      return current;
    },
    can,
    transition,
    onEnter,
    onExit,
  };
}
```

Nota: `TRANSITIONS` e le mappe di listener sono `Record<GameStateName, ...>` con chiavi
letterali esplicite, quindi `noUncheckedIndexedAccess` non introduce `| undefined`
sull'accesso — nessun controllo difensivo necessario.

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS, gli 11 test di `src/core/state-machine.test.ts` verdi, insieme a tutti i
precedenti (rng, events, loop, smoke).

Comando: `npm run typecheck`

Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/core/state-machine.ts src/core/state-machine.test.ts
git commit -m "feat(core): add game state machine with guarded transitions"
```

---

### Task 6: Configurazione e geometria delle corsie

**Files:**
- Create: `src/game/config.ts`
- Create: `src/game/lanes.ts`
- Create: `src/game/speed.ts`
- Test: `src/game/lanes.test.ts`
- Test: `src/game/speed.test.ts`

**Interfaces:**
- Consumes: `export type Lane = 0 | 1 | 2;` da `src/game/types.ts` (Task 2).
- Produces:
  - `export const CONFIG` (oggetto `as const` con tutti i numeri di bilanciamento).
  - `export function laneToX(lane: number): number;`
  - `export function entityCenterX(lane: number, width: number): number;`
  - `export function entityHalfWidth(width: number): number;`
  - `export function clampLane(lane: number): Lane;`
  - `export function speedAt(distance: number): number;`
  - `export function difficultyAt(distance: number): number;`

Nota: `config.ts` è dato puro (nessuna logica) e viene creato insieme ai test, perché
i test stessi leggono le costanti da lì invece di ripetere numeri a mano. Il ciclo
rosso/verde riguarda `lanes.ts` e `speed.ts`.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/config.ts` (dato puro, contenuto integrale):

```ts
export const CONFIG = {
  world: {
    laneCount: 3,
    laneWidth: 2,
    startSpeed: 18,
    maxSpeed: 40,
    speedGrowth: 6,
    speedRefDistance: 150,
    chunkLength: 40,
    chunkCount: 6,
    despawnBehindZ: -20,
  },
  player: {
    laneChangeSeconds: 0.12,
    jumpSeconds: 0.55,
    jumpHeight: 3.2,
    slamGravityMultiplier: 3.5,
    baseHalfWidth: 0.45,
    halfWidthPerSize: 0.11,
    baseHeight: 1.2,
    heightPerSize: 0.25,
    depth: 1.4,
  },
  avalanche: {
    threshold: 100,
    durationSeconds: 8,
    warningSeconds: 1.5,
    scoreMultiplier: 4,
    /** Soglie di carica per taglia 1..5 */
    sizeThresholds: [0, 20, 40, 60, 80],
    maxSize: 5,
    /** Taglia minima per sfondare tree/fence */
    smashMinSize: 3,
  },
  forgiveness: {
    enabled: true,
    minChargeRatio: 0.5,
    sizePenalty: 1,
  },
  pickups: {
    charge: { snowflake: 1, hay: 5, cow: 10 },
    sizeBonus: { snowflake: 0, hay: 0, cow: 1 },
  },
  score: {
    pointsPerUnit: 1,
    pickupBonus: { snowflake: 5, hay: 25, cow: 50 },
    smashBonus: 30,
    recordKey: 'rollingcows.record',
  },
  spawn: {
    /** Passo tra due "righe" generabili dentro un chunk */
    rowSpacing: 10,
    /** Probabilità che una riga contenga qualcosa, a difficoltà 0 e 1 */
    rowFillChanceMin: 0.35,
    rowFillChanceMax: 0.8,
    /** Numero massimo di corsie occupabili da ostacoli in una riga (deve restare >=1 libera) */
    maxBlockedLanes: 2,
    /** Distanza a cui la difficoltà raggiunge il massimo */
    difficultyRampDistance: 2500,
    pickupChance: 0.45,
    cowChance: 0.05,
    hayChance: 0.15,
  },
  render: {
    maxPixelRatio: 2,
    fogNear: 40,
    fogFar: 120,
    voxelPoolSize: 4000,
    voxelSize: 0.25,
    cameraBaseDistance: 9,
    cameraDistancePerSize: 0.9,
    cameraBaseFov: 60,
    cameraAvalancheFov: 78,
    shakeDecay: 4,
  },
  input: {
    swipeMinPixels: 24,
    swipeMaxMs: 400,
    bufferSeconds: 0.18,
  },
  perf: {
    lowFpsThreshold: 45,
    lowFpsSeconds: 3,
  },
} as const;
```

`src/game/lanes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { clampLane, entityCenterX, entityHalfWidth, laneToX } from './lanes';

describe('laneToX', () => {
  it('mette la corsia centrale esattamente a x = 0', () => {
    expect(laneToX(1)).toBe(0);
  });

  it('mette le corsie esterne simmetriche a +/- laneWidth', () => {
    expect(laneToX(0)).toBe(-CONFIG.world.laneWidth);
    expect(laneToX(2)).toBe(CONFIG.world.laneWidth);
    expect(laneToX(0) + laneToX(2)).toBe(0);
  });
});

describe('entityCenterX', () => {
  it('per una entità larga 1 coincide con il centro della corsia', () => {
    expect(entityCenterX(0, 1)).toBe(laneToX(0));
    expect(entityCenterX(2, 1)).toBe(laneToX(2));
  });

  it('per una cabin larga 2 che parte da lane 0 sta a metà tra le corsie 0 e 1', () => {
    expect(entityCenterX(0, 2)).toBe((laneToX(0) + laneToX(1)) / 2);
  });

  it('per una cabin larga 2 che parte da lane 1 sta a metà tra le corsie 1 e 2', () => {
    expect(entityCenterX(1, 2)).toBe((laneToX(1) + laneToX(2)) / 2);
  });
});

describe('entityHalfWidth', () => {
  it('copre mezza corsia per lato per una entità larga 1', () => {
    expect(entityHalfWidth(1)).toBe(CONFIG.world.laneWidth / 2);
  });

  it('raddoppia per una entità larga 2', () => {
    expect(entityHalfWidth(2)).toBe(entityHalfWidth(1) * 2);
  });
});

describe('clampLane', () => {
  it('lascia invariate le corsie valide', () => {
    expect(clampLane(0)).toBe(0);
    expect(clampLane(1)).toBe(1);
    expect(clampLane(2)).toBe(2);
  });

  it('clampa i valori fuori range agli estremi', () => {
    expect(clampLane(-1)).toBe(0);
    expect(clampLane(-99)).toBe(0);
    expect(clampLane(3)).toBe(2);
    expect(clampLane(99)).toBe(2);
  });

  it('arrotonda i valori non interi alla corsia più vicina', () => {
    expect(clampLane(1.4)).toBe(1);
    expect(clampLane(1.6)).toBe(2);
  });
});
```

`src/game/speed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { difficultyAt, speedAt } from './speed';

describe('speedAt', () => {
  it('parte esattamente da startSpeed', () => {
    expect(speedAt(0)).toBe(CONFIG.world.startSpeed);
  });

  it('cresce in modo monotono con la distanza', () => {
    let previous = speedAt(0);
    for (let distance = 25; distance <= 3000; distance += 25) {
      const current = speedAt(distance);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
    expect(speedAt(500)).toBeGreaterThan(speedAt(100));
  });

  it('resta clampata a maxSpeed anche per distanze enormi', () => {
    expect(speedAt(10_000_000)).toBe(CONFIG.world.maxSpeed);
    expect(speedAt(1e12)).toBe(CONFIG.world.maxSpeed);
  });

  it('non supera mai maxSpeed lungo tutta la curva', () => {
    for (let distance = 0; distance <= 500_000; distance += 500) {
      expect(speedAt(distance)).toBeLessThanOrEqual(CONFIG.world.maxSpeed);
    }
  });
});

describe('difficultyAt', () => {
  it('vale 0 alla partenza', () => {
    expect(difficultyAt(0)).toBe(0);
  });

  it('vale 1 alla distanza di rampa e oltre', () => {
    expect(difficultyAt(CONFIG.spawn.difficultyRampDistance)).toBe(1);
    expect(difficultyAt(CONFIG.spawn.difficultyRampDistance * 10)).toBe(1);
  });

  it('è lineare a metà rampa', () => {
    expect(difficultyAt(CONFIG.spawn.difficultyRampDistance / 2)).toBeCloseTo(0.5, 10);
  });

  it('non scende sotto 0 per distanze negative', () => {
    expect(difficultyAt(-100)).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/lanes.test.ts src/game/speed.test.ts`

Atteso: FAIL con `Failed to resolve import "./lanes"` e `Failed to resolve import "./speed"` (i moduli non esistono ancora).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/lanes.ts`:

```ts
import { CONFIG } from './config';
import type { Lane } from './types';

const { laneCount, laneWidth } = CONFIG.world;

/** Indice della corsia centrale espresso come numero reale: con 3 corsie vale 1. */
const CENTER_LANE = (laneCount - 1) / 2;

/** Centro X della corsia (corsia 1 = 0). */
export function laneToX(lane: number): number {
  return (lane - CENTER_LANE) * laneWidth;
}

/** Centro X di un'entità larga `width` corsie che parte da `lane`. */
export function entityCenterX(lane: number, width: number): number {
  return laneToX(lane) + ((width - 1) * laneWidth) / 2;
}

/** Semi-larghezza in unità di mondo di un'entità larga `width` corsie. */
export function entityHalfWidth(width: number): number {
  return (width * laneWidth) / 2;
}

/** Corsia valida più vicina, clampata in [0, laneCount-1]. */
export function clampLane(lane: number): Lane {
  const rounded = Math.round(lane);
  if (rounded <= 0) return 0;
  if (rounded >= laneCount - 1) return (laneCount - 1) as Lane;
  return rounded as Lane;
}
```

`src/game/speed.ts`:

```ts
import { CONFIG } from './config';

/** Velocità di scorrimento del mondo alla distanza data (u/s). */
export function speedAt(distance: number): number {
  const { startSpeed, maxSpeed, speedGrowth, speedRefDistance } = CONFIG.world;
  const grown = startSpeed + speedGrowth * Math.log1p(Math.max(0, distance) / speedRefDistance);
  return Math.min(maxSpeed, grown);
}

/** Difficoltà normalizzata in [0,1] alla distanza data. */
export function difficultyAt(distance: number): number {
  const ratio = distance / CONFIG.spawn.difficultyRampDistance;
  if (ratio <= 0) return 0;
  return Math.min(1, ratio);
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS (tutti i test di `lanes.test.ts` e `speed.test.ts`, più quelli dei task precedenti).

Verifica anche i tipi: `npm run typecheck` → nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/config.ts src/game/lanes.ts src/game/lanes.test.ts src/game/speed.ts src/game/speed.test.ts
git commit -m "feat(game): add balancing config, lane geometry and speed curve"
```

---

### Task 7: Mondo a tapis roulant con pooling dei chunk

**Files:**
- Create: `src/game/world.ts`
- Test: `src/game/world.test.ts`

**Interfaces:**
- Consumes:
  - `export const CONFIG` da `./config` (Task 6): `world.chunkLength`, `world.chunkCount`, `world.despawnBehindZ`.
  - `export function speedAt(distance: number): number;` da `./speed` (Task 6).
- Produces:
  - `export interface Chunk { id: number; z: number; }`
  - `export interface WorldState { distance: number; speed: number; chunks: Chunk[]; recycled: Chunk[]; }`
  - `export function createWorld(): WorldState;`
  - `export function updateWorld(world: WorldState, dt: number): void;`

Vincolo: nessuna allocazione per frame. `recycled` è **lo stesso array** per tutta la
vita del mondo: viene azzerato con `length = 0` all'inizio di ogni `updateWorld` e
riempito con riferimenti ai chunk già esistenti. Anche i cicli sono indicizzati (non
`for...of`), per non creare un iteratore a ogni frame.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/world.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { speedAt } from './speed';
import { createWorld, updateWorld } from './world';
import type { Chunk } from './world';

const { chunkCount, chunkLength, despawnBehindZ } = CONFIG.world;

function sortedByZ(chunks: Chunk[]): Chunk[] {
  return [...chunks].sort((a, b) => a.z - b.z);
}

describe('createWorld', () => {
  it('crea chunkCount chunk a z crescente con passo chunkLength', () => {
    const world = createWorld();
    expect(world.chunks).toHaveLength(chunkCount);
    for (let i = 0; i < world.chunks.length; i++) {
      const chunk = world.chunks[i];
      expect(chunk).toBeDefined();
      if (!chunk) continue;
      expect(chunk.z).toBe(i * chunkLength);
    }
  });

  it('non lascia buchi tra chunk adiacenti', () => {
    const sorted = sortedByZ(createWorld().chunks);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (!previous || !current) throw new Error('chunk mancante');
      expect(current.z - previous.z).toBe(chunkLength);
    }
  });

  it('parte da distanza 0, velocità iniziale e nessun riciclo', () => {
    const world = createWorld();
    expect(world.distance).toBe(0);
    expect(world.speed).toBe(speedAt(0));
    expect(world.recycled).toHaveLength(0);
  });

  it('assegna id univoci ai chunk', () => {
    const ids = new Set(createWorld().chunks.map((chunk) => chunk.id));
    expect(ids.size).toBe(chunkCount);
  });
});

describe('updateWorld', () => {
  it('avanza distance di speed * dt', () => {
    const world = createWorld();
    const dt = 1 / 60;
    const expected = speedAt(0) * dt;
    updateWorld(world, dt);
    expect(world.distance).toBeCloseTo(expected, 10);
    expect(world.speed).toBe(speedAt(0));
  });

  it('fa arretrare i chunk di speed * dt', () => {
    const world = createWorld();
    const dt = 1 / 60;
    const delta = speedAt(0) * dt;
    updateWorld(world, dt);
    for (let i = 0; i < world.chunks.length; i++) {
      const chunk = world.chunks[i];
      if (!chunk) throw new Error('chunk mancante');
      expect(chunk.z).toBeCloseTo(i * chunkLength - delta, 10);
    }
  });

  it('ricicla in coda il chunk uscito oltre despawnBehindZ', () => {
    const world = createWorld();
    // Un solo passo lungo abbastanza da spingere il primo chunk dietro la soglia.
    const dt = (chunkLength - despawnBehindZ + 1) / speedAt(0);
    updateWorld(world, dt);

    expect(world.recycled).toHaveLength(1);
    const recycled = world.recycled[0];
    if (!recycled) throw new Error('nessun chunk riciclato');
    expect(recycled.id).toBe(0);

    let maxOther = -Infinity;
    for (const chunk of world.chunks) {
      if (chunk.id === recycled.id) continue;
      if (chunk.z > maxOther) maxOther = chunk.z;
    }
    expect(recycled.z).toBeCloseTo(maxOther + chunkLength, 10);
  });

  it('svuota recycled all-inizio di ogni frame invece di accumulare', () => {
    const world = createWorld();
    const dt = (chunkLength - despawnBehindZ + 1) / speedAt(0);
    updateWorld(world, dt);
    expect(world.recycled.length).toBeGreaterThan(0);

    // Passo cortissimo: nessun chunk esce, quindi recycled deve tornare vuoto.
    updateWorld(world, 1 / 600);
    expect(world.recycled).toHaveLength(0);
  });

  it('riusa sempre lo stesso array recycled (nessuna allocazione)', () => {
    const world = createWorld();
    const reference = world.recycled;
    for (let i = 0; i < 100; i++) updateWorld(world, 1 / 60);
    expect(world.recycled).toBe(reference);
  });

  it('mantiene i chunk contigui e in numero costante dopo 60 secondi simulati', () => {
    const world = createWorld();
    const dt = 1 / 60;
    for (let step = 0; step < 60 * 60; step++) {
      updateWorld(world, dt);
      expect(world.chunks).toHaveLength(chunkCount);
      const sorted = sortedByZ(world.chunks);
      for (let i = 1; i < sorted.length; i++) {
        const previous = sorted[i - 1];
        const current = sorted[i];
        if (!previous || !current) throw new Error('chunk mancante');
        expect(Math.abs(current.z - previous.z - chunkLength)).toBeLessThan(1e-6);
      }
    }
    expect(world.distance).toBeGreaterThan(CONFIG.world.startSpeed * 59);
  });

  it('aggiorna la velocità seguendo la curva speedAt', () => {
    const world = createWorld();
    for (let step = 0; step < 600; step++) updateWorld(world, 1 / 60);
    expect(world.speed).toBeGreaterThan(CONFIG.world.startSpeed);
    expect(world.speed).toBeLessThanOrEqual(CONFIG.world.maxSpeed);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/world.test.ts`

Atteso: FAIL con `Failed to resolve import "./world"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/world.ts`:

```ts
import { CONFIG } from './config';
import { speedAt } from './speed';

export interface Chunk {
  id: number;
  /** Bordo iniziale (più vicino al giocatore) del chunk. */
  z: number;
}

export interface WorldState {
  distance: number;
  speed: number;
  chunks: Chunk[];
  /** Riempito da updateWorld a ogni frame: chunk riciclati in questo frame. */
  recycled: Chunk[];
}

export function createWorld(): WorldState {
  const { chunkCount, chunkLength } = CONFIG.world;
  const chunks: Chunk[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push({ id: i, z: i * chunkLength });
  }
  return {
    distance: 0,
    speed: speedAt(0),
    chunks,
    recycled: [],
  };
}

/** Avanza distanza e scorre i chunk. I chunk usciti dietro vengono riposizionati
 *  in coda e messi in `world.recycled` (array riusato, svuotato a ogni chiamata). */
export function updateWorld(world: WorldState, dt: number): void {
  const { chunkLength, despawnBehindZ } = CONFIG.world;
  const chunks = world.chunks;

  world.recycled.length = 0;
  world.speed = speedAt(world.distance);

  const delta = world.speed * dt;
  world.distance += delta;

  // Primo passaggio: scorrimento e ricerca del bordo più lontano.
  let maxZ = -Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    chunk.z -= delta;
    if (chunk.z > maxZ) maxZ = chunk.z;
  }

  // Secondo passaggio: riciclo in coda. `maxZ` avanza a ogni riciclo, così anche
  // più chunk riciclati nello stesso frame restano contigui e senza sovrapposizioni.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk === undefined) continue;
    if (chunk.z + chunkLength < despawnBehindZ) {
      maxZ += chunkLength;
      chunk.z = maxZ;
      world.recycled.push(chunk);
    }
  }
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS. In particolare il test di simulazione lunga ("mantiene i chunk contigui
e in numero costante dopo 60 secondi simulati") deve passare senza deriva: la
differenza tra chunk adiacenti resta `chunkLength` entro `1e-6`.

Verifica anche i tipi: `npm run typecheck` → nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/world.ts src/game/world.test.ts
git commit -m "feat(game): add treadmill world with chunk pooling"
```

---

### Task 8: Generatore procedurale di ostacoli e raccoglibili

**Files:**
- Create: `src/game/spawner.ts`
- Test: `src/game/spawner.test.ts`

**Interfaces:**
- Consumes:
  - `export interface Rng { next(): number; int(minInclusive: number, maxExclusive: number): number; chance(p: number): boolean; pick<T>(items: readonly T[]): T; }` e `export function createRng(seed: number): Rng;` da `../core/rng` (Task 3).
  - `export interface Entity { id: number; kind: EntityKind; category: 'obstacle' | 'pickup'; lane: Lane; width: 1 | 2; z: number; y: number; alive: boolean; }` da `./types` (Task 2).
  - `export const CONFIG` da `./config` (Task 6): `world.laneCount`, `world.chunkLength`, tutto `spawn`.
- Produces:
  - `export interface Spawner { populateChunk(chunkZ: number, difficulty: number, out: Entity[]): void; reset(): void; }`
  - `export function createSpawner(rng: Rng): Spawner;`
  - `export const BRANCH_Y: number;` (quota del ramo sospeso)

Note di progetto:
1. **Determinismo.** L'RNG è iniettato: con lo stesso seed la generazione è
   riproducibile, per questo i test possono asserire invarianti su centinaia di chunk.
2. **Costanti locali.** `BRANCH_Y` e i pesi della tabella di generazione (`WEIGHTS`)
   vivono in `spawner.ts` e non in `CONFIG` perché il contratto congela il contenuto
   di `config.ts`. Sono raccolti in due sole costanti in testa al file, documentate:
   se in futuro serve tararli dall'esterno si spostano in `CONFIG.spawn` senza
   toccare la logica. `BRANCH_Y` è geometria dell'entità, non bilanciamento: sta
   accanto alle altre misure per kind, come `ENTITY_BOX` in `collisions.ts`.
3. **Zero array temporanei.** L'unico array di appoggio (`laneBlocked`) è allocato una
   volta in `createSpawner` e riazzerato per riga. Le entità vengono scritte
   direttamente in `out` con `push`; l'array `out` è di proprietà del chiamante
   (`game.ts`), che lo riusa.
4. **Solvibilità.** Per costruzione una riga non può mai bloccare a terra tutte le
   corsie: gli ostacoli a terra si fermano a `CONFIG.spawn.maxBlockedLanes` (2), e la
   `cabin`, che da sola ne occupa 2, esclude qualsiasi altro ostacolo a terra nella
   stessa riga. Il `branch` è sospeso (`y = 1.6`): non blocca la corsia, si passa
   sotto con lo slam, e viene generato solo se al massimo una corsia è già bloccata.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/spawner.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { CONFIG } from './config';
import { BRANCH_Y, createSpawner } from './spawner';
import type { Entity } from './types';

const { laneCount, chunkLength } = CONFIG.world;

function rowsOf(entities: Entity[]): number[] {
  return [...new Set(entities.map((entity) => entity.z))].sort((a, b) => a - b);
}

/** Corsie realmente bloccate a terra in una riga: il branch è sospeso e non conta. */
function groundBlockedLanes(entities: Entity[], rowZ: number): Set<number> {
  const blocked = new Set<number>();
  for (const entity of entities) {
    if (entity.z !== rowZ) continue;
    if (entity.category !== 'obstacle') continue;
    if (entity.y > 0) continue;
    for (let offset = 0; offset < entity.width; offset++) {
      blocked.add(entity.lane + offset);
    }
  }
  return blocked;
}

function generate(seed: number, difficulty: number, chunks: number): Entity[] {
  const spawner = createSpawner(createRng(seed));
  const out: Entity[] = [];
  for (let i = 0; i < chunks; i++) {
    spawner.populateChunk(i * chunkLength, difficulty, out);
  }
  return out;
}

describe('populateChunk', () => {
  it('posiziona le entità dentro l-intervallo [chunkZ, chunkZ + chunkLength)', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const spawner = createSpawner(createRng(seed));
      const out: Entity[] = [];
      const chunkZ = 320;
      spawner.populateChunk(chunkZ, 1, out);
      for (const entity of out) {
        expect(entity.z).toBeGreaterThanOrEqual(chunkZ);
        expect(entity.z).toBeLessThan(chunkZ + chunkLength);
      }
    }
  });

  it('aggiunge in coda a out senza cancellare il contenuto preesistente', () => {
    const spawner = createSpawner(createRng(7));
    const out: Entity[] = [];
    spawner.populateChunk(0, 1, out);
    const first = out.length;
    spawner.populateChunk(chunkLength, 1, out);
    expect(out.length).toBeGreaterThan(first);
  });

  it('non lascia mai una riga con tutte le corsie bloccate a terra (500 seed, difficoltà 1)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const entities = generate(seed, 1, 1);
      for (const rowZ of rowsOf(entities)) {
        const blocked = groundBlockedLanes(entities, rowZ);
        expect(blocked.size).toBeLessThanOrEqual(CONFIG.spawn.maxBlockedLanes);
        expect(blocked.size).toBeLessThanOrEqual(laneCount - 1);
      }
    }
  });

  it('genera meno entità a difficoltà 0 che a difficoltà 1', () => {
    const easy = generate(12345, 0, 200).length;
    const hard = generate(12345, 1, 200).length;
    expect(easy).toBeGreaterThan(0);
    expect(easy).toBeLessThan(hard);
  });

  it('non mette mai un pickup nella stessa corsia e riga di un ostacolo a terra', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const entities = generate(seed, 1, 3);
      for (const entity of entities) {
        if (entity.category !== 'pickup') continue;
        const blocked = groundBlockedLanes(entities, entity.z);
        expect(blocked.has(entity.lane)).toBe(false);
      }
    }
  });

  it('assegna id univoci e strettamente crescenti', () => {
    const entities = generate(99, 1, 50);
    expect(entities.length).toBeGreaterThan(10);
    for (let i = 1; i < entities.length; i++) {
      const previous = entities[i - 1];
      const current = entities[i];
      if (!previous || !current) throw new Error('entità mancante');
      expect(current.id).toBeGreaterThan(previous.id);
    }
  });

  it('sospende solo il branch: y = 1.6 per il branch, 0 per tutto il resto', () => {
    const entities = generate(2024, 1, 200);
    let branches = 0;
    for (const entity of entities) {
      if (entity.kind === 'branch') {
        branches++;
        expect(entity.y).toBe(BRANCH_Y);
        expect(BRANCH_Y).toBe(1.6);
      } else {
        expect(entity.y).toBe(0);
      }
    }
    expect(branches).toBeGreaterThan(0);
  });

  it('dà width 2 solo alla cabin, e solo nelle corsie 0 o 1', () => {
    const entities = generate(4242, 1, 200);
    let cabins = 0;
    for (const entity of entities) {
      if (entity.kind === 'cabin') {
        cabins++;
        expect(entity.width).toBe(2);
        expect([0, 1]).toContain(entity.lane);
      } else {
        expect(entity.width).toBe(1);
      }
    }
    expect(cabins).toBeGreaterThan(0);
  });

  it('marca tutte le entità come vive e coerenti nella categoria', () => {
    const entities = generate(31337, 1, 50);
    const pickupKinds = new Set(['snowflake', 'hay', 'cow']);
    for (const entity of entities) {
      expect(entity.alive).toBe(true);
      expect(entity.category).toBe(pickupKinds.has(entity.kind) ? 'pickup' : 'obstacle');
    }
  });

  it('è deterministico a parità di seed', () => {
    const a = generate(555, 0.5, 20);
    const b = generate(555, 0.5, 20);
    expect(a).toEqual(b);
  });
});

describe('reset', () => {
  it('riporta il contatore degli id a zero', () => {
    const spawner = createSpawner(createRng(8));
    const first: Entity[] = [];
    spawner.populateChunk(0, 1, first);
    expect(first.length).toBeGreaterThan(0);

    spawner.reset();
    const second: Entity[] = [];
    spawner.populateChunk(0, 1, second);
    const firstEntity = second[0];
    if (!firstEntity) throw new Error('nessuna entità generata dopo il reset');
    expect(firstEntity.id).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/spawner.test.ts`

Atteso: FAIL con `Failed to resolve import "./spawner"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/spawner.ts`:

```ts
import type { Rng } from '../core/rng';
import { CONFIG } from './config';
import type { Entity, EntityKind, Lane, ObstacleKind, PickupKind } from './types';

/** Quota della base del ramo sospeso: sotto ci si passa con lo slam.
 *  È geometria dell'entità (come ENTITY_BOX in collisions.ts), non bilanciamento. */
export const BRANCH_Y = 1.6;

/** Pesi della tabella di generazione. Stanno qui e non in CONFIG perché il
 *  contratto congela il contenuto di config.ts: sono gli unici numeri locali del
 *  modulo e vivono tutti in questa costante, pronti per essere spostati. */
const WEIGHTS = {
  /** Probabilità che la riga sia dominata da una cabin, a difficoltà 0 e 1. */
  cabinBase: 0.1,
  cabinPerDifficulty: 0.12,
  /** Probabilità di un secondo ostacolo a terra, a difficoltà 0 e 1. */
  secondObstacleBase: 0.2,
  secondObstaclePerDifficulty: 0.45,
  /** Probabilità di un ramo sospeso, a difficoltà 0 e 1. */
  branchBase: 0.12,
  branchPerDifficulty: 0.2,
} as const;

/** Ostacoli che poggiano a terra e bloccano la corsia. */
const GROUND_OBSTACLES: readonly ObstacleKind[] = ['rock', 'tree', 'fence', 'crevasse'];

const PICKUP_BY_ROLL: readonly PickupKind[] = ['cow', 'hay', 'snowflake'];

export interface Spawner {
  /** Popola un chunk appena riciclato, aggiungendo entità a `out`. */
  populateChunk(chunkZ: number, difficulty: number, out: Entity[]): void;
  reset(): void;
}

export function createSpawner(rng: Rng): Spawner {
  const { laneCount, chunkLength } = CONFIG.world;
  const { rowSpacing, rowFillChanceMin, rowFillChanceMax, maxBlockedLanes } = CONFIG.spawn;
  const { pickupChance, cowChance, hayChance } = CONFIG.spawn;

  const rowCount = Math.max(1, Math.floor(chunkLength / rowSpacing));
  /** Tetto reale di corsie bloccabili: almeno una resta sempre percorribile. */
  const blockLimit = Math.min(maxBlockedLanes, laneCount - 1);
  /** Scratch riusato per ogni riga: nessuna allocazione durante la generazione. */
  const laneBlocked: boolean[] = new Array<boolean>(laneCount).fill(false);

  let nextId = 0;

  function clearLanes(): void {
    for (let lane = 0; lane < laneCount; lane++) {
      laneBlocked[lane] = false;
    }
  }

  function freeLaneCount(): number {
    let free = 0;
    for (let lane = 0; lane < laneCount; lane++) {
      if (!laneBlocked[lane]) free++;
    }
    return free;
  }

  /** Corsia libera scelta a caso, oppure -1 se non ce ne sono. */
  function pickFreeLane(): number {
    const free = freeLaneCount();
    if (free === 0) return -1;
    let target = rng.int(0, free);
    for (let lane = 0; lane < laneCount; lane++) {
      if (laneBlocked[lane]) continue;
      if (target === 0) return lane;
      target--;
    }
    return -1;
  }

  function emit(
    out: Entity[],
    kind: EntityKind,
    category: 'obstacle' | 'pickup',
    lane: number,
    width: 1 | 2,
    z: number,
    y: number,
  ): void {
    out.push({
      id: nextId++,
      kind,
      category,
      lane: lane as Lane,
      width,
      z,
      y,
      alive: true,
    });
  }

  function pickPickupKind(): PickupKind {
    const roll = rng.next();
    if (roll < cowChance) return PICKUP_BY_ROLL[0] as PickupKind;
    if (roll < cowChance + hayChance) return PICKUP_BY_ROLL[1] as PickupKind;
    return PICKUP_BY_ROLL[2] as PickupKind;
  }

  function populateRow(rowZ: number, difficulty: number, out: Entity[]): void {
    clearLanes();

    // 1. Ostacoli a terra. La cabin occupa due corsie e da sola satura il budget.
    const cabinChance = WEIGHTS.cabinBase + WEIGHTS.cabinPerDifficulty * difficulty;
    if (blockLimit >= 2 && laneCount >= 3 && rng.chance(cabinChance)) {
      const lane = rng.int(0, laneCount - 1); // 0 o 1: la cabin sfora a destra
      emit(out, 'cabin', 'obstacle', lane, 2, rowZ, 0);
      laneBlocked[lane] = true;
      laneBlocked[lane + 1] = true;
    } else {
      const secondChance =
        WEIGHTS.secondObstacleBase + WEIGHTS.secondObstaclePerDifficulty * difficulty;
      const wanted = rng.chance(secondChance) ? 2 : 1;
      const count = Math.min(wanted, blockLimit);
      for (let i = 0; i < count; i++) {
        const lane = pickFreeLane();
        if (lane < 0) break;
        emit(out, rng.pick(GROUND_OBSTACLES), 'obstacle', lane, 1, rowZ, 0);
        laneBlocked[lane] = true;
      }
    }

    // 2. Ramo sospeso: non blocca la corsia (ci si passa sotto con lo slam), ma lo
    //    generiamo solo se resta almeno una corsia completamente sgombra.
    const blocked = laneCount - freeLaneCount();
    const branchChance = WEIGHTS.branchBase + WEIGHTS.branchPerDifficulty * difficulty;
    if (blocked < blockLimit && rng.chance(branchChance)) {
      const lane = pickFreeLane();
      if (lane >= 0) {
        emit(out, 'branch', 'obstacle', lane, 1, rowZ, BRANCH_Y);
      }
    }

    // 3. Un raccoglibile al massimo, mai in una corsia occupata da un ostacolo a terra.
    if (rng.chance(pickupChance)) {
      const lane = pickFreeLane();
      if (lane >= 0) {
        emit(out, pickPickupKind(), 'pickup', lane, 1, rowZ, 0);
        laneBlocked[lane] = true;
      }
    }
  }

  return {
    populateChunk(chunkZ: number, difficulty: number, out: Entity[]): void {
      const clamped = Math.min(1, Math.max(0, difficulty));
      const fillChance = rowFillChanceMin + (rowFillChanceMax - rowFillChanceMin) * clamped;
      for (let row = 0; row < rowCount; row++) {
        if (!rng.chance(fillChance)) continue;
        populateRow(chunkZ + row * rowSpacing, clamped, out);
      }
    },
    reset(): void {
      nextId = 0;
    },
  };
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS. In particolare devono passare l'invariante di solvibilità sui 500 seed a
difficoltà 1 e il confronto dei volumi tra difficoltà 0 e 1.

Verifica anche i tipi: `npm run typecheck` → nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/spawner.ts src/game/spawner.test.ts
git commit -m "feat(game): add procedural spawner with solvable rows"
```

---

### Task 9: Movimento del giocatore (corsie, salto, schiacciata)

**Files:**
- Create: `src/game/player.ts`
- Test: `src/game/player.test.ts`

**Interfaces:**
- Consumes:
  - `export type Lane = 0 | 1 | 2;` da `./types` (Task 2).
  - `export function laneToX(lane: number): number;` e `export function clampLane(lane: number): Lane;` da `./lanes` (Task 6).
  - `export const CONFIG` da `./config` (Task 6): `player.laneChangeSeconds`, `player.jumpSeconds`, `player.jumpHeight`, `player.slamGravityMultiplier`.
- Produces:
  - `export interface PlayerState { lane: Lane; x: number; laneFromX: number; laneChangeT: number; y: number; vy: number; airborne: boolean; slamming: boolean; slamTimer: number; }`
  - `export function createPlayer(): PlayerState;`
  - `export function moveLane(player: PlayerState, direction: -1 | 1): void;`
  - `export function jump(player: PlayerState): void;`
  - `export function slam(player: PlayerState): void;`
  - `export function updatePlayer(player: PlayerState, dt: number): void;`
  - `export const SLAM_GROUND_SECONDS: number;`

**Estensione della firma del contratto: `slamTimer`.**
Il contratto impone che `slam()` a terra tenga la mucca abbassata per 0,25 s, ma
`PlayerState` non prevede alcun campo in cui misurare quel tempo, e nessun altro
campo esistente può ospitarlo senza sovraccaricarne il significato (`laneChangeT`
serve all'interpolazione orizzontale, `vy` alla verticale). Aggiungiamo quindi il
campo `slamTimer: number`, additivo e privo di impatto su chi legge gli altri campi.
Tutte le firme delle funzioni restano invariate.

**Nota sull'integrazione verticale.** Il salto è una parabola scriptata: deve durare
esattamente `jumpSeconds` e culminare a `jumpHeight`. Da `y(t) = v0·t − g·t²/2`
seguono `v0 = 4·h/T` e `g = 8·h/T²`. Per riprodurre la parabola senza errore di
integrazione usiamo l'aggiornamento esatto per accelerazione costante
(`y += vy·dt − g·dt²/2`, poi `vy -= g·dt`) invece dell'Eulero semplice, che
sbaglierebbe apice e durata di circa il 6% a 60 Hz.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/player.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { laneToX } from './lanes';
import { SLAM_GROUND_SECONDS, createPlayer, jump, moveLane, slam, updatePlayer } from './player';
import type { PlayerState } from './player';

const STEP = 1 / 60;
const { laneChangeSeconds, jumpSeconds, jumpHeight } = CONFIG.player;

/** Simula il volo e restituisce il tempo di atterraggio e la quota massima. */
function flight(player: PlayerState, onStep?: (elapsed: number) => void): {
  landedAt: number;
  maxY: number;
  maxAt: number;
} {
  let elapsed = 0;
  let maxY = 0;
  let maxAt = 0;
  while (player.airborne && elapsed < 5) {
    updatePlayer(player, STEP);
    elapsed += STEP;
    if (player.y > maxY) {
      maxY = player.y;
      maxAt = elapsed;
    }
    onStep?.(elapsed);
  }
  return { landedAt: elapsed, maxY, maxAt };
}

describe('createPlayer', () => {
  it('parte in corsia 1, a x = 0, a terra', () => {
    const player = createPlayer();
    expect(player.lane).toBe(1);
    expect(player.x).toBe(0);
    expect(player.x).toBe(laneToX(1));
    expect(player.y).toBe(0);
    expect(player.airborne).toBe(false);
    expect(player.slamming).toBe(false);
  });
});

describe('moveLane', () => {
  it('porta a corsia 0 e completa la transizione entro laneChangeSeconds', () => {
    const player = createPlayer();
    moveLane(player, -1);
    expect(player.lane).toBe(0);

    let elapsed = 0;
    while (elapsed < laneChangeSeconds) {
      updatePlayer(player, STEP);
      elapsed += STEP;
    }
    expect(player.x).toBeCloseTo(laneToX(0), 10);
    expect(player.laneChangeT).toBe(1);
  });

  it('non fa nulla oltre i bordi', () => {
    const player = createPlayer();
    moveLane(player, -1);
    for (let i = 0; i < 20; i++) updatePlayer(player, STEP);
    expect(player.lane).toBe(0);

    moveLane(player, -1);
    expect(player.lane).toBe(0);
    expect(player.x).toBeCloseTo(laneToX(0), 10);

    moveLane(player, 1);
    moveLane(player, 1);
    for (let i = 0; i < 40; i++) updatePlayer(player, STEP);
    expect(player.lane).toBe(2);
    moveLane(player, 1);
    expect(player.lane).toBe(2);
  });

  it('interpola in ease-out: a metà tempo ha percorso più di metà distanza', () => {
    const player = createPlayer();
    moveLane(player, -1);
    updatePlayer(player, laneChangeSeconds / 2);

    const travelled = Math.abs(player.x - 0);
    const total = Math.abs(laneToX(0) - 0);
    expect(player.laneChangeT).toBeCloseTo(0.5, 10);
    expect(travelled / total).toBeGreaterThan(0.5);
    expect(travelled / total).toBeLessThan(1);
  });

  it('riparte dalla x corrente se si cambia corsia durante una transizione', () => {
    const player = createPlayer();
    moveLane(player, -1);
    updatePlayer(player, laneChangeSeconds / 2);
    const xBefore = player.x;

    moveLane(player, 1);
    expect(player.lane).toBe(1);
    expect(player.laneFromX).toBeCloseTo(xBefore, 10);
    expect(player.laneChangeT).toBe(0);

    updatePlayer(player, 0.001);
    expect(Math.abs(player.x - xBefore)).toBeLessThan(0.15);
  });
});

describe('jump', () => {
  it('mette in aria e descrive una parabola che culmina vicino a jumpHeight', () => {
    const player = createPlayer();
    jump(player);
    expect(player.airborne).toBe(true);

    const { maxY, maxAt } = flight(player);
    expect(maxY).toBeGreaterThan(jumpHeight - 0.05);
    expect(maxY).toBeLessThanOrEqual(jumpHeight + 1e-6);
    expect(Math.abs(maxAt - jumpSeconds / 2)).toBeLessThan(0.05);
  });

  it('atterra a fine jumpSeconds riportando y a 0', () => {
    const player = createPlayer();
    jump(player);
    const { landedAt } = flight(player);

    expect(Math.abs(landedAt - jumpSeconds)).toBeLessThanOrEqual(STEP);
    expect(player.y).toBe(0);
    expect(player.vy).toBe(0);
    expect(player.airborne).toBe(false);
  });

  it('sale prima di scendere', () => {
    const player = createPlayer();
    jump(player);
    updatePlayer(player, STEP);
    const first = player.y;
    updatePlayer(player, STEP);
    expect(player.y).toBeGreaterThan(first);
    expect(first).toBeGreaterThan(0);
  });

  it('viene ignorato se si è già in aria', () => {
    const player = createPlayer();
    jump(player);
    for (let i = 0; i < 10; i++) updatePlayer(player, STEP);
    const yBefore = player.y;
    const vyBefore = player.vy;

    jump(player);
    expect(player.y).toBe(yBefore);
    expect(player.vy).toBe(vyBefore);
  });
});

describe('slam', () => {
  it('a terra tiene la mucca abbassata per SLAM_GROUND_SECONDS e poi si spegne', () => {
    const player = createPlayer();
    slam(player);
    expect(player.slamming).toBe(true);
    expect(player.slamTimer).toBeCloseTo(SLAM_GROUND_SECONDS, 10);
    expect(SLAM_GROUND_SECONDS).toBe(0.25);

    updatePlayer(player, 0.1);
    expect(player.slamming).toBe(true);

    updatePlayer(player, 0.2);
    expect(player.slamming).toBe(false);
    expect(player.slamTimer).toBe(0);
  });

  it('in aria accelera la caduta', () => {
    const plain = createPlayer();
    jump(plain);
    const plainFlight = flight(plain);

    const slammed = createPlayer();
    jump(slammed);
    updatePlayer(slammed, STEP);
    slam(slammed);
    expect(slammed.slamming).toBe(true);
    const slamFlight = flight(slammed);

    expect(slamFlight.landedAt + STEP).toBeLessThan(plainFlight.landedAt);
    expect(slammed.airborne).toBe(false);
    expect(slammed.y).toBe(0);
    expect(slammed.slamming).toBe(false);
  });

  it('non lascia lo slam attivo dopo l-atterraggio', () => {
    const player = createPlayer();
    jump(player);
    slam(player);
    flight(player);
    expect(player.slamming).toBe(false);
    expect(player.slamTimer).toBe(0);
  });

  it('saltare durante uno slam a terra annulla lo slam', () => {
    const player = createPlayer();
    slam(player);
    jump(player);
    expect(player.slamming).toBe(false);
    expect(player.slamTimer).toBe(0);
    expect(player.airborne).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/player.test.ts`

Atteso: FAIL con `Failed to resolve import "./player"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/player.ts`:

```ts
import { CONFIG } from './config';
import { clampLane, laneToX } from './lanes';
import type { Lane } from './types';

/** Durata della finestra di schiacciata a terra: quanto la mucca resta abbassata. */
export const SLAM_GROUND_SECONDS = 0.25;

/** Velocità iniziale e gravità del salto scriptato. Da y(t) = v0*t - g*t^2/2, per
 *  durare T = jumpSeconds e culminare a h = jumpHeight servono v0 = 4h/T e g = 8h/T^2. */
const JUMP_SPEED = (4 * CONFIG.player.jumpHeight) / CONFIG.player.jumpSeconds;
const JUMP_GRAVITY =
  (8 * CONFIG.player.jumpHeight) / (CONFIG.player.jumpSeconds * CONFIG.player.jumpSeconds);

/** Ease-out cubica: parte veloce e frena in arrivo. */
function easeOutCubic(t: number): number {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

export interface PlayerState {
  lane: Lane;
  /** X interpolato durante il cambio corsia. */
  x: number;
  laneFromX: number;
  laneChangeT: number; // avanzamento in [0,1]
  y: number;
  vy: number;
  airborne: boolean;
  slamming: boolean;
  /** Secondi residui della schiacciata a terra. Estensione del contratto: senza
   *  questo campo non c'è dove misurare i 0,25 s richiesti da slam() a terra. */
  slamTimer: number;
}

export function createPlayer(): PlayerState {
  const x = laneToX(1);
  return {
    lane: 1,
    x,
    laneFromX: x,
    laneChangeT: 1,
    y: 0,
    vy: 0,
    airborne: false,
    slamming: false,
    slamTimer: 0,
  };
}

export function moveLane(player: PlayerState, direction: -1 | 1): void {
  const next = clampLane(player.lane + direction);
  if (next === player.lane) return;
  player.lane = next;
  // Si riparte dalla posizione corrente: un secondo cambio non fa scattare la mucca.
  player.laneFromX = player.x;
  player.laneChangeT = 0;
}

export function jump(player: PlayerState): void {
  if (player.airborne) return;
  player.airborne = true;
  player.vy = JUMP_SPEED;
  player.slamming = false;
  player.slamTimer = 0;
}

export function slam(player: PlayerState): void {
  player.slamming = true;
  // In aria lo slam dura finché non si tocca terra: nessun timer da armare.
  player.slamTimer = player.airborne ? 0 : SLAM_GROUND_SECONDS;
}

export function updatePlayer(player: PlayerState, dt: number): void {
  if (player.laneChangeT < 1) {
    player.laneChangeT = Math.min(1, player.laneChangeT + dt / CONFIG.player.laneChangeSeconds);
    const target = laneToX(player.lane);
    player.x = player.laneFromX + (target - player.laneFromX) * easeOutCubic(player.laneChangeT);
  }

  if (player.airborne) {
    const gravity = JUMP_GRAVITY * (player.slamming ? CONFIG.player.slamGravityMultiplier : 1);
    // Aggiornamento esatto per accelerazione costante: riproduce la parabola
    // analitica senza l'errore di integrazione dell'Eulero semplice.
    player.y += player.vy * dt - 0.5 * gravity * dt * dt;
    player.vy -= gravity * dt;
    if (player.y <= 0) {
      player.y = 0;
      player.vy = 0;
      player.airborne = false;
      player.slamming = false;
      player.slamTimer = 0;
    }
    return;
  }

  if (player.slamTimer > 0) {
    player.slamTimer = Math.max(0, player.slamTimer - dt);
    if (player.slamTimer === 0) player.slamming = false;
  }
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS. In particolare l'apice del salto deve risultare entro 0,05 unità da
`jumpHeight` e l'atterraggio entro un passo da `jumpSeconds`.

Verifica anche i tipi: `npm run typecheck` → nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/player.ts src/game/player.test.ts
git commit -m "feat(game): add player lane change, jump and slam"
```

---

### Task 10: Collisioni AABB per corsia e altezza

**Files:**
- Create: `src/game/collisions.ts`
- Test: `src/game/collisions.test.ts`

**Interfaces:**
- Consumes:
  - `export interface Entity` e `export type EntityKind` da `./types` (Task 2).
  - `export function entityCenterX(lane: number, width: number): number;` ed `export function entityHalfWidth(width: number): number;` da `./lanes` (Task 6).
  - `export const CONFIG` da `./config` (Task 6): `player.baseHalfWidth`, `player.halfWidthPerSize`, `player.baseHeight`, `player.heightPerSize`, `player.depth`.
- Produces:
  - `export interface Box { x: number; halfWidth: number; y: number; height: number; z: number; depth: number; }`
  - `export const ENTITY_BOX: Record<EntityKind, { height: number; depth: number }>;`
  - `export function playerBox(x: number, y: number, size: number, slamming?: boolean): Box;`
  - `export function entityBox(entity: Entity): Box;`
  - `export function boxesOverlap(a: Box, b: Box): boolean;`
  - `export const SLAM_HEIGHT_RATIO: number;`

**Convenzioni del box.** `x` e `z` sono **centri**, `halfWidth` è la semi-larghezza e
`depth` la profondità **totale** (quindi `z ± depth/2`); `y` è la **base** e `height`
si estende verso l'alto (`y … y + height`). Il contatto esatto non conta come
collisione: `boxesOverlap` usa confronti stretti, così un'entità che tocca il bordo
non uccide.

**Estensione della firma del contratto: `playerBox(..., slamming = false)`.**
Il contratto fissa `playerBox(x, y, size)`, ma il ramo sospeso (`branch`, base a
`y = 1.6`) si evita **abbassandosi**, non spostandosi: senza un modo di dire al box
che la mucca è in schiacciata, la collisione col ramo sarebbe indistinguibile tra
mucca eretta e mucca abbassata, e la meccanica dello slam non esisterebbe. Il
parametro è opzionale con default `false`, quindi tutte le chiamate esistenti a tre
argomenti restano valide e il contratto resta soddisfatto per estensione. Il
chiamante (`game.ts`) passerà `player.slamming`.

**Conseguenza geometrica documentata.** Con le costanti del contratto l'altezza della
mucca è `1.2 + 0.25·size`: a taglia 1 vale 1,45, sotto la base del ramo (1,6). Una
mucca piccola passa quindi sotto al ramo anche senza slam, ed è voluto: il ramo è una
minaccia per la mucca cresciuta (taglia 2 e oltre), coerente con "la crescita è un
rischio/ricompensa" del design. I test lo verificano esplicitamente su entrambi i casi.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/game/collisions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { ENTITY_BOX, boxesOverlap, entityBox, playerBox } from './collisions';
import { laneToX } from './lanes';
import type { Box } from './collisions';
import type { Entity, EntityKind, Lane } from './types';

function makeEntity(kind: EntityKind, lane: Lane, z = 0, y = 0, width: 1 | 2 = 1): Entity {
  const pickups = new Set<EntityKind>(['snowflake', 'hay', 'cow']);
  return {
    id: 1,
    kind,
    category: pickups.has(kind) ? 'pickup' : 'obstacle',
    lane,
    width,
    z,
    y,
    alive: true,
  };
}

function box(x: number, halfWidth: number, y: number, height: number, z: number, depth: number): Box {
  return { x, halfWidth, y, height, z, depth };
}

describe('boxesOverlap', () => {
  it('rileva la sovrapposizione di due box coincidenti', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 0, 2))).toBe(true);
  });

  it('separa correttamente sull-asse X', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(1.5, 1, 0, 2, 0, 2))).toBe(true);
    expect(boxesOverlap(a, box(3, 1, 0, 2, 0, 2))).toBe(false);
  });

  it('separa correttamente sull-asse Y', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 1, 1.5, 2, 0, 2))).toBe(true);
    expect(boxesOverlap(a, box(0, 1, 2.5, 2, 0, 2))).toBe(false);
  });

  it('separa correttamente sull-asse Z', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 1.5, 2))).toBe(true);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 3, 2))).toBe(false);
  });

  it('non considera collisione il contatto esatto sui bordi', () => {
    const a = box(0, 1, 0, 2, 0, 2);
    expect(boxesOverlap(a, box(2, 1, 0, 2, 0, 2))).toBe(false);
    expect(boxesOverlap(a, box(0, 1, 2, 2, 0, 2))).toBe(false);
    expect(boxesOverlap(a, box(0, 1, 0, 2, 2, 2))).toBe(false);
  });
});

describe('playerBox', () => {
  it('si allarga e si alza al crescere della taglia', () => {
    const small = playerBox(0, 0, 1);
    const big = playerBox(0, 0, 5);
    expect(big.halfWidth).toBeGreaterThan(small.halfWidth);
    expect(big.height).toBeGreaterThan(small.height);
    expect(small.halfWidth).toBeCloseTo(
      CONFIG.player.baseHalfWidth + CONFIG.player.halfWidthPerSize,
      10,
    );
    expect(small.depth).toBe(CONFIG.player.depth);
  });

  it('abbassa la mucca in schiacciata senza toccarne la larghezza', () => {
    const upright = playerBox(0, 0, 3);
    const slammed = playerBox(0, 0, 3, true);
    expect(slammed.height).toBeLessThan(upright.height);
    expect(slammed.halfWidth).toBe(upright.halfWidth);
  });
});

describe('entityBox', () => {
  it('usa le misure per kind di ENTITY_BOX', () => {
    const rock = entityBox(makeEntity('rock', 1));
    expect(rock.height).toBe(ENTITY_BOX.rock.height);
    expect(rock.depth).toBe(ENTITY_BOX.rock.depth);
    expect(rock.x).toBe(laneToX(1));
  });

  it('centra la cabin larga 2 tra le due corsie occupate', () => {
    const cabin = entityBox(makeEntity('cabin', 0, 0, 0, 2));
    expect(cabin.x).toBe((laneToX(0) + laneToX(1)) / 2);
    expect(cabin.halfWidth).toBe(CONFIG.world.laneWidth);
  });
});

describe('collisioni di gioco', () => {
  it('un giocatore in corsia 0 non collide con un ostacolo in corsia 2', () => {
    const player = playerBox(laneToX(0), 0, 5);
    expect(boxesOverlap(player, entityBox(makeEntity('rock', 2)))).toBe(false);
    expect(boxesOverlap(player, entityBox(makeEntity('rock', 0)))).toBe(true);
  });

  it('saltando si passa sopra una fence ma non sopra una cabin', () => {
    const apex = CONFIG.player.jumpHeight;
    const player = playerBox(laneToX(1), apex, 1);
    expect(boxesOverlap(player, entityBox(makeEntity('fence', 1)))).toBe(false);
    expect(boxesOverlap(player, entityBox(makeEntity('cabin', 0, 0, 0, 2)))).toBe(true);
  });

  it('il branch colpisce la mucca cresciuta, ma non se è in schiacciata', () => {
    const branch = entityBox(makeEntity('branch', 1, 0, 1.6));
    expect(boxesOverlap(playerBox(laneToX(1), 0, 3), branch)).toBe(true);
    expect(boxesOverlap(playerBox(laneToX(1), 0, 3, true), branch)).toBe(false);
  });

  it('la mucca a taglia 1 passa sotto al branch anche senza schiacciata', () => {
    // Conseguenza voluta delle costanti: a taglia 1 la mucca è alta 1.45 < 1.6.
    const branch = entityBox(makeEntity('branch', 1, 0, 1.6));
    expect(boxesOverlap(playerBox(laneToX(1), 0, 1), branch)).toBe(false);
  });

  it('il crevasse colpisce solo chi è a terra', () => {
    const crevasse = entityBox(makeEntity('crevasse', 1));
    expect(boxesOverlap(playerBox(laneToX(1), 0, 1), crevasse)).toBe(true);
    expect(boxesOverlap(playerBox(laneToX(1), 1, 1), crevasse)).toBe(false);
    expect(boxesOverlap(playerBox(laneToX(1), CONFIG.player.jumpHeight, 1), crevasse)).toBe(false);
  });

  it('definisce una misura per ogni kind', () => {
    const kinds: EntityKind[] = [
      'rock',
      'tree',
      'fence',
      'cabin',
      'crevasse',
      'branch',
      'snowflake',
      'hay',
      'cow',
    ];
    for (const kind of kinds) {
      expect(ENTITY_BOX[kind].height).toBeGreaterThan(0);
      expect(ENTITY_BOX[kind].depth).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/collisions.test.ts`

Atteso: FAIL con `Failed to resolve import "./collisions"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa il minimo necessario**

`src/game/collisions.ts`:

```ts
import { CONFIG } from './config';
import { entityCenterX, entityHalfWidth } from './lanes';
import type { Entity, EntityKind } from './types';

/** AABB allineato agli assi. `x` e `z` sono centri, `y` è la base: il box occupa
 *  [x-halfWidth, x+halfWidth] x [y, y+height] x [z-depth/2, z+depth/2]. */
export interface Box {
  x: number;
  halfWidth: number;
  y: number;
  height: number;
  z: number;
  depth: number;
}

/** Quanto si abbassa la mucca in schiacciata: dimezza l'altezza del box, il che
 *  la porta sotto la base del ramo sospeso (1.6) fino a taglia 5. */
export const SLAM_HEIGHT_RATIO = 0.5;

/** Ingombro verticale e in profondità di ogni tipo di entità. La larghezza non
 *  serve: deriva dalle corsie occupate (`entityHalfWidth`). */
export const ENTITY_BOX: Record<EntityKind, { height: number; depth: number }> = {
  /** Masso basso e tozzo: si scavalca solo saltando. */
  rock: { height: 1.4, depth: 1.4 },
  /** Albero: troppo alto per essere saltato, va aggirato o sfondato da taglia 3. */
  tree: { height: 3, depth: 1.2 },
  /** Staccionata: bassa e sottile, il salto ci passa sopra comodamente. */
  fence: { height: 1.2, depth: 0.8 },
  /** Baita: muro invalicabile, profondo, che occupa due corsie. */
  cabin: { height: 3.5, depth: 4 },
  /** Crepaccio: praticamente piatto, quindi collide solo con chi è a terra;
   *  molto profondo, così va anticipato con il salto. */
  crevasse: { height: 0.1, depth: 3 },
  /** Ramo sospeso: base a 1.6 (vedi BRANCH_Y), spesso quanto una staccionata. */
  branch: { height: 1.2, depth: 0.8 },
  /** Fiocco di neve: piccolo, ma la raccolta è generosa. */
  snowflake: { height: 0.8, depth: 0.8 },
  /** Balla di fieno: cubo di un metro. */
  hay: { height: 1, depth: 1 },
  /** Altra mucca: stesse proporzioni del giocatore a taglia 1. */
  cow: { height: 1.4, depth: 1.6 },
};

/** Box del giocatore. `slamming` (estensione additiva del contratto) riduce
 *  l'altezza: è così che si passa sotto al ramo sospeso. */
export function playerBox(x: number, y: number, size: number, slamming = false): Box {
  const { baseHalfWidth, halfWidthPerSize, baseHeight, heightPerSize, depth } = CONFIG.player;
  const height = baseHeight + heightPerSize * size;
  return {
    x,
    halfWidth: baseHalfWidth + halfWidthPerSize * size,
    y,
    height: slamming ? height * SLAM_HEIGHT_RATIO : height,
    // Il giocatore è fermo sull'asse di scorrimento: è il mondo a muoversi.
    z: 0,
    depth,
  };
}

export function entityBox(entity: Entity): Box {
  const measures = ENTITY_BOX[entity.kind];
  return {
    x: entityCenterX(entity.lane, entity.width),
    halfWidth: entityHalfWidth(entity.width),
    y: entity.y,
    height: measures.height,
    z: entity.z,
    depth: measures.depth,
  };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  if (Math.abs(a.x - b.x) >= a.halfWidth + b.halfWidth) return false;
  if (Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2) return false;
  if (a.y + a.height <= b.y) return false;
  if (b.y + b.height <= a.y) return false;
  return true;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`

Atteso: PASS su tutta la suite (task 1-10).

Verifica anche i tipi: `npm run typecheck` → nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/collisions.ts src/game/collisions.test.ts
git commit -m "feat(game): add AABB collision boxes for player and entities"
```

---

### Task 11: Sistema valanga (carica, taglia, fasi)

**Files:**
- Create: `src/game/avalanche.ts`
- Test: `src/game/avalanche.test.ts`

**Interfaces:**
- Consumes:
  - `createEventBus(): EventBus` e `EventBus.emit<K extends EventName>(name: K, payload: GameEvents[K]): void` da `src/core/events.ts`
  - `CONFIG.avalanche = { threshold: 100, durationSeconds: 8, warningSeconds: 1.5, scoreMultiplier: 4, sizeThresholds: [0, 20, 40, 60, 80], maxSize: 5, smashMinSize: 3 }` e `CONFIG.forgiveness = { enabled: true, minChargeRatio: 0.5, sizePenalty: 1 }` da `src/game/config.ts`
  - `type ObstacleKind` da `src/game/types.ts`
- Produces:
  - `export type AvalanchePhase = 'idle' | 'active' | 'warning'`
  - `export interface AvalancheState { charge: number; size: number; phase: AvalanchePhase; timeLeft: number }`
  - `export function createAvalanche(): AvalancheState`
  - `export function sizeForCharge(charge: number): number`
  - `export function addCharge(state: AvalancheState, amount: number, bus: EventBus): void`
  - `export function updateAvalanche(state: AvalancheState, dt: number, bus: EventBus): void`
  - `export function applyForgivenessPenalty(state: AvalancheState, bus: EventBus): void`
  - `export function isInvulnerable(state: AvalancheState): boolean`
  - `export function canSmash(state: AvalancheState, kind: ObstacleKind): boolean`
  - `export function scoreMultiplier(state: AvalancheState): number`

**Note di progetto (decise qui, valide per i task successivi):**
- Durante `phase !== 'idle'` la funzione `addCharge` è un **no-op**: la carica non si accumula e la fase non riparte. È il modo più semplice per rispettare "la valanga non si autoprolunga", ed è coerente col design (a fine fase la carica torna comunque a 0).
- `size:changed` è emesso **solo** se la taglia cambia davvero: tutti i cambi passano dall'unica funzione interna `setSize`, che clampa in `[1, maxSize]` e confronta con il valore precedente.
- Ordine degli eventi a fine fase: prima `avalanche:ended`, poi l'eventuale `size:changed` del ritorno a taglia 1.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// src/game/avalanche.test.ts
import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  type EventBus,
  type EventName,
  type GameEvents,
} from '../core/events';
import {
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  createAvalanche,
  isInvulnerable,
  scoreMultiplier,
  sizeForCharge,
  updateAvalanche,
} from './avalanche';
import { CONFIG } from './config';

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = [
  'run:started',
  'run:ended',
  'pickup:collected',
  'obstacle:hit',
  'size:changed',
  'avalanche:triggered',
  'avalanche:ending',
  'avalanche:ended',
];

function recordEvents(bus: EventBus): Recorded[] {
  const seen: Recorded[] = [];
  for (const name of ALL_EVENTS) {
    bus.on(name, (payload: unknown) => {
      seen.push({ name, payload });
    });
  }
  return seen;
}

function namesOf(events: readonly Recorded[]): EventName[] {
  return events.map((event) => event.name);
}

function countOf(events: readonly Recorded[], name: EventName): number {
  return events.filter((event) => event.name === name).length;
}

function payloadsOf<K extends EventName>(
  events: readonly Recorded[],
  name: K,
): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

describe('sizeForCharge', () => {
  it('rispetta le soglie [0, 20, 40, 60, 80]', () => {
    expect(CONFIG.avalanche.sizeThresholds).toEqual([0, 20, 40, 60, 80]);
    expect(sizeForCharge(0)).toBe(1);
    expect(sizeForCharge(19)).toBe(1);
    expect(sizeForCharge(20)).toBe(2);
    expect(sizeForCharge(39.9)).toBe(2);
    expect(sizeForCharge(40)).toBe(3);
    expect(sizeForCharge(60)).toBe(4);
    expect(sizeForCharge(79.9)).toBe(4);
    expect(sizeForCharge(80)).toBe(5);
    expect(sizeForCharge(100)).toBe(5);
  });
});

describe('createAvalanche', () => {
  it('parte da carica 0, taglia 1, fase idle', () => {
    const state = createAvalanche();
    expect(state).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
  });
});

describe('addCharge', () => {
  it('accumula la carica e la clampa alla soglia', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, 5, bus);
    expect(state.charge).toBe(5);

    addCharge(state, 10, bus);
    expect(state.charge).toBe(15);

    addCharge(state, 999, bus);
    expect(state.charge).toBe(CONFIG.avalanche.threshold);
  });

  it('emette size:changed a ogni cambio di taglia con size e previous corretti', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 5, bus);
    expect(countOf(events, 'size:changed')).toBe(0);

    addCharge(state, 15, bus);
    expect(payloadsOf(events, 'size:changed')).toEqual([{ size: 2, previous: 1 }]);
    expect(state.size).toBe(2);

    addCharge(state, 1, bus);
    expect(countOf(events, 'size:changed')).toBe(1);

    addCharge(state, 19, bus);
    expect(payloadsOf(events, 'size:changed')).toEqual([
      { size: 2, previous: 1 },
      { size: 3, previous: 2 },
    ]);
  });

  it('superata la soglia entra in fase active ed emette avalanche:triggered una sola volta', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 90, bus);
    expect(state.phase).toBe('idle');
    expect(countOf(events, 'avalanche:triggered')).toBe(0);

    addCharge(state, 30, bus);
    expect(state.phase).toBe('active');
    expect(state.charge).toBe(CONFIG.avalanche.threshold);
    expect(state.size).toBe(CONFIG.avalanche.maxSize);
    expect(state.timeLeft).toBe(CONFIG.avalanche.durationSeconds);
    expect(payloadsOf(events, 'avalanche:triggered')).toEqual([{ size: 5 }]);

    addCharge(state, 50, bus);
    addCharge(state, 50, bus);
    expect(countOf(events, 'avalanche:triggered')).toBe(1);
  });

  it('durante la fase attiva non fa ripartire la fase né altera timeLeft', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, 3, bus);
    const timeLeft = state.timeLeft;

    addCharge(state, 50, bus);
    expect(state.timeLeft).toBe(timeLeft);
    expect(state.phase).toBe('active');
    expect(state.charge).toBe(CONFIG.avalanche.threshold);
  });
});

describe('updateAvalanche', () => {
  it('in fase idle non fa nulla e non emette eventi', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    updateAvalanche(state, 1, bus);
    expect(state).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
    expect(events).toHaveLength(0);
  });

  it('scala timeLeft del delta time', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, 1, bus);
    expect(state.timeLeft).toBeCloseTo(CONFIG.avalanche.durationSeconds - 1, 6);

    updateAvalanche(state, 0.5, bus);
    expect(state.timeLeft).toBeCloseTo(CONFIG.avalanche.durationSeconds - 1.5, 6);
  });

  it('entra in warning ed emette avalanche:ending una sola volta', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, 6, bus);
    expect(state.phase).toBe('active');
    expect(countOf(events, 'avalanche:ending')).toBe(0);

    updateAvalanche(state, 0.6, bus);
    expect(state.phase).toBe('warning');
    expect(countOf(events, 'avalanche:ending')).toBe(1);

    updateAvalanche(state, 0.1, bus);
    updateAvalanche(state, 0.1, bus);
    updateAvalanche(state, 0.1, bus);
    expect(state.phase).toBe('warning');
    expect(countOf(events, 'avalanche:ending')).toBe(1);
  });

  it('a timeLeft esaurito chiude la fase, azzera la carica e torna a taglia 1', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, CONFIG.avalanche.threshold, bus);
    updateAvalanche(state, CONFIG.avalanche.durationSeconds, bus);

    expect(state.phase).toBe('idle');
    expect(state.charge).toBe(0);
    expect(state.size).toBe(1);
    expect(state.timeLeft).toBe(0);
    expect(countOf(events, 'avalanche:ended')).toBe(1);
    expect(namesOf(events).slice(-2)).toEqual(['avalanche:ended', 'size:changed']);
    expect(payloadsOf(events, 'size:changed').at(-1)).toEqual({ size: 1, previous: 5 });

    updateAvalanche(state, 1, bus);
    expect(countOf(events, 'avalanche:ended')).toBe(1);
  });
});

describe('isInvulnerable / canSmash / scoreMultiplier', () => {
  it('è invulnerabile solo in fase active o warning', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    expect(isInvulnerable(state)).toBe(false);

    addCharge(state, CONFIG.avalanche.threshold, bus);
    expect(isInvulnerable(state)).toBe(true);

    updateAvalanche(state, CONFIG.avalanche.durationSeconds - 1, bus);
    expect(state.phase).toBe('warning');
    expect(isInvulnerable(state)).toBe(true);

    updateAvalanche(state, 5, bus);
    expect(isInvulnerable(state)).toBe(false);
  });

  it('durante la valanga sfonda qualunque ostacolo', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    addCharge(state, CONFIG.avalanche.threshold, bus);

    expect(canSmash(state, 'rock')).toBe(true);
    expect(canSmash(state, 'tree')).toBe(true);
    expect(canSmash(state, 'fence')).toBe(true);
    expect(canSmash(state, 'cabin')).toBe(true);
    expect(canSmash(state, 'crevasse')).toBe(true);
    expect(canSmash(state, 'branch')).toBe(true);
  });

  it('fuori dalla valanga sfonda solo tree e fence da taglia 3', () => {
    const bus = createEventBus();
    const state = createAvalanche();

    addCharge(state, 20, bus);
    expect(state.size).toBe(2);
    expect(canSmash(state, 'tree')).toBe(false);
    expect(canSmash(state, 'fence')).toBe(false);

    addCharge(state, 20, bus);
    expect(state.size).toBe(3);
    expect(canSmash(state, 'tree')).toBe(true);
    expect(canSmash(state, 'fence')).toBe(true);
    expect(canSmash(state, 'rock')).toBe(false);
    expect(canSmash(state, 'cabin')).toBe(false);
    expect(canSmash(state, 'crevasse')).toBe(false);
    expect(canSmash(state, 'branch')).toBe(false);
  });

  it('il moltiplicatore vale 4 in valanga e 1 fuori', () => {
    const bus = createEventBus();
    const state = createAvalanche();
    expect(scoreMultiplier(state)).toBe(1);

    addCharge(state, CONFIG.avalanche.threshold, bus);
    expect(scoreMultiplier(state)).toBe(CONFIG.avalanche.scoreMultiplier);

    updateAvalanche(state, CONFIG.avalanche.durationSeconds, bus);
    expect(scoreMultiplier(state)).toBe(1);
  });
});

describe('applyForgivenessPenalty', () => {
  it('azzera la carica, scala la taglia ed emette size:changed', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 60, bus);
    expect(state.size).toBe(4);

    applyForgivenessPenalty(state, bus);
    expect(state.charge).toBe(0);
    expect(state.size).toBe(4 - CONFIG.forgiveness.sizePenalty);
    expect(payloadsOf(events, 'size:changed').at(-1)).toEqual({ size: 3, previous: 4 });
  });

  it('non scende mai sotto taglia 1', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const state = createAvalanche();

    addCharge(state, 5, bus);
    applyForgivenessPenalty(state, bus);

    expect(state.charge).toBe(0);
    expect(state.size).toBe(1);
    expect(countOf(events, 'size:changed')).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/avalanche.test.ts`
Atteso: FAIL con `Failed to resolve import "./avalanche" from "src/game/avalanche.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

```ts
// src/game/avalanche.ts
import type { EventBus } from '../core/events';
import { CONFIG } from './config';
import type { ObstacleKind } from './types';

export type AvalanchePhase = 'idle' | 'active' | 'warning';

export interface AvalancheState {
  /** Carica accumulata, 0..CONFIG.avalanche.threshold. */
  charge: number;
  /** Taglia della mucca, 1..CONFIG.avalanche.maxSize. */
  size: number;
  phase: AvalanchePhase;
  /** Secondi rimanenti nella fase active/warning. */
  timeLeft: number;
}

export function createAvalanche(): AvalancheState {
  return { charge: 0, size: 1, phase: 'idle', timeLeft: 0 };
}

export function sizeForCharge(charge: number): number {
  const thresholds = CONFIG.avalanche.sizeThresholds;
  let size = 1;
  for (let index = 0; index < thresholds.length; index += 1) {
    const threshold = thresholds[index];
    if (threshold === undefined) continue;
    if (charge >= threshold) size = index + 1;
  }
  return Math.min(size, CONFIG.avalanche.maxSize);
}

/** Unico punto in cui la taglia cambia: clampa ed emette `size:changed`. */
function setSize(state: AvalancheState, next: number, bus: EventBus): void {
  const clamped = Math.max(1, Math.min(CONFIG.avalanche.maxSize, Math.floor(next)));
  if (clamped === state.size) return;
  const previous = state.size;
  state.size = clamped;
  bus.emit('size:changed', { size: clamped, previous });
}

export function addCharge(state: AvalancheState, amount: number, bus: EventBus): void {
  // Durante la valanga la carica è congelata: la fase non si autoprolunga.
  if (state.phase !== 'idle') return;
  if (amount <= 0) return;

  const threshold = CONFIG.avalanche.threshold;
  state.charge = Math.min(threshold, state.charge + amount);
  setSize(state, sizeForCharge(state.charge), bus);

  if (state.charge >= threshold) {
    state.phase = 'active';
    state.timeLeft = CONFIG.avalanche.durationSeconds;
    bus.emit('avalanche:triggered', { size: state.size });
  }
}

export function updateAvalanche(state: AvalancheState, dt: number, bus: EventBus): void {
  if (state.phase === 'idle') return;

  state.timeLeft -= dt;

  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    state.phase = 'idle';
    state.charge = 0;
    bus.emit('avalanche:ended', {});
    setSize(state, 1, bus);
    return;
  }

  if (state.phase === 'active' && state.timeLeft <= CONFIG.avalanche.warningSeconds) {
    state.phase = 'warning';
    bus.emit('avalanche:ending', {});
  }
}

/** Penalità del "primo impatto perdonato": carica a zero e taglia scalata. */
export function applyForgivenessPenalty(state: AvalancheState, bus: EventBus): void {
  state.charge = 0;
  setSize(state, state.size - CONFIG.forgiveness.sizePenalty, bus);
}

export function isInvulnerable(state: AvalancheState): boolean {
  return state.phase !== 'idle';
}

export function canSmash(state: AvalancheState, kind: ObstacleKind): boolean {
  if (isInvulnerable(state)) return true;
  if (kind !== 'tree' && kind !== 'fence') return false;
  return state.size >= CONFIG.avalanche.smashMinSize;
}

export function scoreMultiplier(state: AvalancheState): number {
  return isInvulnerable(state) ? CONFIG.avalanche.scoreMultiplier : 1;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS (tutti i file di test, incluso `src/game/avalanche.test.ts`).
Comando: `npm run typecheck`
Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/avalanche.ts src/game/avalanche.test.ts
git commit -m "feat(avalanche): add charge, size thresholds and avalanche phases"
```

---

### Task 12: Punteggio, moltiplicatori e record persistito

**Files:**
- Create: `src/game/score.ts`
- Test: `src/game/score.test.ts`

**Interfaces:**
- Consumes:
  - `CONFIG.score = { pointsPerUnit: 1, pickupBonus: { snowflake: 5, hay: 25, cow: 50 }, smashBonus: 30, recordKey: 'rollingcows.record' }` da `src/game/config.ts`
- Produces:
  - `export interface ScoreState { points: number; distance: number }`
  - `export function createScore(): ScoreState`
  - `export function addDistance(score: ScoreState, meters: number, multiplier: number): void`
  - `export function addBonus(score: ScoreState, amount: number, multiplier: number): void`
  - `export function loadRecord(storage?: Storage): number`
  - `export function saveRecord(points: number, storage?: Storage): boolean`

**Note di progetto:**
- `points` resta un **float** per tutta la vita della run: arrotondare a ogni frame introdurrebbe una perdita sistematica (ogni frame aggiunge frazioni di metro). L'arrotondamento è responsabilità della vista: `Hud.setPoints` chiama `Math.floor`.
- Il record è salvato con il valore esatto (`String(points)`); anche lì è la UI ad arrotondare.
- Lo `storage` è risolto una sola volta per chiamata: parametro esplicito, altrimenti `globalThis.localStorage` se esiste, altrimenti nessuno (le funzioni degradano a `0` / `false` senza lanciare). Tutti gli accessi sono in `try/catch` perché Safari in modalità privata può lanciare su `setItem`.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// src/game/score.test.ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import {
  addBonus,
  addDistance,
  createScore,
  loadRecord,
  saveRecord,
} from './score';

/** Storage finto e isolato: i test non toccano mai il localStorage vero. */
function createFakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
    },
    getItem(key: string): string | null {
      return map.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      map.delete(key);
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
  };
}

describe('createScore', () => {
  it('parte da zero punti e zero distanza', () => {
    expect(createScore()).toEqual({ points: 0, distance: 0 });
  });
});

describe('addDistance', () => {
  it('somma metri * pointsPerUnit * multiplier e aggiorna la distanza', () => {
    const score = createScore();

    addDistance(score, 10, 1);
    expect(score.distance).toBe(10);
    expect(score.points).toBe(10 * CONFIG.score.pointsPerUnit);

    addDistance(score, 10, 4);
    expect(score.distance).toBe(20);
    expect(score.points).toBe(10 * CONFIG.score.pointsPerUnit + 40 * CONFIG.score.pointsPerUnit);
  });

  it('mantiene i punti come float, senza arrotondamenti', () => {
    const score = createScore();
    addDistance(score, 0.3, 1);
    addDistance(score, 0.3, 1);
    expect(score.points).toBeCloseTo(0.6, 10);
    expect(score.distance).toBeCloseTo(0.6, 10);
  });
});

describe('addBonus', () => {
  it('somma amount * multiplier senza toccare la distanza', () => {
    const score = createScore();

    addBonus(score, CONFIG.score.pickupBonus.hay, 1);
    expect(score.points).toBe(25);

    addBonus(score, CONFIG.score.smashBonus, 4);
    expect(score.points).toBe(25 + 120);
    expect(score.distance).toBe(0);
  });
});

describe('loadRecord', () => {
  it('restituisce 0 su storage vuoto', () => {
    expect(loadRecord(createFakeStorage())).toBe(0);
  });

  it('restituisce 0 su valore non numerico, senza lanciare', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: 'pippo' });
    expect(() => loadRecord(storage)).not.toThrow();
    expect(loadRecord(storage)).toBe(0);
  });

  it('legge il valore salvato', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: '1234.5' });
    expect(loadRecord(storage)).toBe(1234.5);
  });
});

describe('saveRecord', () => {
  it('salva e restituisce true se il punteggio è maggiore del record', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: '100' });

    expect(saveRecord(150, storage)).toBe(true);
    expect(loadRecord(storage)).toBe(150);
  });

  it('non sovrascrive e restituisce false se il punteggio è minore o uguale', () => {
    const storage = createFakeStorage({ [CONFIG.score.recordKey]: '150' });

    expect(saveRecord(150, storage)).toBe(false);
    expect(saveRecord(10, storage)).toBe(false);
    expect(loadRecord(storage)).toBe(150);
  });

  it('salva il primo record su storage vuoto', () => {
    const storage = createFakeStorage();

    expect(saveRecord(42, storage)).toBe(true);
    expect(storage.getItem(CONFIG.score.recordKey)).toBe('42');
  });
});

describe('senza storage disponibile', () => {
  it('loadRecord dà 0 e saveRecord non lancia', () => {
    const globalWithStorage = globalThis as { localStorage?: Storage };
    const original = globalWithStorage.localStorage;
    delete globalWithStorage.localStorage;

    try {
      expect(loadRecord()).toBe(0);
      expect(() => saveRecord(1000)).not.toThrow();
      expect(saveRecord(1000)).toBe(false);
    } finally {
      if (original !== undefined) globalWithStorage.localStorage = original;
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/score.test.ts`
Atteso: FAIL con `Failed to resolve import "./score" from "src/game/score.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

```ts
// src/game/score.ts
import { CONFIG } from './config';

export interface ScoreState {
  /**
   * Punteggio grezzo, tenuto in virgola mobile per non perdere le frazioni di
   * metro sommate a ogni frame. È la vista (HUD, schermata di game over) ad
   * arrotondare con Math.floor.
   */
  points: number;
  /** Metri percorsi nella run corrente. */
  distance: number;
}

export function createScore(): ScoreState {
  return { points: 0, distance: 0 };
}

export function addDistance(score: ScoreState, meters: number, multiplier: number): void {
  score.distance += meters;
  score.points += meters * CONFIG.score.pointsPerUnit * multiplier;
}

export function addBonus(score: ScoreState, amount: number, multiplier: number): void {
  score.points += amount * multiplier;
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage !== undefined) return storage;
  const ambient = (globalThis as { localStorage?: Storage }).localStorage;
  return ambient ?? null;
}

export function loadRecord(storage?: Storage): number {
  const target = resolveStorage(storage);
  if (target === null) return 0;

  let raw: string | null = null;
  try {
    raw = target.getItem(CONFIG.score.recordKey);
  } catch {
    return 0;
  }
  if (raw === null) return 0;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

/** Salva se maggiore del record; restituisce true se è un nuovo record. */
export function saveRecord(points: number, storage?: Storage): boolean {
  const target = resolveStorage(storage);
  if (target === null) return false;
  if (!Number.isFinite(points)) return false;
  if (points <= loadRecord(target)) return false;

  try {
    target.setItem(CONFIG.score.recordKey, String(points));
  } catch {
    return false;
  }
  return true;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS.
Comando: `npm run typecheck`
Atteso: nessun errore.

- [ ] **Step 5: Commit**

```bash
git add src/game/score.ts src/game/score.test.ts
git commit -m "feat(score): add scoring with multipliers and persisted record"
```

---

### Task 13: Orchestratore di gioco e test di integrazione headless

**Files:**
- Create: `src/game/game.ts`
- Test: `src/game/game.test.ts`

**Interfaces:**
- Consumes:
  - `createRng(seed: number): Rng` da `src/core/rng.ts`
  - `EventBus` da `src/core/events.ts`
  - `createWorld(): WorldState`, `updateWorld(world: WorldState, dt: number): void` da `src/game/world.ts`
  - `createPlayer(): PlayerState`, `moveLane(player, direction: -1 | 1)`, `jump(player)`, `slam(player)`, `updatePlayer(player, dt)` da `src/game/player.ts`
  - `createAvalanche`, `addCharge`, `updateAvalanche`, `applyForgivenessPenalty`, `canSmash`, `scoreMultiplier`, `sizeForCharge` da `src/game/avalanche.ts`
  - `createScore`, `addDistance`, `addBonus`, `saveRecord` da `src/game/score.ts`
  - `createSpawner(rng: Rng): Spawner` con `populateChunk(chunkZ, difficulty, out)` da `src/game/spawner.ts`
  - `playerBox(x, y, size, slamming = false)`, `entityBox(entity)`, `boxesOverlap(a, b)`, `ENTITY_BOX` da `src/game/collisions.ts`
  - `difficultyAt(distance: number): number` da `src/game/speed.ts`
- Produces:
  - `export interface GameState { seed: number; rng: Rng; bus: EventBus; world: WorldState; player: PlayerState; avalanche: AvalancheState; score: ScoreState; spawner: Spawner; entities: Entity[]; alive: boolean; forgivenessUsed: boolean }`
  - `export function createGame(seed: number, bus: EventBus): GameState`
  - `export function startRun(game: GameState, seed?: number): void`
  - `export function handleAction(game: GameState, action: Action): void`
  - `export function updateGame(game: GameState, dt: number): void`

**Note di progetto:**
- `GameState` aggiunge il campo `seed` rispetto alla bozza del contratto: serve a `run:started` (che porta il seed nel payload) e a `startRun(game)` senza argomenti, che deve poter ricreare `rng` e `spawner` con lo stesso seed. È l'unica aggiunta.
- **Scatto di taglia della mucca raccolta:** implementato *dentro l'unica risorsa del gioco*, la carica. `sizeBonusCharge` calcola quanta carica manca per raggiungere la soglia del livello successivo e la aggiunge alla carica base del pickup. Motivo: il design dice esplicitamente "una sola risorsa, due letture"; se la taglia fosse alzata a parte, il primo `sizeForCharge` successivo la riporterebbe giù, e la barra mentirebbe.
- `pickup:collected.charge` riporta la carica **effettivamente applicata** (`charge` dopo meno `charge` prima): durante la valanga vale 0, perché `addCharge` è congelata.
- Il moltiplicatore del bonus è letto **prima** di `addCharge`: il pickup che fa scattare la valanga vale ancora ×1, il ×4 parte dall'evento successivo.
- `createGame` restituisce uno stato **non in corsa** (`alive: false`): `updateGame` è inerte finché non si chiama `startRun`.
- La finestra `COLLISION_Z_WINDOW` è derivata da `CONFIG.player.depth` e dalla profondità massima in `ENTITY_BOX` (nessuna costante magica) ed è volutamente conservativa: serve solo a evitare di costruire una AABB per ogni entità del mondo a ogni frame. A 40 u/s e passo 1/60 un'entità si sposta di 0,67 unità per frame, quindi non può attraversare la finestra senza essere testata.

- [ ] **Step 1: Scrivi il test che fallisce**

```ts
// src/game/game.test.ts
import { describe, expect, it } from 'vitest';
import {
  createEventBus,
  type EventBus,
  type EventName,
  type GameEvents,
} from '../core/events';
import { addCharge } from './avalanche';
import { CONFIG } from './config';
import { createGame, handleAction, startRun, updateGame, type GameState } from './game';
import type { Entity } from './types';

const STEP = 1 / 60;

interface Recorded {
  name: EventName;
  payload: unknown;
}

const ALL_EVENTS: EventName[] = [
  'run:started',
  'run:ended',
  'pickup:collected',
  'obstacle:hit',
  'size:changed',
  'avalanche:triggered',
  'avalanche:ending',
  'avalanche:ended',
];

function recordEvents(bus: EventBus): Recorded[] {
  const seen: Recorded[] = [];
  for (const name of ALL_EVENTS) {
    bus.on(name, (payload: unknown) => {
      seen.push({ name, payload });
    });
  }
  return seen;
}

function countOf(events: readonly Recorded[], name: EventName): number {
  return events.filter((event) => event.name === name).length;
}

function payloadsOf<K extends EventName>(
  events: readonly Recorded[],
  name: K,
): GameEvents[K][] {
  return events
    .filter((event) => event.name === name)
    .map((event) => event.payload as GameEvents[K]);
}

function rock(): Entity {
  return { id: 1, kind: 'rock', category: 'obstacle', lane: 1, width: 1, z: 5, y: 0, alive: true };
}

function cow(): Entity {
  return { id: 2, kind: 'cow', category: 'pickup', lane: 1, width: 1, z: 5, y: 0, alive: true };
}

/**
 * Piazza una sola entità nella corsia centrale, a 5 unità dal giocatore.
 * A 18 u/s l'impatto avviene entro ~17 frame; i 60 frame simulati restano
 * abbondantemente sotto ai 3,3 s necessari al primo riciclo di chunk, quindi
 * nessuna entità generata dallo spawner interferisce con lo scenario.
 */
function scenario(seed: number, entity: Entity): { game: GameState; events: Recorded[] } {
  const bus = createEventBus();
  const game = createGame(seed, bus);
  startRun(game);
  const events = recordEvents(bus);
  game.entities.length = 0;
  game.entities.push(entity);
  return { game, events };
}

function runFrames(game: GameState, frames: number): void {
  for (let frame = 0; frame < frames; frame += 1) {
    updateGame(game, STEP);
  }
}

describe('startRun', () => {
  it('reinizializza tutto ed emette run:started', () => {
    const bus = createEventBus();
    const events = recordEvents(bus);
    const game = createGame(99, bus);

    startRun(game);
    runFrames(game, 120);
    expect(game.score.points).toBeGreaterThan(0);

    game.forgivenessUsed = true;
    game.alive = false;
    startRun(game, 7);

    expect(game.seed).toBe(7);
    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(game.entities).toHaveLength(0);
    expect(game.score).toEqual({ points: 0, distance: 0 });
    expect(game.world.distance).toBe(0);
    expect(game.avalanche).toEqual({ charge: 0, size: 1, phase: 'idle', timeLeft: 0 });
    expect(payloadsOf(events, 'run:started')).toEqual([{ seed: 99 }, { seed: 7 }]);
  });
});

describe('updateGame — simulazione lunga', () => {
  it('60 secondi a 1/60 non lanciano e le entità vive restano limitate', () => {
    const bus = createEventBus();
    const game = createGame(20260816, bus);
    startRun(game);

    let maxEntities = 0;

    expect(() => {
      for (let frame = 0; frame < 60 * 60; frame += 1) {
        updateGame(game, STEP);
        maxEntities = Math.max(maxEntities, game.entities.length);
        if (!game.alive) startRun(game);
      }
    }).not.toThrow();

    expect(maxEntities).toBeGreaterThan(0);
    expect(maxEntities).toBeLessThan(200);
  });

  it('il punteggio non decresce mai finché il giocatore è vivo', () => {
    const bus = createEventBus();
    const game = createGame(4242, bus);
    startRun(game);

    let previous = game.score.points;
    let frames = 0;

    while (game.alive && frames < 60 * 30) {
      updateGame(game, STEP);
      expect(game.score.points).toBeGreaterThanOrEqual(previous);
      previous = game.score.points;
      frames += 1;
    }

    expect(frames).toBeGreaterThan(0);
    expect(game.score.points).toBeGreaterThan(0);
  });
});

describe('updateGame — collisione con ostacolo', () => {
  it('uccide il giocatore ed emette run:ended una sola volta', () => {
    const { game, events } = scenario(1, rock());

    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['death']);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.lane)).toEqual([1]);
    expect(countOf(events, 'run:ended')).toBe(1);

    const ended = payloadsOf(events, 'run:ended')[0];
    expect(ended?.points).toBeGreaterThan(0);
    expect(ended?.distance).toBeGreaterThan(0);

    const total = events.length;
    runFrames(game, 10);
    expect(events).toHaveLength(total);
    expect(countOf(events, 'run:ended')).toBe(1);
  });

  it('con carica al 60% perdona il primo impatto invece di uccidere', () => {
    const { game, events } = scenario(1, rock());
    addCharge(game.avalanche, 60, game.bus);
    expect(game.avalanche.size).toBe(4);

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(true);
    expect(game.avalanche.charge).toBe(0);
    expect(game.avalanche.size).toBe(4 - CONFIG.forgiveness.sizePenalty);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['forgiven']);
    expect(countOf(events, 'run:ended')).toBe(0);
    expect(game.entities).toHaveLength(0);
  });

  it('in fase valanga sfonda la roccia e incassa il bonus moltiplicato', () => {
    const { game, events } = scenario(1, rock());
    addCharge(game.avalanche, CONFIG.avalanche.threshold, game.bus);
    expect(game.avalanche.phase).toBe('active');

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.forgivenessUsed).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual(['smashed']);
    expect(game.score.points).toBeGreaterThanOrEqual(
      CONFIG.score.smashBonus * CONFIG.avalanche.scoreMultiplier,
    );
    expect(game.entities).toHaveLength(0);
  });

  it('perdona una sola volta per run', () => {
    const { game, events } = scenario(1, rock());
    addCharge(game.avalanche, 60, game.bus);
    runFrames(game, 60);
    expect(game.alive).toBe(true);

    addCharge(game.avalanche, 60, game.bus);
    game.entities.push(rock());
    runFrames(game, 60);

    expect(game.alive).toBe(false);
    expect(payloadsOf(events, 'obstacle:hit').map((hit) => hit.outcome)).toEqual([
      'forgiven',
      'death',
    ]);
  });
});

describe('updateGame — raccolta pickup', () => {
  it('la mucca raccolta dà carica 10 e uno scatto immediato di taglia', () => {
    const { game, events } = scenario(1, cow());

    runFrames(game, 60);

    expect(game.alive).toBe(true);
    expect(game.entities).toHaveLength(0);
    // 10 di carica base + 10 per raggiungere la soglia della taglia 2.
    expect(game.avalanche.charge).toBe(20);
    expect(game.avalanche.size).toBe(2);
    expect(payloadsOf(events, 'pickup:collected')).toEqual([{ kind: 'cow', charge: 20 }]);
    expect(payloadsOf(events, 'size:changed')).toEqual([{ size: 2, previous: 1 }]);
    expect(game.score.points).toBeGreaterThanOrEqual(CONFIG.score.pickupBonus.cow);
  });
});

describe('determinismo', () => {
  it('due partite con lo stesso seed e le stesse azioni danno lo stesso punteggio', () => {
    function play(seed: number, frames: number): { points: number; distance: number; alive: boolean } {
      const bus = createEventBus();
      const game = createGame(seed, bus);
      startRun(game);

      for (let frame = 0; frame < frames; frame += 1) {
        if (frame % 53 === 0) handleAction(game, 'JUMP');
        if (frame % 71 === 0) handleAction(game, 'SLAM');
        if (frame % 97 === 0) handleAction(game, 'MOVE_LEFT');
        if (frame % 131 === 0) handleAction(game, 'MOVE_RIGHT');
        updateGame(game, STEP);
        if (!game.alive) startRun(game, seed);
      }

      return { points: game.score.points, distance: game.score.distance, alive: game.alive };
    }

    const first = play(31337, 60 * 20);
    const second = play(31337, 60 * 20);

    expect(second).toEqual(first);
    expect(first.points).toBeGreaterThan(0);
  });
});

describe('handleAction', () => {
  it('instrada MOVE_LEFT e MOVE_RIGHT al cambio corsia', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    expect(game.player.lane).toBe(1);

    handleAction(game, 'MOVE_LEFT');
    expect(game.player.lane).toBe(0);
    runFrames(game, 20);

    handleAction(game, 'MOVE_RIGHT');
    expect(game.player.lane).toBe(1);
  });

  it('instrada JUMP al salto', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'JUMP');
    expect(game.player.airborne).toBe(true);
  });

  it('instrada SLAM alla schiacciata', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);

    handleAction(game, 'SLAM');
    expect(game.player.slamming).toBe(true);
  });

  it('ignora PAUSE, gestita fuori dal gioco', () => {
    const bus = createEventBus();
    const game = createGame(5, bus);
    startRun(game);
    const before = { ...game.player };

    handleAction(game, 'PAUSE');

    expect(game.player).toEqual(before);
    expect(game.alive).toBe(true);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/game/game.test.ts`
Atteso: FAIL con `Failed to resolve import "./game" from "src/game/game.test.ts"`.

- [ ] **Step 3: Implementa il minimo necessario**

```ts
// src/game/game.ts
import type { EventBus } from '../core/events';
import { createRng, type Rng } from '../core/rng';
import {
  addCharge,
  applyForgivenessPenalty,
  canSmash,
  createAvalanche,
  scoreMultiplier,
  sizeForCharge,
  updateAvalanche,
  type AvalancheState,
} from './avalanche';
import { boxesOverlap, entityBox, playerBox, ENTITY_BOX } from './collisions';
import { CONFIG } from './config';
import {
  createPlayer,
  jump,
  moveLane,
  slam,
  updatePlayer,
  type PlayerState,
} from './player';
import { addBonus, addDistance, createScore, saveRecord, type ScoreState } from './score';
import { createSpawner, type Spawner } from './spawner';
import { difficultyAt } from './speed';
import type { Action, Entity, EntityKind, ObstacleKind, PickupKind } from './types';
import { createWorld, updateWorld, type WorldState } from './world';

export interface GameState {
  /** Seed della run corrente: va in `run:started` e permette di rigiocarla identica. */
  seed: number;
  rng: Rng;
  bus: EventBus;
  world: WorldState;
  player: PlayerState;
  avalanche: AvalancheState;
  score: ScoreState;
  spawner: Spawner;
  entities: Entity[];
  alive: boolean;
  forgivenessUsed: boolean;
}

/**
 * Semi-finestra lungo z entro cui vale la pena costruire le AABB. Derivata dalle
 * profondità dichiarate, non da un numero scelto a mano, e volutamente più larga
 * della condizione di sovrapposizione: a 40 u/s con passo 1/60 un'entità si
 * sposta di 0,67 unità per frame, quindi non può saltarla.
 */
const MAX_ENTITY_DEPTH = Math.max(...Object.values(ENTITY_BOX).map((box) => box.depth));
const COLLISION_Z_WINDOW = CONFIG.player.depth + MAX_ENTITY_DEPTH;

function isPickupKind(kind: EntityKind): kind is PickupKind {
  return kind === 'snowflake' || kind === 'hay' || kind === 'cow';
}

export function createGame(seed: number, bus: EventBus): GameState {
  const rng = createRng(seed);
  return {
    seed,
    rng,
    bus,
    world: createWorld(),
    player: createPlayer(),
    avalanche: createAvalanche(),
    score: createScore(),
    spawner: createSpawner(rng),
    entities: [],
    // Uno stato appena creato non è in corsa: serve startRun.
    alive: false,
    forgivenessUsed: false,
  };
}

export function startRun(game: GameState, seed?: number): void {
  if (seed !== undefined) game.seed = seed;

  game.rng = createRng(game.seed);
  game.spawner = createSpawner(game.rng);
  game.world = createWorld();
  game.player = createPlayer();
  game.avalanche = createAvalanche();
  game.score = createScore();
  game.entities.length = 0;
  game.alive = true;
  game.forgivenessUsed = false;

  game.bus.emit('run:started', { seed: game.seed });
}

export function handleAction(game: GameState, action: Action): void {
  if (!game.alive) return;

  switch (action) {
    case 'MOVE_LEFT':
      moveLane(game.player, -1);
      break;
    case 'MOVE_RIGHT':
      moveLane(game.player, 1);
      break;
    case 'JUMP':
      jump(game.player);
      break;
    case 'SLAM':
      slam(game.player);
      break;
    case 'PAUSE':
      // La pausa è una transizione della macchina a stati, non un'azione di gioco.
      break;
  }
}

export function updateGame(game: GameState, dt: number): void {
  if (!game.alive) return;

  const distanceBefore = game.world.distance;

  updateWorld(game.world, dt);
  updatePlayer(game.player, dt);
  updateAvalanche(game.avalanche, dt, game.bus);

  const difficulty = difficultyAt(game.world.distance);
  for (const chunk of game.world.recycled) {
    game.spawner.populateChunk(chunk.z, difficulty, game.entities);
  }

  const moved = game.world.distance - distanceBefore;
  for (const entity of game.entities) {
    if (!entity.alive) continue;
    entity.z -= moved;
    if (entity.z < CONFIG.world.despawnBehindZ) entity.alive = false;
  }

  const box = playerBox(
    game.player.x,
    game.player.y,
    game.avalanche.size,
    game.player.slamming,
  );
  for (const entity of game.entities) {
    if (!entity.alive) continue;
    if (Math.abs(entity.z) > COLLISION_Z_WINDOW) continue;
    if (!boxesOverlap(box, entityBox(entity))) continue;

    resolveCollision(game, entity);
    if (!game.alive) break;
  }

  compactEntities(game.entities);

  if (game.alive) {
    addDistance(game.score, moved, scoreMultiplier(game.avalanche));
  }
}

function resolveCollision(game: GameState, entity: Entity): void {
  if (isPickupKind(entity.kind)) {
    collectPickup(game, entity, entity.kind);
    return;
  }
  hitObstacle(game, entity, entity.kind);
}

/**
 * Carica extra necessaria a far salire di `levels` livelli la taglia che si
 * avrebbe con `charge`. Lo scatto di taglia della mucca raccolta è espresso
 * nell'unica risorsa del gioco: se alzassimo `size` a parte, il primo ricalcolo
 * da soglia lo cancellerebbe e la barra mentirebbe al giocatore.
 */
function sizeBonusCharge(charge: number, levels: number): number {
  if (levels <= 0) return 0;

  const thresholds = CONFIG.avalanche.sizeThresholds;
  const targetIndex = Math.min(
    sizeForCharge(charge) - 1 + levels,
    CONFIG.avalanche.maxSize - 1,
  );
  const needed = thresholds[targetIndex];
  if (needed === undefined) return 0;

  return Math.max(0, needed - charge);
}

function collectPickup(game: GameState, entity: Entity, kind: PickupKind): void {
  entity.alive = false;

  // Il moltiplicatore è letto prima della carica: il pickup che fa scattare la
  // valanga vale ancora ×1.
  const multiplier = scoreMultiplier(game.avalanche);
  const base = CONFIG.pickups.charge[kind];
  const extra = sizeBonusCharge(
    Math.min(CONFIG.avalanche.threshold, game.avalanche.charge + base),
    CONFIG.pickups.sizeBonus[kind],
  );

  const chargeBefore = game.avalanche.charge;
  addCharge(game.avalanche, base + extra, game.bus);
  addBonus(game.score, CONFIG.score.pickupBonus[kind], multiplier);

  game.bus.emit('pickup:collected', {
    kind,
    charge: game.avalanche.charge - chargeBefore,
  });
}

function hitObstacle(game: GameState, entity: Entity, kind: ObstacleKind): void {
  const multiplier = scoreMultiplier(game.avalanche);
  const lane = entity.lane;
  const z = entity.z;

  if (canSmash(game.avalanche, kind)) {
    entity.alive = false;
    addBonus(game.score, CONFIG.score.smashBonus, multiplier);
    game.bus.emit('obstacle:hit', { kind, outcome: 'smashed', lane, z });
    return;
  }

  const chargeRatio = game.avalanche.charge / CONFIG.avalanche.threshold;
  const forgivable =
    CONFIG.forgiveness.enabled &&
    !game.forgivenessUsed &&
    chargeRatio >= CONFIG.forgiveness.minChargeRatio;

  if (forgivable) {
    game.forgivenessUsed = true;
    // L'ostacolo perdonato sparisce: altrimenti colpirebbe di nuovo il frame dopo.
    entity.alive = false;
    applyForgivenessPenalty(game.avalanche, game.bus);
    game.bus.emit('obstacle:hit', { kind, outcome: 'forgiven', lane, z });
    return;
  }

  game.alive = false;
  game.bus.emit('obstacle:hit', { kind, outcome: 'death', lane, z });

  const isRecord = saveRecord(game.score.points);
  game.bus.emit('run:ended', {
    points: game.score.points,
    distance: game.score.distance,
    isRecord,
  });
}

/** Compattazione a due indici, in place: nessun array nuovo per frame. */
function compactEntities(entities: Entity[]): void {
  let write = 0;
  for (let read = 0; read < entities.length; read += 1) {
    const entity = entities[read];
    if (entity === undefined || !entity.alive) continue;
    if (write !== read) entities[write] = entity;
    write += 1;
  }
  entities.length = write;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS su tutti i file, inclusi i test di integrazione di `src/game/game.test.ts`.
Comando: `npm run typecheck`
Atteso: nessun errore (`strict` + `noUncheckedIndexedAccess`).

- [ ] **Step 5: Commit**

```bash
git add src/game/game.ts src/game/game.test.ts
git commit -m "feat(game): add headless game orchestrator with collisions and scoring"
```

---

### Task 14: Contesto di rendering, rig di camera e prima immagine a schermo

**Files:**
- Create: `src/render/camera-rig.ts`
- Test: `src/render/camera-rig.test.ts`
- Create: `src/render/scene.ts`
- Create: `src/main.ts` (sostituisce integralmente il file di scaffolding del task 1)

**Interfaces:**
- Consumes: `CONFIG` da `src/game/config.ts`; `createLoop(callbacks: LoopCallbacks, options?: { step?: number; maxAccumulated?: number }): Loop` da `src/core/loop.ts`.
- Produces:
  - `cameraDistanceFor(size: number): number`
  - `cameraHeightFor(size: number): number`
  - `cameraFovFor(avalanche: boolean, t: number): number`
  - `decayShake(current: number, dt: number): number`
  - `worldToViewX(x: number): number`
  - `createScene(canvas: HTMLCanvasElement): SceneContext` con `SceneContext` esattamente come da contratto.

**Nota di orientamento degli assi (vale per tutti i task 14-17).**
Nel mondo di gioco le entità nascono a `z` grande e scorrono verso `z` negativo
(`CONFIG.world.despawnBehindZ = -20`): il giocatore sta a `z = 0` e la camera sta
quindi *dietro*, a `z` negativo, e guarda verso `+z`. Con quell'inquadratura
l'asse `+X` del mondo cade alla **sinistra** dello schermo (il vettore "destra"
della camera è `forward × up = (0,0,1) × (0,1,0) = (-1,0,0)`). Siccome
`laneToX(0) = -2`, senza correzione la corsia 0 apparirebbe a destra e
`MOVE_LEFT` sposterebbe la mucca a destra. La vista specchia quindi l'asse X in
**un unico punto**, la funzione pura `worldToViewX`, usata da `entities-view.ts`,
`player-view.ts` e dai punti di `main.ts` che passano coordinate ai detriti. La
logica di gioco non ne sa nulla.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/render/camera-rig.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraFovFor,
  cameraHeightFor,
  decayShake,
  worldToViewX,
} from './camera-rig';

describe('cameraDistanceFor', () => {
  it('a taglia 1 usa la distanza base', () => {
    expect(cameraDistanceFor(1)).toBeCloseTo(CONFIG.render.cameraBaseDistance, 10);
  });

  it('cresce di cameraDistancePerSize per ogni taglia', () => {
    expect(cameraDistanceFor(3)).toBeCloseTo(
      CONFIG.render.cameraBaseDistance + 2 * CONFIG.render.cameraDistancePerSize,
      10,
    );
    expect(cameraDistanceFor(5)).toBeCloseTo(
      CONFIG.render.cameraBaseDistance + 4 * CONFIG.render.cameraDistancePerSize,
      10,
    );
  });

  it('clampa fuori dall intervallo delle taglie valide', () => {
    expect(cameraDistanceFor(0)).toBeCloseTo(cameraDistanceFor(1), 10);
    expect(cameraDistanceFor(99)).toBeCloseTo(cameraDistanceFor(CONFIG.avalanche.maxSize), 10);
  });
});

describe('cameraHeightFor', () => {
  it('è proporzionale alla distanza, così l inclinazione resta costante', () => {
    const ratio1 = cameraHeightFor(1) / cameraDistanceFor(1);
    const ratio5 = cameraHeightFor(5) / cameraDistanceFor(5);
    expect(ratio1).toBeCloseTo(ratio5, 10);
    expect(cameraHeightFor(1)).toBeGreaterThan(0);
  });
});

describe('cameraFovFor', () => {
  it('parte dal FOV di partenza e arriva a quello di destinazione', () => {
    expect(cameraFovFor(true, 0)).toBeCloseTo(CONFIG.render.cameraBaseFov, 10);
    expect(cameraFovFor(true, 1)).toBeCloseTo(CONFIG.render.cameraAvalancheFov, 10);
    expect(cameraFovFor(false, 0)).toBeCloseTo(CONFIG.render.cameraAvalancheFov, 10);
    expect(cameraFovFor(false, 1)).toBeCloseTo(CONFIG.render.cameraBaseFov, 10);
  });

  it('a metà transizione sta strettamente in mezzo', () => {
    const mid = cameraFovFor(true, 0.5);
    expect(mid).toBeGreaterThan(CONFIG.render.cameraBaseFov);
    expect(mid).toBeLessThan(CONFIG.render.cameraAvalancheFov);
  });

  it('è monotona crescente entrando in valanga', () => {
    let previous = cameraFovFor(true, 0);
    for (let i = 1; i <= 10; i += 1) {
      const current = cameraFovFor(true, i / 10);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('clampa t fuori da [0,1]', () => {
    expect(cameraFovFor(true, -5)).toBeCloseTo(CONFIG.render.cameraBaseFov, 10);
    expect(cameraFovFor(true, 5)).toBeCloseTo(CONFIG.render.cameraAvalancheFov, 10);
  });
});

describe('decayShake', () => {
  it('con dt = 0 non cambia nulla', () => {
    expect(decayShake(0.5, 0)).toBeCloseTo(0.5, 10);
  });

  it('è indipendente dal frame rate', () => {
    const oneStep = decayShake(1, 0.5);
    const twoSteps = decayShake(decayShake(1, 0.25), 0.25);
    expect(twoSteps).toBeCloseTo(oneStep, 10);
  });

  it('decade secondo shakeDecay', () => {
    expect(decayShake(1, 1)).toBeCloseTo(Math.exp(-CONFIG.render.shakeDecay), 10);
  });

  it('arriva esattamente a zero e ci resta', () => {
    let value = 1;
    for (let i = 0; i < 600; i += 1) value = decayShake(value, 1 / 60);
    expect(value).toBe(0);
    expect(decayShake(0, 1 / 60)).toBe(0);
  });
});

describe('worldToViewX', () => {
  it('specchia l asse X una volta sola', () => {
    expect(worldToViewX(-2)).toBe(2);
    expect(worldToViewX(0)).toBe(0);
    expect(worldToViewX(worldToViewX(1.5))).toBe(1.5);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/camera-rig.test.ts`
Atteso: FAIL con `Failed to resolve import "./camera-rig"`.

- [ ] **Step 3: Implementa `src/render/camera-rig.ts`**

```ts
import { CONFIG } from '../game/config';

/**
 * Rapporto fra altezza e distanza della camera. È una scelta di inquadratura,
 * non un numero di bilanciamento: tenendolo costante l'inclinazione della
 * camera resta identica a ogni taglia, e cambia solo quanto mondo si vede.
 */
export const CAMERA_HEIGHT_RATIO = 0.42;

/** Distanza della camera dietro la mucca per la taglia data (1..maxSize). */
export function cameraDistanceFor(size: number): number {
  const clamped = Math.min(CONFIG.avalanche.maxSize, Math.max(1, size));
  return (
    CONFIG.render.cameraBaseDistance + (clamped - 1) * CONFIG.render.cameraDistancePerSize
  );
}

/** Altezza della camera sopra il pendio per la taglia data. */
export function cameraHeightFor(size: number): number {
  return cameraDistanceFor(size) * CAMERA_HEIGHT_RATIO;
}

/**
 * FOV durante la transizione verso lo stato corrente.
 * `t` è l'avanzamento della transizione in [0,1]: 0 = stato appena cambiato,
 * 1 = transizione conclusa. Entrando in valanga si va da cameraBaseFov a
 * cameraAvalancheFov, uscendo si torna indietro.
 */
export function cameraFovFor(avalanche: boolean, t: number): number {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  const eased = clamped * clamped * (3 - 2 * clamped);
  const from = avalanche ? CONFIG.render.cameraBaseFov : CONFIG.render.cameraAvalancheFov;
  const to = avalanche ? CONFIG.render.cameraAvalancheFov : CONFIG.render.cameraBaseFov;
  return from + (to - from) * eased;
}

/**
 * Smorzamento esponenziale dello scuotimento: indipendente dal frame rate,
 * con snap a zero sotto la soglia percettibile per non tenere la camera
 * perennemente "viva" con oscillazioni infinitesime.
 */
export function decayShake(current: number, dt: number): number {
  const next = current * Math.exp(-CONFIG.render.shakeDecay * dt);
  return next < 1e-4 ? 0 : next;
}

/**
 * Converte una X di mondo nella X della vista. La camera sta a z negativo e
 * guarda verso +z: in quell'inquadratura l'asse +X del mondo cade a sinistra
 * dello schermo. Questa è l'unica funzione autorizzata a specchiare l'asse.
 */
export function worldToViewX(x: number): number {
  return -x;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/render/camera-rig.test.ts`
Atteso: PASS, 12 test.

- [ ] **Step 5: Implementa `src/render/scene.ts`**

Il cielo è una `CanvasTexture` a gradiente generata da codice (2×256 px) usata
come `scene.background`: three la disegna come quad a schermo intero, quindi il
ridimensionamento della finestra la stira solo in verticale su una texture che è
costante in orizzontale — nessuna deformazione visibile e zero asset esterni.

```ts
import * as THREE from 'three';
import { CONFIG } from '../game/config';
import {
  cameraDistanceFor,
  cameraFovFor,
  cameraHeightFor,
  decayShake,
} from './camera-rig';

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(): void;
  update(dt: number, size: number, avalanche: boolean): void;
  shake(amount: number): void;
  render(): void;
  setQuality(low: boolean): void;
}

/** Colori dell'ambiente: scelte estetiche, non numeri di bilanciamento. */
const SKY_TOP = '#1f5fa8';
const SKY_MID = '#7fb6e8';
const SKY_HORIZON = '#e8f4ff';
const FOG_COLOR = 0xdfeeff;
const SUN_COLOR = 0xfff4e0;
const SKY_LIGHT = 0xbfd9ff;
const GROUND_LIGHT = 0xf2f7ff;

/** Punto verso cui la camera guarda: davanti alla mucca, poco sopra la neve. */
const LOOK_AHEAD_Z = 9;
const LOOK_AT_Y = 1.4;
/** Velocità (1/s) con cui distanza, altezza e FOV raggiungono il valore obiettivo. */
const RIG_RATE = CONFIG.render.shakeDecay;
/** Tetto dello scuotimento accumulabile, in unità di mondo. */
const MAX_SHAKE = 1.2;

function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Contesto 2D non disponibile per la texture del cielo');
  }
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, SKY_TOP);
  gradient.addColorStop(0.55, SKY_MID);
  gradient.addColorStop(1, SKY_HORIZON);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  return texture;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const coarsePointer =
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !coarsePointer,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(FOG_COLOR, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = createSkyTexture();
  scene.fog = new THREE.Fog(FOG_COLOR, CONFIG.render.fogNear, CONFIG.render.fogFar);

  const camera = new THREE.PerspectiveCamera(
    CONFIG.render.cameraBaseFov,
    1,
    0.1,
    CONFIG.render.fogFar + 60,
  );

  const hemisphere = new THREE.HemisphereLight(SKY_LIGHT, GROUND_LIGHT, 1.1);
  scene.add(hemisphere);

  const sun = new THREE.DirectionalLight(SUN_COLOR, 1.35);
  sun.position.set(14, 26, -10);
  sun.target.position.set(0, 0, 12);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0015;
  sun.shadow.camera.left = -14;
  sun.shadow.camera.right = 14;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  const lookAt = new THREE.Vector3(0, LOOK_AT_Y, LOOK_AHEAD_Z);
  let shakeAmount = 0;
  let fovT = 1;
  let lastAvalanche = false;
  let distance = cameraDistanceFor(1);
  let height = cameraHeightFor(1);

  function resize(): void {
    const width = Math.max(1, window.innerWidth);
    const heightPx = Math.max(1, window.innerHeight);
    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio),
    );
    // updateStyle = false: la dimensione CSS del canvas la impone main.ts.
    renderer.setSize(width, heightPx, false);
    camera.aspect = width / heightPx;
    camera.updateProjectionMatrix();
  }

  function update(dt: number, size: number, avalanche: boolean): void {
    if (avalanche !== lastAvalanche) {
      lastAvalanche = avalanche;
      fovT = 0;
    }
    fovT = Math.min(1, fovT + dt * RIG_RATE);
    const fov = cameraFovFor(avalanche, fovT);
    if (Math.abs(camera.fov - fov) > 0.001) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const k = Math.min(1, dt * RIG_RATE);
    distance += (cameraDistanceFor(size) - distance) * k;
    height += (cameraHeightFor(size) - height) * k;

    shakeAmount = decayShake(shakeAmount, dt);
    const offsetX = (Math.random() * 2 - 1) * shakeAmount;
    const offsetY = (Math.random() * 2 - 1) * shakeAmount;
    camera.position.set(offsetX, height + offsetY, -distance);
    camera.lookAt(lookAt);
  }

  function shake(amount: number): void {
    shakeAmount = Math.min(MAX_SHAKE, shakeAmount + amount);
  }

  function render(): void {
    renderer.render(scene, camera);
  }

  function setQuality(low: boolean): void {
    sun.castShadow = !low;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.needsUpdate = true;
    hemisphere.intensity = low ? 1.35 : 1.1;
  }

  resize();
  camera.position.set(0, height, -distance);
  camera.lookAt(lookAt);

  return { renderer, scene, camera, resize, update, shake, render, setQuality };
}
```

- [ ] **Step 6: Implementa `src/main.ts`**

```ts
import { createLoop } from './core/loop';
import { createScene, type SceneContext } from './render/scene';

function ensureCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>('canvas#game');
  const canvas = existing ?? document.createElement('canvas');
  canvas.id = 'game';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  if (existing === null) document.body.appendChild(canvas);
  return canvas;
}

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font:16px/1.5 system-ui,sans-serif;color:#123;background:#e8f4ff;text-align:center;padding:24px;';
  box.textContent = message;
  document.body.appendChild(box);
}

function main(): void {
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#e8f4ff';
  const canvas = ensureCanvas();

  let view: SceneContext;
  try {
    view = createScene(canvas);
  } catch {
    showFatal('WebGL non è disponibile su questo browser: Rolling Cows non può partire.');
    return;
  }

  const loop = createLoop({
    update(dt: number): void {
      view.update(dt, 1, false);
    },
    render(): void {
      view.render();
    },
  });

  window.addEventListener('resize', () => view.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop();
    else loop.start();
  });

  loop.start();
}

main();
```

- [ ] **Step 7: Verifica visiva**

Comandi: `npm run typecheck` (atteso: nessun errore), poi `npm run dev` e apri
l'URL stampato da Vite.

Cosa DEVI vedere:
- lo schermo interamente riempito da un gradiente verticale: blu intenso in alto
  che sfuma in azzurro e poi in bianco-azzurro in basso;
- nessuna barra bianca ai bordi e nessuna barra di scorrimento;
- ridimensionando la finestra (anche molto stretta o molto larga) il gradiente
  resta verticale e non si inclina né si deforma;
- console del browser pulita: nessun errore, nessun warning di three.

Cosa NON devi vedere: terreno, mucca, ostacoli, nebbia visibile come banco —
a questo punto la scena è vuota, la nebbia esiste ma non ha nulla da sfumare.

- [ ] **Step 8: Commit**

```bash
git add src/render/camera-rig.ts src/render/camera-rig.test.ts src/render/scene.ts src/main.ts
git commit -m "feat(render): add scene context, camera rig and canvas bootstrap"
```

---

### Task 15: Modelli voxel generati da codice e geometria unica per modello

**Files:**
- Create: `src/render/models.ts`
- Test: `src/render/models.test.ts`
- Modify: `src/main.ts` (blocco temporaneo di verifica visiva, rimosso dal task 16)

**Interfaces:**
- Consumes: `ObstacleKind`, `PickupKind` da `src/game/types.ts`; `CONFIG.render.voxelSize`.
- Produces:
  - `interface VoxelModel { voxels: readonly number[][]; palette: readonly number[] }`
  - `const PALETTE: readonly number[]`
  - `const MODELS: Record<'cow' | ObstacleKind | PickupKind, VoxelModel>`
  - `buildGeometry(model: VoxelModel, voxelSize: number): THREE.BufferGeometry`

**Perché i modelli sono generati e non elencati.** Scrivere a mano le coordinate
di una baita solida (15×8×9 = 1080 cubetti) è impraticabile e immantenibile: ogni
modello nasce quindi da poche chiamate a `box()` e `set()` su un builder che
tiene i cubetti in una `Map` indicizzata da una chiave impacchettata. Riscrivere
lo stesso cubetto sovrascrive il colore: è così che si dipingono macchie, muso e
travi sopra a un volume già riempito.

**Perché si omettono le facce interne.** Una baita piena ha 1080 cubetti; senza
culling sarebbero 6480 facce (12960 triangoli) per **una** baita. Generando una
faccia solo quando la cella adiacente in quella direzione è vuota, restano solo
le facce del guscio esterno: circa 900 facce, un fattore 7 in meno. È la singola
ottimizzazione che rende sostenibile il budget di 150k triangoli con decine di
istanze a schermo. Il costo è O(1) per faccia: un lookup in un `Set` di interi.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/render/models.test.ts`

```ts
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { MODELS, PALETTE, buildGeometry, type VoxelModel } from './models';

function solidCube(size: number, colorIndex = 0): VoxelModel {
  const voxels: number[][] = [];
  for (let x = 0; x < size; x += 1) {
    for (let y = 0; y < size; y += 1) {
      for (let z = 0; z < size; z += 1) voxels.push([x, y, z, colorIndex]);
    }
  }
  return { voxels, palette: PALETTE };
}

function faceCount(geometry: THREE.BufferGeometry): number {
  const index = geometry.getIndex();
  expect(index).not.toBeNull();
  return (index?.count ?? 0) / 6;
}

describe('buildGeometry — omissione delle facce interne', () => {
  it('un cubo pieno 2x2x2 genera esattamente 24 facce esterne e nessuna interna', () => {
    const geometry = buildGeometry(solidCube(2), 1);
    // 8 cubetti x 3 facce esposte ciascuno = 24 facce (senza culling sarebbero 48).
    expect(faceCount(geometry)).toBe(24);
    expect(geometry.getAttribute('position').count).toBe(24 * 4);
    expect(geometry.getIndex()?.count).toBe(24 * 6);
  });

  it('un cubo pieno 3x3x3 espone solo la superficie: 54 facce, il cubetto centrale sparisce', () => {
    const geometry = buildGeometry(solidCube(3), 1);
    expect(faceCount(geometry)).toBe(6 * 9);
  });

  it('un singolo cubetto isolato ha tutte e 6 le facce', () => {
    const geometry = buildGeometry({ voxels: [[0, 0, 0, 0]], palette: PALETTE }, 1);
    expect(faceCount(geometry)).toBe(6);
  });
});

describe('buildGeometry — forma degli attributi', () => {
  it('ogni modello ha 4 vertici per faccia e 6 indici per faccia', () => {
    for (const model of Object.values(MODELS)) {
      const geometry = buildGeometry(model, CONFIG.render.voxelSize);
      const faces = faceCount(geometry);
      expect(faces).toBeGreaterThan(0);
      expect(geometry.getAttribute('position').count).toBe(faces * 4);
      expect(geometry.getAttribute('normal').count).toBe(faces * 4);
      expect(geometry.getAttribute('color').count).toBe(faces * 4);
      expect(geometry.getIndex()?.count).toBe(faces * 6);
    }
  });

  it('nessun modello sfora il budget di triangoli per istanza', () => {
    for (const model of Object.values(MODELS)) {
      const geometry = buildGeometry(model, CONFIG.render.voxelSize);
      expect(faceCount(geometry) * 2).toBeLessThan(4000);
    }
  });
});

describe('buildGeometry — centratura', () => {
  it('ogni modello è centrato su X e Z e appoggiato a y = 0', () => {
    for (const model of Object.values(MODELS)) {
      const geometry = buildGeometry(model, CONFIG.render.voxelSize);
      const box = geometry.boundingBox;
      expect(box).not.toBeNull();
      if (box === null) continue;
      expect(box.min.x).toBeCloseTo(-box.max.x, 6);
      expect(box.min.z).toBeCloseTo(-box.max.z, 6);
      expect(box.min.y).toBeCloseTo(0, 6);
      expect(box.max.y).toBeGreaterThan(0);
    }
  });

  it('la scala è quella di voxelSize', () => {
    const geometry = buildGeometry(solidCube(4), 0.25);
    const box = geometry.boundingBox;
    expect(box?.max.y).toBeCloseTo(1, 6);
    expect((box?.max.x ?? 0) - (box?.min.x ?? 0)).toBeCloseTo(1, 6);
  });
});

describe('MODELS', () => {
  it('la mucca sta dentro una corsia e ha la profondità di un animale', () => {
    const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
    const box = geometry.boundingBox;
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    const depth = (box?.max.z ?? 0) - (box?.min.z ?? 0);
    expect(width).toBeLessThanOrEqual(CONFIG.world.laneWidth);
    expect(depth).toBeGreaterThan(width);
  });

  it('la baita occupa due corsie senza sforarle', () => {
    const geometry = buildGeometry(MODELS.cabin, CONFIG.render.voxelSize);
    const box = geometry.boundingBox;
    const width = (box?.max.x ?? 0) - (box?.min.x ?? 0);
    expect(width).toBeGreaterThan(CONFIG.world.laneWidth);
    expect(width).toBeLessThanOrEqual(CONFIG.world.laneWidth * 2);
  });

  it('espone un modello per ogni kind usato dal gioco', () => {
    const kinds = [
      'cow', 'rock', 'tree', 'fence', 'cabin', 'crevasse', 'branch', 'snowflake', 'hay',
    ] as const;
    for (const kind of kinds) {
      expect(MODELS[kind].voxels.length).toBeGreaterThan(0);
    }
  });
});

describe('palette', () => {
  it('i colori nei vertici corrispondono alla palette del modello', () => {
    const pinkIndex = 2;
    const geometry = buildGeometry({ voxels: [[0, 0, 0, pinkIndex]], palette: PALETTE }, 1);
    const expected = new THREE.Color().setHex(PALETTE[pinkIndex] ?? 0, THREE.SRGBColorSpace);
    const colors = geometry.getAttribute('color');
    expect(colors.count).toBe(24);
    for (let i = 0; i < colors.count; i += 1) {
      expect(colors.getX(i)).toBeCloseTo(expected.r, 6);
      expect(colors.getY(i)).toBeCloseTo(expected.g, 6);
      expect(colors.getZ(i)).toBeCloseTo(expected.b, 6);
    }
  });

  it('ogni indice colore usato dai modelli esiste nella palette', () => {
    for (const model of Object.values(MODELS)) {
      for (const voxel of model.voxels) {
        const index = voxel[3] ?? -1;
        expect(model.palette[index]).toBeTypeOf('number');
      }
    }
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/models.test.ts`
Atteso: FAIL con `Failed to resolve import "./models"`.

- [ ] **Step 3: Implementa `src/render/models.ts`**

```ts
import * as THREE from 'three';
import type { ObstacleKind, PickupKind } from '../game/types';

export interface VoxelModel {
  /** [x, y, z, colorIndex] per cubetto */
  voxels: readonly number[][];
  palette: readonly number[];
}

/** Palette condivisa da tutti i modelli: 13 colori, alta montagna. */
export const PALETTE: readonly number[] = [
  0xffffff, //  0 neve / pelo bianco
  0x1c1c22, //  1 nero
  0xff9ec4, //  2 rosa del muso
  0xf2d6a2, //  3 corno / legno chiaro
  0x8d8f96, //  4 roccia
  0x6b6d74, //  5 roccia scura
  0x5a3a24, //  6 legno
  0x2f7a46, //  7 abete
  0x1f5c34, //  8 abete scuro
  0xb43a3a, //  9 tetto della baita
  0xe0c060, // 10 fieno
  0x123048, // 11 buio del crepaccio
  0x9fd8ff, // 12 ghiaccio
];

const SNOW = 0;
const BLACK = 1;
const PINK = 2;
const LIGHT_WOOD = 3;
const ROCK = 4;
const ROCK_DARK = 5;
const WOOD = 6;
const PINE = 7;
const PINE_DARK = 8;
const ROOF = 9;
const HAY = 10;
const VOID = 11;
const ICE = 12;

/**
 * Griglia logica in cui vivono i modelli: 64³ celle centrate sull'origine.
 * La chiave impacchettata evita di allocare stringhe per ogni cubetto.
 */
const GRID = 64;
const GRID_ORIGIN = 32;

function packKey(x: number, y: number, z: number): number {
  return ((x + GRID_ORIGIN) * GRID + (y + GRID_ORIGIN)) * GRID + (z + GRID_ORIGIN);
}

interface VoxelBuilder {
  set(x: number, y: number, z: number, color: number): void;
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: number): void;
  build(): VoxelModel;
}

function createBuilder(): VoxelBuilder {
  const cells = new Map<number, number>();

  const set = (x: number, y: number, z: number, color: number): void => {
    cells.set(packKey(x, y, z), color);
  };

  const box = (
    x: number, y: number, z: number,
    w: number, h: number, d: number,
    color: number,
  ): void => {
    for (let i = 0; i < w; i += 1) {
      for (let j = 0; j < h; j += 1) {
        for (let k = 0; k < d; k += 1) set(x + i, y + j, z + k, color);
      }
    }
  };

  const build = (): VoxelModel => {
    const voxels: number[][] = [];
    for (const [key, color] of cells) {
      const z = (key % GRID) - GRID_ORIGIN;
      const y = (Math.floor(key / GRID) % GRID) - GRID_ORIGIN;
      const x = Math.floor(key / (GRID * GRID)) - GRID_ORIGIN;
      voxels.push([x, y, z, color]);
    }
    return { voxels, palette: PALETTE };
  };

  return { set, box, build };
}

/** Mucca: 8 largo × 7 alto × 11 profondo. Il muso guarda verso +z. */
function buildCow(): VoxelModel {
  const b = createBuilder();
  // corpo
  b.box(0, 2, 0, 8, 3, 8, SNOW);
  // macchie nere, dipinte sopra al corpo già riempito
  b.box(1, 2, 1, 2, 2, 2, BLACK);
  b.box(5, 3, 4, 2, 2, 2, BLACK);
  b.box(3, 4, 1, 2, 1, 2, BLACK);
  b.box(0, 2, 5, 1, 2, 2, BLACK);
  b.box(7, 2, 2, 1, 2, 2, BLACK);
  // testa e muso
  b.box(2, 3, 8, 4, 3, 2, SNOW);
  b.box(2, 3, 9, 4, 1, 1, PINK);
  b.set(2, 5, 9, BLACK);
  b.set(5, 5, 9, BLACK);
  // orecchie e corna
  b.set(1, 4, 8, BLACK);
  b.set(6, 4, 8, BLACK);
  b.set(2, 6, 8, LIGHT_WOOD);
  b.set(5, 6, 8, LIGHT_WOOD);
  // quattro zampe
  b.box(0, 0, 1, 2, 2, 2, BLACK);
  b.box(6, 0, 1, 2, 2, 2, BLACK);
  b.box(0, 0, 5, 2, 2, 2, BLACK);
  b.box(6, 0, 5, 2, 2, 2, BLACK);
  // coda
  b.set(3, 4, -1, BLACK);
  b.set(3, 5, -1, BLACK);
  return b.build();
}

/** Masso: ellissoide riempito per scansione, con venature più scure. */
function buildRock(): VoxelModel {
  const b = createBuilder();
  const rx = 3;
  const ry = 2;
  const rz = 3;
  for (let x = -rx; x <= rx; x += 1) {
    for (let y = 0; y <= ry * 2; y += 1) {
      for (let z = -rz; z <= rz; z += 1) {
        const dx = x / (rx + 0.5);
        const dy = (y - ry) / (ry + 1.2);
        const dz = z / (rz + 0.5);
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        b.set(x, y, z, (x + y + z) % 3 === 0 ? ROCK_DARK : ROCK);
      }
    }
  }
  return b.build();
}

/** Abete: tronco 3×3 e quattro palchi di chioma a rombo, punta innevata. */
function buildTree(): VoxelModel {
  const b = createBuilder();
  b.box(-1, 0, -1, 3, 5, 3, WOOD);
  for (let layer = 0; layer < 4; layer += 1) {
    const radius = 3 - layer;
    const baseY = 4 + layer * 2;
    const color = layer % 2 === 0 ? PINE : PINE_DARK;
    for (let y = baseY; y < baseY + 2; y += 1) {
      const r = y === baseY ? radius : Math.max(0, radius - 1);
      for (let x = -r; x <= r; x += 1) {
        for (let z = -r; z <= r; z += 1) {
          if (Math.abs(x) + Math.abs(z) > r + 1) continue;
          b.set(x, y, z, color);
        }
      }
    }
  }
  b.set(0, 12, 0, SNOW);
  return b.build();
}

/** Staccionata: due pali, due traverse e una diagonale. */
function buildFence(): VoxelModel {
  const b = createBuilder();
  b.box(-3, 0, 0, 1, 5, 2, WOOD);
  b.box(3, 0, 0, 1, 5, 2, WOOD);
  b.box(-3, 2, 0, 7, 1, 2, LIGHT_WOOD);
  b.box(-3, 4, 0, 7, 1, 2, LIGHT_WOOD);
  for (let i = 0; i < 5; i += 1) b.set(-2 + i, i, 0, LIGHT_WOOD);
  b.box(-3, 0, 0, 1, 1, 2, SNOW);
  b.box(3, 0, 0, 1, 1, 2, SNOW);
  return b.build();
}

/**
 * Baita: 15 largo (3.75 unità, dentro le due corsie), volume PIENO.
 * Pieno e non cavo di proposito: il culling delle facce interne elimina tutto
 * ciò che non si vede, mentre una scatola cava esporrebbe anche le pareti
 * interne raddoppiando i triangoli senza che nessuno le veda mai.
 */
function buildCabin(): VoxelModel {
  const b = createBuilder();
  const halfWidth = 7;
  const depth = 9;
  const wallHeight = 8;
  b.box(-halfWidth, 0, 0, halfWidth * 2 + 1, wallHeight, depth, WOOD);
  // travi chiare sul guscio, ogni tre file
  for (let y = 1; y < wallHeight; y += 3) {
    for (let x = -halfWidth; x <= halfWidth; x += 1) {
      b.set(x, y, 0, LIGHT_WOOD);
      b.set(x, y, depth - 1, LIGHT_WOOD);
    }
    for (let z = 0; z < depth; z += 1) {
      b.set(-halfWidth, y, z, LIGHT_WOOD);
      b.set(halfWidth, y, z, LIGHT_WOOD);
    }
  }
  // tetto a due falde, che rientra di due celle per ogni palco
  for (let layer = 0; ; layer += 1) {
    const x0 = -halfWidth + layer * 2;
    const x1 = halfWidth - layer * 2;
    if (x0 > x1) break;
    b.box(x0, wallHeight + layer, -1, x1 - x0 + 1, 1, depth + 2, ROOF);
  }
  // porta sulla facciata rivolta al giocatore
  b.box(-1, 0, depth - 1, 3, 5, 1, VOID);
  return b.build();
}

/** Crepaccio: lastra scura di una cella con il bordo di ghiaccio. */
function buildCrevasse(): VoxelModel {
  const b = createBuilder();
  for (let x = -3; x <= 3; x += 1) {
    for (let z = -3; z <= 3; z += 1) {
      const rim = Math.abs(x) === 3 || Math.abs(z) === 3;
      b.set(x, 0, z, rim ? ICE : VOID);
    }
  }
  return b.build();
}

/** Ramo sospeso: sbarra orizzontale con tre ciuffi di aghi. */
function buildBranch(): VoxelModel {
  const b = createBuilder();
  b.box(-4, 0, 0, 9, 2, 2, WOOD);
  b.set(-3, 2, 0, PINE);
  b.set(-3, 2, 1, PINE);
  b.set(0, 2, 0, PINE_DARK);
  b.set(0, 2, 1, PINE_DARK);
  b.set(3, 2, 0, PINE);
  b.set(3, 2, 1, PINE);
  return b.build();
}

/** Fiocco di neve: croce 5×5 con un accenno di spessore. */
function buildSnowflake(): VoxelModel {
  const b = createBuilder();
  for (let i = -2; i <= 2; i += 1) {
    b.set(i, 2, 0, SNOW);
    b.set(0, 2 + i, 0, SNOW);
  }
  b.set(0, 2, 1, ICE);
  b.set(0, 2, -1, ICE);
  b.set(1, 3, 0, ICE);
  b.set(-1, 3, 0, ICE);
  b.set(1, 1, 0, ICE);
  b.set(-1, 1, 0, ICE);
  return b.build();
}

/** Balla di fieno: cilindro con asse X, legature più chiare. */
function buildHay(): VoxelModel {
  const b = createBuilder();
  const r = 3;
  for (let x = -r; x <= r; x += 1) {
    for (let y = 0; y <= r * 2; y += 1) {
      for (let z = -r; z <= r; z += 1) {
        const dy = (y - r) / (r + 0.5);
        const dz = z / (r + 0.5);
        if (dy * dy + dz * dz > 1) continue;
        b.set(x, y, z, (y + z) % 4 === 0 ? LIGHT_WOOD : HAY);
      }
    }
  }
  return b.build();
}

/**
 * `cow` è una voce sola: la mucca del giocatore e il raccoglibile "altra mucca"
 * condividono il modello, il raccoglibile viene solo disegnato in scala ridotta
 * da entities-view.ts.
 */
export const MODELS: Record<'cow' | ObstacleKind | PickupKind, VoxelModel> = {
  cow: buildCow(),
  rock: buildRock(),
  tree: buildTree(),
  fence: buildFence(),
  cabin: buildCabin(),
  crevasse: buildCrevasse(),
  branch: buildBranch(),
  snowflake: buildSnowflake(),
  hay: buildHay(),
};

/**
 * Le sei facce del cubo unitario, con l'ordine dei vertici antiorario visto
 * da fuori: è ciò che rende corretti il backface culling e le normali.
 */
const FACES: readonly {
  nx: number;
  ny: number;
  nz: number;
  corners: readonly (readonly [number, number, number])[];
}[] = [
  { nx: 1, ny: 0, nz: 0, corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { nx: -1, ny: 0, nz: 0, corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { nx: 0, ny: 1, nz: 0, corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { nx: 0, ny: -1, nz: 0, corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { nx: 0, ny: 0, nz: 1, corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { nx: 0, ny: 0, nz: -1, corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];

/**
 * "Cuoce" un modello in UNA sola BufferGeometry indicizzata con i colori nei
 * vertici: un albero intero costa una draw call. Le facce con un cubetto
 * adiacente vengono omesse, e la geometria esce centrata su X e Z e appoggiata
 * a y = 0, così una entità si posiziona semplicemente con la sua (x, y, z).
 */
export function buildGeometry(model: VoxelModel, voxelSize: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  if (model.voxels.length === 0) return geometry;

  const occupied = new Set<number>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const voxel of model.voxels) {
    const x = voxel[0] ?? 0;
    const y = voxel[1] ?? 0;
    const z = voxel[2] ?? 0;
    occupied.add(packKey(x, y, z));
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // Un cubetto in posizione x occupa l'intervallo [x, x+1): da qui il +1.
  const offsetX = -(minX + maxX + 1) / 2;
  const offsetY = -minY;
  const offsetZ = -(minZ + maxZ + 1) / 2;

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new THREE.Color();
  let vertexCount = 0;

  for (const voxel of model.voxels) {
    const x = voxel[0] ?? 0;
    const y = voxel[1] ?? 0;
    const z = voxel[2] ?? 0;
    color.setHex(model.palette[voxel[3] ?? 0] ?? 0xff00ff, THREE.SRGBColorSpace);

    for (const face of FACES) {
      // faccia interna: c'è un cubetto attaccato, nessuno la vedrà mai
      if (occupied.has(packKey(x + face.nx, y + face.ny, z + face.nz))) continue;
      for (const corner of face.corners) {
        positions.push(
          (x + corner[0] + offsetX) * voxelSize,
          (y + corner[1] + offsetY) * voxelSize,
          (z + corner[2] + offsetZ) * voxelSize,
        );
        normals.push(face.nx, face.ny, face.nz);
        colors.push(color.r, color.g, color.b);
      }
      indices.push(
        vertexCount, vertexCount + 1, vertexCount + 2,
        vertexCount, vertexCount + 2, vertexCount + 3,
      );
      vertexCount += 4;
    }
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS, tutti i test del progetto compresi i 12 di `camera-rig` e i 12 di `models`.

- [ ] **Step 5: Verifica visiva (blocco temporaneo in `src/main.ts`)**

Aggiungi in `src/main.ts` l'import e il blocco marcato, dentro `main()` subito
dopo la creazione di `view` e sostituendo il corpo di `update`:

```ts
import * as THREE from 'three';
import { MODELS, buildGeometry } from './render/models';
import { CONFIG } from './game/config';

  // --- VERIFICA VISIVA TASK 15: rimosso dal task 16 ---
  const previewGeometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
  const previewMesh = new THREE.Mesh(
    previewGeometry,
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  previewMesh.position.set(0, 0, 4);
  view.scene.add(previewMesh);
  // --- fine blocco temporaneo ---

  const loop = createLoop({
    update(dt: number): void {
      previewMesh.rotation.y += dt * 0.8;
      view.update(dt, 1, false);
    },
    render(): void {
      view.render();
    },
  });
```

Comando: `npm run dev`

Cosa DEVI vedere: una mucca voxel di circa due unità di larghezza che gira lenta
su sé stessa davanti al cielo a gradiente; girando si riconoscono corpo bianco
con macchie nere, testa con muso rosa, due occhi neri, orecchie e cornetti
chiari, quattro zampe nere e la codina dietro. I cubetti hanno spigoli netti e
ombreggiatura diversa fra facce rivolte in alto e di lato.

Cosa NON devi vedere: buchi o facce mancanti mentre la mucca ruota (sarebbe
winding sbagliato), triangoli neri sfarfallanti dentro al corpo (sarebbero
facce interne non omesse), una mucca appesa a mezz'aria o sprofondata (la base
deve poggiare esattamente sul livello y = 0, che qui coincide con l'orizzonte
del cielo), colori slavati o fluo (sarebbe la conversione di color space).

- [ ] **Step 6: Commit**

```bash
git add src/render/models.ts src/render/models.test.ts src/main.ts
git commit -m "feat(render): add procedural voxel models baked into merged geometry"
```

---

### Task 16: Terreno che scorre, entità istanziate e la mucca che rotola

**Files:**
- Create: `src/render/instancing.ts`
- Test: `src/render/instancing.test.ts`
- Create: `src/render/terrain.ts`
- Create: `src/render/entities-view.ts`
- Create: `src/render/player-view.ts`
- Modify: `src/main.ts` (riscritto per intero: il blocco temporaneo del task 15 sparisce)

**Interfaces:**
- Consumes: `WorldState`, `Chunk` da `src/game/world.ts`; `Entity`, `EntityKind` da `src/game/types.ts`; `PlayerState` da `src/game/player.ts`; `entityCenterX(lane: number, width: number): number` da `src/game/lanes.ts`; `createGame(seed: number, bus: EventBus): GameState`, `startRun(game: GameState, seed?: number): void`, `updateGame(game: GameState, dt: number): void`; `createEventBus(): EventBus`; `MODELS`, `buildGeometry`; `worldToViewX`.
- Produces:
  - `instanceCountFor(entities: Entity[], kind: EntityKind, max: number): number`
  - `const MAX_INSTANCES_PER_KIND: number`
  - `createTerrain(): TerrainView` con `TerrainView { sync(world: WorldState): void; group: THREE.Group }`
  - `createEntitiesView(): EntitiesView` con `EntitiesView { sync(entities: Entity[]): void; group: THREE.Group }`
  - `createPlayerView(): PlayerView` con `PlayerView { sync(player: PlayerState, size: number, speed: number, dt: number): void; group: THREE.Group }`

**Nota sul budget.** Dopo questo task la scena disegna: 1 sfondo + 6 mesh di
terreno + 9 `InstancedMesh` di entità (di cui in pratica solo 4-6 con `count > 0`)
+ 1 mucca = **al massimo 17 draw call**. Triangoli: terreno ~620 per chunk × 6 =
3,7k; entità ~40 vive a schermo × ~700 triangoli medi = ~28k; mucca ~1,4k. Totale
sotto i 35k, ampiamente dentro i 150k dello spec, con il resto del budget
riservato al pool di voxel del task 17.

**Nota sul tetto di istanze.** Con `chunkCount = 6`, `chunkLength = 40` e
`despawnBehindZ = -20` la fascia visibile è di 260 unità, cioè 26 righe a
`rowSpacing = 10`; ogni riga produce al massimo 3 entità, quindi il massimo
teorico è ~78 entità **su tutti i tipi insieme**. `MAX_INSTANCES_PER_KIND = 32`
per singolo tipo è quindi generoso e non si raggiunge mai in gioco. Le entità
oltre il tetto **vengono semplicemente ignorate**: essendo `entities` in ordine
di generazione, le scartate sono le più lontane, quelle già nascoste dalla
nebbia a 120 unità.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/render/instancing.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import type { Entity, EntityKind, Lane } from '../game/types';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';

let nextId = 1;

function entity(kind: EntityKind, alive = true, lane: Lane = 1): Entity {
  return {
    id: nextId++,
    kind,
    category: kind === 'snowflake' || kind === 'hay' || kind === 'cow' ? 'pickup' : 'obstacle',
    lane,
    width: kind === 'cabin' ? 2 : 1,
    z: 10,
    y: 0,
    alive,
  };
}

describe('instanceCountFor', () => {
  it('conta solo le entità vive del tipo richiesto', () => {
    const entities = [
      entity('rock'),
      entity('tree'),
      entity('rock'),
      entity('rock', false),
      entity('hay'),
    ];
    expect(instanceCountFor(entities, 'rock', 32)).toBe(2);
    expect(instanceCountFor(entities, 'tree', 32)).toBe(1);
    expect(instanceCountFor(entities, 'hay', 32)).toBe(1);
    expect(instanceCountFor(entities, 'cabin', 32)).toBe(0);
  });

  it('su un elenco vuoto restituisce 0', () => {
    expect(instanceCountFor([], 'rock', 32)).toBe(0);
  });

  it('non supera mai il tetto, anche con molte più entità', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 500; i += 1) entities.push(entity('tree'));
    expect(instanceCountFor(entities, 'tree', 32)).toBe(32);
    expect(instanceCountFor(entities, 'tree', 1)).toBe(1);
    expect(instanceCountFor(entities, 'tree', 0)).toBe(0);
  });

  it('conta esattamente il tetto quando le entità vive sono altrettante', () => {
    const entities: Entity[] = [];
    for (let i = 0; i < 32; i += 1) entities.push(entity('rock'));
    expect(instanceCountFor(entities, 'rock', 32)).toBe(32);
  });

  it('il tetto di default è positivo e ragionevole', () => {
    expect(MAX_INSTANCES_PER_KIND).toBeGreaterThanOrEqual(16);
    expect(MAX_INSTANCES_PER_KIND).toBeLessThanOrEqual(128);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/instancing.test.ts`
Atteso: FAIL con `Failed to resolve import "./instancing"`.

- [ ] **Step 3: Implementa `src/render/instancing.ts`**

```ts
import type { Entity, EntityKind } from '../game/types';

/**
 * Quante istanze può contenere l'InstancedMesh di un singolo tipo di entità.
 * Vedi la nota sul tetto: il massimo teorico su TUTTI i tipi insieme è ~78.
 */
export const MAX_INSTANCES_PER_KIND = 32;

/**
 * Quante istanze di `kind` vanno disegnate: entità vive di quel tipo, non oltre
 * `max`. Le eccedenti vengono ignorate dalla vista, non muoiono nel gioco.
 */
export function instanceCountFor(entities: Entity[], kind: EntityKind, max: number): number {
  if (max <= 0) return 0;
  let count = 0;
  for (const entity of entities) {
    if (!entity.alive || entity.kind !== kind) continue;
    count += 1;
    if (count >= max) return max;
  }
  return count;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/render/instancing.test.ts`
Atteso: PASS, 5 test.

- [ ] **Step 5: Implementa `src/render/terrain.ts`**

Una sola geometria condivisa da tutte e sei le mesh: il rilievo è periodico su
`chunkLength`, così il bordo di un chunk combacia con quello del successivo e
non si vede nessuna cucitura. Il corridoio delle tre corsie resta perfettamente
piatto a `y = 0`, altrimenti le entità appoggiate a `y = 0` galleggerebbero.
Nessuna mesh viene creata durante il gioco: `sync` sposta solo delle `z`.

```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CONFIG } from '../game/config';
import type { WorldState } from '../game/world';

export interface TerrainView {
  sync(world: WorldState): void;
  group: THREE.Group;
}

const SNOW_COLOR = 0xf4fbff;
const BANK_HEIGHT = 3.2;
const BANK_WIDTH = 3;
const BANK_TILT = 0.3;
const SEGMENTS_X = 12;
const SEGMENTS_Z = 24;
/** Semilarghezza del corridoio percorribile: 3 unità con la config di default. */
const CORRIDOR_HALF = (CONFIG.world.laneCount * CONFIG.world.laneWidth) / 2;
const GROUND_WIDTH = CONFIG.world.laneCount * CONFIG.world.laneWidth + 4;

function displaceGround(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const length = CONFIG.world.chunkLength;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const lateral = Math.abs(x) / CORRIDOR_HALF;
    const outside = Math.max(0, lateral - 1);
    // Periodica su chunkLength: a z = 0 e a z = chunkLength il seno vale 0,
    // quindi i bordi di due chunk adiacenti combaciano esattamente.
    const wave =
      Math.sin((z / length) * Math.PI * 2) * 0.18 +
      Math.sin((z / length) * Math.PI * 6 + x * 0.6) * 0.09;
    position.setY(i, wave * outside * 3 + outside * outside * 2.2);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

function createChunkGeometry(): THREE.BufferGeometry {
  const length = CONFIG.world.chunkLength;

  const ground = new THREE.PlaneGeometry(GROUND_WIDTH, length, SEGMENTS_X, SEGMENTS_Z);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, length / 2);
  displaceGround(ground);

  const leftBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  leftBank.rotateZ(BANK_TILT);
  leftBank.translate(-(GROUND_WIDTH / 2 + 0.9), BANK_HEIGHT * 0.35 - 0.5, length / 2);

  const rightBank = new THREE.BoxGeometry(BANK_WIDTH, BANK_HEIGHT, length, 1, 1, 2);
  rightBank.rotateZ(-BANK_TILT);
  rightBank.translate(GROUND_WIDTH / 2 + 0.9, BANK_HEIGHT * 0.35 - 0.5, length / 2);

  const merged = mergeGeometries([ground, leftBank, rightBank], false);
  if (merged === null) {
    throw new Error('Impossibile unire le geometrie del chunk di terreno');
  }
  ground.dispose();
  leftBank.dispose();
  rightBank.dispose();
  merged.computeBoundingSphere();
  return merged;
}

export function createTerrain(): TerrainView {
  const geometry = createChunkGeometry();
  const material = new THREE.MeshLambertMaterial({ color: SNOW_COLOR });
  const group = new THREE.Group();
  const meshes: THREE.Mesh[] = [];

  for (let i = 0; i < CONFIG.world.chunkCount; i += 1) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.position.z = i * CONFIG.world.chunkLength;
    meshes.push(mesh);
    group.add(mesh);
  }

  function sync(world: WorldState): void {
    for (let i = 0; i < meshes.length; i += 1) {
      const mesh = meshes[i];
      const chunk = world.chunks[i];
      if (mesh === undefined || chunk === undefined) continue;
      mesh.position.z = chunk.z;
    }
  }

  return { sync, group };
}
```

- [ ] **Step 6: Implementa `src/render/entities-view.ts`**

```ts
import * as THREE from 'three';
import { CONFIG } from '../game/config';
import { entityCenterX } from '../game/lanes';
import type { Entity, EntityKind } from '../game/types';
import { worldToViewX } from './camera-rig';
import { MAX_INSTANCES_PER_KIND, instanceCountFor } from './instancing';
import { MODELS, buildGeometry } from './models';

export interface EntitiesView {
  sync(entities: Entity[]): void;
  group: THREE.Group;
}

const ENTITY_KINDS: readonly EntityKind[] = [
  'rock', 'tree', 'fence', 'cabin', 'crevasse', 'branch', 'snowflake', 'hay', 'cow',
];

/** Quante corsie è largo il MODELLO di ogni tipo (la baita è disegnata a due). */
const MODEL_LANES: Record<EntityKind, 1 | 2> = {
  rock: 1, tree: 1, fence: 1, cabin: 2, crevasse: 1, branch: 1,
  snowflake: 1, hay: 1, cow: 1,
};

/** La mucca-raccoglibile è la stessa della giocante, disegnata più piccola. */
const PICKUP_COW_SCALE = 0.55;
/** Il crepaccio è complanare alla neve: un pelo sopra per non sfarfallare. */
const CREVASSE_Y_BIAS = 0.02;
/** Tipi che proiettano ombra: le lastre piatte non ne hanno bisogno. */
const CASTS_SHADOW: Record<EntityKind, boolean> = {
  rock: true, tree: true, fence: true, cabin: true, crevasse: false, branch: true,
  snowflake: false, hay: true, cow: true,
};

function nowSeconds(): number {
  return (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
}

export function createEntitiesView(): EntitiesView {
  const group = new THREE.Group();
  // Un solo materiale per tutte le entità: i colori arrivano dai vertici,
  // quindi non c'è alcun motivo di cambiare stato fra un tipo e l'altro.
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const meshes = new Map<EntityKind, THREE.InstancedMesh>();
  const dummy = new THREE.Object3D();

  for (const kind of ENTITY_KINDS) {
    const geometry = buildGeometry(MODELS[kind], CONFIG.render.voxelSize);
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES_PER_KIND);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Il bounding volume di un InstancedMesh non segue le istanze: senza
    // questo, gli ostacoli sparirebbero appena la geometria base esce dal frustum.
    mesh.frustumCulled = false;
    mesh.castShadow = CASTS_SHADOW[kind];
    mesh.receiveShadow = false;
    mesh.count = 0;
    meshes.set(kind, mesh);
    group.add(mesh);
  }

  function sync(entities: Entity[]): void {
    const time = nowSeconds();

    for (const kind of ENTITY_KINDS) {
      const mesh = meshes.get(kind);
      if (mesh === undefined) continue;

      const count = instanceCountFor(entities, kind, MAX_INSTANCES_PER_KIND);
      let index = 0;

      for (const entity of entities) {
        if (index >= count) break;
        if (!entity.alive || entity.kind !== kind) continue;

        const baseScale = entity.width / MODEL_LANES[kind];
        const scale = kind === 'cow' ? baseScale * PICKUP_COW_SCALE : baseScale;
        const yBias = kind === 'crevasse' ? CREVASSE_Y_BIAS : 0;

        let yaw = 0;
        if (entity.category === 'pickup') yaw = time * 2.2;
        else if (kind === 'rock' || kind === 'tree') yaw = (entity.id % 4) * (Math.PI / 2);

        dummy.position.set(
          worldToViewX(entityCenterX(entity.lane, entity.width)),
          entity.y + yBias,
          entity.z,
        );
        dummy.rotation.set(0, yaw, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        index += 1;
      }

      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  return { sync, group };
}
```

- [ ] **Step 7: Implementa `src/render/player-view.ts`**

La mucca ROTOLA: la mesh sta dentro un perno posto al centro geometrico
dell'animale, così la rotazione non la fa oscillare come un pendolo. L'angolo
avanza per rotolamento puro, `dθ = v·dt / raggio`, quindi la velocità della
rotazione segue da sé quella del mondo. Il segno è negativo perché con la camera
a `z` negativo che guarda verso `+z` un corpo che avanza in `+z` ruota nel verso
negativo dell'asse X.

```ts
import * as THREE from 'three';
import { CONFIG } from '../game/config';
import type { PlayerState } from '../game/player';
import { worldToViewX } from './camera-rig';
import { MODELS, buildGeometry } from './models';

export interface PlayerView {
  sync(player: PlayerState, size: number, speed: number, dt: number): void;
  group: THREE.Group;
}

/**
 * Crescita visiva per taglia. È una costante di resa, non di bilanciamento:
 * l'hitbox reale cresce secondo CONFIG.player.halfWidthPerSize e heightPerSize.
 */
const PLAYER_SCALE_PER_SIZE = 0.18;

export function createPlayerView(): PlayerView {
  const geometry = buildGeometry(MODELS.cow, CONFIG.render.voxelSize);
  const box = geometry.boundingBox;
  const halfHeight = box === null ? 0.5 : (box.max.y - box.min.y) / 2;

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  // Il modello poggia a y = 0: abbassandolo di mezza altezza, il centro
  // geometrico finisce esattamente sull'origine del perno.
  mesh.position.y = -halfHeight;

  const pivot = new THREE.Group();
  pivot.add(mesh);
  const group = new THREE.Group();
  group.add(pivot);

  let roll = 0;

  function sync(player: PlayerState, size: number, speed: number, dt: number): void {
    const scale = 1 + (size - 1) * PLAYER_SCALE_PER_SIZE;
    pivot.scale.setScalar(scale);

    const radius = Math.max(halfHeight * scale, 0.001);
    roll = (roll - (speed * dt) / radius) % (Math.PI * 2);
    pivot.rotation.x = roll;

    group.position.set(worldToViewX(player.x), player.y + radius, 0);
  }

  return { sync, group };
}
```

- [ ] **Step 8: Riscrivi `src/main.ts`**

```ts
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { createGame, startRun, updateGame } from './game/game';
import { createEntitiesView } from './render/entities-view';
import { createPlayerView } from './render/player-view';
import { createScene, type SceneContext } from './render/scene';
import { createTerrain } from './render/terrain';

function ensureCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>('canvas#game');
  const canvas = existing ?? document.createElement('canvas');
  canvas.id = 'game';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  if (existing === null) document.body.appendChild(canvas);
  return canvas;
}

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font:16px/1.5 system-ui,sans-serif;color:#123;background:#e8f4ff;text-align:center;padding:24px;';
  box.textContent = message;
  document.body.appendChild(box);
}

function main(): void {
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#e8f4ff';
  const canvas = ensureCanvas();

  let view: SceneContext;
  try {
    view = createScene(canvas);
  } catch {
    showFatal('WebGL non è disponibile su questo browser: Rolling Cows non può partire.');
    return;
  }

  const terrain = createTerrain();
  const entitiesView = createEntitiesView();
  const playerView = createPlayerView();
  view.scene.add(terrain.group);
  view.scene.add(entitiesView.group);
  view.scene.add(playerView.group);

  const bus = createEventBus();
  const game = createGame(1234, bus);
  startRun(game);

  const loop = createLoop({
    update(dt: number): void {
      updateGame(game, dt);
      // Riavvio automatico: serve solo a tenere viva la demo finché il task 19
      // non collega la macchina a stati e la schermata di game over.
      if (!game.alive) startRun(game);

      terrain.sync(game.world);
      entitiesView.sync(game.entities);
      playerView.sync(game.player, game.avalanche.size, game.world.speed, dt);
      view.update(dt, game.avalanche.size, game.avalanche.phase !== 'idle');
    },
    render(): void {
      view.render();
    },
  });

  window.addEventListener('resize', () => view.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop();
    else loop.start();
  });

  loop.start();
}

main();
```

- [ ] **Step 9: Esegui i test e verifica che passino**

Comandi: `npm run typecheck` (atteso: nessun errore) e `npm run test:run`
(atteso: PASS, nessuna regressione sui test dei task 1-15).

- [ ] **Step 10: Verifica visiva**

Comando: `npm run dev`

Cosa DEVI vedere:
- un pendio di neve che scorre verso di me in modo continuo, con i bordi laterali
  che si alzano a suggerire i fianchi della montagna;
- **nessuna cucitura e nessun buco** dove finisce un chunk e comincia il
  successivo: il rilievo attraversa il giunto senza scalini né lampi di cielo;
- ostacoli che emergono gradualmente dal bianco della nebbia invece di comparire
  di colpo, e scompaiono dietro la camera;
- la baita che occupa visibilmente due corsie su tre, il crepaccio come lastra
  scura appoggiata alla neve, il ramo sospeso sopra la testa della mucca;
- fiocchi, balle di fieno e mucchette che ruotano lentamente su sé stessi;
- la mucca ferma al centro dello schermo che **rotola** in avanti, sempre più
  veloce man mano che il mondo accelera, restando appoggiata alla neve;
- la camera che si allontana e allarga il campo quando la mucca cresce e quando
  parte la valanga (basta aspettare che la carica arrivi a 100).

Cosa NON devi vedere: ostacoli che spariscono all'improvviso restando in vista
(sarebbe il frustum culling degli `InstancedMesh`), la mucca che oscilla come un
pendolo invece di rotolare (perno sbagliato), la mucca che sprofonda o galleggia
sopra la neve mentre cresce, entità che sfarfallano contro il terreno, un
tremolio della mucca sulla corsia laterale opposta a quella attesa.

- [ ] **Step 11: Commit**

```bash
git add src/render/instancing.ts src/render/instancing.test.ts src/render/terrain.ts src/render/entities-view.ts src/render/player-view.ts src/main.ts
git commit -m "feat(render): add scrolling terrain, instanced entities and rolling cow"
```

---

### Task 17: Pool di voxel e detriti — la distruzione

**Files:**
- Create: `src/render/voxel-pool.ts`
- Test: `src/render/voxel-pool.test.ts`
- Create: `src/render/debris.ts`
- Test: `src/render/debris.test.ts`
- Modify: `src/main.ts` (collegamento al bus eventi)

**Interfaces:**
- Consumes: `VoxelModel`, `MODELS`, `PALETTE`; `CONFIG.render.voxelPoolSize`, `CONFIG.render.voxelSize`; `EventBus.on` con i payload di `'obstacle:hit'`, `'pickup:collected'`; `GameState`.
- Produces:
  - `createVoxelPool(capacity: number, voxelSize: number): VoxelPool` con `VoxelPool` esattamente come da contratto.
  - `burstFromModel(pool: VoxelPool, model: VoxelModel, x: number, y: number, z: number, power: number): void`
  - `avalancheTrail(pool: VoxelPool, dt: number, x: number, y: number, z: number, intensity: number): void`
  - `resetDebris(): void`

**Costanti locali.** Gravità, restituzione e attrito dei detriti stanno in
`voxel-pool.ts`, non in `config.ts`: `config.ts` è la superficie di bilanciamento
del gioco (e appartiene al task 4), mentre questi tre numeri decidono soltanto
quanto "gommosa" è un'esplosione. Se in futuro si vorranno esporre al tuning,
migreranno in `CONFIG.render` senza toccare altro.

**Perché il pool è UNO solo.** Tutti i cubetti liberi del gioco — detriti degli
ostacoli, disintegrazione della mucca, scia della valanga — vivono in un unico
`InstancedMesh` da `CONFIG.render.voxelPoolSize` istanze: **una sola draw call**
per tutta la distruzione. Nel caso pessimo (4000 cubetti attivi) sono 48k
triangoli, che sommati ai 35k del task 16 stanno dentro i 150k dello spec; in
pratica `mesh.count` segue lo slot attivo più alto, quindi il costo reale è molto
più basso. La free list restituisce gli slot bassi per primi proprio per tenere
`count` compatto.

- [ ] **Step 1: Scrivi il test che fallisce**

`src/render/voxel-pool.test.ts`

```ts
import * as THREE from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { createVoxelPool, type VoxelPool } from './voxel-pool';

const WHITE = 0xffffff;
const scratch = new THREE.Matrix4();

function slotY(pool: VoxelPool, slot: number): number {
  pool.mesh.getMatrixAt(slot, scratch);
  return scratch.elements[13] ?? 0;
}

function fill(pool: VoxelPool, life: number): number {
  let spawned = 0;
  while (pool.spawn(0, 1, 0, 0, 0, 0, WHITE, life)) spawned += 1;
  return spawned;
}

describe('createVoxelPool — free list', () => {
  let pool: VoxelPool;

  beforeEach(() => {
    pool = createVoxelPool(64, 0.25);
  });

  it('parte vuoto e con la capacità richiesta', () => {
    expect(pool.capacity).toBe(64);
    expect(pool.activeCount).toBe(0);
  });

  it('dopo 1000 cicli di spawn e morte activeCount torna esattamente a 0', () => {
    for (let cycle = 0; cycle < 1000; cycle += 1) {
      const spawned = fill(pool, 0.05);
      expect(spawned).toBe(64);
      expect(pool.activeCount).toBe(64);
      for (let step = 0; step < 10; step += 1) pool.update(1 / 60, 20);
      expect(pool.activeCount).toBe(0);
    }
    // nessuno slot perso: il pool si riempie ancora tutto
    expect(fill(pool, 1)).toBe(64);
  });

  it('spawn oltre la capacità restituisce false senza corrompere lo stato', () => {
    expect(fill(pool, 1)).toBe(64);
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 1)).toBe(false);
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 1)).toBe(false);
    expect(pool.activeCount).toBe(64);
    for (let step = 0; step < 200; step += 1) pool.update(1 / 60, 20);
    expect(pool.activeCount).toBe(0);
    expect(fill(pool, 1)).toBe(64);
  });

  it('ignora gli spawn con vita non positiva senza consumare slot', () => {
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, 0)).toBe(false);
    expect(pool.spawn(0, 1, 0, 0, 0, 0, WHITE, -1)).toBe(false);
    expect(pool.activeCount).toBe(0);
    expect(fill(pool, 1)).toBe(64);
  });

  it('reset libera tutto e rende di nuovo disponibili tutti gli slot', () => {
    fill(pool, 10);
    expect(pool.activeCount).toBe(64);
    pool.reset();
    expect(pool.activeCount).toBe(0);
    expect(pool.mesh.count).toBe(0);
    expect(fill(pool, 10)).toBe(64);
  });
});

describe('createVoxelPool — fisica dei cubetti', () => {
  it('un cubetto lanciato verso l alto ricade e rimbalza più basso', () => {
    const pool = createVoxelPool(8, 0.25);
    expect(pool.spawn(0, 0, 0, 0, 12, 0, WHITE, 5)).toBe(true);

    let firstPeak = 0;
    let landed = false;
    for (let step = 0; step < 200 && !landed; step += 1) {
      pool.update(1 / 60, 0);
      const y = slotY(pool, 0);
      if (y > firstPeak) firstPeak = y;
      if (firstPeak > 0.5 && y <= 0) landed = true;
    }
    expect(landed).toBe(true);
    expect(firstPeak).toBeGreaterThan(1);

    let secondPeak = 0;
    for (let step = 0; step < 200; step += 1) {
      pool.update(1 / 60, 0);
      const y = slotY(pool, 0);
      if (y > secondPeak) secondPeak = y;
    }
    expect(secondPeak).toBeGreaterThan(0);
    expect(secondPeak).toBeLessThan(firstPeak * 0.3);
  });

  it('il mondo che scorre trascina indietro i cubetti', () => {
    const pool = createVoxelPool(8, 0.25);
    pool.spawn(0, 0, 0, 0, 0, 0, WHITE, 5);
    for (let step = 0; step < 60; step += 1) pool.update(1 / 60, 20);
    pool.mesh.getMatrixAt(0, scratch);
    expect(scratch.elements[14] ?? 0).toBeLessThan(-15);
  });

  it('gli slot morti sono nascosti con scala 0', () => {
    const pool = createVoxelPool(8, 0.25);
    pool.spawn(0, 5, 0, 0, 0, 0, WHITE, 0.05);
    for (let step = 0; step < 10; step += 1) pool.update(1 / 60, 0);
    pool.mesh.getMatrixAt(0, scratch);
    expect(scratch.elements[0]).toBe(0);
    expect(scratch.elements[5]).toBe(0);
    expect(scratch.elements[10]).toBe(0);
  });
});

describe('createVoxelPool — zero allocazioni', () => {
  it('gli array interni restano gli stessi dopo migliaia di spawn', () => {
    const pool = createVoxelPool(32, 0.25);
    const matrixAttribute = pool.mesh.instanceMatrix;
    const matrixArray = pool.mesh.instanceMatrix.array;
    const colorAttribute = pool.mesh.instanceColor;
    const colorArray = colorAttribute?.array;
    expect(colorArray).toBeDefined();

    for (let cycle = 0; cycle < 200; cycle += 1) {
      while (pool.spawn(0, 1, 0, 1, 2, 3, WHITE, 0.05)) {
        /* riempie il pool */
      }
      for (let step = 0; step < 10; step += 1) pool.update(1 / 60, 20);
    }

    expect(pool.mesh.instanceMatrix).toBe(matrixAttribute);
    expect(pool.mesh.instanceMatrix.array).toBe(matrixArray);
    expect(pool.mesh.instanceColor).toBe(colorAttribute);
    expect(pool.mesh.instanceColor?.array).toBe(colorArray);
    expect(pool.activeCount).toBe(0);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/voxel-pool.test.ts`
Atteso: FAIL con `Failed to resolve import "./voxel-pool"`.

- [ ] **Step 3: Implementa `src/render/voxel-pool.ts`**

```ts
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
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/render/voxel-pool.test.ts`
Atteso: PASS, 9 test. In particolare deve passare quello dei 1000 cicli: se
`activeCount` non torna a 0 c'è un leak di slot ed è un bug bloccante.

- [ ] **Step 5: Scrivi il test dei detriti**

`src/render/debris.test.ts`

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { MODELS, PALETTE, type VoxelModel } from './models';
import { MAX_BURST_VOXELS, avalancheTrail, burstFromModel, resetDebris } from './debris';
import { createVoxelPool } from './voxel-pool';

const BIG_POOL = 500;

function model(voxelCount: number): VoxelModel {
  const voxels: number[][] = [];
  for (let i = 0; i < voxelCount; i += 1) voxels.push([i % 5, (i % 3) + 1, i % 4, i % 3]);
  return { voxels, palette: PALETTE };
}

describe('burstFromModel', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('genera un cubetto per ogni voxel dei modelli piccoli', () => {
    const pool = createVoxelPool(64, 0.25);
    burstFromModel(pool, model(10), 0, 1, 0, 8);
    expect(pool.activeCount).toBe(10);
  });

  it('campiona i modelli grandi per non svuotare il pool', () => {
    const pool = createVoxelPool(1000, 0.25);
    const big = model(500);
    burstFromModel(pool, big, 0, 1, 0, 8);
    const step = Math.ceil(500 / MAX_BURST_VOXELS);
    expect(pool.activeCount).toBe(Math.ceil(500 / step));
    expect(pool.activeCount).toBeLessThanOrEqual(MAX_BURST_VOXELS);
  });

  it('con un pool pieno non esplode e non corrompe nulla', () => {
    const pool = createVoxelPool(5, 0.25);
    burstFromModel(pool, model(40), 0, 1, 0, 8);
    expect(pool.activeCount).toBe(5);
    expect(pool.spawn(0, 0, 0, 0, 0, 0, 0xffffff, 1)).toBe(false);
  });

  it('un modello vuoto non fa nulla', () => {
    const pool = createVoxelPool(16, 0.25);
    burstFromModel(pool, { voxels: [], palette: PALETTE }, 0, 1, 0, 8);
    expect(pool.activeCount).toBe(0);
  });

  it('funziona con i modelli veri del gioco', () => {
    const pool = createVoxelPool(BIG_POOL, 0.25);
    burstFromModel(pool, MODELS.tree, 0, 0.5, 12, 9);
    expect(pool.activeCount).toBeGreaterThan(0);
    expect(pool.activeCount).toBeLessThanOrEqual(MAX_BURST_VOXELS);
  });
});

describe('avalancheTrail', () => {
  beforeEach(() => {
    resetDebris();
  });

  it('con intensità 0 non emette nulla', () => {
    const pool = createVoxelPool(200, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(pool, 1 / 60, 0, 0.2, -1.5, 0);
    expect(pool.activeCount).toBe(0);
  });

  it('emette la stessa quantità a 60 e a 120 fps', () => {
    const poolA = createVoxelPool(200, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(poolA, 1 / 60, 0, 0.2, -1.5, 1);
    const atSixty = poolA.activeCount;

    resetDebris();
    const poolB = createVoxelPool(200, 0.25);
    for (let i = 0; i < 120; i += 1) avalancheTrail(poolB, 1 / 120, 0, 0.2, -1.5, 1);
    const atOneTwenty = poolB.activeCount;

    expect(atSixty).toBeGreaterThan(0);
    expect(Math.abs(atSixty - atOneTwenty)).toBeLessThanOrEqual(1);
  });

  it('emette di più al crescere dell intensità', () => {
    const weak = createVoxelPool(400, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(weak, 1 / 60, 0, 0.2, -1.5, 0.2);
    const weakCount = weak.activeCount;

    resetDebris();
    const strong = createVoxelPool(400, 0.25);
    for (let i = 0; i < 60; i += 1) avalancheTrail(strong, 1 / 60, 0, 0.2, -1.5, 1);

    expect(strong.activeCount).toBeGreaterThan(weakCount);
  });

  it('con il pool pieno si ferma senza accumulare debito infinito', () => {
    const pool = createVoxelPool(8, 0.25);
    for (let i = 0; i < 600; i += 1) avalancheTrail(pool, 1 / 60, 0, 0.2, -1.5, 1);
    expect(pool.activeCount).toBe(8);
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/debris.test.ts`
Atteso: FAIL con `Failed to resolve import "./debris"`.

- [ ] **Step 7: Implementa `src/render/debris.ts`**

```ts
import { CONFIG } from '../game/config';
import { PALETTE, type VoxelModel } from './models';
import type { VoxelPool } from './voxel-pool';

/** Tetto di cubetti per esplosione: oltre, il modello viene campionato. */
export const MAX_BURST_VOXELS = 96;
/** Spinta verso la camera e verso l'alto, in frazioni di `power`. */
const BURST_TOWARD_CAMERA = 0.35;
const BURST_LIFT = 0.6;
const BURST_LIFE = 0.9;
const BURST_LIFE_SPREAD = 0.8;
/** Cubetti al secondo della scia, a intensità 1. */
const TRAIL_PER_SECOND = 70;
/** Tetto per chiamata: impedisce che un frame lungo svuoti il pool. */
const MAX_TRAIL_PER_CALL = 24;
const TRAIL_LIFE = 0.9;
const SNOW_COLOR = PALETTE[0] ?? 0xffffff;

/**
 * Rumore locale della vista: volutamente separato dall'Rng di gioco, che è a
 * seed per rendere le run riproducibili nei test. Gli effetti non devono
 * consumarne la sequenza.
 */
let noiseState = 0x9e3779b9;

function noise(): number {
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  return ((noiseState >>> 0) % 4096) / 4096;
}

let trailAccumulator = 0;

/** Riporta rumore e accumulatore allo stato iniziale (nuova run, test). */
export function resetDebris(): void {
  noiseState = 0x9e3779b9;
  trailAccumulator = 0;
}

/**
 * Disintegra un modello: un cubetto per voxel (campionando i modelli grandi),
 * scagliato radialmente dal centro con una componente verso la camera. Le
 * coordinate (x, y, z) sono già quelle della VISTA: chi chiama ha applicato
 * worldToViewX.
 */
export function burstFromModel(
  pool: VoxelPool,
  model: VoxelModel,
  x: number,
  y: number,
  z: number,
  power: number,
): void {
  const voxels = model.voxels;
  if (voxels.length === 0) return;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const voxel of voxels) {
    const vxCoord = voxel[0] ?? 0;
    const vyCoord = voxel[1] ?? 0;
    const vzCoord = voxel[2] ?? 0;
    if (vxCoord < minX) minX = vxCoord;
    if (vxCoord > maxX) maxX = vxCoord;
    if (vyCoord < minY) minY = vyCoord;
    if (vzCoord < minZ) minZ = vzCoord;
    if (vzCoord > maxZ) maxZ = vzCoord;
  }

  // Stessa centratura di buildGeometry: i cubetti nascono dove c'era la mesh.
  const size = CONFIG.render.voxelSize;
  const offsetX = -(minX + maxX + 1) / 2;
  const offsetY = -minY;
  const offsetZ = -(minZ + maxZ + 1) / 2;
  const step = Math.max(1, Math.ceil(voxels.length / MAX_BURST_VOXELS));

  for (let i = 0; i < voxels.length; i += step) {
    const voxel = voxels[i];
    if (voxel === undefined) continue;
    const localX = ((voxel[0] ?? 0) + 0.5 + offsetX) * size;
    const localY = ((voxel[1] ?? 0) + 0.5 + offsetY) * size;
    const localZ = ((voxel[2] ?? 0) + 0.5 + offsetZ) * size;
    const distance = Math.max(0.25, Math.hypot(localX, localY, localZ));
    const speed = power * (0.6 + noise() * 0.8);
    const color = model.palette[voxel[3] ?? 0] ?? SNOW_COLOR;

    const alive = pool.spawn(
      x + localX,
      y + localY,
      z + localZ,
      (localX / distance) * speed,
      (localY / distance) * speed + power * BURST_LIFT,
      (localZ / distance) * speed - power * BURST_TOWARD_CAMERA,
      color,
      BURST_LIFE + noise() * BURST_LIFE_SPREAD,
    );
    if (!alive) return;
  }
}

/**
 * Scia di neve dietro la mucca durante la valanga. Il rateo è in cubetti al
 * secondo e le frazioni si accumulano fra una chiamata e l'altra: la densità
 * della scia è la stessa a 30, 60 o 120 fps.
 */
export function avalancheTrail(
  pool: VoxelPool,
  dt: number,
  x: number,
  y: number,
  z: number,
  intensity: number,
): void {
  if (intensity <= 0 || dt <= 0) return;

  trailAccumulator += dt * TRAIL_PER_SECOND * intensity;
  let budget = MAX_TRAIL_PER_CALL;

  while (trailAccumulator >= 1 && budget > 0) {
    trailAccumulator -= 1;
    budget -= 1;
    const spread = (noise() * 2 - 1) * 1.2 * intensity;
    const alive = pool.spawn(
      x + spread,
      y + noise() * 0.6,
      z - noise() * 1.5,
      spread * 1.5,
      2 + noise() * 3,
      -2 - noise() * 3,
      SNOW_COLOR,
      TRAIL_LIFE + noise() * 0.4,
    );
    if (!alive) break;
  }

  // Niente debito infinito quando il pool è pieno o il frame è stato lungo.
  if (trailAccumulator > MAX_TRAIL_PER_CALL) trailAccumulator = MAX_TRAIL_PER_CALL;
}
```

- [ ] **Step 8: Esegui i test e verifica che passino**

Comandi: `npm run typecheck` e `npm run test:run`
Atteso: PASS su tutto, compresi i 9 test del pool e i 9 dei detriti.

- [ ] **Step 9: Collega tutto al bus eventi in `src/main.ts`**

`main.ts` non contiene regole: traduce eventi di gioco in effetti. Le coordinate
del mondo passano da `worldToViewX` prima di arrivare ai detriti. `'pickup:collected'`
non porta con sé una posizione, quindi lo scoppietto parte dalla mucca, che è
esattamente dove il raccoglibile è stato preso.

```ts
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { CONFIG } from './game/config';
import { createGame, startRun, updateGame } from './game/game';
import { entityCenterX } from './game/lanes';
import { worldToViewX } from './render/camera-rig';
import { avalancheTrail, burstFromModel, resetDebris } from './render/debris';
import { createEntitiesView } from './render/entities-view';
import { MODELS } from './render/models';
import { createPlayerView } from './render/player-view';
import { createScene, type SceneContext } from './render/scene';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';

function ensureCanvas(): HTMLCanvasElement {
  const existing = document.querySelector<HTMLCanvasElement>('canvas#game');
  const canvas = existing ?? document.createElement('canvas');
  canvas.id = 'game';
  canvas.style.cssText =
    'position:fixed;inset:0;width:100%;height:100%;display:block;touch-action:none;';
  if (existing === null) document.body.appendChild(canvas);
  return canvas;
}

function showFatal(message: string): void {
  const box = document.createElement('div');
  box.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'font:16px/1.5 system-ui,sans-serif;color:#123;background:#e8f4ff;text-align:center;padding:24px;';
  box.textContent = message;
  document.body.appendChild(box);
}

function main(): void {
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  document.body.style.background = '#e8f4ff';
  const canvas = ensureCanvas();

  let view: SceneContext;
  try {
    view = createScene(canvas);
  } catch {
    showFatal('WebGL non è disponibile su questo browser: Rolling Cows non può partire.');
    return;
  }

  const terrain = createTerrain();
  const entitiesView = createEntitiesView();
  const playerView = createPlayerView();
  const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
  view.scene.add(terrain.group);
  view.scene.add(entitiesView.group);
  view.scene.add(playerView.group);
  view.scene.add(pool.mesh);

  const bus = createEventBus();
  const game = createGame(1234, bus);

  bus.on('obstacle:hit', (payload) => {
    const width = payload.kind === 'cabin' ? 2 : 1;
    const hitX = worldToViewX(entityCenterX(payload.lane, width));
    const cowX = worldToViewX(game.player.x);

    if (payload.outcome === 'smashed') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, 9);
      view.shake(0.28);
      return;
    }
    if (payload.outcome === 'forgiven') {
      burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, 6);
      view.shake(0.45);
      return;
    }
    // morte: la mucca si disintegra e l'ostacolo con lei
    burstFromModel(pool, MODELS.cow, cowX, 0.6, 0, 16);
    burstFromModel(pool, MODELS[payload.kind], hitX, 0.4, payload.z, 10);
    view.shake(0.7);
  });

  bus.on('pickup:collected', (payload) => {
    burstFromModel(pool, MODELS[payload.kind], worldToViewX(game.player.x), 0.8, 0, 4);
  });

  bus.on('avalanche:triggered', () => {
    view.shake(0.6);
  });

  startRun(game);

  const loop = createLoop({
    update(dt: number): void {
      updateGame(game, dt);

      const avalancheOn = game.avalanche.phase !== 'idle';
      const intensity = avalancheOn ? game.avalanche.size / CONFIG.avalanche.maxSize : 0;
      avalancheTrail(pool, dt, worldToViewX(game.player.x), 0.2, -1.5, intensity);
      pool.update(dt, game.world.speed);

      // Riavvio automatico: sostituito dalla macchina a stati nel task 19.
      if (!game.alive) {
        pool.reset();
        resetDebris();
        startRun(game);
      }

      terrain.sync(game.world);
      entitiesView.sync(game.entities);
      playerView.sync(game.player, game.avalanche.size, game.world.speed, dt);
      view.update(dt, game.avalanche.size, avalancheOn);
    },
    render(): void {
      view.render();
    },
  });

  window.addEventListener('resize', () => view.resize());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) loop.stop();
    else loop.start();
  });

  loop.start();
}

main();
```

`view.setQuality(true)` resta non chiamato: lo collegherà il task che misura il
frame rate secondo `CONFIG.perf.lowFpsThreshold` e `lowFpsSeconds`.

- [ ] **Step 10: Verifica visiva**

Comando: `npm run dev`

Cosa DEVI vedere:
- **investire un albero da taglia 3+**: l'albero si polverizza in cubetti verdi e
  marroni che schizzano verso la camera, ricadono sulla neve e ci **rimbalzano
  una seconda volta più bassi** prima di fermarsi, mentre scorrono all'indietro
  insieme al mondo e infine svaniscono;
- **la morte**: la mucca si disintegra in un centinaio di cubetti bianchi e neri
  sparati verso lo schermo, con uno scossone di camera netto che si spegne in
  meno di un secondo;
- **un raccoglibile preso**: uno scoppietto piccolo, dello stesso colore del
  raccoglibile;
- **durante la valanga**: una scia continua di cubetti bianchi che esce da dietro
  la mucca e si deposita sulla neve, più densa quando la taglia è alta;
- i cubetti ruotano su sé stessi mentre volano, ognuno in modo diverso.

Cosa NON devi vedere: cubetti che restano appesi a mezz'aria o che sprofondano
sotto la neve; cubetti che spariscono tutti insieme di colpo (sarebbe il tetto
del pool esaurito); cubetti neri o grigi al posto del colore del modello (sarebbe
`instanceColor` non applicato); scatti periodici del frame rate (sarebbe il
garbage collector, cioè un'allocazione entrata nel loop); la scia che continua a
uscire dopo la fine della valanga.

Controllo di budget, da fare una volta sola: aggiungi temporaneamente in fondo a
`render()` la riga

```ts
      if (Math.random() < 0.01) console.log(view.renderer.info.render);
```

e leggi in console, durante una valanga, `calls` (atteso **≤ 18**) e `triangles`
(atteso sotto **150000** anche con il pool pieno). Poi togli la riga.

- [ ] **Step 11: Commit**

```bash
git add src/render/voxel-pool.ts src/render/voxel-pool.test.ts src/render/debris.ts src/render/debris.test.ts src/main.ts
git commit -m "feat(render): add pooled voxel debris, model bursts and avalanche trail"
```

---

### Task 18: Input — riconoscimento gesti puro e sorgente di input collegata al gioco

**Files:**
- Create: `src/input/gesture.ts`
- Test: `src/input/gesture.test.ts`
- Create: `src/input/input.ts`
- Test: `src/input/input.test.ts`
- Modify: `index.html`
- Create: `src/style.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes:
  - `CONFIG.input.swipeMinPixels`, `CONFIG.input.swipeMaxMs`, `CONFIG.input.bufferSeconds` da `src/game/config.ts`
  - `type Action = 'MOVE_LEFT' | 'MOVE_RIGHT' | 'JUMP' | 'SLAM' | 'PAUSE'` da `src/game/types.ts`
  - `createGame(seed: number, bus: EventBus): GameState`, `startRun(game: GameState, seed?: number): void`, `handleAction(game: GameState, action: Action): void`, `updateGame(game: GameState, dt: number): void` da `src/game/game.ts`
  - `createLoop(callbacks: LoopCallbacks, options?: { step?: number; maxAccumulated?: number }): Loop` da `src/core/loop.ts`
  - `createEventBus(): EventBus` da `src/core/events.ts`
  - `createScene(canvas: HTMLCanvasElement): SceneContext` da `src/render/scene.ts`
  - `createTerrain(): TerrainView`, `createEntitiesView(): EntitiesView` da `src/render/terrain.ts` e `src/render/entities-view.ts`
  - `createVoxelPool(capacity: number, voxelSize: number): VoxelPool` da `src/render/voxel-pool.ts`
  - `avalancheTrail(pool: VoxelPool, dt: number, x: number, y: number, z: number, intensity: number): void` da `src/render/debris.ts`
  - `MODELS`, `buildGeometry(model: VoxelModel, voxelSize: number): THREE.BufferGeometry` da `src/render/models.ts`
- Produces:
  - `gestureToAction(dx: number, dy: number, dtMs: number): Action | null`
  - `interface InputSource { consume(): Action | null; dispose(): void }`
  - `createInput(target: HTMLElement, nowMs?: () => number): InputSource`

- [ ] **Step 1: Scrivi il test che fallisce (riconoscimento gesto)**

`src/input/gesture.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { gestureToAction } from './gesture';

const LONG = CONFIG.input.swipeMinPixels * 3;
const FAST = CONFIG.input.swipeMaxMs / 2;

describe('gestureToAction', () => {
  it('riconosce uno swipe netto verso destra come MOVE_RIGHT', () => {
    expect(gestureToAction(LONG, 0, FAST)).toBe('MOVE_RIGHT');
  });

  it('riconosce uno swipe netto verso sinistra come MOVE_LEFT', () => {
    expect(gestureToAction(-LONG, 0, FAST)).toBe('MOVE_LEFT');
  });

  it('riconosce lo swipe verso l alto come JUMP (dy negativo in coordinate schermo)', () => {
    expect(gestureToAction(0, -LONG, FAST)).toBe('JUMP');
  });

  it('riconosce lo swipe verso il basso come SLAM (dy positivo in coordinate schermo)', () => {
    expect(gestureToAction(0, LONG, FAST)).toBe('SLAM');
  });

  it('ignora uno spostamento sotto la soglia minima in pixel', () => {
    const short = CONFIG.input.swipeMinPixels - 1;
    expect(gestureToAction(short, short, FAST)).toBeNull();
  });

  it('ignora un gesto troppo lento', () => {
    expect(gestureToAction(LONG, 0, CONFIG.input.swipeMaxMs + 1)).toBeNull();
  });

  it('sceglie l asse dominante in un gesto diagonale', () => {
    expect(gestureToAction(LONG, -LONG / 2, FAST)).toBe('MOVE_RIGHT');
    expect(gestureToAction(-LONG / 2, LONG, FAST)).toBe('SLAM');
  });

  it('accetta un gesto esattamente alla soglia di distanza e di durata', () => {
    expect(gestureToAction(CONFIG.input.swipeMinPixels, 0, CONFIG.input.swipeMaxMs)).toBe('MOVE_RIGHT');
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/input/gesture.test.ts`
Atteso: FAIL con `Failed to resolve import "./gesture"` (il modulo non esiste ancora).

- [ ] **Step 3: Implementa `src/input/gesture.ts`**

```ts
import { CONFIG } from '../game/config';
import type { Action } from '../game/types';

/**
 * Traduce lo spostamento di un puntatore in un'azione di gioco.
 *
 * ATTENZIONE AL SEGNO: `dx`/`dy` sono in COORDINATE SCHERMO, dove l'asse Y
 * cresce verso il BASSO. Quindi:
 *   - dy < 0  => il dito è andato verso l'ALTO  => JUMP
 *   - dy > 0  => il dito è andato verso il BASSO => SLAM
 * È l'errore di segno più comune in questo tipo di codice: qui è esplicito e
 * bloccato da un test.
 *
 * Vince l'asse dominante: se |dx| >= |dy| il gesto è orizzontale, altrimenti
 * verticale. La distanza considerata è quella dell'asse dominante, non la
 * diagonale: un gesto obliquo corto non deve passare per somma di componenti.
 *
 * Restituisce null se il gesto è troppo corto (< swipeMinPixels) o troppo
 * lento (> swipeMaxMs): in quel caso è un tap o un trascinamento, non uno swipe.
 */
export function gestureToAction(dx: number, dy: number, dtMs: number): Action | null {
  if (dtMs > CONFIG.input.swipeMaxMs) {
    return null;
  }

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const dominant = Math.max(absX, absY);

  if (dominant < CONFIG.input.swipeMinPixels) {
    return null;
  }

  if (absX >= absY) {
    return dx > 0 ? 'MOVE_RIGHT' : 'MOVE_LEFT';
  }

  return dy < 0 ? 'JUMP' : 'SLAM';
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Comando: `npm run test:run -- src/input/gesture.test.ts`
Atteso: PASS, 8 test verdi.

- [ ] **Step 5: Scrivi il test che fallisce (sorgente di input)**

`src/input/input.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createInput } from './input';

/** Orologio controllato dal test: niente timer reali, niente flakiness. */
let now = 0;
const nowMs = (): number => now;

let target: HTMLElement;

beforeEach(() => {
  now = 0;
  target = document.createElement('div');
  document.body.appendChild(target);
});

afterEach(() => {
  target.remove();
});

function pressKey(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

/**
 * jsdom non implementa il costruttore PointerEvent: dispatchiamo un MouseEvent
 * con il tipo 'pointerdown'/'pointerup'. I listener registrati su quei tipi
 * scattano lo stesso e clientX/clientY sono supportati.
 */
function pointer(type: 'pointerdown' | 'pointerup', x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true }));
}

describe('createInput', () => {
  it('traduce ArrowLeft in MOVE_LEFT e consuma il buffer una sola volta', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    expect(input.consume()).toBe('MOVE_LEFT');
    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('mappa i tasti di gioco sulle azioni astratte', () => {
    const input = createInput(target, nowMs);

    pressKey('ArrowRight');
    expect(input.consume()).toBe('MOVE_RIGHT');
    pressKey('d');
    expect(input.consume()).toBe('MOVE_RIGHT');
    pressKey(' ');
    expect(input.consume()).toBe('JUMP');
    pressKey('ArrowDown');
    expect(input.consume()).toBe('SLAM');
    pressKey('Escape');
    expect(input.consume()).toBe('PAUSE');

    input.dispose();
  });

  it('scarta un azione più vecchia di bufferSeconds', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    now = CONFIG.input.bufferSeconds * 1000 + 1;

    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('mantiene un azione ancora dentro la finestra di buffer', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');

    now = CONFIG.input.bufferSeconds * 1000 - 1;

    expect(input.consume()).toBe('MOVE_LEFT');

    input.dispose();
  });

  it('un nuovo input sostituisce quello in buffer', () => {
    const input = createInput(target, nowMs);
    pressKey('ArrowLeft');
    pressKey('ArrowRight');

    expect(input.consume()).toBe('MOVE_RIGHT');
    expect(input.consume()).toBeNull();

    input.dispose();
  });

  it('riconosce uno swipe da puntatore sul target', () => {
    const input = createInput(target, nowMs);

    pointer('pointerdown', 200, 200);
    now = 80;
    pointer('pointerup', 200 + CONFIG.input.swipeMinPixels * 3, 205);

    expect(input.consume()).toBe('MOVE_RIGHT');

    input.dispose();
  });

  it('dopo dispose nessun evento produce più azioni', () => {
    const input = createInput(target, nowMs);
    input.dispose();

    pressKey('ArrowLeft');
    pointer('pointerdown', 10, 10);
    now = 50;
    pointer('pointerup', 10 + CONFIG.input.swipeMinPixels * 3, 10);

    expect(input.consume()).toBeNull();
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/input/input.test.ts`
Atteso: FAIL con `Failed to resolve import "./input"`.

- [ ] **Step 7: Implementa `src/input/input.ts`**

```ts
import { CONFIG } from '../game/config';
import type { Action } from '../game/types';
import { gestureToAction } from './gesture';

export interface InputSource {
  /** Consuma e restituisce l'azione in buffer, se presente e non scaduta. */
  consume(): Action | null;
  dispose(): void;
}

/**
 * Tastiera desktop: frecce + WASD, spazio per saltare, Esc (o P) per la pausa.
 * Le chiavi sono i valori di KeyboardEvent.key.
 */
const KEY_ACTIONS: Readonly<Record<string, Action>> = {
  ArrowLeft: 'MOVE_LEFT',
  a: 'MOVE_LEFT',
  A: 'MOVE_LEFT',
  ArrowRight: 'MOVE_RIGHT',
  d: 'MOVE_RIGHT',
  D: 'MOVE_RIGHT',
  ArrowUp: 'JUMP',
  w: 'JUMP',
  W: 'JUMP',
  ' ': 'JUMP',
  Spacebar: 'JUMP',
  ArrowDown: 'SLAM',
  s: 'SLAM',
  S: 'SLAM',
  Escape: 'PAUSE',
  Esc: 'PAUSE',
  p: 'PAUSE',
  P: 'PAUSE',
};

/**
 * Sorgente di input unificata: swipe (touch), trascinamento (mouse/penna) e
 * tastiera producono le stesse azioni astratte. Il resto del gioco non sa da
 * dove arriva l'azione.
 *
 * Il buffer contiene UNA sola azione: l'ultima ricevuta. Serve a non perdere un
 * comando dato un istante prima che sia eseguibile (swipe appena prima
 * dell'atterraggio). Scade dopo CONFIG.input.bufferSeconds per non eseguire
 * comandi ormai vecchi.
 *
 * `nowMs` è iniettabile: i test controllano il tempo senza timer reali.
 */
export function createInput(target: HTMLElement, nowMs: () => number = () => performance.now()): InputSource {
  const view: Window = target.ownerDocument.defaultView ?? window;

  let buffered: Action | null = null;
  let bufferedAt = 0;

  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  let tracking = false;

  function push(action: Action): void {
    buffered = action;
    bufferedAt = nowMs();
  }

  function begin(x: number, y: number): void {
    startX = x;
    startY = y;
    startedAt = nowMs();
    tracking = true;
  }

  function end(x: number, y: number): void {
    if (!tracking) {
      return;
    }
    tracking = false;
    const action = gestureToAction(x - startX, y - startY, nowMs() - startedAt);
    if (action !== null) {
      push(action);
    }
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) {
      return;
    }
    const action = KEY_ACTIONS[event.key];
    if (action === undefined) {
      return;
    }
    // Evita lo scroll della pagina con spazio e frecce.
    event.preventDefault();
    push(action);
  };

  const onTouchStart = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (touch === undefined) {
      return;
    }
    // preventDefault su touchstart/touchmove: niente scroll, niente
    // pull-to-refresh, niente zoom a doppio tap durante il gioco.
    event.preventDefault();
    begin(touch.clientX, touch.clientY);
  };

  const onTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
  };

  const onTouchEnd = (event: TouchEvent): void => {
    const touch = event.changedTouches[0];
    if (touch === undefined) {
      return;
    }
    event.preventDefault();
    end(touch.clientX, touch.clientY);
  };

  const onTouchCancel = (): void => {
    tracking = false;
  };

  const onPointerDown = (event: PointerEvent): void => {
    // Su mobile i pointer event arrivano DUPLICATI insieme ai touch event:
    // ignoriamo qui il touch, che è già gestito sopra.
    if (event.pointerType === 'touch') {
      return;
    }
    begin(event.clientX, event.clientY);
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      return;
    }
    end(event.clientX, event.clientY);
  };

  const onPointerCancel = (): void => {
    tracking = false;
  };

  const active = { passive: false } as const;

  target.addEventListener('touchstart', onTouchStart, active);
  target.addEventListener('touchmove', onTouchMove, active);
  target.addEventListener('touchend', onTouchEnd, active);
  target.addEventListener('touchcancel', onTouchCancel);
  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointerup', onPointerUp);
  target.addEventListener('pointercancel', onPointerCancel);
  view.addEventListener('keydown', onKeyDown);

  return {
    consume(): Action | null {
      if (buffered === null) {
        return null;
      }
      if (nowMs() - bufferedAt > CONFIG.input.bufferSeconds * 1000) {
        buffered = null;
        return null;
      }
      const action = buffered;
      buffered = null;
      return action;
    },

    dispose(): void {
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchmove', onTouchMove);
      target.removeEventListener('touchend', onTouchEnd);
      target.removeEventListener('touchcancel', onTouchCancel);
      target.removeEventListener('pointerdown', onPointerDown);
      target.removeEventListener('pointerup', onPointerUp);
      target.removeEventListener('pointercancel', onPointerCancel);
      view.removeEventListener('keydown', onKeyDown);
      buffered = null;
      tracking = false;
    },
  };
}
```

- [ ] **Step 8: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS, inclusi i 7 test di `input.test.ts` e gli 8 di `gesture.test.ts`.

- [ ] **Step 9: Prepara la pagina per il gioco a schermo intero**

`index.html` (contenuto completo):

```html
<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
    />
    <meta name="theme-color" content="#0b1c2c" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <title>Rolling Cows</title>
  </head>
  <body>
    <canvas id="game-canvas"></canvas>
    <div id="ui"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/style.css` (contenuto completo, verrà ampliato nel Task 19):

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0b1c2c;
  /* Niente scroll elastico, niente pull-to-refresh mentre si gioca. */
  overscroll-behavior: none;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

#game-canvas {
  position: fixed;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

#ui {
  position: fixed;
  inset: 0;
  z-index: 1;
  color: #f7fbff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  /* CRITICO: il layer UI non deve MAI intercettare gli swipe del gioco. */
  pointer-events: none;
}
```

- [ ] **Step 10: Collega l'input al gioco in `src/main.ts`**

`src/main.ts` (contenuto completo, sostituisce quello dei task precedenti):

```ts
import * as THREE from 'three';
import './style.css';
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { CONFIG } from './game/config';
import { createGame, handleAction, startRun, updateGame } from './game/game';
import { createInput } from './input/input';
import { avalancheTrail } from './render/debris';
import { createEntitiesView } from './render/entities-view';
import { buildGeometry, MODELS } from './render/models';
import { createScene } from './render/scene';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';

const canvas = document.getElementById('game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #game-canvas non trovato');
}

const scene = createScene(canvas);
const bus = createEventBus();
const game = createGame(Date.now(), bus);

const terrain = createTerrain();
const entitiesView = createEntitiesView();
const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
scene.scene.add(terrain.group);
scene.scene.add(entitiesView.group);
scene.scene.add(pool.mesh);

const cow = new THREE.Mesh(
  buildGeometry(MODELS.cow, CONFIG.render.voxelSize),
  new THREE.MeshLambertMaterial({ vertexColors: true }),
);
scene.scene.add(cow);

const input = createInput(canvas);

/** Scala del modello mucca derivata dall'altezza dichiarata in config. */
function cowScale(size: number): number {
  const { baseHeight, heightPerSize } = CONFIG.player;
  return (baseHeight + heightPerSize * (size - 1)) / baseHeight;
}

function syncCow(dt: number): void {
  const scale = cowScale(game.avalanche.size);
  cow.scale.setScalar(scale);
  cow.position.set(game.player.x, game.player.y + (CONFIG.player.baseHeight * scale) / 2, 0);
  // Rotolamento: giro completo ogni circonferenza percorsa, raggio = mezza altezza.
  const radius = (CONFIG.player.baseHeight * scale) / 2;
  cow.rotation.x -= (game.world.speed * dt) / radius;
}

function update(dt: number): void {
  const action = input.consume();
  if (action !== null) {
    handleAction(game, action);
  }

  updateGame(game, dt);
  syncCow(dt);

  const inAvalanche = game.avalanche.phase !== 'idle';
  if (inAvalanche) {
    avalancheTrail(pool, dt, game.player.x, game.player.y, 0, game.avalanche.size / CONFIG.avalanche.maxSize);
  }
  pool.update(dt, game.world.speed);
  scene.update(dt, game.avalanche.size, inAvalanche);
}

function render(): void {
  terrain.sync(game.world);
  entitiesView.sync(game.entities);
  scene.render();
}

const loop = createLoop({ update, render });

window.addEventListener('resize', () => scene.resize());
window.visualViewport?.addEventListener('resize', () => scene.resize());

startRun(game, Date.now());
loop.start();
```

- [ ] **Step 11: Verifica di tipi, test e build**

Comandi:
```bash
npm run typecheck
npm run test:run
npm run build
```
Atteso: tutti e tre senza errori.

- [ ] **Step 12: Verifica manuale nel browser**

Comando: `npm run dev`

Su desktop (`http://localhost:5173/rollingCows/`):
- Freccia sinistra: la mucca scivola nella corsia di sinistra in ~0,12 s, con transizione, non a scatto. Dalla corsia 0 un'altra freccia sinistra non la fa uscire dal pendio.
- Freccia destra: stesso comportamento a specchio.
- Barra spaziatrice: la mucca compie una parabola di circa mezzo secondo e la pagina NON scrolla.
- Freccia giù a mezz'aria: la caduta è visibilmente più rapida della discesa naturale.
- Trascinando col mouse sul canvas da sinistra a destra per almeno 24 px in meno di 400 ms, la mucca cambia corsia.

Con l'emulazione touch dei devtools (icona telefono) o su un telefono vero:
- Swipe orizzontale: cambio corsia.
- Swipe verso l'alto: salto. Verso il basso: schiacciata.
- Durante gli swipe la pagina non scrolla mai, non compare il pull-to-refresh e un doppio tap non zooma.

- [ ] **Step 13: Commit**

```bash
git add src/input/gesture.ts src/input/gesture.test.ts src/input/input.ts src/input/input.test.ts src/style.css src/main.ts index.html
git commit -m "feat(input): add pure gesture recognition and buffered input source"
```

### Task 19: HUD, schermate e macchina a stati collegata

**Files:**
- Create: `src/ui/hud.ts`
- Test: `src/ui/hud.test.ts`
- Create: `src/ui/screens.ts`
- Test: `src/ui/screens.test.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes:
  - `type GameStateName = 'boot' | 'menu' | 'playing' | 'paused' | 'gameover'` e `createStateMachine(initial?: GameStateName): StateMachine` da `src/core/state-machine.ts`
  - `loadRecord(storage?: Storage): number` da `src/game/score.ts`
  - `createInput(target: HTMLElement, nowMs?: () => number): InputSource` da `src/input/input.ts`
  - `CONFIG.avalanche.threshold`, `CONFIG.avalanche.maxSize` da `src/game/config.ts`
  - `'run:ended': { points: number; distance: number; isRecord: boolean }` dal bus eventi
- Produces:
  - `interface Hud { setPoints(p: number): void; setCharge(ratio: number): void; setSize(size: number): void; setAvalanche(on: boolean, warning: boolean): void }`
  - `createHud(root: HTMLElement): Hud`
  - `interface Screens { show(name: GameStateName): void; setMenuRecord(record: number): void; setGameOver(points: number, record: number, isRecord: boolean): void; onStart(fn: () => void): void; onRestart(fn: () => void): void; onResume(fn: () => void): void; onMenu(fn: () => void): void; onToggleMute(fn: (muted: boolean) => void): void }`
  - `createScreens(root: HTMLElement): Screens`

- [ ] **Step 1: Scrivi il test che fallisce (HUD)**

`src/ui/hud.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHud } from './hud';

let root: HTMLElement;

/** Recupera un elemento obbligatorio: fallisce forte se il markup cambia. */
function need(selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`Elemento mancante nel HUD: ${selector}`);
  }
  return el;
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('createHud', () => {
  it('scrive il punteggio arrotondato all intero', () => {
    const hud = createHud(root);

    hud.setPoints(1234.7);
    expect(need('.hud__points').textContent).toBe('1235');

    hud.setPoints(0);
    expect(need('.hud__points').textContent).toBe('0');
  });

  it('riempie la barra di carica in proporzione al ratio', () => {
    const hud = createHud(root);

    hud.setCharge(0.5);
    expect(need('.hud__charge-fill').style.width).toBe('50%');

    hud.setCharge(0);
    expect(need('.hud__charge-fill').style.width).toBe('0%');
  });

  it('clampa il ratio della barra fuori da [0,1]', () => {
    const hud = createHud(root);

    hud.setCharge(1.8);
    expect(need('.hud__charge-fill').style.width).toBe('100%');

    hud.setCharge(-2);
    expect(need('.hud__charge-fill').style.width).toBe('0%');
  });

  it('mostra la taglia corrente', () => {
    const hud = createHud(root);

    hud.setSize(3);
    expect(need('.hud__size').textContent).toBe('TAGLIA 3');
  });

  it('aggiunge e rimuove le classi della fase valanga', () => {
    const hud = createHud(root);
    const container = need('.hud');

    hud.setAvalanche(true, false);
    expect(container.classList.contains('hud--avalanche')).toBe(true);
    expect(container.classList.contains('hud--warning')).toBe(false);

    hud.setAvalanche(true, true);
    expect(container.classList.contains('hud--avalanche')).toBe(true);
    expect(container.classList.contains('hud--warning')).toBe(true);

    hud.setAvalanche(false, false);
    expect(container.classList.contains('hud--avalanche')).toBe(false);
    expect(container.classList.contains('hud--warning')).toBe(false);
  });
});
```

- [ ] **Step 2: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/ui/hud.test.ts`
Atteso: FAIL con `Failed to resolve import "./hud"`.

- [ ] **Step 3: Implementa `src/ui/hud.ts`**

```ts
export interface Hud {
  setPoints(p: number): void;
  setCharge(ratio: number): void;
  setSize(size: number): void;
  setAvalanche(on: boolean, warning: boolean): void;
}

/**
 * HUD in HTML sopra al canvas. Non legge lo stato di gioco: riceve solo numeri
 * già pronti, così resta un consumatore passivo e testabile.
 *
 * L'intero HUD è `pointer-events: none` (vedi style.css): se catturasse i touch,
 * gli swipe non arriverebbero al canvas e il gioco sarebbe ingiocabile.
 */
export function createHud(root: HTMLElement): Hud {
  const container = document.createElement('div');
  container.className = 'hud';
  container.innerHTML = `
    <div class="hud__points">0</div>
    <div class="hud__charge"><div class="hud__charge-fill"></div></div>
    <div class="hud__size">TAGLIA 1</div>
  `;
  root.appendChild(container);

  function need(selector: string): HTMLElement {
    const el = container.querySelector<HTMLElement>(selector);
    if (el === null) {
      throw new Error(`Elemento mancante nel HUD: ${selector}`);
    }
    return el;
  }

  const pointsEl = need('.hud__points');
  const fillEl = need('.hud__charge-fill');
  const sizeEl = need('.hud__size');

  return {
    setPoints(p: number): void {
      pointsEl.textContent = String(Math.round(p));
    },

    setCharge(ratio: number): void {
      const clamped = Math.max(0, Math.min(1, ratio));
      // Un decimale basta e tiene la stringa pulita (50%, 33.3%).
      fillEl.style.width = `${Math.round(clamped * 1000) / 10}%`;
    },

    setSize(size: number): void {
      sizeEl.textContent = `TAGLIA ${Math.round(size)}`;
    },

    setAvalanche(on: boolean, warning: boolean): void {
      container.classList.toggle('hud--avalanche', on);
      container.classList.toggle('hud--warning', warning);
    },
  };
}
```

- [ ] **Step 4: Esegui il test e verifica che passi**

Comando: `npm run test:run -- src/ui/hud.test.ts`
Atteso: PASS, 5 test verdi.

- [ ] **Step 5: Scrivi il test che fallisce (schermate)**

`src/ui/screens.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScreens } from './screens';

let root: HTMLElement;

function need(selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) {
    throw new Error(`Elemento mancante nelle schermate: ${selector}`);
  }
  return el;
}

function visible(name: string): boolean {
  return !need(`[data-screen="${name}"]`).classList.contains('screen--hidden');
}

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  root.remove();
});

describe('createScreens', () => {
  it('mostra una sola schermata alla volta', () => {
    const screens = createScreens(root);

    screens.show('menu');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([true, false, false]);

    screens.show('paused');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, true, false]);

    screens.show('gameover');
    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, false, true]);
  });

  it('durante il gioco nasconde tutte le schermate', () => {
    const screens = createScreens(root);

    screens.show('menu');
    screens.show('playing');

    expect([visible('menu'), visible('paused'), visible('gameover')]).toEqual([false, false, false]);
  });

  it('invoca onStart al click su PARTI', () => {
    const screens = createScreens(root);
    const onStart = vi.fn();
    screens.onStart(onStart);

    need('[data-action="start"]').click();

    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('invoca onRestart al click su RIGIOCA e onResume su RIPRENDI', () => {
    const screens = createScreens(root);
    const onRestart = vi.fn();
    const onResume = vi.fn();
    screens.onRestart(onRestart);
    screens.onResume(onResume);

    need('[data-action="restart"]').click();
    need('[data-action="resume"]').click();

    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('invoca onMenu da entrambi i bottoni MENU', () => {
    const screens = createScreens(root);
    const onMenu = vi.fn();
    screens.onMenu(onMenu);

    const buttons = root.querySelectorAll<HTMLButtonElement>('[data-action="menu"]');
    expect(buttons.length).toBe(2);
    buttons.forEach((button) => button.click());

    expect(onMenu).toHaveBeenCalledTimes(2);
  });

  it('notifica il toggle del mute alternando lo stato', () => {
    const screens = createScreens(root);
    const onToggleMute = vi.fn();
    screens.onToggleMute(onToggleMute);

    const button = need('[data-action="mute"]');
    button.click();
    button.click();

    expect(onToggleMute).toHaveBeenNthCalledWith(1, true);
    expect(onToggleMute).toHaveBeenNthCalledWith(2, false);
  });

  it('scrive record e punteggio finale', () => {
    const screens = createScreens(root);

    screens.setMenuRecord(1234.6);
    expect(need('[data-menu-record]').textContent).toBe('1235');

    screens.setGameOver(880.2, 1235, false);
    expect(need('[data-final-points]').textContent).toBe('880');
    expect(need('[data-final-record]').textContent).toBe('1235');
  });

  it('mostra NUOVO RECORD solo quando isRecord è true', () => {
    const screens = createScreens(root);
    const banner = need('[data-new-record]');

    screens.setGameOver(100, 500, false);
    expect(banner.classList.contains('screen--hidden')).toBe(true);

    screens.setGameOver(900, 900, true);
    expect(banner.classList.contains('screen--hidden')).toBe(false);
    expect(banner.textContent).toBe('NUOVO RECORD!');
  });
});
```

- [ ] **Step 6: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/ui/screens.test.ts`
Atteso: FAIL con `Failed to resolve import "./screens"`.

- [ ] **Step 7: Implementa `src/ui/screens.ts`**

```ts
import type { GameStateName } from '../core/state-machine';

export interface Screens {
  show(name: GameStateName): void;
  setMenuRecord(record: number): void;
  setGameOver(points: number, record: number, isRecord: boolean): void;
  onStart(fn: () => void): void;
  onRestart(fn: () => void): void;
  onResume(fn: () => void): void;
  onMenu(fn: () => void): void;
  onToggleMute(fn: (muted: boolean) => void): void;
}

const HIDDEN = 'screen--hidden';

/**
 * Menu, pausa e game over in HTML/CSS sopra al canvas.
 *
 * Solo le schermate visibili ricevono i tap (`pointer-events: auto` sul singolo
 * `.screen`, mentre il contenitore #ui resta `none`): quando si gioca sono tutte
 * `display: none`, quindi nulla può rubare gli swipe al canvas.
 */
export function createScreens(root: HTMLElement): Screens {
  const layer = document.createElement('div');
  layer.className = 'screens';
  layer.innerHTML = `
    <section class="screen ${HIDDEN}" data-screen="menu">
      <div class="panel">
        <h1 class="title">Rolling Cows</h1>
        <p class="subtitle">Rotola, cresci, travolgi tutto.</p>
        <p class="record">Record: <span data-menu-record>0</span></p>
        <button class="button button--primary" type="button" data-action="start">PARTI</button>
        <button class="button button--ghost" type="button" data-action="mute" aria-pressed="false">Audio: ON</button>
      </div>
    </section>
    <section class="screen ${HIDDEN}" data-screen="paused">
      <div class="panel">
        <h2 class="title title--small">Pausa</h2>
        <button class="button button--primary" type="button" data-action="resume">RIPRENDI</button>
        <button class="button button--ghost" type="button" data-action="menu">MENU</button>
      </div>
    </section>
    <section class="screen ${HIDDEN}" data-screen="gameover">
      <div class="panel">
        <h2 class="title title--small">Fine corsa</h2>
        <p class="record record--new ${HIDDEN}" data-new-record>NUOVO RECORD!</p>
        <p class="score">Punteggio: <span data-final-points>0</span></p>
        <p class="record">Record: <span data-final-record>0</span></p>
        <button class="button button--primary" type="button" data-action="restart">RIGIOCA</button>
        <button class="button button--ghost" type="button" data-action="menu">MENU</button>
      </div>
    </section>
  `;
  root.appendChild(layer);

  function need(selector: string): HTMLElement {
    const el = layer.querySelector<HTMLElement>(selector);
    if (el === null) {
      throw new Error(`Elemento mancante nelle schermate: ${selector}`);
    }
    return el;
  }

  const menuEl = need('[data-screen="menu"]');
  const pausedEl = need('[data-screen="paused"]');
  const gameoverEl = need('[data-screen="gameover"]');
  const menuRecordEl = need('[data-menu-record]');
  const finalPointsEl = need('[data-final-points]');
  const finalRecordEl = need('[data-final-record]');
  const newRecordEl = need('[data-new-record]');
  const muteButton = need('[data-action="mute"]');

  const noop = (): void => {};
  let startFn: () => void = noop;
  let restartFn: () => void = noop;
  let resumeFn: () => void = noop;
  let menuFn: () => void = noop;
  let muteFn: (muted: boolean) => void = () => {};

  let muted = false;

  function bind(action: string, handler: () => void): void {
    layer.querySelectorAll<HTMLButtonElement>(`[data-action="${action}"]`).forEach((button) => {
      button.addEventListener('click', handler);
    });
  }

  function renderMuteButton(): void {
    muteButton.textContent = muted ? 'Audio: OFF' : 'Audio: ON';
    muteButton.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  bind('start', () => startFn());
  bind('restart', () => restartFn());
  bind('resume', () => resumeFn());
  bind('menu', () => menuFn());
  bind('mute', () => {
    muted = !muted;
    renderMuteButton();
    muteFn(muted);
  });

  renderMuteButton();

  return {
    show(name: GameStateName): void {
      menuEl.classList.toggle(HIDDEN, name !== 'menu');
      pausedEl.classList.toggle(HIDDEN, name !== 'paused');
      gameoverEl.classList.toggle(HIDDEN, name !== 'gameover');
    },

    setMenuRecord(record: number): void {
      menuRecordEl.textContent = String(Math.round(record));
    },

    setGameOver(points: number, record: number, isRecord: boolean): void {
      finalPointsEl.textContent = String(Math.round(points));
      finalRecordEl.textContent = String(Math.round(record));
      newRecordEl.classList.toggle(HIDDEN, !isRecord);
    },

    onStart(fn: () => void): void {
      startFn = fn;
    },

    onRestart(fn: () => void): void {
      restartFn = fn;
    },

    onResume(fn: () => void): void {
      resumeFn = fn;
    },

    onMenu(fn: () => void): void {
      menuFn = fn;
    },

    onToggleMute(fn: (muted: boolean) => void): void {
      muteFn = fn;
    },
  };
}
```

- [ ] **Step 8: Esegui i test e verifica che passino**

Comando: `npm run test:run`
Atteso: PASS, inclusi gli 8 test di `screens.test.ts`.

- [ ] **Step 9: Scrivi il CSS dell'interfaccia**

`src/style.css` (contenuto completo, sostituisce quello del Task 18):

```css
*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0b1c2c;
  /* Niente scroll elastico, niente pull-to-refresh mentre si gioca. */
  overscroll-behavior: none;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

#game-canvas {
  position: fixed;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

#ui {
  position: fixed;
  inset: 0;
  z-index: 1;
  color: #f7fbff;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  /* CRITICO: il layer UI non deve MAI intercettare gli swipe del gioco.
     Solo le schermate visibili riattivano i puntatori (regola .screen). */
  pointer-events: none;
}

/* ------------------------------------------------------------------ HUD -- */

.hud {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: calc(12px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
    calc(12px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
  /* Ridondante ma voluto: nemmeno per errore l'HUD deve prendere i touch. */
  pointer-events: none;
}

.hud__points {
  font-size: clamp(28px, 9vw, 56px);
  font-weight: 800;
  letter-spacing: 0.02em;
  font-variant-numeric: tabular-nums;
  text-shadow: 0 2px 0 rgba(0, 0, 0, 0.35);
}

.hud__charge {
  width: min(420px, 70%);
  height: 14px;
  border-radius: 7px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.hud__charge-fill {
  width: 0%;
  height: 100%;
  border-radius: 7px;
  background: linear-gradient(90deg, #7fd7ff, #ffffff);
  transition: width 90ms linear;
}

.hud__size {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 0.08em;
  background: rgba(11, 28, 44, 0.45);
}

.hud--avalanche .hud__points {
  animation: hud-pulse 0.6s ease-in-out infinite;
}

.hud--avalanche .hud__charge-fill {
  background: linear-gradient(90deg, #ffd166, #ff7b3d);
}

.hud--warning .hud__charge,
.hud--warning .hud__size {
  animation: hud-blink 0.35s steps(2, end) infinite;
}

@keyframes hud-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.12);
  }
}

@keyframes hud-blink {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0.25;
  }
}

/* ----------------------------------------------------------- schermate -- */

.screens {
  position: absolute;
  inset: 0;
}

.screen {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right))
    calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
  background: radial-gradient(circle at 50% 35%, rgba(11, 28, 44, 0.55), rgba(4, 12, 20, 0.9));
  /* Solo la schermata a video riceve i tap. */
  pointer-events: auto;
}

.screen--hidden {
  display: none;
}

.panel {
  display: flex;
  width: min(420px, 100%);
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 28px 24px;
  border-radius: 22px;
  text-align: center;
  background: rgba(8, 22, 36, 0.72);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
}

.title {
  margin: 0;
  font-size: clamp(34px, 12vw, 60px);
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0.01em;
  text-shadow: 0 3px 0 rgba(0, 0, 0, 0.35);
}

.title--small {
  font-size: clamp(26px, 8vw, 40px);
}

.subtitle {
  margin: 0;
  font-size: 16px;
  opacity: 0.75;
}

.score,
.record {
  margin: 0;
  font-size: 18px;
  font-variant-numeric: tabular-nums;
}

.record--new {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: #ffd166;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* Area di tap comoda anche col pollice: mai sotto i 44px. */
  min-height: 56px;
  min-width: 200px;
  padding: 0 24px;
  border: 0;
  border-radius: 14px;
  font: inherit;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  touch-action: manipulation;
}

.button--primary {
  color: #06202f;
  background: linear-gradient(180deg, #ffffff, #bfe6ff);
  box-shadow: 0 6px 0 rgba(0, 0, 0, 0.3);
}

.button--ghost {
  min-height: 44px;
  min-width: 160px;
  font-size: 16px;
  color: #f7fbff;
  background: rgba(255, 255, 255, 0.12);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.25);
}

.button:active {
  transform: translateY(2px);
}

@media (prefers-reduced-motion: reduce) {
  .hud--avalanche .hud__points,
  .hud--warning .hud__charge,
  .hud--warning .hud__size {
    animation: none;
  }

  .hud__charge-fill {
    transition: none;
  }
}
```

- [ ] **Step 10: Collega la macchina a stati in `src/main.ts`**

`src/main.ts` (contenuto completo, sostituisce quello del Task 18):

```ts
import * as THREE from 'three';
import './style.css';
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { createStateMachine } from './core/state-machine';
import { CONFIG } from './game/config';
import { createGame, handleAction, startRun, updateGame } from './game/game';
import { loadRecord } from './game/score';
import { createInput } from './input/input';
import { avalancheTrail } from './render/debris';
import { createEntitiesView } from './render/entities-view';
import { buildGeometry, MODELS } from './render/models';
import { createScene } from './render/scene';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';
import { createHud } from './ui/hud';
import { createScreens } from './ui/screens';

const canvas = document.getElementById('game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #game-canvas non trovato');
}

const uiRoot = document.getElementById('ui');
if (uiRoot === null) {
  throw new Error('Contenitore #ui non trovato');
}

const scene = createScene(canvas);
const bus = createEventBus();
const game = createGame(Date.now(), bus);

const terrain = createTerrain();
const entitiesView = createEntitiesView();
const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
scene.scene.add(terrain.group);
scene.scene.add(entitiesView.group);
scene.scene.add(pool.mesh);

const cow = new THREE.Mesh(
  buildGeometry(MODELS.cow, CONFIG.render.voxelSize),
  new THREE.MeshLambertMaterial({ vertexColors: true }),
);
scene.scene.add(cow);

const input = createInput(canvas);
const hud = createHud(uiRoot);
const screens = createScreens(uiRoot);
const machine = createStateMachine();

let record = loadRecord();

function goToMenu(): void {
  if (machine.transition('menu')) {
    screens.setMenuRecord(record);
    screens.show('menu');
  }
}

function beginRun(): void {
  if (!machine.transition('playing')) {
    return;
  }
  startRun(game, Date.now());
  pool.reset();
  screens.show('playing');
}

function togglePause(): void {
  if (machine.current === 'playing' && machine.transition('paused')) {
    screens.show('paused');
    return;
  }
  if (machine.current === 'paused' && machine.transition('playing')) {
    screens.show('playing');
  }
}

screens.onStart(beginRun);
screens.onRestart(beginRun);
screens.onResume(togglePause);
screens.onMenu(goToMenu);
screens.onToggleMute(() => {
  // L'audio arriva nel Task 20: qui il toggle esiste già e non fa nulla.
});

bus.on('run:ended', (payload) => {
  record = Math.max(record, payload.points);
  if (machine.transition('gameover')) {
    screens.setGameOver(payload.points, record, payload.isRecord);
    screens.show('gameover');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && machine.current === 'playing') {
    machine.transition('paused');
    screens.show('paused');
  }
});

window.addEventListener('blur', () => {
  if (machine.current === 'playing') {
    machine.transition('paused');
    screens.show('paused');
  }
});

/** Scala del modello mucca derivata dall'altezza dichiarata in config. */
function cowScale(size: number): number {
  const { baseHeight, heightPerSize } = CONFIG.player;
  return (baseHeight + heightPerSize * (size - 1)) / baseHeight;
}

function syncCow(dt: number): void {
  const scale = cowScale(game.avalanche.size);
  cow.scale.setScalar(scale);
  cow.position.set(game.player.x, game.player.y + (CONFIG.player.baseHeight * scale) / 2, 0);
  const radius = (CONFIG.player.baseHeight * scale) / 2;
  cow.rotation.x -= (game.world.speed * dt) / radius;
}

function syncHud(): void {
  hud.setPoints(game.score.points);
  hud.setCharge(game.avalanche.charge / CONFIG.avalanche.threshold);
  hud.setSize(game.avalanche.size);
  hud.setAvalanche(game.avalanche.phase !== 'idle', game.avalanche.phase === 'warning');
}

function update(dt: number): void {
  // PAUSE va letto in qualunque stato, altrimenti da fermi Esc non riprende.
  const action = input.consume();
  if (action === 'PAUSE') {
    togglePause();
  } else if (action !== null && machine.current === 'playing') {
    handleAction(game, action);
  }

  if (machine.current === 'playing') {
    updateGame(game, dt);
    syncHud();
  }

  // La vista continua a vivere anche in menu, pausa e game over.
  syncCow(machine.current === 'playing' ? dt : 0);

  const inAvalanche = machine.current === 'playing' && game.avalanche.phase !== 'idle';
  if (inAvalanche) {
    avalancheTrail(pool, dt, game.player.x, game.player.y, 0, game.avalanche.size / CONFIG.avalanche.maxSize);
  }
  pool.update(dt, game.world.speed);
  scene.update(dt, game.avalanche.size, inAvalanche);
}

function render(): void {
  terrain.sync(game.world);
  entitiesView.sync(game.entities);
  scene.render();
}

const loop = createLoop({ update, render });

window.addEventListener('resize', () => scene.resize());
window.visualViewport?.addEventListener('resize', () => scene.resize());

goToMenu();
syncHud();
loop.start();
```

- [ ] **Step 11: Verifica di tipi, test e build**

Comandi:
```bash
npm run typecheck
npm run test:run
npm run build
```
Atteso: tutti e tre senza errori.

- [ ] **Step 12: Verifica manuale nel browser**

Comando: `npm run dev`

- All'avvio compare il menu con "Rolling Cows", il record e il bottone PARTI grande al centro; dietro, il pendio scorre e la mucca rotola.
- PARTI: il menu sparisce, il punteggio parte da 0 e sale.
- Durante il gioco lo swipe funziona ANCHE se parte da sopra al punteggio o alla barra di carica: è la prova che l'HUD non intercetta i puntatori.
- Raccogliendo fiocchi la barra si riempie; al 100% il punteggio pulsa e la barra diventa arancione; nell'ultimo secondo e mezzo barra e taglia lampeggiano.
- Esc mette in pausa e mostra RIPRENDI/MENU; Esc di nuovo (o RIPRENDI) riprende esattamente da dove si era.
- Cambiando scheda del browser e tornando indietro, il gioco è in pausa e non è andato avanti da solo.
- Alla morte compare il game over con punteggio e record; RIGIOCA riparte subito senza passare dal menu.
- Su telefono, il pannello non finisce sotto al notch né sotto alla barra di gesture: i bottoni restano interamente toccabili.

- [ ] **Step 13: Commit**

```bash
git add src/ui/hud.ts src/ui/hud.test.ts src/ui/screens.ts src/ui/screens.test.ts src/style.css src/main.ts
git commit -m "feat(ui): add HUD, menu/pause/game over screens and state machine wiring"
```

### Task 20: Audio sintetizzato con WebAudio

**Files:**
- Modify: `src/game/config.ts`
- Create: `src/audio/audio.ts`
- Test: `src/audio/audio.test.ts`
- Modify: `src/ui/screens.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes:
  - `interface EventBus { on<K extends EventName>(name: K, handler: (payload: GameEvents[K]) => void): () => void; ... }` da `src/core/events.ts`
  - Eventi `'run:started'`, `'pickup:collected'`, `'obstacle:hit'`, `'avalanche:triggered'`, `'avalanche:ending'`, `'avalanche:ended'`
  - `CONFIG.avalanche.maxSize` da `src/game/config.ts`
- Produces:
  - `interface Audio { attach(bus: EventBus): void; setMuted(muted: boolean): void; readonly muted: boolean; unlock(): void }`
  - `createAudio(contextFactory?: () => AudioContext): Audio`
  - `CONFIG.audio` (nuovo blocco di configurazione)

> **Estensione dichiarata della firma del contratto.** Il contratto prevede
> `createAudio(): Audio`. Qui la firma diventa
> `createAudio(contextFactory?: () => AudioContext): Audio`: il parametro è
> **opzionale**, quindi ogni chiamata prevista dal contratto resta valida.
> Serve perché jsdom non implementa WebAudio: senza un punto di iniezione
> l'unico modo di testare il modulo sarebbe fare monkey-patch di
> `globalThis.AudioContext`, che è fragile e sporca lo stato globale tra i test.
> Con la fabbrica iniettabile il test passa un finto contesto che registra i
> nodi creati, e la produzione non cambia di una riga.

- [ ] **Step 1: Aggiungi il blocco `audio` alla configurazione**

In `src/game/config.ts`, dentro l'oggetto `CONFIG`, subito dopo il blocco `input`, inserisci:

```ts
  audio: {
    /** Volume del bus principale: tutto passa di qui. */
    masterVolume: 0.35,
    mutedKey: 'rollingcows.muted',
    /** Durata del buffer di rumore bianco riusato da impatti e rombo. */
    noiseSeconds: 1,
    /** Muggito: sawtooth con portamento discendente. */
    moo: { startHz: 220, endHz: 110, seconds: 0.5, attackRatio: 0.12, gain: 0.9 },
    /** Impatto: rumore bianco passa-basso con decadimento rapido. */
    impact: { cutoffHz: 700, seconds: 0.28, gain: 1 },
    /** Raccolta: triangolare con salto di frequenza verso l'alto. */
    pickup: { lowHz: 620, highHz: 990, stepRatio: 0.35, seconds: 0.18, gain: 0.5 },
    /** Rombo della valanga: rumore filtrato in loop. */
    rumble: { cutoffHz: 380, maxGain: 0.8, riseSeconds: 0.4, fadeSeconds: 0.8, endingGainRatio: 0.4 },
  },
```

- [ ] **Step 2: Scrivi il test che fallisce**

`src/audio/audio.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../core/events';
import { CONFIG } from '../game/config';
import { createAudio } from './audio';

/* ---------------------------------------------------- finto WebAudio -- */

class FakeParam {
  value = 0;

  setValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    return this;
  }

  exponentialRampToValueAtTime(value: number, _time: number): FakeParam {
    this.value = value;
    return this;
  }

  cancelScheduledValues(_time: number): FakeParam {
    return this;
  }
}

class FakeNode {
  connect(target: unknown): unknown {
    return target;
  }

  disconnect(): void {}
}

class FakeOscillator extends FakeNode {
  type = 'sine';
  frequency = new FakeParam();
  started = false;
  stopped = false;

  start(_time?: number): void {
    this.started = true;
  }

  stop(_time?: number): void {
    this.stopped = true;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam();
}

class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  started = false;
  stopped = false;

  start(_time?: number): void {
    this.started = true;
  }

  stop(_time?: number): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  currentTime = 0;
  sampleRate = 48000;
  state: AudioContextState = 'suspended';
  destination = new FakeNode();
  oscillators: FakeOscillator[] = [];
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  sources: FakeBufferSource[] = [];
  resumeCalls = 0;

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.sources.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, _sampleRate: number): { numberOfChannels: number; length: number; getChannelData(): Float32Array } {
    return {
      numberOfChannels,
      length,
      getChannelData: () => new Float32Array(length),
    };
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }
}

/* --------------------------------------------------------------- test -- */

let fake: FakeAudioContext;
let factoryCalls = 0;

const factory = (): AudioContext => {
  factoryCalls += 1;
  return fake as unknown as AudioContext;
};

beforeEach(() => {
  fake = new FakeAudioContext();
  factoryCalls = 0;
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe('createAudio', () => {
  it('suona la raccolta creando un oscillatore su pickup:collected', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'snowflake', charge: 1 });

    expect(fake.oscillators.length).toBe(1);
    expect(fake.oscillators[0]?.type).toBe('triangle');
    expect(fake.oscillators[0]?.started).toBe(true);
  });

  it('aggiunge il muggito quando il raccoglibile è una mucca', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'cow', charge: 10 });

    expect(fake.oscillators.length).toBe(2);
  });

  it('avvia il rombo su avalanche:triggered e lo spegne su avalanche:ended', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.attach(bus);

    bus.emit('avalanche:triggered', { size: CONFIG.avalanche.maxSize });
    expect(fake.sources.length).toBe(1);
    expect(fake.sources[0]?.loop).toBe(true);
    expect(fake.sources[0]?.started).toBe(true);

    bus.emit('avalanche:ended', {});
    expect(fake.sources[0]?.stopped).toBe(true);
  });

  it('con muted non crea nessun nodo e non apre nemmeno il contesto', () => {
    const audio = createAudio(factory);
    const bus = createEventBus();
    audio.setMuted(true);
    audio.attach(bus);

    bus.emit('pickup:collected', { kind: 'hay', charge: 5 });
    bus.emit('obstacle:hit', { kind: 'rock', outcome: 'death', lane: 1, z: 0 });

    expect(audio.muted).toBe(true);
    expect(factoryCalls).toBe(0);
    expect(fake.oscillators.length).toBe(0);
    expect(fake.sources.length).toBe(0);
  });

  it('persiste il mute e lo rilegge alla creazione successiva', () => {
    const first = createAudio(factory);
    first.setMuted(true);
    expect(localStorage.getItem(CONFIG.audio.mutedKey)).toBe('1');

    const second = createAudio(factory);
    expect(second.muted).toBe(true);

    second.setMuted(false);
    expect(localStorage.getItem(CONFIG.audio.mutedKey)).toBe('0');
    expect(createAudio(factory).muted).toBe(false);
  });

  it('unlock chiama resume una sola volta', () => {
    const audio = createAudio(factory);

    audio.unlock();
    audio.unlock();
    audio.unlock();

    expect(fake.resumeCalls).toBe(1);
    expect(factoryCalls).toBe(1);
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/audio/audio.test.ts`
Atteso: FAIL con `Failed to resolve import "./audio"`.

- [ ] **Step 4: Implementa `src/audio/audio.ts`**

```ts
import type { EventBus } from '../core/events';
import { CONFIG } from '../game/config';

export interface Audio {
  attach(bus: EventBus): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  unlock(): void;
}

type ContextFactory = () => AudioContext;

/** Safari desktop e vecchi WebView espongono ancora solo webkitAudioContext. */
function defaultContextFactory(): AudioContext {
  const legacy = (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  const Ctor = globalThis.AudioContext ?? legacy;
  if (Ctor === undefined) {
    throw new Error('WebAudio non disponibile');
  }
  return new Ctor();
}

function readMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONFIG.audio.mutedKey) === '1';
  } catch {
    return false;
  }
}

function writeMuted(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(CONFIG.audio.mutedKey, value ? '1' : '0');
  } catch {
    // Storage negato (navigazione privata): il mute resta valido per la sessione.
  }
}

/**
 * Tutti i suoni sono sintetizzati: nessun file, nessun caricamento, nessun peso
 * aggiunto al bundle. Il modulo è un puro consumatore del bus eventi.
 *
 * `contextFactory` è iniettabile per i test (vedi nota nel piano): in produzione
 * si omette e si usa l'AudioContext del browser.
 */
export function createAudio(contextFactory: ContextFactory = defaultContextFactory): Audio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let rumble: { source: AudioBufferSourceNode; gain: GainNode; level: number } | null = null;
  let muted = readMuted();
  let unlocked = false;
  const subscriptions: Array<() => void> = [];

  function createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * CONFIG.audio.noiseSeconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /** Apre il contesto se serve. Da chiamare solo quando si vuole davvero suonare. */
  function ensure(): AudioContext {
    if (ctx === null) {
      const context = contextFactory();
      const gain = context.createGain();
      gain.gain.value = CONFIG.audio.masterVolume;
      gain.connect(context.destination);
      noise = createNoiseBuffer(context);
      master = gain;
      ctx = context;
    }
    return ctx;
  }

  /** Contesto solo se l'audio è attivo: da muto non si alloca proprio nulla. */
  function audible(): AudioContext | null {
    return muted ? null : ensure();
  }

  function playMoo(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { startHz, endHz, seconds, attackRatio, gain: level } = CONFIG.audio.moo;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(endHz, t + seconds);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + seconds * attackRatio);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  function playImpact(): void {
    const context = audible();
    if (context === null || master === null || noise === null) {
      return;
    }
    const { cutoffHz, seconds, gain: level } = CONFIG.audio.impact;
    const t = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = noise;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, t);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + seconds);
  }

  function playPickup(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, highHz, stepRatio, seconds, gain: level } = CONFIG.audio.pickup;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(lowHz, t);
    osc.frequency.setValueAtTime(highHz, t + seconds * stepRatio);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  function stopRumble(fadeSeconds: number): void {
    if (rumble === null || ctx === null) {
      return;
    }
    const t = ctx.currentTime;
    rumble.gain.gain.cancelScheduledValues(t);
    rumble.gain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
    rumble.source.stop(t + fadeSeconds);
    rumble = null;
  }

  function startRumble(intensity: number): void {
    const context = audible();
    if (context === null || master === null || noise === null) {
      return;
    }
    stopRumble(0);

    const { cutoffHz, maxGain, riseSeconds } = CONFIG.audio.rumble;
    const t = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const level = maxGain * Math.max(0, Math.min(1, intensity));

    source.buffer = noise;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz, t);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + riseSeconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);

    rumble = { source, gain, level };
  }

  /** Negli ultimi secondi della valanga il rombo cala: la fine si sente arrivare. */
  function duckRumble(): void {
    if (rumble === null || ctx === null) {
      return;
    }
    const t = ctx.currentTime;
    rumble.gain.gain.cancelScheduledValues(t);
    rumble.gain.gain.linearRampToValueAtTime(rumble.level * CONFIG.audio.rumble.endingGainRatio, t + 0.2);
  }

  function detach(): void {
    while (subscriptions.length > 0) {
      subscriptions.pop()?.();
    }
  }

  return {
    attach(bus: EventBus): void {
      detach();
      subscriptions.push(bus.on('run:started', () => playMoo()));
      subscriptions.push(
        bus.on('pickup:collected', (payload) => {
          playPickup();
          if (payload.kind === 'cow') {
            playMoo();
          }
        }),
      );
      subscriptions.push(
        bus.on('obstacle:hit', (payload) => {
          playImpact();
          if (payload.outcome === 'death') {
            playMoo();
          }
        }),
      );
      subscriptions.push(
        bus.on('avalanche:triggered', (payload) => {
          playMoo();
          startRumble(payload.size / CONFIG.avalanche.maxSize);
        }),
      );
      subscriptions.push(bus.on('avalanche:ending', () => duckRumble()));
      subscriptions.push(bus.on('avalanche:ended', () => stopRumble(CONFIG.audio.rumble.fadeSeconds)));
    },

    setMuted(value: boolean): void {
      muted = value;
      writeMuted(value);
      if (muted) {
        stopRumble(0);
      }
    },

    get muted(): boolean {
      return muted;
    },

    /**
     * iOS e Safari creano l'AudioContext in stato 'suspended' e lo lasciano muto
     * finché non viene ripreso DENTRO al gestore di un vero gesto dell'utente
     * (tap, click, tasto). Chiamato altrove — al caricamento della pagina, dopo
     * una promise, in un timer — il resume viene ignorato e il gioco resta muto
     * per sempre. Va quindi invocato dal primo listener di pointerdown/keydown
     * (vedi main.ts), una sola volta.
     */
    unlock(): void {
      if (unlocked) {
        return;
      }
      unlocked = true;
      const context = ensure();
      if (context.state === 'suspended') {
        void context.resume();
      }
    },
  };
}
```

- [ ] **Step 5: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/audio/audio.test.ts`
Atteso: PASS, 6 test verdi.

- [ ] **Step 6: Fai partire il bottone mute dallo stato persistito**

In `src/ui/screens.ts`, aggiungi l'import della configurazione in testa al file:

```ts
import { CONFIG } from '../game/config';
```

Aggiungi questa funzione subito sopra a `export function createScreens`:

```ts
/** Stato del mute salvato dall'audio: il bottone deve nascere coerente. */
function readPersistedMuted(): boolean {
  try {
    return globalThis.localStorage?.getItem(CONFIG.audio.mutedKey) === '1';
  } catch {
    return false;
  }
}
```

E dentro `createScreens` sostituisci la riga:

```ts
  let muted = false;
```

con:

```ts
  let muted = readPersistedMuted();
```

- [ ] **Step 7: Collega l'audio in `src/main.ts`**

Aggiungi l'import insieme agli altri:

```ts
import { createAudio } from './audio/audio';
```

Subito dopo la riga `const machine = createStateMachine();` inserisci:

```ts
const audio = createAudio();
audio.attach(bus);

/**
 * Sblocco dell'audio al primo gesto reale dell'utente: è l'unico momento in cui
 * iOS/Safari accetta il resume dell'AudioContext. I listener si tolgono da soli.
 */
const unlockAudio = (): void => {
  audio.unlock();
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('touchend', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('touchend', unlockAudio);
window.addEventListener('keydown', unlockAudio);
```

Sostituisci il segnaposto del toggle mute:

```ts
screens.onToggleMute(() => {
  // L'audio arriva nel Task 20: qui il toggle esiste già e non fa nulla.
});
```

con:

```ts
screens.onToggleMute((isMuted) => {
  audio.setMuted(isMuted);
});
```

- [ ] **Step 8: Verifica di tipi, test e build**

Comandi:
```bash
npm run typecheck
npm run test:run
npm run build
```
Atteso: tutti e tre senza errori.

- [ ] **Step 9: Verifica manuale nel browser**

Comando: `npm run dev`

- Primo click su PARTI: parte il muggito di inizio corsa (sawtooth che scende di tono). Se non si sente nulla, controlla che `unlock()` sia stato chiamato: in console, `document` deve aver ricevuto il primo pointerdown.
- Raccogliendo un fiocco si sente un "bip" triangolare che salta verso l'alto; raccogliendo una mucca, bip + muggito.
- Colpendo un ostacolo si sente un tonfo scuro e corto (rumore filtrato), non un click metallico.
- Al 100% di carica parte il rombo continuo, più forte se la taglia è alta; nell'ultimo secondo e mezzo cala; alla fine sfuma in meno di un secondo senza tagli netti.
- Il toggle "Audio: ON/OFF" nel menu silenzia tutto immediatamente, incluso un rombo in corso.
- Ricaricando la pagina con l'audio spento, il bottone mostra ancora "Audio: OFF" e il gioco resta muto (chiave `rollingcows.muted` in localStorage).
- Su iPhone: il primo tap sullo schermo sblocca l'audio; senza toccare nulla il gioco resta muto, ed è il comportamento corretto imposto dal sistema.

- [ ] **Step 10: Commit**

```bash
git add src/audio/audio.ts src/audio/audio.test.ts src/game/config.ts src/ui/screens.ts src/main.ts
git commit -m "feat(audio): add synthesized WebAudio sounds driven by the event bus"
```

### Task 21: Degradazione delle performance, fallback WebGL e rifinitura finale

**Files:**
- Create: `src/render/perf-monitor.ts`
- Test: `src/render/perf-monitor.test.ts`
- Create: `src/render/webgl-support.ts`
- Test: `src/render/webgl-support.test.ts`
- Modify: `src/game/config.ts`
- Modify: `src/style.css`
- Modify: `src/main.ts`
- Create: `README.md`

**Interfaces:**
- Consumes:
  - `CONFIG.perf.lowFpsThreshold`, `CONFIG.perf.lowFpsSeconds` da `src/game/config.ts`
  - `SceneContext.setQuality(low: boolean): void`, `SceneContext.shake(amount: number): void`, `SceneContext.renderer`, `SceneContext.camera` da `src/render/scene.ts`
  - `burstFromModel(pool: VoxelPool, model: VoxelModel, x: number, y: number, z: number, power: number): void` da `src/render/debris.ts`
  - `laneToX(lane: number): number` da `src/game/lanes.ts`
- Produces:
  - `interface PerfMonitor { readonly degraded: boolean; sample(dt: number): boolean; reset(): void }`
  - `createPerfMonitor(): PerfMonitor`
  - `isWebGLAvailable(canvasFactory?: () => HTMLCanvasElement): boolean`
  - `showWebGLError(root: HTMLElement): void`
  - `CONFIG.feel`, `CONFIG.perf.smoothingSeconds`, `CONFIG.perf.lowQualityParticleScale`, `CONFIG.perf.statsLogSeconds`

- [ ] **Step 1: Estendi la configurazione con i numeri di perf e di feel**

In `src/game/config.ts`, sostituisci il blocco `perf` con:

```ts
  perf: {
    lowFpsThreshold: 45,
    lowFpsSeconds: 3,
    /** Costante di tempo della media mobile degli FPS, in secondi. */
    smoothingSeconds: 0.5,
    /** Fattore applicato alle particelle quando la qualità viene abbassata. */
    lowQualityParticleScale: 0.35,
    /** Ogni quanti secondi loggare draw call e triangoli in console. */
    statsLogSeconds: 5,
  },
```

e aggiungi, subito dopo, il nuovo blocco `feel` (ultimo dell'oggetto `CONFIG`):

```ts
  feel: {
    /** Rallentatore alla morte: quanto dura e quanto rallenta. */
    deathSlowSeconds: 0.8,
    deathTimeScale: 0.35,
    /** Ampiezza dello scuotimento di camera per i vari eventi. */
    impactShake: 0.7,
    avalancheShake: 1.1,
    deathShake: 1.6,
    /** Potenza dell'esplosione di cubetti. */
    deathBurstPower: 9,
    smashBurstPower: 6,
    /** Velocità di smorzamento della transizione di FOV (1/s). */
    fovLerpPerSecond: 3.5,
  },
```

- [ ] **Step 2: Scrivi il test che fallisce (monitor delle performance)**

`src/render/perf-monitor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../game/config';
import { createPerfMonitor } from './perf-monitor';

const FRAME_60 = 1 / 60;
const FRAME_30 = 1 / 30;

describe('createPerfMonitor', () => {
  it('a 60fps non chiede mai il degrado', () => {
    const monitor = createPerfMonitor();

    let triggered = false;
    for (let i = 0; i < 600; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }

    expect(triggered).toBe(false);
    expect(monitor.degraded).toBe(false);
  });

  it('a 30fps scatta dopo circa lowFpsSeconds e una sola volta', () => {
    const monitor = createPerfMonitor();

    let triggerFrame = -1;
    let triggerCount = 0;
    for (let i = 0; i < 600; i += 1) {
      if (monitor.sample(FRAME_30)) {
        triggerCount += 1;
        if (triggerFrame < 0) {
          triggerFrame = i;
        }
      }
    }

    const expectedFrame = CONFIG.perf.lowFpsSeconds / FRAME_30;
    expect(triggerCount).toBe(1);
    expect(triggerFrame).toBeGreaterThan(expectedFrame - 5);
    expect(triggerFrame).toBeLessThan(expectedFrame + 5);
    expect(monitor.degraded).toBe(true);
  });

  it('un calo isolato e breve non fa scattare il degrado', () => {
    const monitor = createPerfMonitor();

    let triggered = false;
    for (let i = 0; i < 20; i += 1) {
      triggered = monitor.sample(FRAME_30) || triggered;
    }
    for (let i = 0; i < 600; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }

    expect(triggered).toBe(false);
  });

  it('ignora i delta non positivi', () => {
    const monitor = createPerfMonitor();

    expect(monitor.sample(0)).toBe(false);
    expect(monitor.sample(-1)).toBe(false);
    expect(monitor.degraded).toBe(false);
  });

  it('reset riporta il monitor allo stato iniziale', () => {
    const monitor = createPerfMonitor();
    for (let i = 0; i < 300; i += 1) {
      monitor.sample(FRAME_30);
    }
    expect(monitor.degraded).toBe(true);

    monitor.reset();
    expect(monitor.degraded).toBe(false);

    let triggered = false;
    for (let i = 0; i < 600; i += 1) {
      triggered = monitor.sample(FRAME_60) || triggered;
    }
    expect(triggered).toBe(false);
  });
});
```

- [ ] **Step 3: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/perf-monitor.test.ts`
Atteso: FAIL con `Failed to resolve import "./perf-monitor"`.

- [ ] **Step 4: Implementa `src/render/perf-monitor.ts`**

```ts
import { CONFIG } from '../game/config';

export interface PerfMonitor {
  /** true dal momento in cui il degrado è stato richiesto. */
  readonly degraded: boolean;
  /** Campiona un frame. Restituisce true SOLO nel frame in cui scatta il degrado. */
  sample(dt: number): boolean;
  reset(): void;
}

/**
 * Logica pura (niente three, niente DOM): decide quando abbassare la qualità.
 *
 * Gli FPS istantanei sono rumorosissimi — un singolo frame lungo per un garbage
 * collect non deve spegnere le ombre. Si usa quindi una media mobile
 * esponenziale con costante di tempo `CONFIG.perf.smoothingSeconds`, e il
 * degrado scatta solo se la media resta sotto soglia per
 * `CONFIG.perf.lowFpsSeconds` CONSECUTIVI. Scatta una volta sola: la qualità si
 * abbassa, non si mette a oscillare.
 */
export function createPerfMonitor(): PerfMonitor {
  let averageFps = 0;
  let seeded = false;
  let belowSeconds = 0;
  let degraded = false;

  return {
    get degraded(): boolean {
      return degraded;
    },

    sample(dt: number): boolean {
      if (dt <= 0) {
        return false;
      }

      const fps = 1 / dt;
      if (!seeded) {
        averageFps = fps;
        seeded = true;
      } else {
        const alpha = Math.min(1, dt / CONFIG.perf.smoothingSeconds);
        averageFps += (fps - averageFps) * alpha;
      }

      if (averageFps < CONFIG.perf.lowFpsThreshold) {
        belowSeconds += dt;
      } else {
        belowSeconds = 0;
      }

      if (!degraded && belowSeconds >= CONFIG.perf.lowFpsSeconds) {
        degraded = true;
        return true;
      }
      return false;
    },

    reset(): void {
      averageFps = 0;
      seeded = false;
      belowSeconds = 0;
      degraded = false;
    },
  };
}
```

- [ ] **Step 5: Esegui il test e verifica che passi**

Comando: `npm run test:run -- src/render/perf-monitor.test.ts`
Atteso: PASS, 5 test verdi.

- [ ] **Step 6: Scrivi il test che fallisce (rilevamento WebGL)**

`src/render/webgl-support.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isWebGLAvailable, showWebGLError } from './webgl-support';

/** Canvas finto: getContext risponde quello che decide il test. */
function fakeCanvas(result: unknown): () => HTMLCanvasElement {
  return () =>
    ({
      getContext: () => result,
    }) as unknown as HTMLCanvasElement;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isWebGLAvailable', () => {
  it('è false quando getContext restituisce null', () => {
    expect(isWebGLAvailable(fakeCanvas(null))).toBe(false);
  });

  it('è true quando getContext restituisce un contesto', () => {
    expect(isWebGLAvailable(fakeCanvas({ drawingBufferWidth: 300 }))).toBe(true);
  });

  it('è false se la creazione del canvas o del contesto lancia', () => {
    const throwing = (): HTMLCanvasElement => {
      throw new Error('contesto negato');
    };
    expect(isWebGLAvailable(throwing)).toBe(false);
  });
});

describe('showWebGLError', () => {
  it('scrive un messaggio leggibile nel contenitore', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    showWebGLError(root);

    const message = root.querySelector('.fatal');
    expect(message).not.toBeNull();
    expect(root.textContent).toContain('WebGL');
  });
});
```

- [ ] **Step 7: Esegui il test e verifica che fallisca**

Comando: `npm run test:run -- src/render/webgl-support.test.ts`
Atteso: FAIL con `Failed to resolve import "./webgl-support"`.

- [ ] **Step 8: Implementa `src/render/webgl-support.ts`**

```ts
/**
 * Rilevamento del supporto WebGL. Il canvas è iniettabile per poterlo testare
 * in jsdom, dove `getContext('webgl')` restituisce sempre null.
 */
export function isWebGLAvailable(
  canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas'),
): boolean {
  try {
    const canvas = canvasFactory();
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return context !== null && context !== undefined;
  } catch {
    // Alcuni browser lanciano invece di restituire null quando l'accelerazione
    // è disattivata o la lista nera delle GPU colpisce il dispositivo.
    return false;
  }
}

/** Messaggio pulito al posto dello schermo nero quando WebGL manca. */
export function showWebGLError(root: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.innerHTML = `
    <h1 class="fatal__title">Rolling Cows non può partire</h1>
    <p class="fatal__text">
      Questo browser non espone WebGL, che serve a disegnare il gioco in 3D.
    </p>
    <p class="fatal__text">
      Prova ad aggiornare il browser, oppure ad attivare l'accelerazione hardware
      nelle impostazioni. Su desktop funziona con Chrome, Firefox, Edge e Safari
      aggiornati.
    </p>
  `;
  root.appendChild(box);
}
```

- [ ] **Step 9: Esegui i test e verifica che passino**

Comando: `npm run test:run -- src/render/webgl-support.test.ts`
Atteso: PASS, 4 test verdi.

- [ ] **Step 10: Aggiungi al CSS lo stile del messaggio di errore**

In coda a `src/style.css` aggiungi:

```css
/* -------------------------------------------------- errore bloccante -- */

.fatal {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: calc(24px + env(safe-area-inset-top)) calc(24px + env(safe-area-inset-right))
    calc(24px + env(safe-area-inset-bottom)) calc(24px + env(safe-area-inset-left));
  text-align: center;
  background: #0b1c2c;
  /* Il testo deve essere selezionabile: serve a chi chiede aiuto. */
  -webkit-user-select: text;
  user-select: text;
  pointer-events: auto;
}

.fatal__title {
  margin: 0;
  font-size: clamp(24px, 7vw, 36px);
  font-weight: 800;
}

.fatal__text {
  max-width: 40ch;
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
  opacity: 0.8;
}
```

- [ ] **Step 11: Scrivi la versione finale di `src/main.ts`**

`src/main.ts` (contenuto completo, sostituisce quello del Task 20):

```ts
import * as THREE from 'three';
import './style.css';
import { createAudio } from './audio/audio';
import { createEventBus } from './core/events';
import { createLoop } from './core/loop';
import { createStateMachine } from './core/state-machine';
import { CONFIG } from './game/config';
import { createGame, handleAction, startRun, updateGame } from './game/game';
import { laneToX } from './game/lanes';
import { loadRecord } from './game/score';
import { createInput } from './input/input';
import { avalancheTrail, burstFromModel } from './render/debris';
import { createEntitiesView } from './render/entities-view';
import { buildGeometry, MODELS } from './render/models';
import { createPerfMonitor } from './render/perf-monitor';
import { createScene } from './render/scene';
import { createTerrain } from './render/terrain';
import { createVoxelPool } from './render/voxel-pool';
import { isWebGLAvailable, showWebGLError } from './render/webgl-support';
import { createHud } from './ui/hud';
import { createScreens } from './ui/screens';

const canvas = document.getElementById('game-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Canvas #game-canvas non trovato');
}

const uiRoot = document.getElementById('ui');
if (uiRoot === null) {
  throw new Error('Contenitore #ui non trovato');
}

function bootstrap(gameCanvas: HTMLCanvasElement, ui: HTMLElement): void {
  const scene = createScene(gameCanvas);
  const bus = createEventBus();
  const game = createGame(Date.now(), bus);

  const terrain = createTerrain();
  const entitiesView = createEntitiesView();
  const pool = createVoxelPool(CONFIG.render.voxelPoolSize, CONFIG.render.voxelSize);
  scene.scene.add(terrain.group);
  scene.scene.add(entitiesView.group);
  scene.scene.add(pool.mesh);

  const cow = new THREE.Mesh(
    buildGeometry(MODELS.cow, CONFIG.render.voxelSize),
    new THREE.MeshLambertMaterial({ vertexColors: true }),
  );
  scene.scene.add(cow);

  const input = createInput(gameCanvas);
  const hud = createHud(ui);
  const screens = createScreens(ui);
  const machine = createStateMachine();
  const perf = createPerfMonitor();
  const audio = createAudio();
  audio.attach(bus);

  /**
   * Sblocco dell'audio al primo gesto reale dell'utente: è l'unico momento in
   * cui iOS/Safari accetta il resume dell'AudioContext. I listener si tolgono
   * da soli.
   */
  const unlockAudio = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('touchend', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio);
  window.addEventListener('touchend', unlockAudio);
  window.addEventListener('keydown', unlockAudio);

  let record = loadRecord();
  let particleScale = 1;
  let fov = CONFIG.render.cameraBaseFov;
  let statsTimer = 0;

  /** Rallentatore alla morte: si continua a renderizzare, poi arriva il game over. */
  let dyingSeconds = 0;
  let pendingGameOver: { points: number; distance: number; isRecord: boolean } | null = null;

  function goToMenu(): void {
    if (machine.transition('menu')) {
      screens.setMenuRecord(record);
      screens.show('menu');
    }
  }

  function beginRun(): void {
    if (!machine.transition('playing')) {
      return;
    }
    startRun(game, Date.now());
    pool.reset();
    dyingSeconds = 0;
    pendingGameOver = null;
    cow.visible = true;
    screens.show('playing');
  }

  function togglePause(): void {
    if (machine.current === 'playing' && machine.transition('paused')) {
      screens.show('paused');
      return;
    }
    if (machine.current === 'paused' && machine.transition('playing')) {
      screens.show('playing');
    }
  }

  function showGameOver(): void {
    const payload = pendingGameOver;
    pendingGameOver = null;
    if (payload === null || !machine.transition('gameover')) {
      return;
    }
    screens.setGameOver(payload.points, record, payload.isRecord);
    screens.show('gameover');
  }

  screens.onStart(beginRun);
  screens.onRestart(beginRun);
  screens.onResume(togglePause);
  screens.onMenu(goToMenu);
  screens.onToggleMute((isMuted) => {
    audio.setMuted(isMuted);
  });

  bus.on('obstacle:hit', (payload) => {
    scene.shake(CONFIG.feel.impactShake);
    if (payload.outcome === 'smashed') {
      burstFromModel(
        pool,
        MODELS[payload.kind],
        laneToX(payload.lane),
        0,
        payload.z,
        CONFIG.feel.smashBurstPower * particleScale,
      );
    }
  });

  bus.on('avalanche:triggered', () => {
    scene.shake(CONFIG.feel.avalancheShake);
  });

  bus.on('run:ended', (payload) => {
    record = Math.max(record, payload.points);
    pendingGameOver = payload;
    dyingSeconds = CONFIG.feel.deathSlowSeconds;
    scene.shake(CONFIG.feel.deathShake);
    burstFromModel(
      pool,
      MODELS.cow,
      game.player.x,
      game.player.y,
      0,
      CONFIG.feel.deathBurstPower * particleScale,
    );
    cow.visible = false;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && machine.current === 'playing') {
      machine.transition('paused');
      screens.show('paused');
    }
  });

  window.addEventListener('blur', () => {
    if (machine.current === 'playing') {
      machine.transition('paused');
      screens.show('paused');
    }
  });

  window.addEventListener('resize', () => scene.resize());
  window.visualViewport?.addEventListener('resize', () => scene.resize());

  /** Scala del modello mucca derivata dall'altezza dichiarata in config. */
  function cowScale(size: number): number {
    const { baseHeight, heightPerSize } = CONFIG.player;
    return (baseHeight + heightPerSize * (size - 1)) / baseHeight;
  }

  function syncCow(dt: number): void {
    const scale = cowScale(game.avalanche.size);
    cow.scale.setScalar(scale);
    cow.position.set(game.player.x, game.player.y + (CONFIG.player.baseHeight * scale) / 2, 0);
    const radius = (CONFIG.player.baseHeight * scale) / 2;
    cow.rotation.x -= (game.world.speed * dt) / radius;
  }

  function syncHud(): void {
    hud.setPoints(game.score.points);
    hud.setCharge(game.avalanche.charge / CONFIG.avalanche.threshold);
    hud.setSize(game.avalanche.size);
    hud.setAvalanche(game.avalanche.phase !== 'idle', game.avalanche.phase === 'warning');
  }

  /**
   * Il FOV è governato qui, dopo scene.update, così la transizione verso il
   * grandangolo della valanga è smorzata in modo uniforme e indipendente dal
   * frame rate.
   */
  function updateFov(dt: number, inAvalanche: boolean): void {
    const target = inAvalanche ? CONFIG.render.cameraAvalancheFov : CONFIG.render.cameraBaseFov;
    fov += (target - fov) * (1 - Math.exp(-CONFIG.feel.fovLerpPerSecond * dt));
    if (Math.abs(scene.camera.fov - fov) > 0.01) {
      scene.camera.fov = fov;
      scene.camera.updateProjectionMatrix();
    }
  }

  function logStats(dt: number): void {
    statsTimer += dt;
    if (statsTimer < CONFIG.perf.statsLogSeconds) {
      return;
    }
    statsTimer = 0;
    const info = scene.renderer.info.render;
    console.info(`[perf] draw call: ${info.calls} | triangoli: ${info.triangles} | budget: <60 / <150000`);
  }

  function update(dt: number): void {
    if (perf.sample(dt) && particleScale === 1) {
      particleScale = CONFIG.perf.lowQualityParticleScale;
      scene.setQuality(true);
      console.info('[perf] frame rate basso: qualità ridotta (ombre off, meno particelle)');
    }

    // PAUSE va letto in qualunque stato, altrimenti da fermi Esc non riprende.
    const action = input.consume();
    if (action === 'PAUSE') {
      togglePause();
    } else if (action !== null && machine.current === 'playing' && dyingSeconds <= 0) {
      handleAction(game, action);
    }

    // Morte: la logica di gioco è ferma, ma i detriti volano al rallentatore.
    if (dyingSeconds > 0) {
      dyingSeconds -= dt;
      const slowDt = dt * CONFIG.feel.deathTimeScale;
      pool.update(slowDt, game.world.speed * CONFIG.feel.deathTimeScale);
      scene.update(slowDt, game.avalanche.size, false);
      updateFov(slowDt, false);
      logStats(dt);
      if (dyingSeconds <= 0) {
        showGameOver();
      }
      return;
    }

    const playing = machine.current === 'playing';
    if (playing) {
      updateGame(game, dt);
      syncHud();
    }

    // La vista continua a vivere anche in menu, pausa e game over.
    syncCow(playing ? dt : 0);

    const inAvalanche = playing && game.avalanche.phase !== 'idle';
    if (inAvalanche) {
      avalancheTrail(
        pool,
        dt,
        game.player.x,
        game.player.y,
        0,
        (game.avalanche.size / CONFIG.avalanche.maxSize) * particleScale,
      );
    }
    pool.update(dt, game.world.speed);
    scene.update(dt, game.avalanche.size, inAvalanche);
    updateFov(dt, inAvalanche);
    logStats(dt);
  }

  function render(): void {
    terrain.sync(game.world);
    entitiesView.sync(game.entities);
    scene.render();
  }

  const loop = createLoop({ update, render });

  goToMenu();
  syncHud();
  loop.start();
}

if (isWebGLAvailable()) {
  bootstrap(canvas, uiRoot);
} else {
  canvas.remove();
  showWebGLError(uiRoot);
}
```

- [ ] **Step 12: Scrivi il README**

`README.md`:

````markdown
# Rolling Cows

Endless runner voxel in cui una mucca rotola giù da una montagna, cresce
raccogliendo neve, fieno e altre mucche, e al culmine esplode in una valanga che
sfonda tutto a punteggio moltiplicato. Poi torna piccola e si ricomincia.

L'idea originale è di mia figlia.

Niente asset esterni: modelli, effetti e suoni sono generati da codice.

## Come si gioca

Obiettivo: andare il più lontano possibile e riempire la barra di carica.

| Comando | Telefono | Desktop |
|---|---|---|
| Cambia corsia | swipe a sinistra / a destra | frecce sinistra/destra, A/D |
| Salta | swipe verso l'alto | freccia su, W, barra spaziatrice |
| Schiacciata | swipe verso il basso | freccia giù, S |
| Pausa | bottone in pausa | Esc, P |

- Rocce e baite bloccano sempre. Alberi e staccionate si sfondano da taglia 3 in
  su. I crepacci vanno saltati, i rami sospesi vanno passati con la schiacciata.
- Fiocco di neve, balla di fieno e altra mucca caricano la barra; l'altra mucca
  fa anche crescere di una taglia.
- A barra piena parte la valanga: 8 secondi di invulnerabilità, distruzione
  totale e punteggio ×4. Negli ultimi 1,5 secondi l'interfaccia lampeggia: è il
  momento di rimettersi in una corsia libera.
- Alla fine della valanga carica e taglia tornano a zero. Lo sfogo si paga.
- Primo impatto perdonato: se la barra è almeno a metà, il primo colpo non
  uccide ma azzera la carica e toglie una taglia.

Il record è salvato in `localStorage`, sul dispositivo.

## Comandi npm

| Comando | Cosa fa |
|---|---|
| `npm install` | installa le dipendenze (Node 20+) |
| `npm run dev` | server di sviluppo su http://localhost:5173/rollingCows/ |
| `npm run dev -- --host` | come sopra, raggiungibile dal telefono sulla rete locale |
| `npm run build` | build di produzione in `dist/` |
| `npm run preview` | serve la build di produzione in locale |
| `npm run test` | test in watch |
| `npm run test:run` | test una volta sola (CI) |
| `npm run typecheck` | controllo dei tipi TypeScript |

## Struttura

```
src/
  core/    # loop a timestep fisso, bus eventi, macchina a stati, PRNG con seed
  game/    # regole di gioco: TypeScript puro, zero three, zero DOM, tutto testato
  render/  # three.js: scena, terreno, entità, pool di voxel, detriti
  ui/      # HUD e schermate in HTML/CSS sopra al canvas
  input/   # swipe e tastiera tradotti in azioni astratte
  audio/   # sintesi WebAudio, consumatore del bus eventi
```

Regole di progetto: `core/` e `game/` non importano mai `three` e non toccano il
DOM; ogni numero di bilanciamento sta in `src/game/config.ts`; nel loop non si
alloca (pool preallocati).

## Deploy

Ogni push su `main` fa partire il workflow GitHub Actions che esegue typecheck,
test e build e pubblica `dist/` su GitHub Pages. La `base` di Vite è
`/rollingCows/`: se il repository viene rinominato va aggiornata in
`vite.config.ts`.

Per pubblicare a mano:

```bash
npm run build
npm run preview   # controlla la build prima di pubblicare
```
````

- [ ] **Step 13: Passata finale di verifica**

Comandi:
```bash
npm run typecheck
npm run test:run
npm run build
```
Atteso: nessun errore di tipo, tutti i test verdi, build completata con il
riepilogo dei bundle.

Verifica del budget di draw call:
```bash
npm run dev
```
Apri la console del browser: ogni 5 secondi compare
`[perf] draw call: N | triangoli: M | budget: <60 / <150000`.
Atteso: `N` sotto 60 anche durante la valanga con la scia di cubetti al massimo,
`M` sotto 150000. Se `N` supera 60, il colpevole è quasi sempre un tipo di
entità non istanziato in `entities-view.ts`.

Verifica su telefono vero:
```bash
npm run dev -- --host
```
Apri dal telefono `http://<ip-del-computer>:5173/rollingCows/` sulla stessa rete
Wi-Fi e controlla:
- 60fps stabili in corsa normale; se il dispositivo non ce la fa, dopo ~3 secondi
  compare in console `[perf] frame rate basso: qualità ridotta` e le ombre si
  spengono senza che il gioco si blocchi.
- Alla morte c'è un rallentatore breve (circa 0,8 s a velocità ridotta) mentre la
  mucca si disintegra in cubetti, e SOLO dopo compare la schermata di game over.
- All'impatto e all'innesco della valanga la camera scuote brevemente.
- Entrando in valanga l'inquadratura si allarga in modo morbido, non a scatto, e
  torna altrettanto morbida alla fine.
- La pagina non scrolla mai, i bottoni non finiscono sotto al notch.

Verifica del fallback WebGL: nei devtools di Chrome apri il menu a tre puntini →
More tools → Rendering → spunta "Disable WebGL" (oppure `chrome://settings` →
Sistema → disattiva "Usa accelerazione hardware") e ricarica: al posto dello
schermo nero deve comparire il messaggio "Rolling Cows non può partire" con il
testo leggibile e selezionabile.

- [ ] **Step 14: Commit**

```bash
git add src/render/perf-monitor.ts src/render/perf-monitor.test.ts src/render/webgl-support.ts src/render/webgl-support.test.ts src/game/config.ts src/style.css src/main.ts README.md
git commit -m "feat(perf): add adaptive quality, WebGL fallback, death slow-motion and README"
```

---
