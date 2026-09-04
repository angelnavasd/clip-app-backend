import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiService } from '../gemini/gemini.service.js';
import { HeuristicClipsService } from './heuristic-clips.service.js';
import { AnalyzeTranscriptDto } from './dto/analyze-transcript.dto.js';
import { EdlResponseDto } from './dto/edl-response.dto.js';

// Clips service handles clip composition via Gemini LLM or heuristics.
@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);
  private readonly useLlmEdl: boolean;

  constructor(
    private readonly geminiService: GeminiService,
    private readonly heuristicService: HeuristicClipsService,
    config: ConfigService,
  ) {
    // $0 por defecto. Para reactivar el EDL con LLM: USE_LLM_EDL=true
    this.useLlmEdl = config.get<string>('USE_LLM_EDL') === 'true';
    this.logger.log(`EDL mode: ${this.useLlmEdl ? 'LLM (Gemini, con costo)' : 'heurístico ($0, offline)'}`);
  }

  async analyze(dto: AnalyzeTranscriptDto): Promise<EdlResponseDto> {
    this.logger.log(`Received analyze request for video: ${dto.videoId}`);
    if (this.useLlmEdl) {
      return this.geminiService.analyzeTranscript(dto);
    }
    const clips = this.heuristicService.compose({
      videoId: dto.videoId,
      videoDuration: dto.videoDuration,
      words: dto.words ?? [],
      silenceGaps: dto.silenceGaps ?? [],
      targetDuration: dto.targetDuration,
      targetClipCount: dto.targetClipCount,
    });
    return { status: 'success', clips: clips as any };
  }
}
