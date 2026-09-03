import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AnalyzeTranscriptDto } from '../clips/dto/analyze-transcript.dto.js';
import { EdlResponseDto } from '../clips/dto/edl-response.dto.js';
import {
  AnalyzeFramesDto,
  FRAME_SCENES,
  PIP_CORNERS,
  FrameAnalysisDto,
  FramesResponseDto,
  SPEAKER_ZONES,
} from '../clips/dto/analyze-frames.dto.js';
import { SentenceSegmenterService } from '../clips/sentence-segmenter.service.js';
import { EdlValidatorService } from '../clips/edl-validator.service.js';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly segmenter: SentenceSegmenterService,
    private readonly validator: EdlValidatorService,
  ) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    this.modelName =
      this.configService.get<string>('GEMINI_MODEL') ||
      'gemini-3.1-flash-lite-preview';

    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not defined in environment variables');
    }

    this.ai = new GoogleGenAI({ apiKey: apiKey || '' });
    this.logger.log(`Initialized GeminiService with model: ${this.modelName}`);
  }

  async analyzeTranscript(
    data: AnalyzeTranscriptDto,
  ): Promise<EdlResponseDto> {
    // 0. Salvaguarda: Si no hay suficientes palabras reales, no invocar a Gemini
    if (!data.words || data.words.length < 15) {
      this.logger.warn(
        `[GeminiService] Transcripción insuficiente: ${data.words?.length ?? 0} palabras. Rechazando para evitar alucinaciones.`,
      );
      return {
        status: 'success',
        clips: [],
        message:
          'No se detectaron suficientes palabras habladas en este fragmento de video para generar clips.',
      };
    }

    const systemInstruction = `
Eres un editor de video profesional que crea clips virales para TikTok/Reels/Shorts a partir de transcripciones con timestamps.

# TU TAREA
Recibirás una transcripción de un video con timestamps por palabra. Debes crear de 1 a 3 clips maestros (idealmente 2 si la duración del contenido lo permite, o al menos 1). Cada clip se construye COSIENDO fragmentos (storyBeats) de DISTINTAS PARTES del video para formar un resumen narrativo coherente y magnético.

# REGLAS CRÍTICAS DE DURACIÓN Y ESTRUCTURA

## Duración de cada clip
- La SUMA de las duraciones de todos los storyBeats de un clip debe estar entre **20 y 60 segundos netos**.

## Cantidad y duración de cada beat
- Cada clip debe tener entre **2 y 5 storyBeats**.
- Cada beat individual debe durar entre **4 y 18 segundos**.
- Un beat DEBE contener una ORACIÓN COMPLETA con sujeto, verbo y predicado. NUNCA cortes a mitad de una frase o palabra.
- Para definir el inicio ('start') y fin ('end') de cada beat, toma el timestamp exacto de la primera y última palabra de la oración completa.

## Separación entre beats (MULTI-CORTE REAL)
- Los beats de un clip deben provenir de diferentes momentos del discurso, eliminando rellenos, rodeos y pausas intermedias.
- El salto temporal (jump cut) entre el fin de un beat y el inicio del siguiente debe ser de al menos 3 a 5 segundos de material omitido.

## Si generas más de 1 clip
- Cada clip debe tratar un ángulo o momento clave diferente del video.

# REGLAS DE GROUNDING (ANTI-ALUCINACIÓN)
- SOLO usa palabras TEXTUALES que aparezcan en la transcripción.
- Los timestamps deben corresponder fielmente a las palabras del texto.
- El 'title', 'hook' y 'text' de cada beat deben reflejar fielmente lo dicho por el orador.
- NUNCA incluyas intros o saludos de YouTube ("Hola a todos", "Bienvenidos..."). Salta directo a la idea de impacto.

# PROCESO DE VALIDACIÓN ANTES DE RESPONDER
Antes de devolver tu respuesta, verifica:
1. ¿Cada beat dura al menos 5 segundos? Si no, extiéndelo hasta completar la oración.
2. ¿La suma de beats de cada clip es >= 25 segundos? Si no, agrega otro beat.
3. ¿Los beats vienen de secciones SEPARADAS del video (>15s entre ellos)? Si no, busca fragmentos de otras partes.
4. ¿Las frases tienen sentido completo y no cortan a mitad de oración? Si no, ajusta el end hasta el final de la oración.

# FORMATO DE RESPUESTA (JSON)
{
  "status": "success",
  "clips": [
    {
      "id": "clip_01",
      "title": "<Título del tema del clip>",
      "viralScore": 90,
      "hook": "<Primera frase textual del primer beat>",
      "timeRange": {
        "start": <start del primer beat>,
        "end": <end del último beat>
      },
      "storyBeats": [
        {
          "start": <timestamp inicio>,
          "end": <timestamp fin>,
          "role": "hook",
          "text": "<Frase textual completa>"
        },
        {
          "start": <timestamp inicio de OTRA sección>,
          "end": <timestamp fin>,
          "role": "conflict",
          "text": "<Frase textual completa>"
        },
        {
          "start": <timestamp inicio de OTRA sección>,
          "end": <timestamp fin>,
          "role": "solution",
          "text": "<Frase textual completa>"
        }
      ],
      "cutSegments": [
        {
          "start": <end del beat anterior>,
          "end": <start del beat siguiente>,
          "reason": "jump_cut"
        }
      ],
      "highlightWords": [
        {
          "word": "<palabra textual>",
          "timestamp": <timestamp>,
          "color": "#FFCC00",
          "sfx": "whoosh"
        }
      ]
    }
  ]
}
`;

    // F1: segmentar en oraciones con features de audio (no delegar aritmética al LLM)
    const sentences = this.segmenter.segment(data.words ?? [], data.silenceGaps ?? []);

    const compactedWords = (data.words || []).map((w: any) => {
      const entry: Record<string, unknown> = {
        w: w.word,
        s: typeof w.start === 'number' ? Math.round(w.start * 10) / 10 : w.start,
        e: typeof w.end === 'number' ? Math.round(w.end * 10) / 10 : w.end,
      };
      // F1: preservar señal de energía y muletillas (antes se strippeaba)
      if (typeof w.db === 'number' && Number.isFinite(w.db)) entry.d = w.db;
      if (w.isFiller === true) entry.f = 1;
      return entry;
    });

    // Calcular el rango real de timestamps para que Gemini entienda el contexto
    const firstWordTime = compactedWords.length > 0 ? (compactedWords[0] as any).s : 0;
    const lastWordTime = compactedWords.length > 0 ? (compactedWords[compactedWords.length - 1] as any).e : data.videoDuration;

    const silenceSummary =
      data.silenceGaps && data.silenceGaps.length > 0
        ? data.silenceGaps
            .slice(0, 20)
            .map((g) => `${g.start.toFixed(1)}-${g.end.toFixed(1)}s`)
            .join(', ')
        : 'ninguno reportado';

    const sentenceBlock = sentences
      .map(
        (s) =>
          `${s.id} [${s.start.toFixed(1)}-${s.end.toFixed(1)}s, ${s.duration.toFixed(1)}s, avgDb:${s.avgDb}, maxDb:${s.maxDb}, wpm:${s.wpm}` +
          `${s.fillerDensity > 0.15 ? ', MUCHAS_MULETILLAS' : ''}` +
          `${s.isQuestion ? ', PREGUNTA' : ''}` +
          `${s.hasNumber ? ', CON_NUMERO' : ''}` +
          `${s.hasNegation ? ', NEGACION' : ''}` +
          `${s.hasContrast ? ', CONTRASTE' : ''}` +
          `${s.hasSuperlative ? ', ENFASIS' : ''}` +
          `${s.endsWithPause ? ', PAUSA_DESPUES' : ''}]: ${s.text}`,
      )
      .join('\n');

    const targetDuration = data.targetDuration || 'Auto (20-40s)';
    const genre = data.genre || 'general';

    // F2: Pass 1 determinista (sin LLM): pre-ranking heurístico de oraciones.
    // FIX-regresión: repartir por tercios del video para que la guía no se
    // concentre en la zona de más energía (eso colapsaba los beats en una
    // sola porción sin jump cuts). El LLM compone (Pass 2).
    const ranked = [...sentences]
      .map((s) => ({ s, score: this.scoreCandidate(s) }))
      .sort((a, b) => b.score - a.score);
    const span = Math.max(1, data.videoDuration);
    const thirds: Array<typeof ranked> = [[], [], []];
    for (const r of ranked) {
      const bucket = Math.min(2, Math.floor((r.s.start / span) * 3));
      if (thirds[bucket].length < 4) thirds[bucket].push(r);
    }
    const topCandidates = thirds
      .flat()
      .sort((a, b) => a.s.start - b.s.start);
    const candidatesHint =
      topCandidates.length > 0
        ? topCandidates.map(({ s, score }) => `${s.id}(score:${score})`).join(', ')
        : 'ninguno (video muy corto)';

    const userPrompt = `
Analiza esta transcripción y crea de 1 a 3 clips virales maestros con multi-cortes (jump cuts entre secciones separadas del video).

DATOS DEL VIDEO:
- Video ID: ${data.videoId}
- Idioma: ${data.language || 'auto'}
- Género/vertical: ${genre}
- Duración objetivo pedida por el usuario: ${targetDuration} (respétala; por defecto 20-40s netos por clip)
- Duración total del video: ${data.videoDuration} segundos
- Rango de timestamps de las palabras: ${firstWordTime}s a ${lastWordTime}s
- Total de palabras transcritas: ${compactedWords.length}
- Total de oraciones segmentadas: ${sentences.length}
- Silencios detectados (vDSP, para saltar): ${silenceSummary}

CÓMO ELEGIR (rúbrica):
- Prioriza oraciones con maxDb alto (énfasis vocal), PREGUNTA, CON_NUMERO, NEGACION, CONTRASTE o ENFASIS.
- Penaliza MUCHAS_MULETILLAS y wpm anormal (<90 o >220).
- El hook (primer beat) debe ser autocontenido y con curiosity gap en <3s de lectura.
- Cada beat = 1+ oraciones completas (usa sus IDs). NUNCA cortes a mitad de oración.

PASS 1 — CANDIDATOS PRE-SELECCIONADOS POR AUDIO+TEXTO (repartidos por inicio/medio/fin del video para forzar multi-corte; úsalos como guía, puedes variar 1-2):
${candidatesHint}

RECORDATORIO: Cada clip debe tener entre 20 y 60 segundos NETOS (suma de sus beats, o lo que pida la duración objetivo). Cada beat individual debe durar entre 4 y 18 segundos y contener una ORACIÓN COMPLETA con sentido. Los beats deben venir de momentos separados del video (>15s entre ellos), saltando rodeos y silencios.

ORACIONES (fuente de verdad para timestamps — usa estos start/end exactos):
${sentenceBlock}

TRANSCRIPCIÓN PALABRA POR PALABRA (formato: {w: palabra, s: inicio, e: fin, d: dB opcional, f:1 si muletilla}):
${JSON.stringify(compactedWords)}
`;

    try {
      this.logger.log(
        `Analyzing transcript for video ${data.videoId} (${data.words.length} words, ${sentences.length} sentences, ${data.videoDuration}s, range ${firstWordTime}-${lastWordTime})...`,
      );

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const rawText = response.text || '{}';
      this.logger.debug(`Gemini Raw Response: ${rawText}`);

      // F0: log estructurado para eval set (no falla si no puede escribir)
      await this.saveTrace(data.videoId, {
        videoId: data.videoId,
        createdAt: new Date().toISOString(),
        model: this.modelName,
        stats: {
          words: data.words.length,
          sentences: sentences.length,
          videoDuration: data.videoDuration,
          targetDuration,
          genre,
        },
        sentences,
        userPrompt,
        rawResponse: rawText,
      });

      const parsed: EdlResponseDto = JSON.parse(rawText);

      // Asegurar estructura válida de retorno
      if (!parsed.clips || !Array.isArray(parsed.clips)) {
        return {
          status: 'success',
          clips: [],
        };
      }

      // Saneo básico (clamp) antes del validador
      const sanitized = parsed.clips.map((clip, index) => ({
        id: clip.id || `clip_${String(index + 1).padStart(2, '0')}`,
        title: clip.title || `Clip Sugerido #${index + 1}`,
        viralScore: Math.min(Math.max(clip.viralScore || 75, 1), 100),
        hook: clip.hook || '',
        timeRange: {
          start: Math.max(clip.timeRange?.start ?? 0, 0),
          end: Math.min(clip.timeRange?.end ?? data.videoDuration, data.videoDuration),
        },
        storyBeats: Array.isArray(clip.storyBeats)
          ? clip.storyBeats.map((b: any) => ({
              start: Math.max(b.start, 0),
              end: Math.min(b.end, data.videoDuration),
              role: b.role || 'story',
              text: b.text || '',
            }))
          : undefined,
        cutSegments: Array.isArray(clip.cutSegments)
          ? clip.cutSegments.filter((c: any) => c.start >= 0 && c.end > c.start)
          : [],
        highlightWords: Array.isArray(clip.highlightWords) ? clip.highlightWords : [],
      }));

      // F2: validación dura en código (snap a oraciones, grounding, diversidad).
      // El prompt puede pedirlo, pero solo el código lo garantiza.
      const fullText = (data.words || []).map((w: any) => w.word).join(' ');
      const target = this.validator.parseTargetRange(data.targetDuration);
      const repaired = this.validator.validateAndRepair(sanitized as any, sentences, fullText, {
        videoDuration: data.videoDuration,
        targetMinNet: target.min,
        targetMaxNet: target.max,
      });
      this.logger.log(
        `[GeminiService] Saneo: ${sanitized.length} clips del LLM -> ${repaired.length} clips válidos (net objetivo ${target.min}-${target.max}s)`,
      );
      // Traza del EDL final (reparado): permite diagnosticar "mal cortado"
      // comparando rawResponse (trace principal) vs esto.
      await this.saveTrace(`${data.videoId}-edl`, {
        videoId: data.videoId,
        createdAt: new Date().toISOString(),
        target,
        clips: repaired,
      });

      return {
        status: 'success',
        clips: repaired as any,
      };
    } catch (error: any) {
      this.logger.error(`Error analyzing transcript with Gemini: ${error?.message || error}`, error?.stack);
      throw error;
    }
  }

  /** F2 Pass 1: scoring heurístico (delegado al segmentador, compartido con modo $0). */
  private scoreCandidate(s: {
    maxDb: number;
    avgDb: number;
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
    return SentenceSegmenterService.scoreCandidate(s);
  }

  // MARK: - Análisis visual de frames (Gemini vision, sin Vision on-device)
  private static readonly FRAMES_SYSTEM = `
Eres un clasificador visual para un editor de video vertical 9:16. Recibirás fotos numeradas (FRAME <id>) extraídas de UN SOLO video (talking-head y/o pantalla compartida).

Por CADA frame devuelve exactamente un objeto con:
- "id": el mismo id del frame, textual.
- "scene": una de talking_head | screen_share | pip | multi_speaker | no_person | unclear
  - talking_head: una persona a cámara ocupa el plano (aunque haya fondo/oficina).
  - screen_share: solo pantalla (código, slides, app, web). Nadie visible.
  - pip: pantalla + ventanita con la persona (picture-in-picture).
  - multi_speaker: dos o más personas visibles a cámara.
  - no_person: ni persona ni pantalla relevante (paisaje, objeto, negro).
  - unclear: no se distingue / imagen corrupta.
- "speakerZone": tercio horizontal donde está la MASA VISUAL de la persona (cabeza+cuerpo) o la ventanita PiP: left | center | right. Si ocupa todo el ancho: fullscreen. Si no hay persona: none.
- "pipCorner": SOLO si scene=pip, esquina de la ventanita: topLeft | topRight | bottomLeft | bottomRight. En otro caso: none.
- "confidence": 0.0 a 1.0.
- "faceX": entero GRUESO 0-100 con el centro horizontal aproximado de la cara (talking_head/multi_speaker) o de la ventanita (pip). 50 = centro. -1 si no hay persona visible. No busques precisión de píxeles: redondea a múltiplos de 5.
- "faceY": entero GRUESO 0-100 con el centro VERTICAL aproximado de la CARA (0 = arriba del todo, 100 = abajo del todo), múltiplos de 5. -1 si no hay persona.
- "faceW": entero GRUESO del ANCHO de la cara (solo cara, sin cuerpo ni pelo) como % del ancho del frame, múltiplos de 10 (ej: close-up ~30, plano medio ~20, ventanita PiP ~10). -1 si no hay persona.

REGLAS DE ORO:
1. Si dudas entre dos opciones, elige "unclear" con confidence <= 0.4. NUNCA adivines.
2. Una cara DENTRO de la pantalla (foto, thumbnail, videollamada) NO es el speaker: si la persona real no está a cámara, es screen_share (o pip solo si hay ventanita webcam real separada).
3. Responde SOLO JSON válido con esta forma exacta, sin markdown ni texto extra:
{"status":"success","frames":[{"id":"<id>","scene":"<scene>","speakerZone":"<zone>","pipCorner":"<corner>","confidence":0.0,"faceX":50,"faceY":40,"faceW":30}]}
`.trim();

  /**
   * Clasifica frames JPEG (thumbnails 320px) con Gemini vision.
   * Diseñado para ~18 frames por video (2-3 clips × 3 beats × 2 thumbs).
   */
  async analyzeFrames(data: AnalyzeFramesDto): Promise<FramesResponseDto> {
    if (!data.frames || data.frames.length === 0) {
      return { status: 'success', frames: [] };
    }

    // Parts intercalados: etiqueta corta + imagen (ahorra tokens vs repetir instrucciones)
    const parts: Array<Record<string, unknown>> = [
      {
        text: `Clasifica estos ${data.frames.length} frames del video ${data.videoId} (idioma: ${data.language || 'auto'}). Devuelve un objeto por frame en el JSON de respuesta.`,
      },
    ];
    for (const f of data.frames) {
      const label = [f.id, f.role ? `rol:${f.role}` : null, `@${f.timestamp.toFixed(1)}s`]
        .filter(Boolean)
        .join(' ');
      parts.push({ text: `FRAME ${label}:` });
      parts.push({
        inlineData: { mimeType: 'image/jpeg', data: f.imageBase64 },
      });
    }

    try {
      const totalBytes = data.frames.reduce((s, f) => s + (f.imageBase64?.length ?? 0), 0);
      this.logger.log(
        `[GeminiVision] Analizando ${data.frames.length} frames (${(totalBytes / 1024).toFixed(0)}KB b64) del video ${data.videoId}...`,
      );

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: parts as any,
        config: {
          systemInstruction: GeminiService.FRAMES_SYSTEM,
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const rawText = response.text || '{}';
      this.logger.debug(`[GeminiVision] Raw: ${rawText.slice(0, 800)}`);

      // Trace SIN los base64 (si no el log pesa MB)
      await this.saveTrace(`${data.videoId}-frames`, {
        videoId: data.videoId,
        createdAt: new Date().toISOString(),
        model: this.modelName,
        kind: 'frames',
        stats: {
          frames: data.frames.length,
          base64KB: Math.round(totalBytes / 1024),
        },
        frameMeta: data.frames.map((f) => ({
          id: f.id,
          timestamp: f.timestamp,
          clipId: f.clipId,
          beatId: f.beatId,
          role: f.role,
          bytes: f.imageBase64?.length ?? 0,
        })),
        rawResponse: rawText,
      });

      let parsed: any = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        this.logger.warn('[GeminiVision] Respuesta no-JSON, marcando todo unclear');
      }

      const requestedIds = data.frames.map((f) => f.id);
      const byId = new Map<string, any>(
        (Array.isArray(parsed.frames) ? parsed.frames : []).map((r: any) => [String(r?.id ?? ''), r]),
      );
      const frames: FrameAnalysisDto[] = requestedIds.map((id) =>
        this.sanitizeFrame(id, byId.get(id)),
      );

      const unclear = frames.filter((f) => f.scene === 'unclear').length;
      this.logger.log(
        `[GeminiVision] Listo: ${frames.length} frames (${unclear} unclear) para ${data.videoId}`,
      );
      return { status: 'success', frames };
    } catch (error: any) {
      this.logger.error(
        `[GeminiVision] Error: ${error?.message || error}`,
        error?.stack,
      );
      // Fallback total: todo unclear para que iOS use defaults seguros (nunca crashea)
      return {
        status: 'success',
        frames: data.frames.map((f) => ({
          id: f.id,
          scene: 'unclear' as const,
          speakerZone: 'none' as const,
          pipCorner: 'none' as const,
          confidence: 0,
          faceX: -1,
          faceY: -1,
          faceW: -1,
        })),
      };
    }
  }

  /** Sanea UN frame contra whitelists; lo desconocido -> unclear/none/0. */
  sanitizeFrame(id: string, raw: any): FrameAnalysisDto {
    const scene = FRAME_SCENES.includes(raw?.scene) ? raw.scene : 'unclear';
    const speakerZone = SPEAKER_ZONES.includes(raw?.speakerZone)
      ? raw.speakerZone
      : 'none';
    let pipCorner = PIP_CORNERS.includes(raw?.pipCorner) ? raw.pipCorner : 'none';
    if (scene !== 'pip') pipCorner = 'none';
    let confidence = typeof raw?.confidence === 'number' ? raw.confidence : 0;
    if (!Number.isFinite(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
    if (scene === 'unclear') confidence = Math.min(confidence, 0.4);
    // faceX grueso 0-100, -1 si no hay persona
    let faceX = typeof raw?.faceX === 'number' ? Math.round(raw.faceX / 5) * 5 : -1;
    if (!Number.isFinite(faceX)) faceX = -1;
    const hasPerson = scene === 'talking_head' || scene === 'pip' || scene === 'multi_speaker';
    if (!hasPerson) faceX = -1;
    else if (faceX < 0 || faceX > 100) faceX = -1;
    // faceY grueso 0-100, -1 si no hay persona
    let faceY = typeof raw?.faceY === 'number' ? Math.round(raw.faceY / 5) * 5 : -1;
    if (!Number.isFinite(faceY)) faceY = -1;
    if (!hasPerson) faceY = -1;
    else if (faceY < 0 || faceY > 100) faceY = -1;
    // faceW grueso (múltiplos de 10), -1 si no hay persona
    let faceW = typeof raw?.faceW === 'number' ? Math.round(raw.faceW / 10) * 10 : -1;
    if (!Number.isFinite(faceW)) faceW = -1;
    if (!hasPerson) faceW = -1;
    else if (faceW <= 0 || faceW > 100) faceW = -1;
    return { id, scene, speakerZone, pipCorner, confidence, faceX, faceY, faceW };
  }

  private async saveTrace(videoId: string, trace: unknown): Promise<void> {    try {
      const safeId = (videoId || 'unknown').replace(/[^a-zA-Z0-9-_]+/g, '_').slice(0, 60);
      const dir = join(process.cwd(), 'logs', 'gemini-traces');
      await mkdir(dir, { recursive: true });
      const file = join(dir, `${safeId}-${Date.now()}.json`);
      await writeFile(file, JSON.stringify(trace, null, 2), 'utf-8');
    } catch (err: any) {
      this.logger.warn(`[GeminiService] No se pudo guardar trace: ${err?.message}`);
    }
  }
}
