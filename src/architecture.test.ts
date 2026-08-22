import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Le tre regole di progetto dichiarate nel README — «core/ e game/ non
 * importano mai three», «core/ e game/ non toccano il DOM», «render/ e ui/ non
 * si conoscono» — sono la ragione per cui la logica di gioco è testabile in
 * node senza browser né WebGL. Finora esistevano solo come paragrafo di
 * documentazione: nulla impediva a un `import * as THREE from 'three'` in
 * game/collisions.ts di entrare nel repository e portarsi dietro, in silenzio,
 * la fine della testabilità.
 *
 * Questo file legge i sorgenti da disco (l'ambiente di vitest è `node`) e
 * trasforma quel paragrafo in un vincolo. Le deroghe legittime stanno in una
 * ALLOWLIST esplicita: il punto non è vietarle, è renderle visibili.
 */

const SRC = new URL('.', import.meta.url).pathname;

interface SourceFile {
  /** Percorso relativo a src/, con separatori '/' — la forma usata nei messaggi. */
  path: string;
  lines: readonly string[];
}

function collect(dir: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, out);
      continue;
    }
    if (!entry.name.endsWith('.ts')) continue;
    // I test possono legittimamente simulare il DOM o importare three: la
    // regola vale sul codice che finisce nel bundle.
    if (entry.name.endsWith('.test.ts')) continue;
    out.push({
      path: relative(SRC, full).split('\\').join('/'),
      lines: readFileSync(full, 'utf8').split('\n'),
    });
  }
}

const ALL_FILES: readonly SourceFile[] = (() => {
  const files: SourceFile[] = [];
  collect(SRC, files);
  return files;
})();

function under(...prefixes: string[]): SourceFile[] {
  return ALL_FILES.filter((file) => prefixes.some((prefix) => file.path.startsWith(prefix)));
}

/** Righe di solo commento: un `// niente three qui` non è una violazione. */
function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

/**
 * Deroghe esplicite alla regola «core/ e game/ non toccano il DOM».
 *
 * È vuota, e non per caso: la persistenza del record è stata spostata in
 * `platform/storage.ts`, che è il posto giusto per l'unica API di browser che
 * non sia rendering o input. `core/loop.ts` non ha bisogno di comparire qui
 * perché usa `globalThis.requestAnimationFrame`, che non è fra i simboli
 * vietati proprio in quanto già protetto da un `typeof … === 'function'` e
 * degradabile fuori dal browser.
 *
 * Se un giorno servirà una deroga vera, va scritta qui con il suo perché: il
 * punto della lista non è vietare, è rendere visibile.
 */
const DOM_ALLOWLIST: readonly { file: string; symbol: string; why: string }[] = [];

function format(violations: readonly Violation[]): string {
  return violations.map((v) => `  src/${v.file}:${v.line}  ${v.text.trim()}`).join('\n');
}

function scan(
  files: readonly SourceFile[],
  matches: (line: string) => boolean,
  allow: (file: string, line: string) => boolean = () => false,
): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      if (isComment(text) || !matches(text)) return;
      if (allow(file.path, text)) return;
      violations.push({ file: file.path, line: index + 1, text });
    });
  }
  return violations;
}

/** `import ... from 'x'`, `export ... from 'x'`, `import('x')`. */
function importSpecifier(line: string): string | null {
  const match =
    /(?:^|\s)(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/.exec(line) ??
    /(?:^|\s)import\s*\(\s*['"]([^'"]+)['"]/.exec(line) ??
    /(?:^|\s)import\s*['"]([^'"]+)['"]/.exec(line);
  return match?.[1] ?? null;
}

describe('regole di progetto', () => {
  it('nessun file sotto core/ o game/ importa three', () => {
    const violations = scan(under('core/', 'game/'), (line) => {
      const specifier = importSpecifier(line);
      return specifier === 'three' || specifier?.startsWith('three/') === true;
    });
    expect(
      violations,
      `core/ e game/ devono restare puri (testabili in node, senza WebGL):\n${format(violations)}`,
    ).toEqual([]);
  });

  it('nessun file sotto core/ o game/ tocca il DOM', () => {
    const forbidden = /\b(document|window|HTMLElement|addEventListener|localStorage)\b/;

    const violations = scan(
      under('core/', 'game/'),
      (line) => forbidden.test(line),
      (file, line) => DOM_ALLOWLIST.some((d) => d.file === file && line.includes(d.symbol)),
    );
    expect(
      violations,
      'core/ e game/ non devono conoscere il browser; se la deroga è voluta, ' +
        `mettila in DOM_ALLOWLIST con il suo perché:\n${format(violations)}`,
    ).toEqual([]);
  });

  it("l'allowlist del DOM non contiene deroghe morte", () => {
    // Una deroga che non serve più è peggio di nessuna deroga: legittima in
    // anticipo un accesso che nessuno sta chiedendo. Quando il codice smette di
    // averne bisogno, la riga deve sparire — e questo test lo impone.
    const dead = DOM_ALLOWLIST.filter((deroga) => {
      const file = ALL_FILES.find((f) => f.path === deroga.file);
      return (
        file === undefined ||
        !file.lines.some((line) => !isComment(line) && line.includes(deroga.symbol))
      );
    });
    expect(
      dead.map((d) => `${d.file} → ${d.symbol}`),
      'deroghe in DOM_ALLOWLIST che nessun file usa più: vanno tolte',
    ).toEqual([]);
  });

  it('render/ e ui/ non si importano a vicenda', () => {
    // La vista 3D e l'HUD in HTML comunicano solo attraverso main.ts e il bus
    // eventi: è ciò che permette di cambiare l'una senza ricompilare l'altra
    // nella propria testa.
    const crossImport = (fromDir: 'render/' | 'ui/', toDir: 'render' | 'ui') =>
      scan(under(fromDir), (line) => {
        const specifier = importSpecifier(line);
        if (specifier === null) return false;
        return specifier.startsWith(`../${toDir}/`) || specifier === `../${toDir}`;
      });

    const violations = [...crossImport('render/', 'ui'), ...crossImport('ui/', 'render')];
    expect(
      violations,
      `render/ e ui/ devono restare separati, il collante è main.ts:\n${format(violations)}`,
    ).toEqual([]);
  });

  it('i numeri di bilanciamento stanno in game/config.ts', () => {
    // La regola per intero non è verificabile a macchina: un `i < 3` in un ciclo
    // è un numero come un altro. Verificabile è però la forma in cui il
    // bilanciamento fugge davvero da config.ts, cioè la costante numerica a
    // livello di modulo — `const DEATH_SLOW_SECONDS = 0.8` in cima a un file di
    // regole. Oggi in game/ non ce n'è nessuna fuori da config.ts, ed è quella
    // proprietà che questo test difende.
    const moduleLevelNumber = /^(?:const|let)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*-?\d/;
    // Unica categoria esentata: le tolleranze in virgola mobile (`*_EPSILON`).
    // Non sono bilanciamento — nessuno le "regola" per rendere il gioco più
    // facile — ma igiene del confronto fra float, e spostarle in config le
    // renderebbe meno leggibili proprio dove servono.
    const epsilon = /^(?:const|let)\s+[A-Za-z_$][\w$]*_EPSILON\b/;
    const rules = under('game/').filter((file) => file.path !== 'game/config.ts');
    const violations = scan(rules, (line) => moduleLevelNumber.test(line) && !epsilon.test(line));
    expect(
      violations,
      `numeri di bilanciamento fuori da config.ts:\n${format(violations)}`,
    ).toEqual([]);
  });
});
