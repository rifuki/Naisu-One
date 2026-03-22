import axios, { AxiosError } from 'axios';
import { API_URL } from '@/lib/env';
import { ApiError } from './types';
import type { ApiSuccessEnvelope, ApiErrorEnvelope } from './types';

export { ApiError } from './types';

const instance = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

instance.interceptors.response.use(
  (res) => {
    const envelope = res.data as ApiSuccessEnvelope<unknown>;
    if (envelope && typeof envelope === 'object' && 'success' in envelope) {
      if (!envelope.success) {
        const err = res.data as ApiErrorEnvelope;
        throw new ApiError(err.message || 'Request failed', err.code ?? res.status, err);
      }
      res.data = envelope.data;
    }
    return res;
  },
  (err: AxiosError) => {
    const envelope = err.response?.data as ApiErrorEnvelope | undefined;
    const message = envelope?.message || err.message || 'Request failed';
    const status = err.response?.status ?? 0;
    throw new ApiError(message, status, envelope);
  },
);

export const apiClient = {
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const filtered = params
      ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
      : undefined;
    const res = await instance.get<T>(path, { params: filtered });
    return res.data;
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await instance.post<T>(path, body);
    return res.data;
  },

  async delete<T = void>(path: string): Promise<T> {
    const res = await instance.delete<T>(path);
    return res.data;
  },
};
