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
