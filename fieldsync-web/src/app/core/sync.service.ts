import { Injectable, NgZone, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { liveQuery } from 'dexie';
import { API_BASE } from './config';
import { db, getDeviceId } from './db';
import { Expedition, Finding, PushResult } from './models';
import { AuthService } from './auth.service';

const BATCH_SIZE = 50;
const MIN_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;
const PERIODIC_MS = 30_000;

/**
 * Offline-first sync engine.
 *  1. Every record is written to the local DB with syncStatus = 'pending' (the "outbox").
 *  2. When the device is (or comes back) online, pending records are PUSHED in batches.
 *  3. Then changes made by other devices are PULLED since the last known server version.
 *  4. Failures back off exponentially (5s, 10s, 20s ... max 5 min) so a weak signal isn't hammered.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private zone = inject(NgZone);

  readonly online = signal<boolean>(navigator.onLine);
  readonly syncing = signal(false);
  readonly pendingCount = signal(0);
  readonly lastSyncAt = signal<string | null>(null);
  readonly lastError = signal<string | null>(null);

  private retryMs = MIN_RETRY_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    // Keep the "waiting to sync" counter live
    liveQuery(() => db.findings.where('syncStatus').equals('pending').count())
      .subscribe(n => this.zone.run(() => this.pendingCount.set(n)));

    db.getMeta('lastSyncAt').then(v => this.lastSyncAt.set(v));

    // Network listeners: the moment the device regains network, sync.
    window.addEventListener('online', () => this.zone.run(() => {
      this.online.set(true);
      this.retryMs = MIN_RETRY_MS;
      this.syncNow();
    }));
    window.addEventListener('offline', () => this.zone.run(() => this.online.set(false)));

    // Safety net: try periodically too (navigator.onLine can be wrong on flaky networks)
    setInterval(() => this.syncNow(), PERIODIC_MS);
    this.syncNow();
  }

  async syncNow(): Promise<void> {
    if (this.syncing() || !navigator.onLine || !this.auth.token) return;
    this.syncing.set(true);
    try {
      await this.refreshExpeditions();
      await this.push();
      await this.pull();
      const now = new Date().toISOString();
      await db.setMeta('lastSyncAt', now);
      this.lastSyncAt.set(now);
      this.lastError.set(null);
      this.retryMs = MIN_RETRY_MS;
    } catch (err: any) {
      // Network dropped mid-sync, server down, etc. Nothing is lost: records stay 'pending'.
      this.lastError.set(err?.status === 401 ? 'Session expired, please log in again' : 'Sync failed, will retry');
      if (err?.status === 401) this.auth.logout();
      this.scheduleRetry();
    } finally {
      this.syncing.set(false);
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.syncNow(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
  }

  private async refreshExpeditions(): Promise<void> {
    const list = await firstValueFrom(this.http.get<Expedition[]>(`${API_BASE}/expeditions`));
    await db.expeditions.bulkPut(list);
  }

  /** PUSH: send pending records in batches. Safe to repeat: the server de-duplicates by id. */
  private async push(): Promise<void> {
    const deviceId = await getDeviceId();
    while (true) {
      const batch = await db.findings.where('syncStatus').equals('pending').limit(BATCH_SIZE).toArray();
      if (batch.length === 0) return;

      const payload = batch.map(({ syncStatus, syncErrors, qualityFlags, ...dto }) => dto);
      const res = await firstValueFrom(
        this.http.post<{ results: PushResult[] }>(`${API_BASE}/sync/push`, { deviceId, findings: payload }));

      await db.transaction('rw', db.findings, async () => {
        for (const r of res.results) {
          const local = await db.findings.get(r.id);
          if (!local) continue;
          // If the engineer edited the record again while this batch was in flight, keep it pending.
          const sent = batch.find(b => b.id === r.id)!;
          if (local.clientUpdatedAt !== sent.clientUpdatedAt) continue;

          if (r.status === 'accepted' || r.status === 'duplicate') {
            await db.findings.update(r.id, {
              syncStatus: 'synced', serverVersion: r.serverVersion, baseServerVersion: r.serverVersion,
              qualityFlags: r.qualityFlags, syncErrors: [],
            });
          } else if (r.status === 'conflict') {
            await db.findings.update(r.id, { syncStatus: 'conflict', syncErrors: ['Edited on another device: sent for review'] });
          } else {
            await db.findings.update(r.id, { syncStatus: 'rejected', syncErrors: r.errors });
          }
        }
      });
    }
  }

  /** PULL: get records changed on the server (by anyone) since our last pull, 500 at a time. */
  private async pull(): Promise<void> {
    while (true) {
      const since = Number(await db.getMeta('lastServerVersion') ?? 0);
      const res = await firstValueFrom(this.http.get<{ findings: Finding[]; maxVersion: number; hasMore: boolean }>(
        `${API_BASE}/sync/pull`, { params: { since } }));

      await db.transaction('rw', db.findings, db.meta, async () => {
        for (const f of res.findings) {
          const local = await db.findings.get(f.id);
          // Never overwrite a local edit that hasn't been pushed yet
          if (local && local.syncStatus === 'pending') continue;
          await db.findings.put({ ...f, baseServerVersion: f.serverVersion, syncStatus: 'synced' });
        }
        await db.meta.put({ key: 'lastServerVersion', value: String(Math.max(since, res.maxVersion)) });
      });
      if (!res.hasMore) return;
    }
  }
}
