import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export interface OffsetPage<T> { items: T[]; page: number; size: number; total: number; totalPages: number }
export interface CursorPage<T> { items: T[]; nextCursor: string | null }

/** Thin promise-based wrapper around HttpClient used by every surface */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  get<T = any>(url: string, params?: Record<string, any>): Promise<T> {
    return firstValueFrom(this.http.get<T>(url, { params: toParams(params) }));
  }
  post<T = any>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(url, body));
  }
  put<T = any>(url: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.put<T>(url, body));
  }
  delete<T = any>(url: string): Promise<T> {
    return firstValueFrom(this.http.delete<T>(url));
  }
  upload<T = any>(url: string, file: File): Promise<T> {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(this.http.post<T>(url, fd));
  }
}

function toParams(p?: Record<string, any>): HttpParams | undefined {
  if (!p) return undefined;
  let hp = new HttpParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v));
  return hp;
}

/** Pull a readable message out of an API error */
export function errMsg(e: any): string {
  return e?.error?.error?.message || e?.message || 'Something went wrong';
}
