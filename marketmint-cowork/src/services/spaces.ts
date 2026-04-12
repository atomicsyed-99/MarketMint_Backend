import { env } from "@/env";

import { z } from "zod";

export const SearchParamsSchema = z.object({
    user_id: z.string(),
    workspace_id: z.string(),
    search: z.string().optional().default(""),
    filter: z.string().optional().default(""),
    is_test: z.boolean().optional().default(false),
    page: z.coerce.number().int().min(1).default(1),
    page_size: z.coerce.number().int().min(1).max(250).default(16),
  });

export const searchSpaces = async (params: z.infer<typeof SearchParamsSchema>) => {
    const queryParams = new URLSearchParams();
    queryParams.set("user_id", params.user_id);
    queryParams.set("workspace_id", params.workspace_id);
    queryParams.set("search", params.search);
    queryParams.set("filter", params.filter);
    queryParams.set("is_test", params.is_test.toString());
    queryParams.set("page", params.page.toString());
    queryParams.set("page_size", params.page_size.toString());


    const response = await fetch(`${env.SPACES_SERVICE_URL}/search/internal?${queryParams.toString()}`, {
        headers: {
            "x-api-key": env.SPACES_SERVICE_AUTH_KEY,
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to search spaces: ${response.status} ${errorText}`);
    }

    return await response.json();
};