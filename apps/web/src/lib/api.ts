import { useAuthStore } from '@/stores/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken, setAuth, user, logout } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    const res = await fetch(`${API_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      logout();
      return null;
    }
    const data = await res.json();
    setAuth({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      user: data.user ?? user!,
    });
    return data.accessToken as string;
  } catch {
    return null;
  }
}

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export async function api<T>(
  path: string,
  options: RequestInit & { token?: string; timeoutMs?: number; retries?: number; branchId?: string | null } = {},
): Promise<T> {
  const { token, timeoutMs = DEFAULT_TIMEOUT_MS, retries = 0, branchId, ...init } = options;
  const method = (init.method || 'GET').toUpperCase();
  const isSafeRetry = method === 'GET' || method === 'HEAD';
  const attempts = isSafeRetry ? Math.max(retries, MAX_RETRIES) : 1;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  if (token) (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;

  const activeShopId = useAuthStore.getState().activeShopId;
  if (branchId === null) {
    // Explicitly request an overall business view, even when an active shop is selected.
  } else if (branchId) {
    (headers as Record<string, string>)['x-branch-id'] = branchId;
  } else if (activeShopId) {
    (headers as Record<string, string>)['x-branch-id'] = activeShopId;
  }

  let lastError: Error | null = null;
  let authToken = token;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/api/v1${path}`,
        {
          ...init,
          headers: {
            ...headers,
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
        },
        timeoutMs,
      );

      if (res.status === 401 && authToken) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          authToken = refreshed;
          continue;
        }
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new ApiError(res.status, err.message || 'Request failed');
      }

      if (res.status === 204) return undefined as T;
      return res.json();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error('Request failed');
      if (e instanceof ApiError) throw e;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        continue;
      }
    }
  }

  if (lastError?.name === 'AbortError') {
    throw new ApiError(408, 'Request timed out — check your connection');
  }
  throw lastError ?? new ApiError(0, 'Network error');
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_URL}/api/v1/health/ready`, {}, 5000);
    return res.ok;
  } catch {
    return false;
  }
}
