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

export class AnalyzeTranscriptDto {
  @IsString()
  videoId: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsNumber()
  videoDuration: number;

  @IsArray()
  words: any[];
}
