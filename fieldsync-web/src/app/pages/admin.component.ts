import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, from } from 'rxjs';
import { liveQuery } from 'dexie';
import { API_BASE } from '../core/config';
import { db } from '../core/db';
import { Finding } from '../core/models';
import { SyncService } from '../core/sync.service';

interface Conflict {
  id: number;
  findingId: string;
  deviceId: string;
  submittedBy: string;
  clientPayloadJson: string;
  detectedAt: string;
}

const FIELDS: { label: string; key: keyof Finding }[] = [
  { label: 'Material', key: 'materialType' },
  { label: 'Depth (m)', key: 'depthM' },
  { label: 'Indicator', key: 'hydrocarbonIndicator' },
  { label: 'Latitude', key: 'latitude' },
  { label: 'Longitude', key: 'longitude' },
  { label: 'Notes', key: 'notes' },
];

/** The server stores the device edit with .NET's default JSON: PascalCase keys, enum as a number. */
function fromPayload(json: string): Partial<Finding> {
  const p = JSON.parse(json);
  return {
    materialType: p.MaterialType, depthM: p.DepthM, latitude: p.Latitude, longitude: p.Longitude, notes: p.Notes,
    hydrocarbonIndicator: (['None', 'OilShow', 'GasShow'] as const)[p.HydrocarbonIndicator] ?? p.HydrocarbonIndicator,
  };
}

/** Office view for Analysts. Stats come from the local DB (the analyst's device pulls every finding); conflicts need network. */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe],
  template: `
    <section class="card">
      <h2>Admin dashboard</h2>
      <div class="stats">
        <div><b>{{ stats().total }}</b><span>Findings</span></div>
        <div><b>{{ stats().oil }}</b><span>Oil shows</span></div>
        <div><b>{{ stats().gas }}</b><span>Gas shows</span></div>
        <div><b>{{ stats().flagged }}</b><span>Quality flags</span></div>
        <div [class.alert]="conflicts().length > 0"><b>{{ conflicts().length }}</b><span>Open conflicts</span></div>
      </div>
    </section>

    <section class="card">
      <h3>By expedition</h3>
      <table>
        <thead><tr><th>Expedition</th><th>Findings</th><th>Oil</th><th>Gas</th><th>Flagged</th><th>Last capture</th></tr></thead>
        <tbody>
          @for (e of byExpedition(); track e.id) {
            <tr>
              <td>{{ e.name }} <span class="muted small">{{ e.region }}</span></td>
              <td>{{ e.total }}</td><td>{{ e.oil }}</td><td>{{ e.gas }}</td><td>{{ e.flagged }}</td>
              <td>{{ e.last ? (e.last | date:'MMM d, HH:mm') : '—' }}</td>
            </tr>
          }
        </tbody>
      </table>
    </section>

    <section class="card">
      <h3>Conflicts to review</h3>
      @if (error()) { <p class="error small">{{ error() }}</p> }
      @for (c of review(); track c.id) {
        <div class="conflict" data-testid="conflict">
          <p class="muted small">
            Finding {{ c.findingId.slice(0, 8) }} · edited by {{ c.submittedBy }} on device {{ c.deviceId }}
            · {{ c.detectedAt | date:'MMM d, HH:mm' }}
          </p>
          <table>
            <thead><tr><th></th><th>Server (current)</th><th>Device edit</th></tr></thead>
            <tbody>
              @for (f of fields; track f.key) {
                <tr [class.diff]="c.server?.[f.key] !== c.device[f.key]">
                  <th>{{ f.label }}</th><td>{{ c.server?.[f.key] ?? '—' }}</td><td>{{ c.device[f.key] }}</td>
                </tr>
              }
            </tbody>
          </table>
          <button class="secondary" (click)="resolve(c.id, 'server')" [disabled]="busy()">Keep server</button>
          <button (click)="resolve(c.id, 'client')" [disabled]="busy()">Keep device edit</button>
        </div>
      } @empty {
        <p class="muted">No open conflicts.</p>
      }
    </section>

    <section class="card">
      <h3>Flagged findings</h3>
      <table>
        <thead><tr><th>Captured</th><th>Engineer</th><th>Material</th><th>Flags</th></tr></thead>
        <tbody>
          @for (f of flagged(); track f.id) {
            <tr>
              <td>{{ f.capturedAt | date:'MMM d, HH:mm' }}</td><td>{{ f.engineerName }}</td><td>{{ f.materialType }}</td>
              <td>@for (q of f.qualityFlags; track q) { <div class="warn small">⚠ {{ q }}</div> }</td>
            </tr>
          } @empty {
            <tr><td colspan="4" class="muted">Nothing flagged.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class AdminComponent implements OnInit {
  private http = inject(HttpClient);
  private sync = inject(SyncService);
  readonly fields = FIELDS;

  private readonly findings = toSignal(
    from(liveQuery(() => db.findings.filter(f => !f.isDeleted).toArray())), { initialValue: [] as Finding[] });
  private readonly expeditions = toSignal(from(liveQuery(() => db.expeditions.toArray())), { initialValue: [] });

  readonly conflicts = signal<Conflict[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly stats = computed(() => summarize(this.findings()));
  readonly byExpedition = computed(() =>
    this.expeditions().map(e => ({ ...e, ...summarize(this.findings().filter(f => f.expeditionId === e.id)) })));
  readonly flagged = computed(() =>
    this.findings().filter(f => f.qualityFlags?.length).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)).slice(0, 20));
  readonly review = computed(() => {
    const byId = new Map(this.findings().map(f => [f.id, f]));
    return this.conflicts().map(c => ({ ...c, server: byId.get(c.findingId), device: fromPayload(c.clientPayloadJson) }));
  });

  ngOnInit() { this.load(); }

  async load() {
    try {
      this.conflicts.set(await firstValueFrom(this.http.get<Conflict[]>(`${API_BASE}/conflicts`)));
      this.error.set(null);
    } catch {
      this.error.set('Cannot load conflicts: reviewing them needs network.');
    }
  }

  async resolve(id: number, keep: 'server' | 'client') {
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post(`${API_BASE}/conflicts/${id}/resolve`, null, { params: { keep } }));
      await this.load();
      this.sync.syncNow();   // pull the finding's new version
    } catch {
      this.error.set('Could not resolve the conflict, try again.');
    } finally {
      this.busy.set(false);
    }
  }
}

function summarize(list: Finding[]) {
  return {
    total: list.length,
    oil: list.filter(f => f.hydrocarbonIndicator === 'OilShow').length,
    gas: list.filter(f => f.hydrocarbonIndicator === 'GasShow').length,
    flagged: list.filter(f => f.qualityFlags?.length).length,
    last: list.reduce<string | null>((m, f) => (!m || f.capturedAt > m ? f.capturedAt : m), null),
  };
}
