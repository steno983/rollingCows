import type { EventBus } from '../core/events';
import { CONFIG } from '../game/config';
import type { BuffKind } from '../game/types';

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
 * `contextFactory` è iniettabile per i test (jsdom non implementa WebAudio): in
 * produzione si omette e si usa l'AudioContext del browser.
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
   *  per farla sentire come il buff più raro. */
  function playSparkle(): void {
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
    osc.frequency.setValueAtTime(lowHz, t);
    osc.frequency.setValueAtTime(midHz, t + noteSeconds);
    osc.frequency.setValueAtTime(highHz, t + noteSeconds * 2);

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
   *  deve suonare come una vera mucca, non come gli altri tre. */
  function playCowbell(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { fundamentalHz, overtoneRatio, seconds, gain: level } = CONFIG.audio.cowbell;
    const t = context.currentTime;

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

    const overtoneSeconds = seconds * 0.6;
    const overtone = context.createOscillator();
    const overtoneGain = context.createGain();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(fundamentalHz * overtoneRatio, t);
    overtoneGain.gain.setValueAtTime(level * 0.6, t);
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

  /** Comparsa di un bivio: un richiamo breve, distinto dai suoni di
   *  raccolta, per il momento in cui il giocatore deve alzare lo sguardo. */
  function playForkAppear(): void {
    const context = audible();
    if (context === null || master === null) {
      return;
    }
    const { lowHz, highHz, seconds, gain: level } = CONFIG.audio.forkAppear;
    const t = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(lowHz, t);
    osc.frequency.exponentialRampToValueAtTime(highHz, t + seconds);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + seconds);
  }

  /** Lo scudo che assorbe un colpo: rumore passa-alto, un "crac" cristallino
   *  distinto dal tonfo sordo passa-basso di un impatto normale (playImpact). */
  function playShieldBreak(): void {
    const context = audible();
    if (context === null || master === null || noise === null) {
      return;
    }
    const { cutoffHz, seconds, gain: level } = CONFIG.audio.shieldBreak;
    const t = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();

    source.buffer = noise;
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(cutoffHz, t);

    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + seconds);
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
      subscriptions.push(
        bus.on('run:started', () => {
          // Il rombo si spegne SOLO su avalanche:ended: se si torna al menu o si
          // ricomincia mentre una valanga stava rombando (run:started sostituisce
          // lo stato senza mai emettere avalanche:ended), il BufferSourceNode in
          // loop continuava a suonare sul menu, sui record e per tutta la run
          // successiva. L'audio resta un consumatore del bus: si spegne qui,
          // niente chiamate dirette dal gioco.
          stopRumble(0);
          playMoo();
        }),
      );
      subscriptions.push(
        // Anche la morte durante una valanga deve spegnere subito il rombo:
        // altrimenti continua a suonare sulla schermata di game over finché non
        // si comincia una nuova run.
        bus.on('run:ended', () => stopRumble(0)),
      );
      subscriptions.push(
        // Run abbandonata da viva (Esc → MENU a metà valanga): nessun
        // run:started né run:ended viene emesso in questo percorso, quindi
        // senza questo listener il rombo continuava a suonare sul menu finché
        // non partiva una run nuova.
        bus.on('run:stopped', () => stopRumble(0)),
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
      subscriptions.push(bus.on('shield:consumed', () => playShieldBreak()));
      subscriptions.push(
        // Il bivio è il momento in cui il giocatore deve alzare lo sguardo:
        // un richiamo sonoro aiuta a non perderlo mentre si guarda l'HUD.
        bus.on('fork:appeared', () => playForkAppear()),
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
