import { NestFactory } from '@nestjs/core';
import { AppModule } from '../dist/app.module.js';
import { ClipsService } from '../dist/clips/clips.service.js';

async function test() {
  console.log('Starting test against NestJS & Gemini 3.1 Flash Lite...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const clipsService = app.get(ClipsService);

  const samplePayload = {
    videoId: "local-asset-uuid-8891",
    language: "es",
    videoDuration: 120.0,
    words: [
      { word: "Esto", start: 0.1, end: 0.4, db: -14.0 },
      { word: "arruinó", start: 0.5, end: 0.9, db: -12.5 },
      { word: "por", start: 1.0, end: 1.2, db: -15.0 },
      { word: "completo", start: 1.3, end: 1.8, db: -13.0 },
      { word: "mi", start: 1.9, end: 2.1, db: -16.0 },
      { word: "aplicación", start: 2.2, end: 2.9, db: -11.0 },
      { word: "ehhh", start: 3.2, end: 4.5, db: -28.0, isFiller: true },
      { word: "o", start: 5.0, end: 5.2, db: -25.0 },
      { word: "sea", start: 5.3, end: 5.6, db: -24.0 },
      { word: "cometí", start: 5.8, end: 6.2, db: -14.0 },
      { word: "un", start: 6.3, end: 6.5, db: -15.0 },
      { word: "error", start: 6.6, end: 7.1, db: -12.0 },
      { word: "gravísimo", start: 7.2, end: 7.9, db: -11.5 },
      { word: "al", start: 8.0, end: 8.2, db: -14.0 },
      { word: "elegir", start: 8.3, end: 8.7, db: -13.5 },
      { word: "la", start: 8.8, end: 9.0, db: -16.0 },
      { word: "base", start: 9.1, end: 9.4, db: -14.0 },
      { word: "de", start: 9.5, end: 9.6, db: -17.0 },
      { word: "datos", start: 9.7, end: 10.2, db: -13.0 },
      { word: "en", start: 10.3, end: 10.5, db: -15.0 },
      { word: "producción", start: 10.6, end: 11.4, db: -12.0 },
      { word: "pensando", start: 11.8, end: 12.4, db: -14.0 },
      { word: "que", start: 12.5, end: 12.7, db: -16.0 },
      { word: "iba", start: 12.8, end: 13.0, db: -15.0 },
      { word: "a", start: 13.1, end: 13.2, db: -17.0 },
      { word: "escalar", start: 13.3, end: 13.9, db: -13.0 },
      { word: "sola", start: 14.0, end: 14.5, db: -13.5 },
      { word: "...", start: 14.6, end: 16.5, db: -35.0 },
      { word: "y", start: 16.6, end: 16.8, db: -15.0 },
      { word: "el", start: 16.9, end: 17.1, db: -16.0 },
      { word: "resultado", start: 17.2, end: 17.9, db: -13.0 },
      { word: "fue", start: 18.0, end: 18.3, db: -14.0 },
      { word: "un", start: 18.4, end: 18.6, db: -16.0 },
      { word: "desastre", start: 18.7, end: 19.5, db: -11.0 },
      { word: "total", start: 19.6, end: 20.2, db: -12.0 }
    ]
  };

  const result = await clipsService.analyze(samplePayload);
  console.log('Result from ClipsService:');
  console.log(JSON.stringify(result, null, 2));

  await app.close();
}

test().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
