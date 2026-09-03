import { describe, expect, it } from 'vitest';
import { SentenceSegmenterService } from './sentence-segmenter.service.js';

const svc = new SentenceSegmenterService();

describe('SentenceSegmenterService (F1)', () => {
  it('no corta a mitad de oración y respeta puntuación', () => {
    const sentences = svc.segment([
      { word: 'Esto', start: 0.1, end: 0.4, db: -14 },
      { word: 'arruinó', start: 0.5, end: 0.9, db: -12.5 },
      { word: 'mi', start: 1.9, end: 2.1, db: -16 },
      { word: 'aplicación.', start: 2.2, end: 2.9, db: -11 },
      { word: 'cometí', start: 5.8, end: 6.2, db: -14 },
      { word: 'un', start: 6.3, end: 6.5, db: -15 },
      { word: 'error', start: 6.6, end: 7.1, db: -12 },
      { word: 'gravísimo.', start: 7.2, end: 7.9, db: -11.5 },
    ]);
    expect(sentences.length).toBe(2);
    expect(sentences[0].text).toBe('Esto arruinó mi aplicación.');
    expect(sentences[0].start).toBeCloseTo(0.1, 2);
    expect(sentences[0].end).toBeCloseTo(2.9, 2);
    expect(sentences[1].wordStartIndex).toBe(4);
  });

  it('parte por pausa larga aunque no haya puntuación', () => {
    const sentences = svc.segment([
      { word: 'Hola', start: 0, end: 0.4, db: -14 },
      { word: 'mundo', start: 0.5, end: 0.9, db: -14 },
      { word: 'esto', start: 5.0, end: 5.3, db: -13 },
      { word: 'sigue', start: 5.4, end: 5.8, db: -13 },
    ]);
    expect(sentences.length).toBe(2);
    expect(sentences[0].endsWithPause).toBe(true);
    expect(sentences[0].pauseAfter).toBeGreaterThanOrEqual(0.6);
  });

  it('calcula features de audio y rúbrica', () => {
    const sentences = svc.segment([
      { word: '¿Quieres', start: 80.0, end: 80.4, db: -11 },
      { word: 'saber', start: 80.5, end: 80.8, db: -12 },
      { word: 'tres', start: 80.9, end: 81.2, db: -11.5 },
      { word: 'secretos?', start: 81.3, end: 82.0, db: -10.5 },
      { word: 'ehhh', start: 83.0, end: 84.0, db: -28, isFiller: true },
      { word: 'bueno', start: 84.1, end: 84.5, db: -26, isFiller: false },
    ]);
    // "bueno" no está marcado como filler en este payload, solo ehhh
    expect(sentences[0].isQuestion).toBe(true);
    expect(sentences[0].hasNumber).toBe(true);
    expect(sentences[0].maxDb).toBeGreaterThan(-12);
    expect(sentences[1].fillerDensity).toBeGreaterThan(0);
  });

  it('respeta silenceGaps como frontera', () => {
    const sentences = svc.segment(
      [
        { word: 'primera', start: 0, end: 0.5, db: -13 },
        { word: 'parte', start: 0.6, end: 1.0, db: -13 },
        { word: 'segunda', start: 3.0, end: 3.5, db: -13 },
        { word: 'parte', start: 3.6, end: 4.0, db: -13 },
      ],
      [{ start: 1.0, end: 3.0 }],
    );
    expect(sentences.length).toBe(2);
  });

  it('genera IDs estables S01, S02... con timestamps exactos', () => {
    const sentences = svc.segment([
      { word: 'Uno.', start: 1.0, end: 1.5, db: -12 },
      { word: 'Dos.', start: 2.0, end: 2.5, db: -12 },
    ]);
    expect(sentences[0].id).toBe('S01');
    expect(sentences[1].id).toBe('S02');
    const map = svc.buildIdMap(sentences);
    expect(map.get('S02')?.start).toBeCloseTo(2.0, 2);
  });
});
