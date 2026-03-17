import { createLogger } from "./logger.js";

const log = createLogger("FileParser");

/** Supported file types */
export type FileType = "pdf" | "docx" | "txt" | "md" | "markdown" | "json" | "csv";

/** Parsed document result */
export interface ParsedDocument {
  content: string;
  metadata: {
    filename: string;
    mimetype: string;
    size: number;
    type: FileType;
    pages?: number;
    wordCount?: number;
  };
}

/** Get file type from filename */
export function getFileType(filename: string): FileType | null {
  const ext = filename.toLowerCase().split(".").pop();
  
  switch (ext) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "txt":
      return "txt";
    case "md":
    case "markdown":
      return "md";
    case "json":
      return "json";
    case "csv":
      return "csv";
    default:
      return null;
  }
}

/** Check if file type is supported */
export function isSupportedFileType(filename: string): boolean {
  return getFileType(filename) !== null;
}

/** Parse PDF file */
async function parsePDF(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  try {
    // Dynamic import to avoid issues if package not available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParseModule: any = await import("pdf-parse");
    const pdfParse = pdfParseModule.default || pdfParseModule;
    const result = await pdfParse(buffer);
    
    return {
      content: result.text,
      metadata: {
        filename,
        mimetype: "application/pdf",
        size: buffer.length,
        type: "pdf",
        pages: result.numpages,
        wordCount: result.text.split(/\s+/).length
      }
    };
  } catch (error) {
    log.error("PDF parsing failed", error instanceof Error ? error : new Error(String(error)));
    throw new Error("Failed to parse PDF file");
  }
}

/** Parse DOCX file */
async function parseDOCX(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    
    return {
      content: result.value,
      metadata: {
        filename,
        mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: buffer.length,
        type: "docx",
        wordCount: result.value.split(/\s+/).length
      }
    };
  } catch (error) {
    log.error("DOCX parsing failed", error instanceof Error ? error : new Error(String(error)));
    throw new Error("Failed to parse DOCX file");
  }
}

/** Parse text file (TXT, MD) */
async function parseText(buffer: Buffer, filename: string, type: "txt" | "md"): Promise<ParsedDocument> {
  try {
    const content = buffer.toString("utf-8");
    
    return {
      content,
      metadata: {
        filename,
        mimetype: type === "md" ? "text/markdown" : "text/plain",
        size: buffer.length,
        type,
        wordCount: content.split(/\s+/).length
      }
    };
  } catch (error) {
    log.error("Text parsing failed", error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to parse ${type.toUpperCase()} file`);
  }
}

/** Parse JSON file */
async function parseJSON(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  try {
    const content = buffer.toString("utf-8");
    const parsed = JSON.parse(content);
    
    // Convert JSON to a readable text format for embedding
    const textContent = JSON.stringify(parsed, null, 2);
    
    return {
      content: textContent,
      metadata: {
        filename,
        mimetype: "application/json",
        size: buffer.length,
        type: "json",
        wordCount: textContent.split(/\s+/).length
      }
    };
  } catch (error) {
    log.error("JSON parsing failed", error instanceof Error ? error : new Error(String(error)));
    throw new Error("Failed to parse JSON file. Ensure it is valid JSON.");
  }
}

/** Parse CSV file */
async function parseCSV(buffer: Buffer, filename: string): Promise<ParsedDocument> {
  try {
    const content = buffer.toString("utf-8");
    
    // Basic CSV parsing - split into rows and cells
    const rows = content.split("\n").filter(row => row.trim());
    const headers = rows[0]?.split(",").map(h => h.trim()) || [];
    
    // Convert to readable text format
    const textLines: string[] = [];
    
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]?.split(",").map(c => c.trim()) || [];
      const rowText = headers.map((h, idx) => `${h}: ${cells[idx] || ""}`).join("; ");
      textLines.push(rowText);
    }
    
    const textContent = textLines.join("\n");
    
    return {
      content: textContent,
      metadata: {
        filename,
        mimetype: "text/csv",
        size: buffer.length,
        type: "csv",
        wordCount: content.split(/\s+/).length
      }
    };
  } catch (error) {
    log.error("CSV parsing failed", error instanceof Error ? error : new Error(String(error)));
    throw new Error("Failed to parse CSV file");
  }
}

/** Parse file based on type */
export async function parseFile(
  buffer: Buffer,
  filename: string
): Promise<ParsedDocument> {
  const fileType = getFileType(filename);
  
  if (!fileType) {
    throw new Error(
      `Unsupported file type: ${filename}. Supported: PDF, DOCX, TXT, MD`
    );
  }
  
  log.info(`Parsing file`, { filename, type: fileType, size: buffer.length });
  
  switch (fileType) {
    case "pdf":
      return parsePDF(buffer, filename);
    case "docx":
      return parseDOCX(buffer, filename);
    case "txt":
    case "md":
      return parseText(buffer, filename, fileType);
    case "json":
      return parseJSON(buffer, filename);
    case "csv":
      return parseCSV(buffer, filename);
    default:
      throw new Error(`Unsupported file type: ${fileType}`);
  }
}

/** Get file size in human readable format */
export function formatFileSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/** Validate file before parsing */
export function validateFile(
  filename: string,
  size: number,
  maxSizeBytes = 10 * 1024 * 1024 // 10MB default
): { valid: boolean; error?: string } {
  // Check file type
  if (!isSupportedFileType(filename)) {
    return {
      valid: false,
      error: `Unsupported file type. Supported: PDF, DOCX, TXT, MD, JSON, CSV`
    };
  }
  
  // Check file size
  if (size > maxSizeBytes) {
    return {
      valid: false,
      error: `File too large. Maximum size: ${formatFileSize(maxSizeBytes)}`
    };
  }
  
  // Check for empty file
  if (size === 0) {
    return {
      valid: false,
      error: "File is empty"
    };
  }
  
  return { valid: true };
}
