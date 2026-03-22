/**
 * HTTP response envelope — mirrors the Rust backend exactly.
 *
 * Success  → { success: true,  code, data: T | null, message, timestamp }
 * Error    → { success: false, code, error_code, message, details, timestamp }
 */

export interface ApiSuccess<T = unknown> {
  success: true;
  code: number;
  data: T | null;
  message: string;
  timestamp: number;
}

export interface ApiError {
  success: false;
  code: number;
  error_code: string | null;
  message: string;
  details: string | null;
  timestamp: number;
}

export type ApiResponse<T = unknown> = ApiSuccess<T> | ApiError;

/** Thrown by apiClient when the server returns success=false or a network error. */
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public envelope?: ApiError,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
