import { HttpErrorResponse, HttpInterceptorFn, HttpClient, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, from, switchMap, throwError, shareReplay } from 'rxjs';
import { AuthStore, Scope, refreshUrl, scopeForUrl } from './auth';

const inflight: Partial<Record<Scope, Observable<any>>> = {};

/** Adds the right Bearer token; on 401 refreshes once (rotating refresh token), else logs out. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStore);
  const http = inject(HttpClient);
  const router = inject(Router);
  const scope = scopeForUrl(req.url);
  if (!scope || req.url.includes('/auth/')) return next(req);

  const withToken = (r: HttpRequest<unknown>) => {
    const t = auth.get(scope)?.accessToken;
    return t ? r.clone({ setHeaders: { Authorization: `Bearer ${t}` } }) : r;
  };

  return next(withToken(req)).pipe(
    catchError((err: HttpErrorResponse) => {
      const tokens = auth.get(scope);
      if (err.status !== 401 || !tokens?.refreshToken) return throwError(() => err);
      inflight[scope] ??= from(fetchRefresh(http, scope, tokens.refreshToken)).pipe(shareReplay(1));
      return inflight[scope]!.pipe(
        switchMap((fresh) => {
          delete inflight[scope];
          auth.set(scope, fresh);
          return next(withToken(req));
        }),
        catchError((e) => {
          delete inflight[scope];
          auth.clear(scope);
          if (scope === 'user') router.navigateByUrl('/admin/login');
          if (scope === 'platform') router.navigateByUrl('/login');
          return throwError(() => e);
        }),
      );
    }),
  );
};

function fetchRefresh(http: HttpClient, scope: Scope, refreshToken: string) {
  return new Promise<any>((resolve, reject) =>
    http.post(refreshUrl[scope], { refreshToken }).subscribe({ next: resolve, error: reject }));
}

export type { HttpHandlerFn };
