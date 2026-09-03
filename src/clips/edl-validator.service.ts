import { Injectable, Logger } from '@nestjs/common';
import type { SentenceFeatures } from './sentence-segmenter.service.js';
import type {
  ClipDecisionDto,
  StoryBeatDto,
} from './dto/edl-response.dto.js';

export interface ValidatorOptions {
  videoDuration: number;
  targetMinNet?: number;
  targetMaxNet?: number;
  minBeatDur?: number;
  maxBeatDur?: number;
  minGapBetweenBeats?: number;
  maxOverlapBetweenClips?: number;
  minNetDuration?: number;
}

const DEFAULTS: Required<ValidatorOptions> = {
  videoDuration: 0,
  targetMinNet: 20,
  targetMaxNet: 60,
  minBeatDur: 2.5,
  maxBeatDur: 18,
  minGapBetweenBeats: 3,
  maxOverlapBetweenClips: 0.3,
  minNetDuration: 8,
};

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿?¡!.,;:()"«»\-—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter(Boolean));
}

function jaccard(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

@Injectable()
export class EdlValidatorService {
  private readonly logger = new Logger(EdlValidatorService.name);

  parseTargetRange(
    targetDuration: string | undefined,
  ): { min: number; max: number } {
    if (!targetDuration) return { min: DEFAULTS.targetMinNet, max: DEFAULTS.targetMaxNet };
    const m = targetDuration.match(/(\d+)\s*[-–]\s*(\d+)\s*s/i);
    if (m) {
      const min = Math.max(5, parseInt(m[1], 10));
      const max = Math.min(180, parseInt(m[2], 10));
      if (max > min) return { min, max };
    }
    return { min: DEFAULTS.targetMinNet, max: DEFAULTS.targetMaxNet };
  }

  /**
   * Valida y repara clips del LLM:
   * - Snap de beats a fronteras de oración (anti corte a mitad de frase)
   * - Regenera cutSegments desde gaps reales entre beats
   * - Recalcula timeRange, filtra beats inválidos, impone diversidad entre clips
   * - Anota needsFace (hook siempre true) + energyScore desde maxDb
   */
  validateAndRepair(
    rawClips: ClipDecisionDto[],
    sentences: SentenceFeatures[],
    fullTranscriptText: string,
    options: ValidatorOptions,
  ): ClipDecisionDto[] {
    const opts = { ...DEFAULTS, ...options };
    if (!rawClips || rawClips.length === 0) return [];
    if (sentences.length === 0) return [];

    const transcriptNorm = normalize(fullTranscriptText);
    const repaired: ClipDecisionDto[] = [];

    for (const clip of rawClips) {
      const beats = Array.isArray(clip.storyBeats) ? clip.storyBeats : [];
      if (beats.length === 0) continue;

      // Ordenar primero para poder capar la extensión de cada beat
      // al inicio del siguiente: un beat NUNCA debe tragarse al beat N+1.
      const sortedRaw = [...beats].sort((a, b) => a.start - b.start);
      const fixedBeats: StoryBeatDto[] = [];
      for (let i = 0; i < sortedRaw.length; i++) {
        const nextStart = i + 1 < sortedRaw.length ? sortedRaw[i + 1].start : undefined;
        const fixed = this.repairBeat(sortedRaw[i], sentences, transcriptNorm, opts, nextStart);
        if (fixed) fixedBeats.push(fixed);
      }
      if (fixedBeats.length === 0) continue;

      // Resolver solapes residuales RECORTANDO (no borrando): el corte entre
      // beats vecinos es justo lo que produce jump cuts. Solo se descarta un
      // beat si tras recortar queda <1.5s.
      fixedBeats.sort((a, b) => a.start - b.start);
      const deduped: StoryBeatDto[] = [];
      for (const b of fixedBeats) {
        const prev = deduped[deduped.length - 1];
        if (prev && b.start < prev.end - 0.05) {
          const trimmed = this.reslice(prev.start, b.start, sentences, prev.role, transcriptNorm);
          if (trimmed && trimmed.end - trimmed.start >= 1.5) {
            deduped[deduped.length - 1] = trimmed;
            deduped.push(b);
          } else if ((b.energyScore ?? 0) > (prev.energyScore ?? 0)) {
            deduped[deduped.length - 1] = b;
          }
          // else: se descarta b (solape total y peor energía)
          continue;
        }
        deduped.push(b);
      }

      const net = deduped.reduce((s, b) => s + Math.max(0, b.end - b.start), 0);
      if (net < opts.minNetDuration) {
        this.logger.warn(`[EdlValidator] Clip ${clip.id} descartado: net ${net.toFixed(1)}s < ${opts.minNetDuration}s`);
        continue;
      }

      // Regenerar cutSegments desde gaps reales (no confiar en el LLM)
      const cutSegments = [];
      for (let i = 0; i < deduped.length - 1; i++) {
        const gapStart = deduped[i].end;
        const gapEnd = deduped[i + 1].start;
        if (gapEnd > gapStart + 0.05) {
          cutSegments.push({
            start: Number(gapStart.toFixed(2)),
            end: Number(gapEnd.toFixed(2)),
            reason: 'jump_cut',
          });
        }
      }

      const start = deduped[0].start;
      const end = deduped[deduped.length - 1].end;

      // needsFace: el hook (primer beat) siempre lo necesita para el encuadre
      deduped[0].needsFace = true;

      repaired.push({
        id: clip.id,
        title: clip.title,
        viralScore: clip.viralScore,
        hook: deduped[0].text,
        timeRange: { start, end },
        cutSegments,
        highlightWords: Array.isArray(clip.highlightWords)
          ? clip.highlightWords.filter(
              (h) =>
                typeof h.timestamp === 'number' &&
                h.timestamp >= start - 0.5 &&
                h.timestamp <= end + 0.5,
            )
          : [],
        storyBeats: deduped,
      });
    }

    // Diversidad: ordenar por viralScore y descartar clips con overlap alto
    repaired.sort((a, b) => b.viralScore - a.viralScore);
    const diverse: ClipDecisionDto[] = [];
    for (const clip of repaired) {
      const clipText = (clip.storyBeats ?? []).map((b) => b.text).join(' ');
      let overlapped = false;
      for (const kept of diverse) {
        const keptText = (kept.storyBeats ?? []).map((b) => b.text).join(' ');
        if (jaccard(clipText, keptText) > opts.maxOverlapBetweenClips) {
          this.logger.warn(`[EdlValidator] Clip ${clip.id} descartado por overlap con ${kept.id}`);
          overlapped = true;
          break;
        }
      }
      if (!overlapped) diverse.push(clip);
    }

    return diverse.slice(0, 3);
  }

  private repairBeat(
    beat: StoryBeatDto,
    sentences: SentenceFeatures[],
    transcriptNorm: string,
    opts: Required<ValidatorOptions>,
    capEnd?: number,
  ): StoryBeatDto | null {
    if (
      typeof beat.start !== 'number' ||
      typeof beat.end !== 'number' ||
      !(beat.end > beat.start)
    ) {
      return null;
    }
    let start = Math.max(0, beat.start);
    let end = Math.min(opts.videoDuration || beat.end, beat.end);
    if (capEnd !== undefined) end = Math.min(end, capEnd);

    // 1. Snap a fronteras de oración (respetando el cap del siguiente beat)
    const covering = sentences.filter((s) => s.start < end && s.end > start);
    if (covering.length > 0) {
      start = Math.min(...covering.map((s) => s.start));
      end = Math.max(...covering.map((s) => s.end));
      if (capEnd !== undefined) end = Math.min(end, capEnd);
    } else {
      // Sin oración que cubra: buscar la más cercana dentro de ±2s
      const near = sentences.filter(
        (s) => Math.abs(s.start - start) < 2 || Math.abs(s.end - end) < 2,
      );
      if (near.length === 0) return null;
      start = Math.min(...near.map((s) => s.start));
      end = Math.max(...near.map((s) => s.end));
      if (capEnd !== undefined && end > capEnd) return null;
    }

    // 2. Extender si quedó muy corto (<minBeatDur), SIN invadir al siguiente beat
    let dur = end - start;
    if (dur < opts.minBeatDur) {
      const limit = Math.min(
        opts.videoDuration || Number.POSITIVE_INFINITY,
        capEnd ?? Number.POSITIVE_INFINITY,
      );
      const next = sentences.find((s) => s.start >= end - 0.05 && s.start < limit);
      if (next) end = Math.min(limit, next.end);
      dur = end - start;
    }
    // 3. Si quedó larguísimo (>maxBeatDur*1.5), recortar a las primeras oraciones que cubran maxBeatDur
    if (dur > opts.maxBeatDur * 1.5) {
      const inBeat = sentences.filter((s) => s.start >= start - 0.05 && s.start < start + opts.maxBeatDur);
      if (inBeat.length > 0) end = inBeat[inBeat.length - 1].end;
    }
    if (end <= start + 0.5) return null;

    return this.reslice(start, end, sentences, beat.role || 'story', transcriptNorm);
  }

  /** Reconstruye un beat desde sus oraciones (texto, energía, ids). Null si es alucinación. */
  private reslice(
    start: number,
    end: number,
    sentences: SentenceFeatures[],
    role: string,
    transcriptNorm: string,
  ): StoryBeatDto | null {
    const inBeatSentences = sentences.filter((s) => s.start < end && s.end > start);
    const text =
      inBeatSentences.length > 0
        ? inBeatSentences.map((s) => s.text).join(' ')
        : '';
    if (!text) return null;

    // Grounding: el texto debe existir en la transcripción (fuzzy por inicio)
    const normText = normalize(text);
    if (transcriptNorm && normText.length > 10) {
      const probe = normText.split(' ').slice(0, 6).join(' ');
      if (probe && !transcriptNorm.includes(probe)) {
        this.logger.warn(`[EdlValidator] Beat descartado por grounding: "${text.slice(0, 60)}..."`);
        return null;
      }
    }

    const maxDb =
      inBeatSentences.length > 0 ? Math.max(...inBeatSentences.map((s) => s.maxDb)) : -20;
    // energyScore 0-100 desde maxDb (-30..-8 dB -> 0..100)
    const energyScore = Math.max(0, Math.min(100, Math.round(((maxDb + 30) / 22) * 100)));

    return {
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      role,
      text,
      needsFace: false,
      energyScore,
      sentenceIds: inBeatSentences.map((s) => s.id),
    };
  }
}
