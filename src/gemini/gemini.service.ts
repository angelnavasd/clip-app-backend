import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AnalyzeTranscriptDto } from '../clips/dto/analyze-transcript.dto.js';
import { EdlResponseDto } from '../clips/dto/edl-response.dto.js';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly ai: GoogleGenAI;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService) {
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

    const compactedWords = (data.words || []).map((w: any) => ({
      w: w.word,
      s: typeof w.start === 'number' ? Math.round(w.start * 10) / 10 : w.start,
      e: typeof w.end === 'number' ? Math.round(w.end * 10) / 10 : w.end,
    }));

    // Calcular el rango real de timestamps para que Gemini entienda el contexto
    const firstWordTime = compactedWords.length > 0 ? compactedWords[0].s : 0;
    const lastWordTime = compactedWords.length > 0 ? compactedWords[compactedWords.length - 1].e : data.videoDuration;

    const userPrompt = `
Analiza esta transcripción y crea de 1 a 3 clips virales maestros con multi-cortes (jump cuts entre secciones separadas del video).

DATOS DEL VIDEO:
- Video ID: ${data.videoId}
- Idioma: ${data.language || 'auto'}
- Duración total del video: ${data.videoDuration} segundos
- Rango de timestamps de las palabras: ${firstWordTime}s a ${lastWordTime}s
- Total de palabras transcritas: ${compactedWords.length}

RECORDATORIO: Cada clip debe tener entre 20 y 60 segundos NETOS (suma de sus beats). Cada beat individual debe durar entre 4 y 18 segundos y contener una ORACIÓN COMPLETA con sentido. Los beats deben venir de momentos separados del video, saltando los rodeos y silencios.

TRANSCRIPCIÓN (formato: {w: palabra, s: segundo_inicio, e: segundo_fin}):
${JSON.stringify(compactedWords)}
`;

    try {
      this.logger.log(
        `Analyzing transcript for video ${data.videoId} (${data.words.length} words, ${data.videoDuration}s, range ${firstWordTime}-${lastWordTime})...`,
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

      const parsed: EdlResponseDto = JSON.parse(rawText);

      // Asegurar estructura válida de retorno
      if (!parsed.clips || !Array.isArray(parsed.clips)) {
        return {
          status: 'success',
          clips: [],
        };
      }

      // Validar y sanear clips
      parsed.clips = parsed.clips.map((clip, index) => ({
        id: clip.id || `clip_${String(index + 1).padStart(2, '0')}`,
        title: clip.title || `Clip Sugerido #${index + 1}`,
        viralScore: Math.min(Math.max(clip.viralScore || 75, 1), 100),
        hook: clip.hook || '',
        timeRange: {
          start: Math.max(clip.timeRange?.start ?? 0, 0),
          end: Math.min(clip.timeRange?.end ?? data.videoDuration, data.videoDuration),
        },
        storyBeats: Array.isArray(clip.storyBeats)
          ? clip.storyBeats.map((b) => ({
              start: Math.max(b.start, 0),
              end: Math.min(b.end, data.videoDuration),
              role: b.role || 'story',
              text: b.text || '',
            }))
          : undefined,
        cutSegments: Array.isArray(clip.cutSegments)
          ? clip.cutSegments.filter((c) => c.start >= 0 && c.end > c.start)
          : [],
        highlightWords: Array.isArray(clip.highlightWords) ? clip.highlightWords : [],
      }));

      return {
        status: 'success',
        clips: parsed.clips,
      };
    } catch (error: any) {
      this.logger.error(`Error analyzing transcript with Gemini: ${error?.message || error}`, error?.stack);
      throw error;
    }
  }
}
