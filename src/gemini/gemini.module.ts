import { Module } from '@nestjs/common';
import { GeminiService } from './gemini.service.js';
import { SentenceSegmenterService } from '../clips/sentence-segmenter.service.js';
import { EdlValidatorService } from '../clips/edl-validator.service.js';

@Module({
  providers: [GeminiService, SentenceSegmenterService, EdlValidatorService],
  exports: [GeminiService],
})
export class GeminiModule {}
