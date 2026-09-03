import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class YouTubeIngestDto {
  @IsNotEmpty({ message: 'La URL de YouTube es requerida' })
  @IsString()
  url!: string;

  @IsOptional()
  @IsString()
  lang?: string;
}
