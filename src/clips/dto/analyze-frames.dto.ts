import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Límite duro: 2-3 clips × 3 beats × 2 thumbs = 18, con margen hasta 24. */
export const MAX_FRAMES_PER_REQUEST = 24;
/** ~200KB base64 por thumb 320px JPEG q0.6 (en la práctica ~20-40KB). */
export const MAX_BASE64_LENGTH = 280_000;

export class FrameInputDto {
  /** Id estable del frame, ej "c1_b2_t1" (clip 1, beat 2, thumb 1). */
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  id: string;

  /** Segundo en el video original (para traza, no para grounding). */
  @IsNumber()
  @Min(0)
  timestamp: number;

  @IsString()
  @IsOptional()
  clipId?: string;

  @IsString()
  @IsOptional()
  beatId?: string;

  /** Rol del beat de origen, si se conoce (hook/conflict/solution/...). */
  @IsString()
  @IsOptional()
  role?: string;

  /** JPEG base64 (sin prefijo data:, solo el payload). */
  @IsString()
  @MinLength(100)
  @MaxLength(MAX_BASE64_LENGTH)
  imageBase64: string;
}

export class AnalyzeFramesDto {
  @IsString()
  @MinLength(1)
  videoId: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_FRAMES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => FrameInputDto)
  frames: FrameInputDto[];
}

export const FRAME_SCENES = [
  'talking_head',
  'screen_share',
  'pip',
  'multi_speaker',
  'no_person',
  'unclear',
] as const;

export type FrameScene = (typeof FRAME_SCENES)[number];

export const SPEAKER_ZONES = [
  'left',
  'center',
  'right',
  'fullscreen',
  'none',
] as const;

export type SpeakerZone = (typeof SPEAKER_ZONES)[number];

export const PIP_CORNERS = [
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'none',
] as const;

export type PipCorner = (typeof PIP_CORNERS)[number];

export class FrameAnalysisDto {
  id: string;
  scene: FrameScene;
  speakerZone: SpeakerZone;
  pipCorner: PipCorner;
  confidence: number;
  /**
   * Centro X aproximado de la cara/ventanita (0-100 en ancho del frame).
   * Grueso a propósito: los VLM no dan píxeles exactos. -1 si no hay persona.
   */
  faceX: number;
  /**
   * Centro Y aproximado de la CARA (0=arriba, 100=abajo, múltiplos de 5).
   * -1 si no hay persona.
   */
  faceY: number;
  /**
   * Ancho aproximado de la CARA (solo cara, no cuerpo) en % del ancho del
   * frame, múltiplos de 10. -1 si no hay persona. Sirve para dimensionar
   * la ventana 9:16 alrededor de la cara (zoom adaptativo).
   */
  faceW: number;
}

export class FramesResponseDto {
  status: 'success' | 'error';
  frames: FrameAnalysisDto[];
  message?: string;
}
