import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class WordTimestampDto {
  @IsString()
  word: string;

  @IsNumber()
  start: number;

  @IsNumber()
  end: number;

  @IsNumber()
  @IsOptional()
  db?: number;

  @IsBoolean()
  @IsOptional()
  isFiller?: boolean;
}

export class SilenceGapDto {
  @IsNumber()
  start: number;

  @IsNumber()
  end: number;
}

export class AnalyzeTranscriptDto {
  @IsString()
  videoId: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsNumber()
  videoDuration: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WordTimestampDto)
  words: WordTimestampDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => SilenceGapDto)
  silenceGaps?: SilenceGapDto[];

  @IsString()
  @IsOptional()
  targetDuration?: string;

  @IsString()
  @IsOptional()
  genre?: string;

  @IsNumber()
  @IsOptional()
  targetClipCount?: number;

  @IsArray()
  @IsOptional()
  sceneCuts?: number[];
}
