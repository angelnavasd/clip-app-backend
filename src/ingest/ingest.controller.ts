import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IngestService, YouTubeIngestResult } from './ingest.service.js';
import { YouTubeIngestDto } from './dto/youtube-ingest.dto.js';

@Controller('api/v1/ingest')
export class IngestController {
  constructor(private readonly ingestService: IngestService) {}

  @Post('youtube')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async ingestYouTube(
    @Body() dto: YouTubeIngestDto,
  ): Promise<YouTubeIngestResult> {
    return this.ingestService.ingestYouTube(dto);
  }
}
