import { Component, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DatePipe } from '@angular/common';
import { SyncService } from './core/sync.service';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, DatePipe],
  template: `
    <header>
      <strong>FieldSync</strong>
      @if (auth.user(); as u) {
        <nav>
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">Capture</a>
          <a routerLink="/findings" routerLinkActive="active">Findings</a>
        </nav>
        <span class="status" [class.offline]="!sync.online()" data-testid="sync-status">
          @if (!sync.online()) { ● Offline · {{ sync.pendingCount() }} waiting to sync }
          @else if (sync.syncing()) { ⟳ Syncing… }
          @else if (sync.pendingCount() > 0) { ● Online · {{ sync.pendingCount() }} waiting }
          @else { ✓ All synced }
        </span>
        <button class="link" (click)="sync.syncNow()" [disabled]="!sync.online()">Sync now</button>
        <span class="muted small">{{ u.displayName }}</span>
        <button class="link" (click)="logout()">Sign out</button>
      }
    </header>
    @if (sync.lastError()) { <div class="banner">{{ sync.lastError() }}</div> }
    <main><router-outlet /></main>
    <footer class="muted small">
      Last sync: {{ sync.lastSyncAt() ? (sync.lastSyncAt() | date:'medium') : 'never' }}
      · Portfolio project inspired by field-data work during my ONGC internship. Synthetic data only.
    </footer>
  `,
})
export class AppComponent implements OnInit {
  readonly sync = inject(SyncService);
  readonly auth = inject(AuthService);
  private router = inject(Router);

  ngOnInit() { this.sync.start(); }

  logout() { this.auth.logout(); this.router.navigateByUrl('/login'); }
}
