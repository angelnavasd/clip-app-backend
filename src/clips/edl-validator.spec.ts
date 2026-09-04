import { describe, expect, it } from 'vitest';
import { EdlValidatorService } from './edl-validator.service.js';
import { SentenceSegmenterService } from './sentence-segmenter.service.js';

const segmenter = new SentenceSegmenterService();
const validator = new EdlValidatorService();

const words = [
  { word: 'Esto', start: 0.1, end: 0.4, db: -14 },
  { word: 'arruinó', start: 0.5, end: 0.9, db: -12.5 },
  { word: 'mi', start: 1.9, end: 2.1, db: -16 },
  { word: 'aplicación.', start: 2.2, end: 2.9, db: -11 },
  { word: 'cometí', start: 5.8, end: 6.2, db: -14 },
  { word: 'un', start: 6.3, end: 6.5, db: -15 },
  { word: 'error', start: 6.6, end: 7.1, db: -12 },
  { word: 'gravísimo.', start: 7.2, end: 7.9, db: -11.5 },
  { word: 'Pero', start: 45.0, end: 45.3, db: -13 },
  { word: 'aprendí', start: 45.4, end: 45.9, db: -12 },
  { word: 'tres', start: 46.0, end: 46.3, db: -11 },
  { word: 'lecciones.', start: 46.4, end: 47.0, db: -12.5 },
];

describe('EdlValidatorService (F2)', () => {
  it('hace snap a frontera de oración aunque el LLM corte a mitad', () => {
    const sentences = segmenter.segment(words as any);
    const fullText = words.map((w) => w.word).join(' ');
    // LLM corta "arruinó" a mitad de la primera oración
    const out = validator.validateAndRepair(
      [
        {
          id: 'clip_01',
          title: 'Test',
          viralScore: 90,
          hook: 'x',
          timeRange: { start: 0.5, end: 7.9 },
          cutSegments: [],
          highlightWords: [],
          storyBeats: [
            { start: 0.5, end: 1.0, role: 'hook', text: 'arruinó mi' },
            { start: 45.0, end: 47.0, role: 'solution', text: 'Pero aprendí tres lecciones.' },
          ],
        },
      ],
      sentences,
      fullText,
      { videoDuration: 120, minNetDuration: 4 },
    );
    expect(out.length).toBe(1);
    // Snap extendió el primer beat al inicio de la oración (0.1)
    expect(out[0].storyBeats![0].start).toBeCloseTo(0.1, 1);
    expect(out[0].storyBeats![0].text).toContain('aplicación.');
    expect(out[0].storyBeats![0].needsFace).toBe(true);
    expect(out[0].hook).toBe(out[0].storyBeats![0].text);
  });

  it('regenera cutSegments desde gaps reales', () => {
    const sentences = segmenter.segment(words as any);
    const fullText = words.map((w) => w.word).join(' ');
    const out = validator.validateAndRepair(
      [
        {
          id: 'clip_01',
          title: 'T',
          viralScore: 80,
          hook: '',
          timeRange: { start: 0, end: 47 },
          cutSegments: [{ start: 0, end: 1, reason: 'inventado' }],
          highlightWords: [],
          storyBeats: [
            { start: 0.1, end: 2.9, role: 'hook', text: 'Esto arruinó mi aplicación.' },
            { start: 45.0, end: 47.0, role: 'solution', text: 'Pero aprendí tres lecciones.' },
          ],
        },
      ],
      sentences,
      fullText,
      // minBeatDur/minNet bajos para aislar lo que testea (regen de cuts, no extensión)
      { videoDuration: 120, minBeatDur: 2, minNetDuration: 4 },
    );
    expect(out[0].cutSegments.length).toBe(1);
    expect(out[0].cutSegments[0].start).toBeGreaterThanOrEqual(2.9);
    expect(out[0].cutSegments[0].start).toBeLessThan(3.2);
    expect(out[0].cutSegments[0].end).toBeCloseTo(45.0, 1);
  });

  it('descarta clips duplicados por overlap', () => {
    const sentences = segmenter.segment(words as any);
    const fullText = words.map((w) => w.word).join(' ');
    const mk = (id: string, score: number) => ({
      id,
      title: id,
      viralScore: score,
      hook: '',
      timeRange: { start: 0, end: 8 },
      cutSegments: [],
      highlightWords: [],
      storyBeats: [
        { start: 0.1, end: 2.9, role: 'hook', text: 'Esto arruinó mi aplicación.' },
        { start: 5.8, end: 7.9, role: 'conflict', text: 'cometí un error gravísimo.' },
      ],
    });
    const out = validator.validateAndRepair([mk('clip_01', 95), mk('clip_02', 90)], sentences, fullText, {
      videoDuration: 120,
      minBeatDur: 2,
      minNetDuration: 4,
    });
    expect(out.length).toBe(1);
    expect(out[0].id).toBe('clip_01');
  });

  it('REGRESIÓN: un beat corto no se traga al beat vecino (multi-corte preservado)', () => {
    const sentences = segmenter.segment(words as any);
    const fullText = words.map((w) => w.word).join(' ');
    // Beat 1 cortito (5.8-6.2) seguido de otro beat (45-47): antes el validador
    // extendía el beat 1 hasta la siguiente oración y fusionaba todo en una porción.
    const out = validator.validateAndRepair(
      [
        {
          id: 'clip_01',
          title: 'T',
          viralScore: 85,
          hook: '',
          timeRange: { start: 5.8, end: 47 },
          cutSegments: [],
          highlightWords: [],
          storyBeats: [
            { start: 5.8, end: 6.2, role: 'hook', text: 'cometí' },
            { start: 45.0, end: 47.0, role: 'solution', text: 'Pero aprendí tres lecciones.' },
          ],
        },
      ],
      sentences,
      fullText,
      { videoDuration: 120, minNetDuration: 4 },
    );
    expect(out.length).toBe(1);
    expect(out[0].storyBeats!.length).toBe(2);
    // El primer beat no debe invadir al segundo
    expect(out[0].storyBeats![0].end).toBeLessThanOrEqual(out[0].storyBeats![1].start);
    // Y debe existir un jump cut real entre ellos
    expect(out[0].cutSegments.length).toBe(1);
    expect(out[0].cutSegments[0].end - out[0].cutSegments[0].start).toBeGreaterThan(3);
  });
});
