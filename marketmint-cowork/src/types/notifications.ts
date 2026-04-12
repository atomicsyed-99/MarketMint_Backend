type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export enum NotificationChannel {
  IN_APP = "in_app",
  EMAIL = "email",
  SMS = "sms",
  PUSH = "push",
}

export enum NotificationType {
  SPACE_EXECUTION = "space_execution",
  VIDEO_GENERATED = "video_generated",
  IMAGE_GENERATED = "image_generated",
  REFINE_COMPLETED = "refine_completed",
  BATCH_COMPLETED = "batch_completed",
  CREDITS = "credits",
  ANNOUNCEMENT = "announcement",
  BRAND_MEMORY = "brand_memory",
  LOOPS = "loops",
  COWORK_JOB = "cowork_job",
}

export enum NotificationSource {
  SYSTEM = "system",
  ADMIN = "admin",
}

export enum NotificationPriority {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
}

export enum NotificationIconName {
  VIDEO = "video",
  IMAGE = "image",
  CREDITS = "credits",
  SPACE = "space",
  BRAND_MEMORY = "brand_memory",
  LOOPS = "loops",
  COWORK_JOB = "cowork_job",
}

export interface NotificationIcon {
  name: NotificationIconName;
  bg_color: string;
  color: string;
}

export enum NotificationActionType {
  OPEN_CHAT = "open_chat",
  OPEN_URL = "open_url",
  OPEN_CHAT_MESSAGE = "open_chat_message",
  OPEN_LIBRARY = "open_library",
  OPEN_CREDITS_USAGE = "open_credits_usage",
  OPEN_LIBRARY_ASSET = "open_library_asset",
  OPEN_BRAND_MEMORY = "open_brand_memory",
  OPEN_EXECUTION = "open_execution",
  OPEN_COWORK_JOB = "open_cowork_job",
}

export interface NotificationAction {
  type: NotificationActionType;
  payload?: Record<string, JsonValue>;
}

export enum NotificationAssetType {
  IMAGE = "image",
  VIDEO = "video",
  AUDIO = "audio",
  DOCUMENT = "document",
}

export interface NotificationAsset {
  type: NotificationAssetType;
  url: string;
}

export interface Notification {
  id: string;
  title: string;
  description: string;
  type: NotificationType;
  icon: NotificationIcon | null;
  delivery_channels: NotificationChannel[];
  priority: NotificationPriority;
  source: NotificationSource;
  assets: NotificationAsset[];
  metadata: Record<string, JsonValue>;
  action: NotificationAction | null;
  created_at: string;
  updated_at: string;
}

export interface CreateNotification {
  title: string;
  description: string;
  type: NotificationType;
  icon?: NotificationIcon | null;
  delivery_channels?: NotificationChannel[];
  priority: NotificationPriority;
  source: NotificationSource;
  assets?: NotificationAsset[];
  metadata?: Record<string, JsonValue>;
  action?: NotificationAction | null;
}

export interface UpdateNotification {
  title?: string;
  description?: string;
  type?: NotificationType;
  icon?: NotificationIcon | null;
  delivery_channels?: NotificationChannel[];
  priority?: NotificationPriority;
  source?: NotificationSource;
  assets?: NotificationAsset[];
  metadata?: Record<string, JsonValue> | null;
  action?: NotificationAction | null;
}

export interface CreateUserNotificationReq {
  email: string;
  notification_id: string;
  workspace_id: string;
}
