export class TimeRangeDto {
  start: number;
  end: number;
}

export class CutSegmentDto {
  start: number;
  end: number;
  reason: 'bad_take_retry' | 'silence_gap' | 'filler_word' | string;
}

export class HighlightWordDto {
  word: string;
  timestamp: number;
  color: string;
  sfx: string;
}

export class StoryBeatDto {
  start: number;
  end: number;
  role: 'hook' | 'conflict' | 'solution' | 'punchline' | string;
  text: string;
}

export class ClipDecisionDto {
  id: string;
  title: string;
  viralScore: number;
  hook: string;
  timeRange: TimeRangeDto;
  cutSegments: CutSegmentDto[];
  highlightWords: HighlightWordDto[];
  storyBeats?: StoryBeatDto[];
}

export class EdlResponseDto {
  status: 'success' | 'error';
  clips: ClipDecisionDto[];
  message?: string;
}
