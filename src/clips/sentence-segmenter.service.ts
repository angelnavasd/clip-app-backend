import { Injectable } from '@nestjs/common';
import type {
  SilenceGapDto,
  WordTimestampDto,
} from './dto/analyze-transcript.dto.js';

export interface SentenceFeatures {
  id: string;
  index: number;
  text: string;
  start: number;
  end: number;
  duration: number;
  wordCount: number;
  wordStartIndex: number;
  wordEndIndex: number;
  avgDb: number;
  maxDb: number;
  wpm: number;
  fillerDensity: number;
  pauseAfter: number;
  endsWithPause: boolean;
  isQuestion: boolean;
  hasNumber: boolean;
  hasNegation: boolean;
  hasContrast: boolean;
  hasSuperlative: boolean;
}

const MAX_WORDS_PER_SENTENCE = 32;
const MAX_SECONDS_PER_SENTENCE = 18;
const PAUSE_SPLIT_THRESHOLD_S = 0.6;

const NEGATION_RE = /\b(no|nunca|jam[aá]s|nadie|nada|ning[uú]n|tampoco|not|never|nobody|nothing)\b/i;
const CONTRAST_RE = /\b(pero|aunque|sin embargo|no obstante|en cambio|mientras|but|however|although|whereas)\b/i;
const SUPERLATIVE_RE =
  /\b(m[aá]s|mejor|peor|n[uú]mero uno|incre[íi]ble|brutal|grav[íi]simo|total|jam[aá]s|secreto|error|bomba|best|worst|insane|crazy|never|always|everyone|nobody)\b/i;
const NUMBER_RE = /\d|uno|dos|tres|cinco|diez|cien|mil|mill[óo]n|one|two|three|five|ten|hundred|thousand/i;
const SENT_END_RE = /[.!?…]+$/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function wordDb(w: WordTimestampDto): number | null {
  return typeof w.db === 'number' && Number.isFinite(w.db) ? w.db : null;
}

function isFillerWord(w: WordTimestampDto): boolean {
  return w.isFiller === true;
}

@Injectable()
export class SentenceSegmenterService {
  segment(
    words: WordTimestampDto[],
    silenceGaps: SilenceGapDto[] = [],
  ): SentenceFeatures[] {
    if (!words || words.length === 0) return [];

    // Ordenar por start para robustez ante payloads desordenados
    const sorted = [...words].sort((a, b) => a.start - b.start);
    const sentences: SentenceFeatures[] = [];

    let current: WordTimestampDto[] = [];
    let currentStartIdx = 0;

    const flush = (endWordIdxExclusive: number, pauseAfter: number) => {
      if (current.length === 0) return;
      const text = current.map((w) => w.word).join(' ').trim();
      if (!text) {
        current = [];
        currentStartIdx = endWordIdxExclusive;
        return;
      }
      const start = current[0].start;
      const end = current[current.length - 1].end;
      const duration = Math.max(0.1, end - start);
      const dbs = current
        .map(wordDb)
        .filter((d): d is number => d !== null);
      const avgDb =
        dbs.length > 0
          ? round2(dbs.reduce((a, b) => a + b, 0) / dbs.length)
          : -20.0;
      const maxDb = dbs.length > 0 ? Math.max(...dbs) : -20.0;
      const fillerCount = current.filter(isFillerWord).length;
      const wpm =
        duration > 0
          ? Math.round((current.length / duration) * 60)
          : 0;

      const index = sentences.length;
      sentences.push({
        id: `S${String(index + 1).padStart(2, '0')}`,
        index,
        text,
        start: round2(start),
        end: round2(end),
        duration: round2(duration),
        wordCount: current.length,
        wordStartIndex: currentStartIdx,
        wordEndIndex: endWordIdxExclusive - 1,
        avgDb,
        maxDb,
        wpm,
        fillerDensity: round2(fillerCount / Math.max(1, current.length)),
        pauseAfter: round2(pauseAfter),
        endsWithPause: pauseAfter >= PAUSE_SPLIT_THRESHOLD_S,
        isQuestion: /\?\s*$/.test(text),
        hasNumber: NUMBER_RE.test(text),
        hasNegation: NEGATION_RE.test(text),
        hasContrast: CONTRAST_RE.test(text),
        hasSuperlative: SUPERLATIVE_RE.test(text),
      });
      current = [];
      currentStartIdx = endWordIdxExclusive;
    };

    for (let i = 0; i < sorted.length; i++) {
      const w = sorted[i];
      if (current.length === 0) currentStartIdx = i;
      current.push(w);

      const next = sorted[i + 1];
      const gapToNext = next ? Math.max(0, next.start - w.end) : 0;
      const endsWithPunct = SENT_END_RE.test(w.word.trim());
      const hitsMaxWords = current.length >= MAX_WORDS_PER_SENTENCE;
      const currentDur = w.end - current[0].start;
      const hitsMaxDur = currentDur >= MAX_SECONDS_PER_SENTENCE;
      const longPause = next ? gapToNext >= PAUSE_SPLIT_THRESHOLD_S : true;
      const inSilenceGap = silenceGaps.some(
        (g) => w.end >= g.start && next && next.start <= g.end,
      );

      if (!next) {
        flush(i + 1, 0);
      } else if (
        endsWithPunct ||
        hitsMaxWords ||
        hitsMaxDur ||
        longPause ||
        inSilenceGap
      ) {
        // Evitar oraciones de 1-2 palabras salvo que haya pausa real larga
        if (current.length <= 2 && !endsWithPunct && gapToNext < 1.2) {
          continue;
        }
        flush(i + 1, gapToNext);
      }
    }

    return sentences;
  }

  /** Compatibilidad: mapa id -> timestamps para resolver beats sin alucinar. */
  buildIdMap(sentences: SentenceFeatures[]): Map<string, SentenceFeatures> {
    return new Map(sentences.map((s) => [s.id, s]));
  }

  /**
   * Scoring heurístico transparente 0-100 (energía vocal + ganchos textuales).
   * Misma rúbrica que se le pedía al LLM: sirve para pre-rankear sin API.
   */
  static scoreCandidate(s: {
    maxDb: number;
    wpm: number;
    fillerDensity: number;
    duration: number;
    wordCount: number;
    isQuestion: boolean;
    hasNumber: boolean;
    hasNegation: boolean;
    hasContrast: boolean;
    hasSuperlative: boolean;
    endsWithPause: boolean;
  }): number {
    let score = 50;
    score += Math.max(0, Math.min(25, ((s.maxDb + 30) / 22) * 25));
    if (s.isQuestion) score += 12;
    if (s.hasNumber) score += 10;
    if (s.hasNegation) score += 6;
    if (s.hasContrast) score += 6;
    if (s.hasSuperlative) score += 8;
    if (s.endsWithPause) score += 3;
    if (s.duration >= 3 && s.duration <= 12) score += 5;
    if (s.fillerDensity > 0.15) score -= 15;
    if (s.wpm < 90 || s.wpm > 220) score -= 10;
    if (s.wordCount < 4) score -= 12;
    return Math.max(0, Math.min(100, Math.round(score)));
  }
}
