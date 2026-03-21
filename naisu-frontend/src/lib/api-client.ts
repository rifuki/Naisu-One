import axios, { AxiosError } from 'axios'
import { API_URL } from '@/lib/env'

// Rust backend envelope: { success, code, data, message, timestamp }
interface BackendEnvelope<T> {
  success: boolean
  code: number
  data: T
  message: string
  timestamp: number
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const instance = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Auto-unwrap envelope and throw on failure
instance.interceptors.response.use(
  (res) => {
    const envelope = res.data as BackendEnvelope<unknown>
    if (envelope && typeof envelope === 'object' && 'success' in envelope) {
      if (!envelope.success) {
        throw new ApiError(envelope.message || 'Request failed', envelope.code ?? res.status, envelope)
      }
      res.data = envelope.data
    }
    return res
  },
  (err: AxiosError) => {
    const envelope = err.response?.data as BackendEnvelope<unknown> | undefined
    const message = envelope?.message || err.message || 'Request failed'
    const status = err.response?.status ?? 0
    throw new ApiError(message, status, envelope)
  }
)

export const apiClient = {
  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const filteredParams = params
      ? Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined))
      : undefined
    const res = await instance.get<T>(path, { params: filteredParams })
    return res.data
  },

  async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await instance.post<T>(path, body)
    return res.data
  },

  async delete<T = void>(path: string): Promise<T> {
    const res = await instance.delete<T>(path)
    return res.data
  },
}
