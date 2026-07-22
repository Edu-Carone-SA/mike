import type { RequestHandler } from "express";
import multer from "multer";

export const MAX_UPLOAD_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_UPLOAD_SIZE_MB = Math.round(
  MAX_UPLOAD_SIZE_BYTES / (1024 * 1024),
);

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "doc",
  "xlsx",
  "xlsm",
  "xls",
  "pptx",
  "ppt",
]);

function fileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  const ext = file.originalname.split(".").pop()?.toLowerCase();
  if (ext && ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        `Unsupported file type: .${ext ?? "unknown"}. Only PDF, Word, Excel, and PowerPoint files are allowed.`,
      ),
    );
  }
}

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
  fileFilter,
});

function wrapSingleUpload(
  uploadInstance: ReturnType<typeof multer>,
  fieldName: string,
): RequestHandler {
  return (req, res, next) => {
    uploadInstance.single(fieldName)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return void res.status(413).json({
              detail: `File too large. Maximum size is ${MAX_UPLOAD_SIZE_MB} MB.`,
            });
          }
          if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return void res.status(415).json({
              detail: err.message,
            });
          }
          return void res.status(400).json({
            detail: `Upload failed: ${err.message}`,
          });
        }

        return next(err);
      }

      // multer v1 stores originalname as Latin-1, but browsers send UTF-8.
      // Re-decode to fix mojibake (e.g., "Ã³" → "ó") in filenames with
      // non-ASCII characters.
      if (req.file?.originalname) {
        try {
          req.file.originalname = Buffer.from(
            req.file.originalname,
            "latin1",
          ).toString("utf8");
        } catch {
          // If re-decoding fails, keep the original — better than blocking upload
        }
      }

      return next();
    });
  };
}

export function singleFileUpload(fieldName: string): RequestHandler {
  return wrapSingleUpload(memoryUpload, fieldName);
}

// ---------------------------------------------------------------------------
// Prompt-file upload — accepts Markdown, plain-text, Word, and PDF files.
// Used by the /workflows/extract-text route which needs a broader set of
// accepted types than the document-only singleFileUpload above.
// ---------------------------------------------------------------------------

const PROMPT_FILE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "docx",
  "doc",
  "pdf",
]);

function promptFileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  const ext = file.originalname.split(".").pop()?.toLowerCase();
  if (ext && PROMPT_FILE_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(
      new multer.MulterError(
        "LIMIT_UNEXPECTED_FILE",
        `Unsupported file type: .${ext ?? "unknown"}. Only Markdown, text, Word, and PDF files are allowed.`,
      ),
    );
  }
}

const promptMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE_BYTES,
    files: 1,
  },
  fileFilter: promptFileFilter,
});

export function promptFileUpload(fieldName: string): RequestHandler {
  return wrapSingleUpload(promptMemoryUpload, fieldName);
}
