import { Module } from '@nestjs/common';
import { ClipsController } from './clips.controller.js';
import { ClipsService } from './clips.service.js';
import { SentenceSegmenterService } from './sentence-segmenter.service.js';
import { EdlValidatorService } from './edl-validator.service.js';
import { HeuristicClipsService } from './heuristic-clips.service.js';
import { GeminiModule } from '../gemini/gemini.module.js';

@Module({
  imports: [GeminiModule],
  controllers: [ClipsController],
  providers: [ClipsService, SentenceSegmenterService, EdlValidatorService, HeuristicClipsService],
  exports: [ClipsService, SentenceSegmenterService, EdlValidatorService, HeuristicClipsService],
})
export class ClipsModule {}
