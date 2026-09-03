import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { GeminiModule } from './gemini/gemini.module.js';
import { ClipsModule } from './clips/clips.module.js';
import { AssetsModule } from './assets/assets.module.js';
import { IngestModule } from './ingest/ingest.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    GeminiModule,
    ClipsModule,
    AssetsModule,
    IngestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
