import { env } from "@/env";
import { AssetItem } from "@/lib/call-python-assets-credits";
import { CreateNotification, CreateUserNotificationReq, NotificationAsset, NotificationAssetType, NotificationChannel, NotificationIconName, NotificationPriority, NotificationSource, NotificationType } from "@/types/notifications";
import { NotificationActionType } from "@/types/notifications";

function isNotificationConfigured(): boolean {
    return !!(env.NOTIFICATION_SERVICE_URL && env.NOTIFICATION_SERVICE_AUTH_KEY);
}
  
function notificationsHeaders(): Record<string, string> {
    return {
      "x-api-key": env.NOTIFICATION_SERVICE_AUTH_KEY || "",
      "Content-Type": "application/json",
    };
}

function notificationsBaseUrl(): string {
  return env.NOTIFICATION_SERVICE_URL!;
}

async function sendNotification(
  email: string,
  workspaceId: string,
  createNotificationData: CreateNotification,
) {
  const url = notificationsBaseUrl();
  const headers = notificationsHeaders();
  const notificationCreateResponse = await fetch(url + "/notifications", {
    method: "POST",
    headers,
    body: JSON.stringify(createNotificationData),
  });

  if (!notificationCreateResponse.ok) {
    throw new Error(
      "Failed to create notification: " +
        (await notificationCreateResponse.text()),
    );
  }

  const notification = await notificationCreateResponse.json();

  const userNotificationCreateData: CreateUserNotificationReq = {
    email,
    notification_id: notification.id,
    workspace_id: workspaceId,
  };

  const userNotificationCreateResponse = await fetch(
    url + "/user-notifications",
    {
      method: "POST",
      headers,
      body: JSON.stringify(userNotificationCreateData),
    },
  );

  if (!userNotificationCreateResponse.ok) {
    throw new Error("Failed to create user notification");
  }

  return await userNotificationCreateResponse.json();
}

export async function sendAgentJobNotification(
  email: string,
  workspaceId: string,
  agentJobRunId: string,
  title: string,
  description: string,
  assets: AssetItem[],
) {
  if (!isNotificationConfigured()) {
    console.log("Notification service not configured, skipping notification");
    return;
  }

  try {
    const notificationAssets: NotificationAsset[] = assets.map((asset) => ({
      type:
        asset.type === "image"
          ? NotificationAssetType.IMAGE
          : asset.type === "video"
            ? NotificationAssetType.VIDEO
            : NotificationAssetType.DOCUMENT,
      url: asset.url
    }));

    await sendNotification(email, workspaceId, {
      title: title,
      description: description,
      type: NotificationType.COWORK_JOB,
      icon: {
        name: NotificationIconName.COWORK_JOB,
        bg_color: "#F0F1F8",
        color: "#000000",
      },
      delivery_channels: [NotificationChannel.IN_APP],
      priority: NotificationPriority.HIGH,
      source: NotificationSource.SYSTEM,
      action: {
        type: NotificationActionType.OPEN_COWORK_JOB,
        payload: {
          agentJobRunId: agentJobRunId,
        },
      },
      assets: notificationAssets,
      metadata: {
        agent_job_run_id: agentJobRunId
      },
    });
  } catch (error) {
    console.error("Failed to send cowork job notification:", error);
  }
}