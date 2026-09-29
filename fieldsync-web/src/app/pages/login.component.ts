import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, homeFor } from '../core/auth.service';
import { SyncService } from '../core/sync.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card narrow">
      <h2>Sign in</h2>
      <p class="muted">Sign in once while you have network. You can then keep working offline in the field.</p>
      <form (ngSubmit)="submit()">
        <label>Username <input name="u" [(ngModel)]="username" required autocomplete="username"></label>
        <label>Password <input name="p" type="password" [(ngModel)]="password" required autocomplete="current-password"></label>
        @if (error()) { <p class="error">{{ error() }}</p> }
        <button type="submit" [disabled]="busy()">{{ busy() ? 'Signing in…' : 'Sign in' }}</button>
      </form>
      <p class="muted small">Demo users: engineer1 / Field&#64;123 · analyst1 / Office&#64;123</p>
    </section>
  `,
})
export class LoginComponent {
  private auth = inject(AuthService);
  private sync = inject(SyncService);
  private router = inject(Router);
  username = 'engineer1';
  password = '';
  busy = signal(false);
  error = signal<string | null>(null);

  async submit() {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.login(this.username, this.password);
      this.sync.syncNow();
      this.router.navigateByUrl(homeFor(this.auth.user()?.role));
    } catch (e: any) {
      this.error.set(e?.status === 401 ? 'Wrong username or password' : 'Cannot reach server: you need network to sign in the first time');
    } finally {
      this.busy.set(false);
    }
  }
}
