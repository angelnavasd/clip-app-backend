import { Module } from '@nestjs/common';
import { ClipsController } from './clips.controller.js';
import { ClipsService } from './clips.service.js';
import { GeminiModule } from '../gemini/gemini.module.js';

@Module({
  imports: [GeminiModule],
  controllers: [ClipsController],
  providers: [ClipsService],
  exports: [ClipsService],
})
export class ClipsModule {}
