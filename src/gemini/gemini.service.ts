import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AnalyzeTranscriptDto } from '../clips/dto/analyze-transcript.dto.js';
import { EdlResponseDto } from '../clips/dto/edl-response.dto.js';
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

    const targetClipCount = Math.max(1, Math.min(8, data.targetClipCount || 4));

    const systemInstruction = `
Eres un editor de video profesional que crea clips virales para TikTok/Reels/Shorts a partir de transcripciones con timestamps.

# TU TAREA
Recibirás una transcripción de un video con timestamps por palabra. Debes crear hasta ${targetClipCount} clips maestros (idealmente ${targetClipCount} opciones si la duración y variedad del contenido lo permite, o al menos 3). Cada clip se construye COSIENDO fragmentos (storyBeats) de DISTINTAS PARTES del video para formar un resumen narrativo coherente y magnético.
Cada clip debe enfocarse en un ángulo, idea o momento clave DIFERENTE del video, permitiendo al usuario elegir entre varias opciones narrativas interesantes.

# REGLAS CRÍTICAS DE DURACIÓN Y ESTRUCTURA

## Duración de cada clip
- La SUMA de las duraciones de todos los storyBeats de un clip debe estar entre **20 y 60 segundos netos**.

## Cantidad y duración de cada beat
- Cada clip debe tener entre **2 y 5 storyBeats**.
- Cada beat individual debe durar entre **4 y 18 segundos**.
- Un beat DEBE contener una ORACIÓN COMPLETA con sujeto, verbo y predicado. NUNCA cortes a mitad de una frase o palabra.
- Para definir el inicio ('start') y fin ('end') de cada beat, toma el timestamp exacto de la primera y última palabra de la oración completa.

## Separación entre beats y UNIDAD TEMÁTICA (CRUCIAL — EVITAR CLIPS FRANKENSTEIN)
- Cada clip DEBE tener una UNIDAD TEMÁTICA CLARA: debe abordar UN solo tema, anécdota, debate o historia específica.
- NUNCA unas frases de partes totalmente inconexas del video que hablen de cosas distintas solo para forzar un salto.
- Los jump cuts se usan para condensar esa misma idea (saltando rodeos, silencios, muletillas o digresiones secundarias dentro de ese mismo bloque de contenido, típicamente dentro de una ventana de 30 a 120 segundos del video original, o conectando un planteamiento inicial con su conclusión directa).
- Al escuchar el clip completo, debe sonar como un pensamiento fluido, lógico y coherente, como si el orador lo hubiera dicho de seguido con dinamismo.
- Si hay jump cut entre beats, debe haber al menos 2 a 5 segundos de material omitido (silencio o rodeo saltado).

## Diversidad entre clips (REGLA FUNDAMENTAL)
- Cada clip DEBE tener un GANCHO (hook) completamente DIFERENTE y abordar una temática o momento distinto del video.
- Evita repetir los mismos beats entre clips; distribuye el contenido del video para que cada una de las 4 opciones sea una experiencia única y valiosa para el usuario.

# REGLA SUPREMA: COHERENCIA DEL DISCURSO Y ORACIONES COMPLETAS (100% OBLIGATORIO)
- La coherencia discursiva y el sentido completo de las frases MANDA SOBRE TODO LO DEMÁS.
- Cada beat DEBE ser una o más oraciones completas con sentido retórico cerrado. NUNCA cortes una idea a la mitad.
- NUNCA termines un beat o un clip con conectores colgantes (ej: "por ejemplo", "es que", "pero", "y", "porque", "o sea", "es decir", "como"). El clip y cada beat deben tener cierre natural.
- Sobre los cortes de escena ('sceneCuts'): son ÚNICAMENTE una referencia visual opcional. NO fuerces cortes de audio por un sceneCut. Si hay un cambio de plano en medio de una frase o idea interesante, deja que la frase termine completa; el motor de la app ajusta el encuadre automáticamente en video sin cortar el audio.

# REGLAS DE GROUNDING (ANTI-ALUCINACIÓN)
- SOLO usa palabras TEXTUALES que aparezcan en la transcripción.
- Los timestamps deben corresponder fielmente a las palabras del texto.
- El 'title', 'hook' y 'text' de cada beat deben reflejar fielmente lo dicho por el orador.
- NUNCA incluyas intros o saludos de YouTube ("Hola a todos", "Bienvenidos..."). Salta directo a la idea de impacto.

# PROCESO DE VALIDACIÓN ANTES DE RESPONDER
Antes de devolver tu respuesta, verifica:
1. ¿Cada beat dura al menos 4 segundos y contiene oraciones completas? Si no, extiéndelo.
2. ¿La suma de beats de cada clip cumple la duración pedida (por defecto 20-40s)? Si no, ajusta los beats.
3. ¿El clip tiene UNIDAD TEMÁTICA clara y coherente (trata sobre un solo tema o anécdota sin saltar a temas inconexos que creen una idea rara)? Si no, reenfoca los beats en esa misma idea.
4. ¿Las frases tienen sentido completo y NO cortan a mitad de oración ni terminan en conectores como 'por ejemplo' o 'pero'? Si no, incluye la oración complementaria o cambia el beat.

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
          "start": <timestamp inicio del hook>,
          "end": <timestamp fin del hook>,
          "role": "hook",
          "text": "<Frase textual completa>"
        },
        {
          "start": <timestamp inicio del desarrollo>,
          "end": <timestamp fin>,
          "role": "conflict",
          "text": "<Frase textual completa>"
        },
        {
          "start": <timestamp inicio del desenlace>,
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
    // Repartir por cuartos del video para distribuir los candidatos en toda la línea temporal.
    const ranked = [...sentences]
      .map((s) => ({ s, score: this.scoreCandidate(s) }))
      .sort((a, b) => b.score - a.score);
    const span = Math.max(1, data.videoDuration);
    const bucketsCount = Math.min(4, Math.max(2, targetClipCount));
    const buckets: Array<typeof ranked> = Array.from({ length: bucketsCount }, () => []);
    for (const r of ranked) {
      const bIdx = Math.min(bucketsCount - 1, Math.floor((r.s.start / span) * bucketsCount));
      if (buckets[bIdx].length < 4) buckets[bIdx].push(r);
    }
    const topCandidates = buckets
      .flat()
      .sort((a, b) => a.s.start - b.s.start);
    const candidatesHint =
      topCandidates.length > 0
        ? topCandidates.map(({ s, score }) => `${s.id}(score:${score})`).join(', ')
        : 'ninguno (video muy corto)';

    const sceneCutsSummary =
      data.sceneCuts && data.sceneCuts.length > 0
        ? data.sceneCuts
            .slice(0, 30)
            .map((c) => `${c.toFixed(1)}s`)
            .join(', ')
        : 'ninguno reportado';

    const userPrompt = `
Analiza esta transcripción y crea ${targetClipCount} opciones distintas de clips virales maestros (cada una explorando un tema, momento o gancho diferente del video) con multi-cortes (jump cuts dinámicos que eliminan rodeos y silencios dentro de cada tema).

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
- Cortes de escena visuales detectados en el video (referencia visual opcional): ${sceneCutsSummary}

CÓMO ELEGIR (rúbrica):
- Prioriza oraciones con maxDb alto (énfasis vocal), PREGUNTA, CON_NUMERO, NEGACION, CONTRASTE o ENFASIS.
- Penaliza MUCHAS_MULETILLAS y wpm anormal (<90 o >220).
- El hook (primer beat) debe ser autocontenido y con curiosity gap en <3s de lectura.
- Cada beat = 1+ oraciones completas (usa sus IDs). NUNCA cortes a mitad de oración ni dejes frases colgando en conectores ("por ejemplo", "pero", "y", "porque").
- CADA CLIP DEBE TENER UNIDAD TEMÁTICA: debe tratar sobre una sola idea o anécdota. Usa los jump cuts para condensar esa misma idea (quitar rodeos y pausas), NUNCA para pegar temas inconexos de minutos distintos.

PASS 1 — CANDIDATOS PRE-SELECCIONADOS POR AUDIO+TEXTO (repartidos por inicio/medio/fin del video para forzar variedad entre clips; úsalos como guía, puedes variar 1-2):
${candidatesHint}

RECORDATORIO: Cada clip debe tener entre 20 y 60 segundos NETOS (suma de sus beats, o lo que pida la duración objetivo). Cada clip DEBE TENER UNIDAD TEMÁTICA (una sola idea, anécdota o reflexión coherente). Usa los jump cuts para quitar pausas y rodeos de esa misma idea, NO para pegar fragmentos de temas inconexos. Cada beat individual debe durar entre 4 y 18 segundos y contener una ORACIÓN COMPLETA con sentido y cierre. NUNCA cortes una frase a la mitad.

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
        targetClipCount,
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
