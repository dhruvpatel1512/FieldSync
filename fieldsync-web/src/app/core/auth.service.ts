import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './config';

interface LoginResponse { token: string; displayName: string; role: string; expiresAt: string; }

const TOKEN_KEY = 'fs_token';
const USER_KEY = 'fs_user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  readonly user = signal<{ displayName: string; role: string } | null>(this.readUser());

  get token(): string | null {
    const t = localStorage.getItem(TOKEN_KEY);
    if (!t) return null;
    // Drop expired tokens so we don't send them
    const exp = localStorage.getItem('fs_exp');
    if (exp && new Date(exp) < new Date()) { this.logout(); return null; }
    return t;
  }

  /** Login needs the network ONCE. The token is kept so the engineer can work offline for days. */
  async login(username: string, password: string): Promise<void> {
    const res = await firstValueFrom(
      this.http.post<LoginResponse>(`${API_BASE}/auth/login`, { username, password }));
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem('fs_exp', res.expiresAt);
    const user = { displayName: res.displayName, role: res.role };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.user.set(user);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('fs_exp');
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
  }

  private readUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; }
  }
}

/** Adds "Authorization: Bearer <token>" to every API call. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token;
  if (token && req.url.startsWith(API_BASE)) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};
