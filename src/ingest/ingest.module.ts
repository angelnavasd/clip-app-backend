import { Module } from '@nestjs/common';
import { GeminiModule } from '../gemini/gemini.module.js';
import { IngestController } from './ingest.controller.js';
import { IngestService } from './ingest.service.js';

@Module({
  imports: [GeminiModule],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
