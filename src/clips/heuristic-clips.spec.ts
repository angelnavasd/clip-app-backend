import { describe, expect, it } from 'vitest';
import { SentenceSegmenterService } from './sentence-segmenter.service.js';
import { EdlValidatorService } from './edl-validator.service.js';
import { HeuristicClipsService } from './heuristic-clips.service.js';

const segmenter = new SentenceSegmenterService();
const validator = new EdlValidatorService();
const svc = new HeuristicClipsService(segmenter, validator);

/** Transcript sintético: 3 secciones separadas con ganchos (pregunta/número/energía). */
function word(word: string, start: number, dur = 0.4, db = -13, isFiller = false) {
  return { word, start: round2(start), end: round2(start + dur), db, ...(isFiller ? { isFiller: true } : {}) };
}
function round2(n: number) { return Math.round(n * 100) / 100; }

function sentence(words: string[], start: number, db = -13, fillers: string[] = ['ehhh', 'eh', 'bueno', 'o', 'sea,', 'pues']): Array<ReturnType<typeof word>> {
  let t = start;
  return words.map((w) => {
    const o = word(w, t, 0.35 + (w.length > 6 ? 0.15 : 0), db, fillers.includes(w.toLowerCase()));
    t = round2(o.end + 0.12);
    return o;
  });
}

function buildWords() {
  return [
    ...sentence(['¿Quieres', 'saber', 'el', 'secreto', 'mejor', 'guardado?'], 5, -11),
    ...sentence(['cometí', 'un', 'error', 'gravísimo', 'con', 'la', 'base', 'de', 'datos.'], 8, -12),
    ...sentence(['ehhh', 'bueno', 'o', 'sea,', 'pues', 'nada', 'más', 'que', 'decir.'], 20, -26),
    ...sentence(['Pero', 'aprendí', 'tres', 'lecciones', 'que', 'valen', 'miles.'], 60, -11),
    ...sentence(['la', 'primera', 'es', 'nunca', 'confiar', 'en', 'magia.'], 64, -13),
    ...sentence(['¿Y', 'sabes', 'qué', 'pasó', 'después?'], 120, -10.5),
    ...sentence(['el', 'resultado', 'fue', 'un', 'desastre', 'total', 'y', 'aprendimos.'], 124, -12),
  ];
}

describe('HeuristicClipsService ($0, sin LLM)', () => {
  it('compone clips multi-corte con gaps reales', () => {
    const words = buildWords();
    const clips = svc.compose({ videoId: 't', videoDuration: 140, words, targetDuration: 'Auto (20-40s)' });
    expect(clips.length).toBeGreaterThanOrEqual(1);
    for (const c of clips) {
      const beats = c.storyBeats!;
      expect(beats.length).toBeGreaterThanOrEqual(2);
      // Ordenados y con jump cuts de >=3s entre beats
      for (let i = 1; i < beats.length; i++) {
        expect(beats[i].start).toBeGreaterThan(beats[i - 1].start);
        expect(beats[i].start - beats[i - 1].end).toBeGreaterThanOrEqual(2.9);
      }
      // Sin muletillas en los beats (la sección de relleno se salta)
      const text = beats.map((b) => b.text).join(' ');
      expect(text).not.toMatch(/ehhh/i);
      // needsFace en el hook para el encuadre
      expect(beats[0].needsFace).toBe(true);
    }
  });

  it('no devuelve clips de una sola porción corrida', () => {
    const words = buildWords();
    const clips = svc.compose({ videoId: 't', videoDuration: 140, words });
    for (const c of clips) {
      const beats = c.storyBeats!;
      const span = beats[beats.length - 1].end - beats[0].start;
      const net = beats.reduce((s, b) => s + (b.end - b.start), 0);
      // Hay material omitido entre beats (multi-corte de verdad)
      expect(span - net).toBeGreaterThan(2.9);
    }
  });

  it('con poco contenido no inventa (cero clips, no alucina)', () => {
    const clips = svc.compose({
      videoId: 't', videoDuration: 30,
      words: [{ word: 'hola', start: 1, end: 1.5, db: -14 }],
    });
    expect(clips.length).toBe(0);
  });
});
