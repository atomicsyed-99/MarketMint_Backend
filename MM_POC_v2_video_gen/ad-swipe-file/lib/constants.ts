export const PLATFORMS = [
  { value: '', label: 'All' },
  { value: 'meta', label: 'Meta' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'google', label: 'Google' },
  { value: 'snapchat', label: 'Snapchat' },
  { value: 'other', label: 'Other' },
] as const;

export const FORMATS = [
  { value: '', label: 'All' },
  { value: 'static', label: 'Static' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'video', label: 'Video' },
  { value: 'story', label: 'Story' },
  { value: 'reel', label: 'Reel' },
  { value: 'ugc', label: 'UGC' },
  { value: 'other', label: 'Other' },
] as const;

export const HOOK_ANGLES = [
  { value: '', label: 'All' },
  { value: 'problem_solution', label: 'Problem/Solution' },
  { value: 'testimonial', label: 'Testimonial' },
  { value: 'before_after', label: 'Before/After' },
  { value: 'curiosity', label: 'Curiosity' },
  { value: 'urgency', label: 'Urgency' },
  { value: 'social_proof', label: 'Social Proof' },
  { value: 'polished_brand', label: 'Polished Brand' },
  { value: 'other', label: 'Other' },
] as const;

export const CTAS = [
  { value: '', label: 'All' },
  { value: 'shop_now', label: 'Shop Now' },
  { value: 'learn_more', label: 'Learn More' },
  { value: 'sign_up', label: 'Sign Up' },
  { value: 'download', label: 'Download' },
  { value: 'book_now', label: 'Book Now' },
  { value: 'get_offer', label: 'Get Offer' },
  { value: 'other', label: 'Other' },
] as const;

export const SUPPORTED_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
export const SUPPORTED_VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi'];
export const SUPPORTED_EXTS = [...SUPPORTED_IMAGE_EXTS, ...SUPPORTED_VIDEO_EXTS];
