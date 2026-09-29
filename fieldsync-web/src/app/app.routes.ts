import { Routes, CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { AuthService } from './core/auth.service';
import { LoginComponent } from './pages/login.component';
import { CaptureComponent } from './pages/capture.component';
import { FindingsComponent } from './pages/findings.component';

const signedIn: CanActivateFn = () =>
  inject(AuthService).token ? true : inject(Router).parseUrl('/login');

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: CaptureComponent, canActivate: [signedIn] },
  { path: 'findings', component: FindingsComponent, canActivate: [signedIn] },
  { path: '**', redirectTo: '' },
];
