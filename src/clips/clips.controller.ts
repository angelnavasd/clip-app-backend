import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ClipsService } from './clips.service.js';
import { AnalyzeTranscriptDto } from './dto/analyze-transcript.dto.js';
import { EdlResponseDto } from './dto/edl-response.dto.js';
import {
  AnalyzeFramesDto,
  FramesResponseDto,
} from './dto/analyze-frames.dto.js';

@Controller('api/v1/clips')
export class ClipsController {
  constructor(private readonly clipsService: ClipsService) {}

  @Post('analyze-transcript')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async analyzeTranscript(
    @Body() dto: AnalyzeTranscriptDto,
  ): Promise<EdlResponseDto> {
    return this.clipsService.analyze(dto);
  }

  @Post('analyze-frames')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async analyzeFrames(
    @Body() dto: AnalyzeFramesDto,
  ): Promise<FramesResponseDto> {
    return this.clipsService.analyzeFrames(dto);
  }
}
