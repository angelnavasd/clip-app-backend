import { Injectable } from '@nestjs/common';

export interface MusicTrack {
  id: string;
  title: string;
  genre: string;
  bpm: number;
  duration: number;
  previewUrl: string;
  duckingVoiceDb: number;
  duckingMusicDb: number;
}

export interface LutPreset {
  id: string;
  name: string;
  description: string;
  thumbnailColor: string;
  contrast: number;
  saturation: number;
  warmth: number;
  cubeFilterName?: string;
}

@Injectable()
export class AssetsService {
  private readonly musicTracks: MusicTrack[] = [
    {
      id: 'none',
      title: 'Sin música',
      genre: 'Silence',
      bpm: 0,
      duration: 0,
      previewUrl: '',
      duckingVoiceDb: 0,
      duckingMusicDb: -100,
    },
    {
      id: 'track_lofi_01',
      title: 'Lo-Fi Chill Beat',
      genre: 'Lo-Fi',
      bpm: 85,
      duration: 120,
      previewUrl: '/assets/audio/lofi-chill.aac',
      duckingVoiceDb: 0,
      duckingMusicDb: -18,
    },
    {
      id: 'track_synth_02',
      title: 'Tech Synth Horizon',
      genre: 'Electronic',
      bpm: 124,
      duration: 90,
      previewUrl: '/assets/audio/tech-synth.aac',
      duckingVoiceDb: 0,
      duckingMusicDb: -19,
    },
    {
      id: 'track_drill_03',
      title: 'Chill Drill Minimal',
      genre: 'Drill / Urban',
      bpm: 140,
      duration: 105,
      previewUrl: '/assets/audio/chill-drill.aac',
      duckingVoiceDb: 0,
      duckingMusicDb: -18,
    },
    {
      id: 'track_hype_04',
      title: 'Viral Hype Trap',
      genre: 'Trap',
      bpm: 130,
      duration: 80,
      previewUrl: '/assets/audio/hype-trap.aac',
      duckingVoiceDb: 0,
      duckingMusicDb: -20,
    },
  ];

  private readonly lutPresets: LutPreset[] = [
    {
      id: 'lut_auto_enhance',
      name: 'Auto-Enhance',
      description: 'Claridad optimizada y balance equilibrado para rostros',
      thumbnailColor: '#FF9500',
      contrast: 1.12,
      saturation: 1.15,
      warmth: 0.05,
      cubeFilterName: 'CIColorControls',
    },
    {
      id: 'lut_warm_podcast',
      name: 'Warm Podcast',
      description: 'Tonos cálidos y acogedores con sombras suaves',
      thumbnailColor: '#FF6B22',
      contrast: 1.08,
      saturation: 1.05,
      warmth: 0.25,
      cubeFilterName: 'CITemperatureAndTint',
    },
    {
      id: 'lut_cinematic_contrast',
      name: 'Cinematic Contrast',
      description: 'Profundidad visual con negros marcados estilo película',
      thumbnailColor: '#5856D6',
      contrast: 1.25,
      saturation: 0.95,
      warmth: -0.05,
      cubeFilterName: 'CIToneCurve',
    },
    {
      id: 'lut_teal_orange',
      name: 'Teal & Orange',
      description: 'Look moderno de creador con piel cálida y fondos fríos',
      thumbnailColor: '#30B0C7',
      contrast: 1.2,
      saturation: 1.2,
      warmth: 0.1,
      cubeFilterName: 'CIColorMatrix',
    },
    {
      id: 'lut_clean_bw',
      name: 'Minimal B&W',
      description: 'Blanco y negro editorial de alto impacto',
      thumbnailColor: '#8E8E93',
      contrast: 1.35,
      saturation: 0.0,
      warmth: 0.0,
      cubeFilterName: 'CIPhotoEffectNoir',
    },
  ];

  getMusicCatalog(): MusicTrack[] {
    return this.musicTracks;
  }

  getLutPresets(): LutPreset[] {
    return this.lutPresets;
  }
}
