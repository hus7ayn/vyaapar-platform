export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface JwtPayload {
  sub: string;
  email: string;
  businessId: string;
  branchId?: string;
  role: string;
  permissions: string[];
}

export interface SyncOperation {
  id: string;
  entity: string;
  action: 'create' | 'update' | 'delete';
  payload: Record<string, unknown>;
  clientId: string;
  timestamp: number;
}
