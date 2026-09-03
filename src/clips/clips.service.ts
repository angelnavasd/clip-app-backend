import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service.js';
import { AnalyzeTranscriptDto } from './dto/analyze-transcript.dto.js';
import { EdlResponseDto } from './dto/edl-response.dto.js';
import {
  AnalyzeFramesDto,
  FramesResponseDto,
} from './dto/analyze-frames.dto.js';

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(private readonly geminiService: GeminiService) {}

  async analyze(dto: AnalyzeTranscriptDto): Promise<EdlResponseDto> {
    this.logger.log(`Received analyze request for video: ${dto.videoId}`);
    return this.geminiService.analyzeTranscript(dto);
  }

  async analyzeFrames(dto: AnalyzeFramesDto): Promise<FramesResponseDto> {
    this.logger.log(
      `Received analyze-frames request for video: ${dto.videoId} (${dto.frames?.length ?? 0} frames)`,
    );
    return this.geminiService.analyzeFrames(dto);
  }
}
