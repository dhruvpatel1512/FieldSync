import { Routes, CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService, homeFor } from './core/auth.service';
import { LoginComponent } from './pages/login.component';
import { CaptureComponent } from './pages/capture.component';
import { FindingsComponent } from './pages/findings.component';
import { AdminComponent } from './pages/admin.component';

const signedIn: CanActivateFn = () =>
  inject(AuthService).token ? true : inject(Router).parseUrl('/login');

/** Signed in AND the right role; otherwise go to your own home page. (The API enforces roles too.) */
const role = (...allowed: string[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.token) return router.parseUrl('/login');
  const mine = auth.user()?.role;
  return allowed.includes(mine ?? '') ? true : router.parseUrl(homeFor(mine));
};

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: CaptureComponent, canActivate: [role('Engineer')] },
  { path: 'admin', component: AdminComponent, canActivate: [role('Analyst', 'Admin')] },
  { path: 'findings', component: FindingsComponent, canActivate: [signedIn] },
  { path: '**', redirectTo: '' },
];
