import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getVideoDetails, getSubtitles } from 'youtube-caption-extractor';
import { GeminiService } from '../gemini/gemini.service.js';
import { WordTimestampDto } from '../clips/dto/analyze-transcript.dto.js';
import { YouTubeIngestDto } from './dto/youtube-ingest.dto.js';
import { EdlResponseDto } from '../clips/dto/edl-response.dto.js';

const execFileAsync = promisify(execFile);

export interface YouTubeIngestResult {
  videoId: string;
  title: string;
  thumbnailUrl: string;
  streamUrl?: string;
  words: WordTimestampDto[];
  analysis: EdlResponseDto;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly ytDlpPath = '/opt/homebrew/bin/yt-dlp';

  constructor(private readonly geminiService: GeminiService) {}

  // MARK: - Extraer Video ID de cualquier formato de URL de YouTube
  extractVideoId(url: string): string {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
      /^[a-zA-Z0-9_-]{11}$/,
    ];

    for (const pattern of patterns) {
      const match = url.trim().match(pattern);
      if (match && match[1]) {
        return match[1];
      } else if (match && match[0] && match[0].length === 11) {
        return match[0];
      }
    }

    throw new BadRequestException(
      'La URL proporcionada no es un enlace válido de YouTube.',
    );
  }

  // MARK: - Obtener URL de streaming directa con yt-dlp
  async getDirectStreamUrl(url: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(this.ytDlpPath, [
        '-g',
        '-f',
        '18/best[height<=720]/best',
        '--no-playlist',
        url,
      ]);
      const lines = stdout.trim().split('\n');
      return lines[0]?.trim();
    } catch (error) {
      this.logger.warn(
        `[IngestService] No se pudo obtener URL directa de streaming con yt-dlp: ${error}`,
      );
      return undefined;
    }
  }

  // MARK: - Ingesta Completa de YouTube
  async ingestYouTube(dto: YouTubeIngestDto): Promise<YouTubeIngestResult> {
    const videoId = this.extractVideoId(dto.url);
    this.logger.log(`Iniciando ingesta de YouTube para videoId: ${videoId}`);

    const preferredLang = dto.lang || 'es';
    let details: any = null;
    let subtitlesList: Array<{ start: string; dur: string; text: string }> = [];

    // 1. Obtener detalles y subtítulos con youtube-caption-extractor
    try {
      details = await getVideoDetails({ videoID: videoId, lang: preferredLang });
      subtitlesList = details?.subtitles || [];
    } catch (err: any) {
      this.logger.warn(
        `Fallo al obtener subtítulos en '${preferredLang}', probando en 'en'... (${err?.message})`,
      );
    }

    // Fallback a inglés si no encontró en español
    if (!subtitlesList || subtitlesList.length === 0) {
      try {
        const enSubs = await getSubtitles({ videoID: videoId, lang: 'en' });
        if (enSubs && enSubs.length > 0) {
          subtitlesList = enSubs;
        }
      } catch (err: any) {
        this.logger.warn(`No se encontraron subtítulos en inglés: ${err?.message}`);
      }
    }

    if (!subtitlesList || subtitlesList.length === 0) {
      throw new BadRequestException(
        'Este video de YouTube no cuenta con transcripción ni subtítulos disponibles para analizar.',
      );
    }

    // 2. Convertir oraciones a WordTimestampDto con timestamps proporcionales
    const words: WordTimestampDto[] = [];
    for (const sub of subtitlesList) {
      const start = parseFloat(sub.start);
      const dur = parseFloat(sub.dur);
      const cleanText = sub.text.replace(/\[.*?\]/g, '').replace(/♪/g, '').trim();
      if (!cleanText) continue;

      const splitWords = cleanText.split(/\s+/).filter((w) => w.length > 0);
      if (splitWords.length === 0) continue;

      const perWordDuration = dur / splitWords.length;
      for (let i = 0; i < splitWords.length; i++) {
        const wStart = start + i * perWordDuration;
        const wEnd = wStart + perWordDuration;
        words.push({
          word: splitWords[i],
          start: parseFloat(wStart.toFixed(2)),
          end: parseFloat(wEnd.toFixed(2)),
        });
      }
    }

    const videoDuration = words.length > 0 ? words[words.length - 1].end : 60;

    this.logger.log(
      `Transcripción procesada: ${words.length} palabras detectadas (duración aprox: ${videoDuration}s). Enviando a Gemini...`,
    );

    // 3. Analizar con Gemini para encontrar los clips virales
    const analysis = await this.geminiService.analyzeTranscript({
      videoId,
      videoDuration,
      language: preferredLang,
      words,
    });

    // 4. Obtener URL de streaming directo para reproducir y editar en el dispositivo
    const streamUrl = await this.getDirectStreamUrl(dto.url);

    const title = details?.title || `YouTube Video (${videoId})`;
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    return {
      videoId,
      title,
      thumbnailUrl,
      streamUrl,
      words,
      analysis,
    };
  }
}
