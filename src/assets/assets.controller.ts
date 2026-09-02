import { Controller, Get } from '@nestjs/common';
import { AssetsService, LutPreset, MusicTrack } from './assets.service.js';

@Controller('api/v1/assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get('music')
  getMusicCatalog(): { status: string; data: MusicTrack[] } {
    return {
      status: 'success',
      data: this.assetsService.getMusicCatalog(),
    };
  }

  @Get('luts')
  getLutPresets(): { status: string; data: LutPreset[] } {
    return {
      status: 'success',
      data: this.assetsService.getLutPresets(),
    };
  }
}
