import { Injectable, Logger } from '@nestjs/common';
import {
  SentenceFeatures,
  SentenceSegmenterService,
} from './sentence-segmenter.service.js';
import { EdlValidatorService } from './edl-validator.service.js';
import type { SilenceGapDto } from './dto/analyze-transcript.dto.js';
import type {
  ClipDecisionDto,
  StoryBeatDto,
} from './dto/edl-response.dto.js';

export interface HeuristicInput {
  videoId: string;
  videoDuration: number;
  words: Array<{
    word: string;
    start: number;
    end: number;
    db?: number;
    isFiller?: boolean;
  }>;
  silenceGaps?: SilenceGapDto[];
  targetDuration?: string;
  targetClipCount?: number;
}

const ROLES = ['hook', 'conflict', 'solution', 'punchline', 'story'];
const MIN_GAP_BETWEEN_BEATS = 3;

/** Respaldo por si el cliente no marcó isFiller: muletillas ES/EN. */
const FILLER_WORDS = new Set(
  'eh ehhh ehh mmm mm ah ajá este o sea bueno pues tipo oye mira um uh uhm like you know well so basically actually'.split(' '),
);

function fillerRatio(text: string): number {
  const toks = text
    .toLowerCase()
    .replace(/[¿?¡!.,;:()"«»\-—_]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (toks.length === 0) return 1;
  return toks.filter((t) => FILLER_WORDS.has(t)).length / toks.length;
}

/**
 * EDL 100% determinista, $0, offline: reusa el scoring y el validador del
 * pipeline LLM pero sin llamar a ninguna API.
 * - Hook = mejor oración con gancho (pregunta/número/énfasis/energía).
 * - Beats de tercios distintos (multi-corte real con gaps >= 3s).
 * - 2-3 clips con penalización de re-uso (el validador impone diversidad).
 */
@Injectable()
export class HeuristicClipsService {
  private readonly logger = new Logger(HeuristicClipsService.name);

  constructor(
    private readonly segmenter: SentenceSegmenterService,
    private readonly validator: EdlValidatorService,
  ) {}

  compose(input: HeuristicInput): ClipDecisionDto[] {
    const sentences = this.segmenter.segment(
      input.words as any,
      input.silenceGaps ?? [],
    );
    if (sentences.length === 0) return [];
    const target = this.validator.parseTargetRange(input.targetDuration);
    const fullText = input.words.map((w) => w.word).join(' ');

    const scored = sentences.map((s) => ({
      s,
      score: SentenceSegmenterService.scoreCandidate(s),
    }));

    const candidates: ClipDecisionDto[] = [];
    const usedIds = new Set<string>();
    const maxToTry = Math.max(4, input.targetClipCount ?? 4);
    for (let n = 0; n < maxToTry; n++) {
      const beats = this.composeOne(scored, usedIds, target.min, target.max);
      if (beats.length < 2) break;
      beats.forEach((b) =>
        (b.sentenceIds ?? []).forEach((id) => usedIds.add(id)),
      );
      const start = beats[0].start;
      const end = beats[beats.length - 1].end;
      candidates.push({
        id: `clip_${String(n + 1).padStart(2, '0')}`,
        title: this.titleFor(beats[0]),
        viralScore: Math.max(
          60,
          Math.min(95, Math.round(this.clipScore(beats, scored))),
        ),
        hook: beats[0].text,
        timeRange: { start, end },
        cutSegments: [],
        highlightWords: this.highlightsFor(beats),
        storyBeats: beats,
      });
    }

    const repaired = this.validator.validateAndRepair(
      candidates,
      sentences,
      fullText,
      {
        videoDuration: input.videoDuration,
        targetMinNet: target.min,
        targetMaxNet: target.max,
        targetClipCount: input.targetClipCount ?? 4,
      },
    );
    this.logger.log(
      `[Heuristic] ${sentences.length} oraciones -> ${repaired.length} clips ($0, sin LLM)`,
    );
    return repaired;
  }

  /** Compone UN clip: hook magnético + beats de tercios distintos con gaps. */
  private composeOne(
    scored: Array<{ s: SentenceFeatures; score: number }>,
    usedIds: Set<string>,
    targetMin: number,
    targetMax: number,
  ): StoryBeatDto[] {
    const span = Math.max(
      1,
      ...scored.map(({ s }) => s.end),
    );
    // Pool: top por tercios (spread temporal), penalizando re-uso y cortas/largas.
    // Secciones de puras muletillas/silencio quedan FUERA: por flag del cliente
    // (fillerDensity) Y por detección propia (por si el flag viene vacío).
    const pool = scored
      .filter(({ s }) => s.duration >= 2 && s.duration <= 18 && s.wordCount >= 4)
      .filter(({ s }) => s.fillerDensity <= 0.4 && s.avgDb > -30)
      .filter(({ s }) => fillerRatio(s.text) <= 0.4)
      .map(({ s, score }) => ({
        s,
        adj: usedIds.has(s.id) ? score - 25 : score,
      }))
      .sort((a, b) => b.adj - a.adj);

    if (pool.length === 0) return [];

    // Hook: mejor puntuada de la primera mitad (el gancho debe llegar pronto)
    const hookPick =
      pool
        .filter(({ s }) => s.start < span * 0.66)
        .sort((a, b) => b.adj - a.adj)[0] ?? pool[0];

    const chosen: SentenceFeatures[] = [hookPick.s];
    let net = hookPick.s.duration;
    const thirdsOf = (t: number) => Math.min(2, Math.floor((t / span) * 3));
    const usedThirds = new Set([thirdsOf(hookPick.s.start)]);

    // Completar con mejores de OTROS tercios, con gap mínimo (jump cut real)
    for (const { s } of pool
      .filter(({ s }) => s.id !== hookPick.s.id)
      .sort((a, b) => {
        const at = usedThirds.has(thirdsOf(a.s.start)) ? 0 : 15;
        const bt = usedThirds.has(thirdsOf(b.s.start)) ? 0 : 15;
        return b.adj + bt - (a.adj + at);
      })) {
      if (net >= targetMin) break;
      if (net + s.duration > targetMax + 10) continue;
      // Gap mínimo de 3s con TODO lo elegido (jump cut real, no porción corrida)
      const clashes = chosen.some(
        (c) => !(s.start >= c.end + MIN_GAP_BETWEEN_BEATS || s.end <= c.start - MIN_GAP_BETWEEN_BEATS),
      );
      if (clashes) continue;
      chosen.push(s);
      usedThirds.add(thirdsOf(s.start));
      net += s.duration;
      if (chosen.length >= 5) break;
    }

    chosen.sort((a, b) => a.start - b.start);
    return chosen.map((s, i) => ({
      start: s.start,
      end: s.end,
      role: ROLES[Math.min(i, ROLES.length - 1)],
      text: s.text,
      needsFace: i === 0,
      energyScore: Math.max(0, Math.min(100, Math.round(((s.maxDb + 30) / 22) * 100))),
      sentenceIds: [s.id],
    }));
  }

  private clipScore(
    beats: StoryBeatDto[],
    scored: Array<{ s: SentenceFeatures; score: number }>,
  ): number {
    const byId = new Map(scored.map(({ s, score }) => [s.id, score]));
    const vals = beats.flatMap((b) => (b.sentenceIds ?? []).map((id) => byId.get(id) ?? 50));
    if (vals.length === 0) return 70;
    return vals.reduce((a, x) => a + x, 0) / vals.length;
  }

  private titleFor(hook: StoryBeatDto): string {
    const t = hook.text.replace(/\s+/g, ' ').trim();
    return t.length > 64 ? `${t.slice(0, 61).trimEnd()}…` : t;
  }

  private highlightsFor(beats: StoryBeatDto[]) {
    const out: Array<{ word: string; timestamp: number; color: string; sfx: string }> = [];
    const colors = ['#FFCC00', '#FF3B30', '#34C759'];
    beats.slice(0, 3).forEach((b, i) => {
      const tokens = b.text.split(/\s+/).filter((w) => w.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]/g, '').length >= 5);
      if (tokens.length === 0) return;
      const pick = tokens.sort((a, c) => c.length - a.length)[0];
      out.push({
        word: pick,
        timestamp: Number((b.start + (b.end - b.start) * 0.3).toFixed(2)),
        color: colors[i % colors.length],
        sfx: 'whoosh',
      });
    });
    return out;
  }
}
