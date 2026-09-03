import { describe, expect, it } from 'vitest';
import { GeminiService } from '../gemini/gemini.service.js';

function svc() {
  const config = { get: (k: string) => (k === 'GEMINI_MODEL' ? 'test-model' : '') };
  return new GeminiService(config as any, {} as any, {} as any);
}

describe('GeminiService.sanitizeFrame (vision)', () => {
  it('acepta un frame válido tal cual', () => {
    const out = svc().sanitizeFrame('c1_b1_t1', {
      id: 'c1_b1_t1',
      scene: 'pip',
      speakerZone: 'right',
      pipCorner: 'bottomRight',
      confidence: 0.87,
      faceX: 82,
      faceY: 73,
      faceW: 12,
    });
    expect(out).toEqual({
      id: 'c1_b1_t1',
      scene: 'pip',
      speakerZone: 'right',
      pipCorner: 'bottomRight',
      confidence: 0.87,
      faceX: 80,
      faceY: 75,
      faceW: 10,
    });
  });

  it('lo desconocido -> unclear/none/0 (nunca crashea el mapper)', () => {
    const out = svc().sanitizeFrame('x', {
      scene: 'holograma',
      speakerZone: 'arriba',
      pipCorner: 'centro',
      confidence: 99,
    });
    expect(out.scene).toBe('unclear');
    expect(out.speakerZone).toBe('none');
    expect(out.pipCorner).toBe('none');
    expect(out.confidence).toBeLessThanOrEqual(0.4);
  });

  it('pipCorner se fuerza a none si no es pip', () => {
    const out = svc().sanitizeFrame('x', {
      scene: 'talking_head',
      speakerZone: 'center',
      pipCorner: 'bottomRight',
      confidence: 0.9,
    });
    expect(out.pipCorner).toBe('none');
    expect(out.scene).toBe('talking_head');
  });

  it('raw nulo o no-objeto -> unclear seguro', () => {
    expect(svc().sanitizeFrame('x', null).scene).toBe('unclear');
    expect(svc().sanitizeFrame('x', undefined).confidence).toBe(0);
    expect(svc().sanitizeFrame('x', 'basura').speakerZone).toBe('none');
  });

  it('faceX se redondea a múltiplos de 5 y -1 sin persona', () => {
    expect(svc().sanitizeFrame('x', { scene: 'talking_head', speakerZone: 'center', pipCorner: 'none', confidence: 0.9, faceX: 68 }).faceX).toBe(70);
    expect(svc().sanitizeFrame('x', { scene: 'screen_share', speakerZone: 'none', pipCorner: 'none', confidence: 0.9, faceX: 30 }).faceX).toBe(-1);
    expect(svc().sanitizeFrame('x', { scene: 'talking_head', speakerZone: 'center', pipCorner: 'none', confidence: 0.9, faceX: 999 }).faceX).toBe(-1);
    expect(svc().sanitizeFrame('x', { scene: 'talking_head', speakerZone: 'center', pipCorner: 'none', confidence: 0.9 }).faceX).toBe(-1);
  });

  it('faceY/faceW gruesos con los mismos resguardos', () => {
    const good = svc().sanitizeFrame('x', { scene: 'pip', speakerZone: 'right', pipCorner: 'bottomRight', confidence: 0.9, faceX: 85, faceY: 73, faceW: 14 });
    expect(good.faceY).toBe(75);
    expect(good.faceW).toBe(10);
    const nop = svc().sanitizeFrame('x', { scene: 'screen_share', speakerZone: 'none', pipCorner: 'none', confidence: 0.9, faceY: 40, faceW: 30 });
    expect(nop.faceY).toBe(-1);
    expect(nop.faceW).toBe(-1);
  });
});
