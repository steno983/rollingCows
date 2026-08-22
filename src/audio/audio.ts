import type { EventBus } from '../core/events';
import { createRng } from '../core/rng';
import { CONFIG } from '../game/config';
import type { BuffKind } from '../game/types';

export interface Audio {
  attach(bus: EventBus): void;
  setMuted(muted: boolean): void;
  readonly muted: boolean;
  unlock(): void;
}

type ContextFactory = () => AudioContext;

/**
 * Seed del rumore bianco. Il rumore non ha alcun bisogno di essere
 * riproducibile — nessuno distingue fra due secondi di rumore diversi — ma la
 * regola del progetto sì: ogni sorgente casuale passa da createRng, fino al
 * jitter dello scuotimento di camera. Math.random() qui dentro era l'ultima
 * eccezione rimasta in tutta la codebase, e una regola con un'eccezione non è
 * più una regola: la prossima cosa aleatoria che qualcuno aggiunge all'audio
 * la copierebbe.
 */
const NOISE_SEED = 0x6f0f1a3d;

/**
 * Quanti tocchi scandiscono l'ultimo secondo di valanga. Tre è una struttura,
 * non un parametro da tarare (come le tre note di sparkle): la spaziatura si
 * ricava da CONFIG.avalanche.warningSeconds, che è il secondo da riempire.
 */
const ENDING_TICK_COUNT = 3;

/**
 * Un rumore filtrato che resta acceso finché non lo si spegne. Il rombo della
 * valanga e il fruscio della scivolata sono lo stesso oggetto — cambia solo il
 * filtro — e devono spegnersi allo stesso modo: un BufferSourceNode in loop
 * dimenticato acceso suona per sempre (è già successo al rombo su tre percorsi
 * diversi, vedi i listener run:*). Una sola implementazione, un solo modo di
 * sbagliare.
 */
interface NoiseLoop {
  source: AudioBufferSourceNode;
  gain: GainNode;
  /** Livello a regime: il duck deve tornare a una frazione di QUESTO. */
  level: number;
}

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
 * `contextFactory` è iniettabile per i test (jsdom non implementa WebAudio): in
 * produzione si omette e si usa l'AudioContext del browser.
 */
export function createAudio(contextFactory: ContextFactory = defaultContextFactory): Audio {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let rumble: NoiseLoop | null = null;
  let slide: NoiseLoop | null = null;
  let muted = readMuted();
  let unlocked = false;
  /** Un gesto di sblocco arrivato da muto: va onorato quando l'audio torna attivo. */
  let unlockPending = false;
  /** Quanti fiocchi di fila: fa salire la scala della raccolta (vedi playPickup). */
  let pickupStreak = 0;
  /** Istante dell'ultima raccolta, nel tempo del contesto. -Infinity = mai. */
  let lastPickupAt = -Infinity;
  const subscriptions: Array<() => void> = [];

  function createNoiseBuffer(context: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(context.sampleRate * CONFIG.audio.noiseSeconds));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    const rng = createRng(NOISE_SEED);
    for (let i = 0; i < length; i += 1) {
      data[i] = rng.next() * 2 - 1;
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

  /* ------------------------------------------------- mattoni sonori -- */

  /**
   * Un colpo di rumore: la forma comune a impatto, scudo, stacco e
   * atterraggio. L'unica cosa che cambia davvero è il filtro — passa-basso
   * suona sordo e pesante (qualcosa che ti colpisce, qualcosa che tocca
   * terra), passa-alto suona cristallino e leggero (qualcosa che si spezza,
   * neve che schizza) — più la durata, che è tutto ciò che distingue un tonfo
   * da un impatto vero.
   */
  function playNoiseBurst(
    filterType: 'lowpass' | 'highpass',
    cutoffHz: number,
    seconds: number,
    level: number,
  ): void {
    const context = audible();
    if (context === null || master === null || noise === null) {
      return;
    }
    const t = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = noise;
    filter.type = filterType;
    filter.frequency.setValueAtTime(cutoffHz, t);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + seconds);
  }

  function startNoiseLoop(options: {
    cutoffHz: number;
    /** Q del filtro, o null per lasciare quello di serie: solo la scivolata
     *  vuole un filo di risonanza (una banda stretta "frusciante"), il rombo
     *  vuole un taglio piatto e largo. */
    resonance: number | null;
    level: number;
    riseSeconds: number;
  }): NoiseLoop | null {
    const context = audible();
    if (context === null || master === null || noise === null) {
      return null;
    }
    const t = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = noise;
    source.loop = true;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(options.cutoffHz, t);
    if (options.resonance !== null) {
      filter.Q.setValueAtTime(options.resonance, t);
    }

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(options.level, t + options.riseSeconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);

    return { source, gain, level: options.level };
  }

  function stopNoiseLoop(loop: NoiseLoop | null, fadeSeconds: number): void {
    if (loop === null || ctx === null) {
      return;
    }
    const t = ctx.currentTime;
    loop.gain.gain.cancelScheduledValues(t);
    loop.gain.gain.linearRampToValueAtTime(0, t + fadeSeconds);
    loop.source.stop(t + fadeSeconds);
  }

  /* -------------------------------------------------------- le voci -- */

  /**
   * Il muggito. `pitchRatio` lo trasporta: la stessa voce più acuta a ogni
   * taglia della mucca (CONFIG.audio.sizeUp) è l'unico modo per far sentire la
   * crescita come una crescita e non come un secondo animale.
   */
  function playMoo(pitchRatio = 1, level: number = CONFIG.audio.moo.gain): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { startHz, endHz, seconds, attackRatio } = CONFIG.audio.moo;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(startHz * pitchRatio, t);
    osc.frequency.exponentialRampToValueAtTime(endHz * pitchRatio, t + seconds);

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level, t + seconds * attackRatio);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  function playImpact(): void {
    const { cutoffHz, seconds, gain: level } = CONFIG.audio.impact;
    playNoiseBurst('lowpass', cutoffHz, seconds, level);
  }

  /**
   * Raccolta di un fiocco. La coppia di note sale di un semitono per ogni
   * fiocco preso di seguito e riparte dopo una pausa: con la calamita attiva
   * se ne raccolgono quasi sei al secondo, e sei note identiche al secondo non
   * sono un premio, sono un ronzio. La scala ascendente è la tecnica di Mario
   * e di Sonic e fa esattamente il lavoro che serve qui — costruire tensione
   * verso la valanga, che di fiocchi ne richiede decine.
   */
  function playPickup(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const {
      lowHz,
      highHz,
      stepRatio,
      seconds,
      gain: level,
      streakResetSeconds,
      streakMaxSteps,
    } = CONFIG.audio.pickup;
    const t = context.currentTime;

    // La serie si azzera dopo una pausa, altrimenti due fiocchi raccolti a
    // dieci secondi di distanza suonerebbero come una progressione.
    // Oltre il tetto si riparte dal basso: salire all'infinito finirebbe
    // fuori dalla banda udibile in pochi secondi di calamita.
    pickupStreak =
      t - lastPickupAt > streakResetSeconds ? 0 : (pickupStreak + 1) % (streakMaxSteps + 1);
    lastPickupAt = t;
    const semitones = 2 ** (pickupStreak / 12);

    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(lowHz * semitones, t);
    osc.frequency.setValueAtTime(highHz * semitones, t + seconds * stepRatio);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  /** Stacco del salto: un soffio breve passa-alto. Deve essere quasi niente —
   *  si salta decine di volte al minuto — ma quel quasi niente è la differenza
   *  fra un comando che risponde e un comando che sembra rotto. Passa-alto
   *  perché la neve che schizza è tutta frequenze alte, ed è l'unica banda
   *  libera mentre sotto rombano valanga e scivolata. */
  function playJump(): void {
    const { cutoffHz, seconds, gain: level } = CONFIG.audio.jump;
    playNoiseBurst('highpass', cutoffHz, seconds, level);
  }

  /**
   * Atterraggio: tonfo sordo passa-basso, l'opposto del soffio dello stacco.
   * Il peso si interpola fra le due voci esistenti — un salto pieno atterra
   * col tonfo intero, un tocco a terra istantaneo pesa quanto il soffio con
   * cui si è staccato — invece di inventare un minimo arbitrario: quei due
   * livelli sono già tarati l'uno rispetto all'altro.
   */
  function playLand(airborneSeconds: number): void {
    const { cutoffHz, seconds, gain: heavy } = CONFIG.audio.land;
    const light = CONFIG.audio.jump.gain;
    const weight = Math.min(1, Math.max(0, airborneSeconds / CONFIG.player.jumpSeconds));
    playNoiseBurst('lowpass', cutoffHz, seconds, light + (heavy - light) * weight);
  }

  /** Scivolata: rumore filtrato IN LOOP finché dura, con un filo di risonanza
   *  che gli dà il carattere "frusciante" della pancia sulla neve invece di un
   *  soffio piatto. È un suono continuo perché la scivolata è uno stato, non
   *  un istante: un colpo secco all'inizio direbbe "hai premuto", non "stai
   *  scivolando". Stessa rampa in entrata e in uscita (fadeSeconds): un loop
   *  di rumore che parte o si spegne di scatto fa clic. */
  function startSlide(): void {
    if (slide !== null) {
      return;
    }
    const { cutoffHz, resonance, gain: level, fadeSeconds } = CONFIG.audio.slide;
    slide = startNoiseLoop({ cutoffHz, resonance, level, riseSeconds: fadeSeconds });
  }

  function stopSlide(): void {
    stopNoiseLoop(slide, CONFIG.audio.slide.fadeSeconds);
    slide = null;
  }

  /** Cristallo di ghiaccio: zap acuto e breve, la carica arriva in un colpo. */
  function playChime(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, highHz, seconds, gain: level } = CONFIG.audio.chime;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(lowHz, t);
    osc.frequency.exponentialRampToValueAtTime(highHz, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  /** Stella: due note ascendenti in un solo oscillatore (stesso trucco a
   *  "salti" di playPickup), più lunga e più mossa dello zap del cristallo
   *  per farla sentire come il buff più raro. `pitchRatio` la traspone: è la
   *  stessa festa un gradino sopra, usata per il record battuto. */
  function playSparkle(pitchRatio = 1): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, midHz, highHz, noteSeconds, gain: level } = CONFIG.audio.sparkle;
    const t = context.currentTime;
    const totalSeconds = noteSeconds * 3;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(lowHz * pitchRatio, t);
    osc.frequency.setValueAtTime(midHz * pitchRatio, t + noteSeconds);
    osc.frequency.setValueAtTime(highHz * pitchRatio, t + noteSeconds * 2);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + totalSeconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + totalSeconds);
  }

  /** Calamita: una sinusoide che SCENDE (l'opposto degli altri tre buff,
   *  tutti ascendenti) per suggerire l'attrazione verso il basso/il centro. */
  function playMagnetPull(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, highHz, seconds, gain: level } = CONFIG.audio.magnetPull;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(highHz, t);
    osc.frequency.exponentialRampToValueAtTime(lowHz, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  /** Campanaccio: fondamentale + una parziale NON armonica (rapporto non
   *  intero) con decadimento percussivo rapido — la tecnica minima per un
   *  timbro di metallo invece di un tono puro. È il buff che dà lo scudo:
   *  deve suonare come una vera mucca, non come gli altri tre.
   *  `delaySeconds` serve a scandire il preavviso di fine valanga: WebAudio
   *  schedula nel futuro senza timer, quindi tre clacchettii si accodano qui
   *  e basta. */
  function playCowbell(delaySeconds = 0): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const {
      fundamentalHz,
      overtoneRatio,
      seconds,
      gain: level,
      overtoneDecayRatio,
      overtoneGainRatio,
    } = CONFIG.audio.cowbell;
    const t = context.currentTime + delaySeconds;

    const body = context.createOscillator();
    const bodyGain = context.createGain();
    body.type = 'square';
    body.frequency.setValueAtTime(fundamentalHz, t);
    bodyGain.gain.setValueAtTime(level, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    body.connect(bodyGain);
    bodyGain.connect(master);
    body.start(t);
    body.stop(t + seconds);

    // La parziale non armonica dura e pesa meno della fondamentale: è ciò che
    // la rende un colore del metallo e non una seconda nota.
    const overtoneSeconds = seconds * overtoneDecayRatio;
    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(fundamentalHz * overtoneRatio, t);
    overtoneGain.gain.setValueAtTime(level * overtoneGainRatio, t);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, t + overtoneSeconds);
    overtone.connect(overtoneGain);
    overtoneGain.connect(master);
    overtone.start(t);
    overtone.stop(t + overtoneSeconds);
  }

  /** Dispatcher per raccolta: ogni buff ha un timbro proprio (vedi i
   *  commenti sui singoli CONFIG.audio.*), il campanaccio in particolare
   *  suona come un vero campanaccio (playCowbell), non come gli altri tre. */
  function playBuffSound(kind: BuffKind): void {
    switch (kind) {
      case 'crystal':
        playChime();
        break;
      case 'star':
        playSparkle();
        break;
      case 'magnet':
        playMagnetPull();
        break;
      case 'bell':
        playCowbell();
        break;
    }
  }

  /** Buff in scadenza: due note DISCENDENTI, cioè il gesto contrario a quello
   *  con cui ogni buff è arrivato (chime, sparkle e cowbell salgono). Non
   *  serve riconoscere quale sta finendo — l'HUD lo dice — serve capire in un
   *  quinto di secondo che qualcosa si sta togliendo invece di aggiungersi.
   *  Prima stella e calamita finivano in silenzio, con il badge che spariva
   *  dopo aver mostrato "1s" per un secondo intero. */
  function playBuffExpire(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { highHz, lowHz, seconds, gain: level } = CONFIG.audio.buffExpire;
    const t = context.currentTime;
    // `seconds` è la durata di UNA nota, come noteSeconds di sparkle.
    const totalSeconds = seconds * 2;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(highHz, t);
    osc.frequency.setValueAtTime(lowHz, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + totalSeconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + totalSeconds);
  }

  /** Fine della valanga: uno sgonfiamento lungo e discendente. È l'inverso
   *  timbrico del muggito che apre la valanga — stesso gesto in discesa, ma
   *  triangolare invece che a dente di sega, cioè senza le armoniche aspre
   *  dell'ingresso: la potenza se ne va, non arriva. */
  function playAvalancheEnd(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { startHz, endHz, seconds, gain: level } = CONFIG.audio.avalancheEnd;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startHz, t);
    osc.frequency.exponentialRampToValueAtTime(endHz, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  /** Il richiamo del bivio. `pitchRatio` = 1 è la comparsa; trasposto più in
   *  alto è la conferma della scelta: stessa famiglia, altra cosa. Un timbro
   *  del tutto diverso avrebbe raccontato due eventi scollegati, uno identico
   *  non avrebbe raccontato niente. */
  function playForkCall(pitchRatio: number, seconds: number, level: number): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, highHz } = CONFIG.audio.forkAppear;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(lowHz * pitchRatio, t);
    osc.frequency.exponentialRampToValueAtTime(highHz * pitchRatio, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  /** Comparsa di un bivio: un richiamo breve, distinto dai suoni di
   *  raccolta, per il momento in cui il giocatore deve alzare lo sguardo. */
  function playForkAppear(): void {
    const { seconds, gain: level } = CONFIG.audio.forkAppear;
    playForkCall(1, seconds, level);
  }

  /** Ramo scelto: era l'unico riscontro che il giocatore riceve prima del
   *  punto di non ritorno e non lo ascoltava nessuno. Più corto e più acuto
   *  della comparsa perché è una conferma, non una chiamata. */
  function playForkChosen(): void {
    const { pitchRatio, seconds, gain: level } = CONFIG.audio.forkChosen;
    playForkCall(pitchRatio, seconds, level);
  }

  /** Serie di ostacoli che sale di gradino: un tocco discreto. Non ha una
   *  voce propria in config perché non deve essere una voce nuova — è la nota
   *  alta della raccolta trasposta con lo stesso rapporto del bivio scelto
   *  ("la stessa cosa, un gradino sopra"), accorciata e alleggerita con i due
   *  rapporti del campanaccio, che esistono esattamente per dire "dura e pesa
   *  meno". Deve passare inosservata finché non la si nota: capita ogni dieci
   *  ostacoli e non deve competere con i fiocchi. */
  function playStreakTick(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { highHz, seconds, gain: level } = CONFIG.audio.pickup;
    const { overtoneDecayRatio, overtoneGainRatio } = CONFIG.audio.cowbell;
    const t = context.currentTime;
    const tickSeconds = seconds * overtoneDecayRatio;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(highHz * CONFIG.audio.forkChosen.pitchRatio, t);

    gain.gain.setValueAtTime(level * overtoneGainRatio, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + tickSeconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + tickSeconds);
  }

  /** Lo scudo che assorbe un colpo: rumore passa-alto, un "crac" cristallino
   *  distinto dal tonfo sordo passa-basso di un impatto normale (playImpact). */
  function playShieldBreak(): void {
    const { cutoffHz, seconds, gain: level } = CONFIG.audio.shieldBreak;
    playNoiseBurst('highpass', cutoffHz, seconds, level);
  }

  function stopRumble(fadeSeconds: number): void {
    stopNoiseLoop(rumble, fadeSeconds);
    rumble = null;
  }

  function startRumble(intensity: number): void {
    stopRumble(0);
    const { cutoffHz, maxGain, riseSeconds } = CONFIG.audio.rumble;
    rumble = startNoiseLoop({
      cutoffHz,
      resonance: null,
      level: maxGain * Math.max(0, Math.min(1, intensity)),
      riseSeconds,
    });
  }

  /** Negli ultimi secondi della valanga il rombo cala: la fine si sente arrivare. */
  function duckRumble(): void {
    if (rumble === null || ctx === null) {
      return;
    }
    const { endingGainRatio, duckSeconds } = CONFIG.audio.rumble;
    const t = ctx.currentTime;
    rumble.gain.gain.cancelScheduledValues(t);
    rumble.gain.gain.linearRampToValueAtTime(rumble.level * endingGainRatio, t + duckSeconds);
  }

  /**
   * Preavviso ATTIVO di fine valanga. Il duck del rombo, da solo, è
   * un'assenza — e un'assenza non è un segnale: chi non stava ascoltando il
   * rombo non si accorge che è calato. Sotto riduzione del movimento, che
   * spegne il lampeggio dell'HUD, era rimasto l'unico avviso di tutto il
   * gioco. Tre clacchettii di campanaccio scandiscono l'ultimo secondo: il
   * timbro metallico è l'unica cosa che passa sopra un rombo tagliato a
   * 380 Hz, ed è già la voce "di mucca" del gioco invece di un bip da timer.
   */
  function playEndingTicks(): void {
    const spacing = CONFIG.avalanche.warningSeconds / ENDING_TICK_COUNT;
    for (let i = 0; i < ENDING_TICK_COUNT; i += 1) {
      playCowbell(spacing * i);
    }
  }

  /** Apre e riprende il contesto. Presuppone di essere dentro (o subito dopo)
   *  un vero gesto dell'utente: vedi unlock(). */
  function resumeContext(): void {
    if (unlocked) {
      return;
    }
    unlocked = true;
    unlockPending = false;
    const context = ensure();
    if (context.state === 'suspended') {
      void context.resume();
    }
  }

  function detach(): void {
    while (subscriptions.length > 0) {
      subscriptions.pop()?.();
    }
  }

  return {
    attach(bus: EventBus): void {
      detach();
      subscriptions.push(
        bus.on('run:started', () => {
          // I loop si spengono SOLO sul proprio evento di chiusura: se si torna
          // al menu o si ricomincia mentre una valanga rombava o la mucca
          // scivolava (run:started sostituisce lo stato senza emettere
          // avalanche:ended né player:slideEnded), il BufferSourceNode in loop
          // continuava a suonare sul menu, sui record e per tutta la run
          // successiva. L'audio resta un consumatore del bus: si spegne qui,
          // niente chiamate dirette dal gioco.
          stopRumble(0);
          stopSlide();
          playMoo();
        }),
      );
      subscriptions.push(
        // Anche la morte durante una valanga (o durante una scivolata) deve
        // spegnere subito i loop: altrimenti continuano a suonare sulla
        // schermata di game over finché non si comincia una nuova run.
        bus.on('run:ended', () => {
          stopRumble(0);
          stopSlide();
        }),
      );
      subscriptions.push(
        // Run abbandonata da viva (Esc → MENU a metà valanga): nessun
        // run:started né run:ended viene emesso in questo percorso, quindi
        // senza questo listener i loop continuavano a suonare sul menu finché
        // non partiva una run nuova.
        bus.on('run:stopped', () => {
          stopRumble(0);
          stopSlide();
        }),
      );
      subscriptions.push(
        // In v2 la mucca non è più un raccoglibile (era 'cow', ora sostituita
        // da crystal/star/magnet/bell): nessuno di questi fa muggire, quindi
        // qui resta solo il suono di raccolta generico.
        bus.on('pickup:collected', () => {
          playPickup();
        }),
      );
      subscriptions.push(bus.on('buff:gained', (payload) => playBuffSound(payload.kind)));
      subscriptions.push(bus.on('buff:expiring', () => playBuffExpire()));
      subscriptions.push(bus.on('shield:consumed', () => playShieldBreak()));
      subscriptions.push(
        // Il bivio è il momento in cui il giocatore deve alzare lo sguardo:
        // un richiamo sonoro aiuta a non perderlo mentre si guarda l'HUD.
        bus.on('fork:appeared', () => playForkAppear()),
      );
      subscriptions.push(bus.on('fork:chosen', () => playForkChosen()));
      subscriptions.push(
        // Salto e scivolata: le due azioni più frequenti del gioco, mute fino
        // a qui. Un comando che non produce suono si legge come un comando
        // che non ha risposto.
        bus.on('player:jumped', () => playJump()),
      );
      subscriptions.push(bus.on('player:landed', (payload) => playLand(payload.airborneSeconds)));
      subscriptions.push(bus.on('player:slid', () => startSlide()));
      subscriptions.push(bus.on('player:slideEnded', () => stopSlide()));
      subscriptions.push(
        // La crescita della mucca è il cuore dell'idea originale del gioco ed
        // era completamente muta: stesso muggito, più acuto a ogni taglia.
        bus.on('size:changed', (payload) =>
          playMoo(1 + CONFIG.audio.sizeUp.pitchPerSize * payload.size, CONFIG.audio.sizeUp.gain),
        ),
      );
      subscriptions.push(
        // L'evento segnala il cambio di gradino in ENTRAMBE le direzioni: sale
        // dopo N ostacoli puliti, ma torna a zero quando si viene colpiti
        // (score.breakStreak). Il tocco è un premio e suona solo in salita:
        // sul crollo c'è già l'impatto, e premiarlo racconterebbe il contrario
        // di quello che è appena successo. streak vale 0 solo sul reset.
        bus.on('streak:changed', (payload) => {
          if (payload.streak > 0) {
            playStreakTick();
          }
        }),
      );
      subscriptions.push(
        // Il momento più gratificante di una corsa, e finora lo si scopriva
        // morendo: la stella trasposta di una quinta, breve e brillante.
        bus.on('record:beaten', () => playSparkle(CONFIG.audio.forkChosen.pitchRatio)),
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
      subscriptions.push(
        bus.on('avalanche:ending', () => {
          duckRumble();
          playEndingTicks();
        }),
      );
      subscriptions.push(
        bus.on('avalanche:ended', () => {
          stopRumble(CONFIG.audio.rumble.fadeSeconds);
          playAvalancheEnd();
        }),
      );
    },

    setMuted(value: boolean): void {
      muted = value;
      writeMuted(value);
      if (muted) {
        stopRumble(0);
        stopSlide();
        return;
      }
      // Riattivare l'audio è a sua volta un gesto dell'utente (il tocco sul
      // pulsante), quindi è il momento buono per onorare lo sblocco che si era
      // solo annotato: vedi unlock().
      if (unlockPending) {
        resumeContext();
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
     *
     * Da muto si annota soltanto che il gesto c'è stato: aprire il contesto
     * qui violerebbe la regola dichiarata da audible() ("da muto non si alloca
     * proprio nulla") e lascerebbe a chi gioca in silenzio un AudioContext
     * aperto più un secondo di rumore bianco generato campione per campione.
     */
    unlock(): void {
      if (unlocked) {
        return;
      }
      if (muted) {
        unlockPending = true;
        return;
      }
      resumeContext();
    },
  };
}
