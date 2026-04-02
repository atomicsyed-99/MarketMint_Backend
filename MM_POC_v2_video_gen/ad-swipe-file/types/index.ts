export interface Ad {
  id: number;
  sha256: string;
  filename: string;
  file_path: string;
  media_type: 'image' | 'video';
  thumbnail_path: string | null;
  duration_secs: number | null;
  brand: string;
  platform: string;
  format: string;
  hook_angle: string;
  cta: string;
  campaign: string;
  notes: string;
  ai_analysis: string;
  embedding_visual: string | null;
  embedding_text: string | null;
  indexed: number;
  created_at: string;
  updated_at: string;
}

export interface SearchResult extends Ad {
  score: number;
}

export interface SyncProgress {
  phase: 'scanning' | 'importing' | 'analyzing' | 'done';
  total: number;
  processed: number;
  imported: number;
  skipped: number;
  analyzed: number;
  current_file?: string;
  error?: string;
}

export interface AiAnalysis {
  layout: string;
  imagery: string;
  headline: string;
  offer: string;
  hook: string;
  structure: string;
  target_audience: string;
  cta_description: string;
  emotional_appeal: string;
  platform_fit: string;
  summary: string;
  visual_description: string;
  search_tags: string;
  suggested_brand?: string;
  suggested_platform?: string;
  suggested_format?: string;
  suggested_hook_angle?: string;
  suggested_cta?: string;
}
