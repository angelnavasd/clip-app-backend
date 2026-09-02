import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../gemini/gemini.service.js';
import { AnalyzeTranscriptDto } from './dto/analyze-transcript.dto.js';
import { EdlResponseDto } from './dto/edl-response.dto.js';

@Injectable()
export class ClipsService {
  private readonly logger = new Logger(ClipsService.name);

  constructor(private readonly geminiService: GeminiService) {}

  async analyze(dto: AnalyzeTranscriptDto): Promise<EdlResponseDto> {
    this.logger.log(`Received analyze request for video: ${dto.videoId}`);
    return this.geminiService.analyzeTranscript(dto);
  }
}
