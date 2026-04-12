/**
 * HOC wrapper that instruments any connector tool with emitUtility calls.
 * Applied centrally in buildAllConnectorTools() — zero changes needed in
 * individual tool files.
 */

import { emitUtility } from "@/mastra/tools/emit-utility";
import { humanizeConnectorToolName } from "./helpers";

/**
 * Wrap a connector tool's execute function to emit running/completed/failed
 * utility pills. Mutates the tool in-place for efficiency — tool instances
 * are freshly created by factories and never shared.
 *
 * @param tool    A Mastra Tool instance produced by createTool()
 * @param dictKey The dictionary key (snake_case, e.g. "ga_list_properties")
 */
export function wrapToolWithUtility(tool: any, dictKey: string): void {
  const originalExecute = tool.execute;
  if (!originalExecute) return;

  const toolId: string = tool.id ?? dictKey;
  const title = humanizeConnectorToolName(dictKey);

  tool.execute = async (input: any, context: any) => {
    const utilityId = crypto.randomUUID();
    const startMs = Date.now();

    emitUtility(context, {
      id: utilityId,
      name: toolId,
      title,
      category: "connector",
      status: "running",
      description: `${title}...`,
    });

    try {
      const result = await originalExecute(input, context);

      emitUtility(context, {
        id: utilityId,
        name: toolId,
        title,
        category: "connector",
        status: "completed",
        description: `${title} complete`,
        duration_ms: Date.now() - startMs,
      });

      return result;
    } catch (err: unknown) {
      emitUtility(context, {
        id: utilityId,
        name: toolId,
        title,
        category: "connector",
        status: "failed",
        description: `${title} failed`,
        duration_ms: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });

      throw err;
    }
  };
}
