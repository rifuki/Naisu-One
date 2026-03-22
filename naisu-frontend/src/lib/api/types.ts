/**
 * HTTP response envelope types — mirrors the Rust backend exactly.
 *
 * Success (ApiSuccess<T>):
 *   { success: true, code, data: T | null, message, timestamp }
 *
 * Error (ApiError):
 *   { success: false, code, error_code, message, details, timestamp }
 */

export interface ApiSuccessEnvelope<T> {
  success: true;
  code: number;
  data: T | null;
  message: string;
  timestamp: number;
}

export interface ApiErrorEnvelope {
  success: false;
  code: number;
  error_code: string | null;
  message: string;
  details: string | null;
  timestamp: number;
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public envelope?: ApiErrorEnvelope,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
