import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { nangoProxy } from "@/connectors/nango/proxy";

const PROVIDER_CONFIG_KEY = "google-sheet";

export function createGoogleSheetsTools(
  connectionId: string,
) {
  return {
    google_sheets_create_spreadsheet: createTool({
      id: "google-sheets-create-spreadsheet",
      description:
        "Create a new Google Spreadsheet.",
      inputSchema: z.object({
        title: z.string().describe("Title for the new spreadsheet"),
        sheet_names: z
          .array(z.string())
          .optional()
          .describe('Names for initial sheets/tabs (default: ["Sheet1"])'),
      }),
      execute: async (input) => {
        try {
          const sheets = (input.sheet_names || ["Sheet1"]).map((name) => ({
            properties: { title: name },
          }));
          return await nangoProxy(
            PROVIDER_CONFIG_KEY,
            connectionId,
            "POST",
            "/v4/spreadsheets",
            {
              body: { properties: { title: input.title }, sheets },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    google_sheets_get_spreadsheet: createTool({
      id: "google-sheets-get-spreadsheet",
      description:
        "Get metadata about a Google Spreadsheet (title, sheets/tabs, etc).",
      inputSchema: z.object({
        spreadsheet_id: z
          .string()
          .describe("The spreadsheet ID from the Google Sheets URL"),
      }),
      execute: async (input) => {
        const result = await nangoProxy(
          PROVIDER_CONFIG_KEY,
          connectionId,
          "GET",
          `/v4/spreadsheets/${input.spreadsheet_id}`,
        );

        return result;
      },
    }),

    google_sheets_list_sheets: createTool({
      id: "google-sheets-list-sheets",
      description: "List all sheets/tabs within a spreadsheet.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
      }),
      execute: async (input) => {
        const data = await nangoProxy(
          PROVIDER_CONFIG_KEY,
          connectionId,
          "GET",
          `/v4/spreadsheets/${input.spreadsheet_id}`,
          { params: { fields: "sheets.properties" } },
        );

        return data;
      },
    }),

    google_sheets_read_range: createTool({
      id: "google-sheets-read-range",
      description: "Read data from a specific range in a Google Sheet.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .describe('A1 notation range (e.g., "Sheet1!A1:D10")'),
      }),
      execute: async (input) => {
        const result = await nangoProxy(
          PROVIDER_CONFIG_KEY,
          connectionId,
          "GET",
          `/v4/spreadsheets/${input.spreadsheet_id}/values/${encodeURIComponent(input.range)}`,
        );

        return result;
      },
    }),

    google_sheets_write_range: createTool({
      id: "google-sheets-write-range",
      description:
        "Write data to a specific range in a Google Sheet.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .describe('A1 notation range (e.g., "Sheet1!A1:D1")'),
        values: z
          .array(z.array(z.string()))
          .describe("2D array of values to write (rows of columns)"),
      }),
      execute: async (input) => {
        try {
          return await nangoProxy(
            PROVIDER_CONFIG_KEY,
            connectionId,
            "PUT",
            `/v4/spreadsheets/${input.spreadsheet_id}/values/${encodeURIComponent(input.range)}`,
            {
              params: { valueInputOption: "USER_ENTERED" },
              body: {
                range: input.range,
                majorDimension: "ROWS",
                values: input.values,
              },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    google_sheets_append_rows: createTool({
      id: "google-sheets-append-rows",
      description:
        "Append rows to the end of a Google Sheet.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .describe('Sheet name or range to append to (e.g., "Sheet1")'),
        values: z
          .array(z.array(z.string()))
          .describe("2D array of rows to append"),
      }),
      execute: async (input) => {
        try {
          return await nangoProxy(
            PROVIDER_CONFIG_KEY,
            connectionId,
            "POST",
            `/v4/spreadsheets/${input.spreadsheet_id}/values/${encodeURIComponent(input.range)}:append`,
            {
              params: {
                valueInputOption: "USER_ENTERED",
                insertDataOption: "INSERT_ROWS",
              },
              body: {
                range: input.range,
                majorDimension: "ROWS",
                values: input.values,
              },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    google_sheets_clear_range: createTool({
      id: "google-sheets-clear-range",
      description:
        "Clear values from a range without deleting cells.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
        range: z
          .string()
          .describe('A1 notation range to clear (e.g., "Sheet1!A1:D10")'),
      }),
      execute: async (input) => {
        try {
          return await nangoProxy(
            PROVIDER_CONFIG_KEY,
            connectionId,
            "POST",
            `/v4/spreadsheets/${input.spreadsheet_id}/values/${encodeURIComponent(input.range)}:clear`,
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    google_sheets_create_sheet: createTool({
      id: "google-sheets-create-sheet",
      description:
        "Add a new sheet/tab to a Google Spreadsheet.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
        title: z.string().describe("Title for the new sheet/tab"),
      }),
      execute: async (input) => {
        try {
          return await nangoProxy(
            PROVIDER_CONFIG_KEY,
            connectionId,
            "POST",
            `/v4/spreadsheets/${input.spreadsheet_id}:batchUpdate`,
            {
              body: {
                requests: [{ addSheet: { properties: { title: input.title } } }],
              },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),

    google_sheets_delete_sheet: createTool({
      id: "google-sheets-delete-sheet",
      description:
        "Delete a sheet/tab from a Google Spreadsheet.",
      inputSchema: z.object({
        spreadsheet_id: z.string().describe("The spreadsheet ID"),
        sheet_id: z
          .number()
          .describe("The numeric sheet ID (not the name)"),
      }),
      execute: async (input) => {
        try {
          return await nangoProxy(
            PROVIDER_CONFIG_KEY,
            connectionId,
            "POST",
            `/v4/spreadsheets/${input.spreadsheet_id}:batchUpdate`,
            {
              body: {
                requests: [{ deleteSheet: { sheetId: input.sheet_id } }],
              },
            },
          );
        } catch (error) {
          throw error;
        }
      },
    }),
  };
}
