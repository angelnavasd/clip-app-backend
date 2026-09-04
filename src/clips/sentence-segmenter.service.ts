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

const DANGLING_END_RE =
  /\b(el|la|los|las|un|una|unos|unas|de|del|al|a|en|con|por|para|sin|sobre|hacia|desde|que|y|o|u|e|pero|sino|si|porque|cuando|donde|como|aunque|se|me|te|le|nos|les|lo|mi|tu|su|este|esta|estos|estas|the|a|an|of|in|to|for|with|on|at|from|by|and|or|but|that|which|who|if|because|when|where)\s*[,;:]?$/i;

const HANGING_CONNECTOR_RE =
  /\b(por ejemplo|es decir|o sea|como por ejemplo|tales como|en plan|es que|creo que|siento que)\s*[,;:]?$/i;

const CLAUSE_PUNCT_RE = /[,;:]$/;

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
      const wordTrim = w.word.trim();
      const endsWithPunct = SENT_END_RE.test(wordTrim);
      const endsWithClausePunct = CLAUSE_PUNCT_RE.test(wordTrim);
      const currentDur = w.end - current[0].start;
      const longPause = next ? gapToNext >= PAUSE_SPLIT_THRESHOLD_S : true;
      const inSilenceGap = silenceGaps.some(
        (g) => w.end >= g.start && next && next.start <= g.end,
      );

      if (!next) {
        flush(i + 1, 0);
        break;
      }

      // 1. Puntuación fuerte de fin de oración (. ! ? …)
      if (endsWithPunct) {
        flush(i + 1, gapToNext);
        continue;
      }

      // Comprobar si la palabra o frase actual queda colgando
      const isDangling =
        DANGLING_END_RE.test(wordTrim) ||
        HANGING_CONNECTOR_RE.test(current.slice(-3).map((cw) => cw.word).join(' ').trim());

      // 2. Silencio de audio prolongado (vDSP) o pausa oral natural (>= 0.6s)
      if ((inSilenceGap || longPause) && !isDangling) {
        // Evitar oraciones de 1-2 palabras salvo que haya pausa muy larga
        if (current.length <= 2 && gapToNext < 1.2) {
          continue;
        }
        flush(i + 1, gapToNext);
        continue;
      }

      // 3. Cláusula intermedia larga (oración de >22 palabras o >10s con coma + pausa intermedia)
      const isLongAccumulation = current.length >= 22 || currentDur >= 10;
      if (
        isLongAccumulation &&
        endsWithClausePunct &&
        gapToNext >= 0.25 &&
        !isDangling
      ) {
        flush(i + 1, gapToNext);
        continue;
      }

      // 4. Pausa de respiración en oraciones extra largas (>32 palabras con pausa >= 0.4s)
      const isVeryLong = current.length >= 32 || currentDur >= 15;
      if (isVeryLong && gapToNext >= 0.4 && !isDangling) {
        flush(i + 1, gapToNext);
        continue;
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
