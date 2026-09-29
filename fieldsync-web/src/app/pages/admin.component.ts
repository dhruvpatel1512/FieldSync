import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, from } from 'rxjs';
import { liveQuery } from 'dexie';
import { API_BASE } from '../core/config';
import { addFinding, db } from '../core/db';
import { Finding, FindingFields, MATERIAL_TYPES } from '../core/models';
import { SyncService } from '../core/sync.service';
import { AuthService } from '../core/auth.service';

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

/** Office view for Analysts (review) and Admins (review + add / edit / delete). Stats come from the local DB (the analyst's device pulls every finding); conflicts need network. */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [DatePipe, FormsModule],
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
      <h3>{{ canEdit() ? 'Manage findings' : 'All findings' }}
        @if (canEdit()) { <button class="small-btn" (click)="startAdd()" [disabled]="editing() !== null">+ Add finding</button> }
      </h3>
      @if (editing(); as id) {
        <form #form="ngForm" class="edit" (ngSubmit)="save(id)">
          <h4>{{ id === 'new' ? 'Add finding' : 'Edit finding' }}</h4>
          <div class="row">
            <label>Expedition
              <select name="exp" [(ngModel)]="draft.expeditionId" required>
                @for (e of expeditions(); track e.id) { <option [ngValue]="e.id">{{ e.name }}</option> }
              </select>
            </label>
            <label>Material type
              <select name="mat" [(ngModel)]="draft.materialType" required>
                @for (m of materials; track m) { <option [value]="m">{{ m }}</option> }
              </select>
            </label>
          </div>
          <div class="row">
            <label>Latitude <input name="lat" type="number" step="0.000001" min="-90" max="90" [(ngModel)]="draft.latitude" required></label>
            <label>Longitude <input name="lon" type="number" step="0.000001" min="-180" max="180" [(ngModel)]="draft.longitude" required></label>
          </div>
          <div class="row">
            <label>Depth (m) <input name="depth" type="number" min="0" max="10000" step="0.1" [(ngModel)]="draft.depthM" required></label>
            <label>Hydrocarbon indicator
              <select name="hc" [(ngModel)]="draft.hydrocarbonIndicator">
                <option value="None">None</option><option value="OilShow">Oil show</option><option value="GasShow">Gas show</option>
              </select>
            </label>
          </div>
          <label>Field notes <textarea name="notes" rows="2" maxlength="2000" [(ngModel)]="draft.notes"></textarea></label>
          <button type="submit" [disabled]="form.invalid">Save</button>
          <button type="button" class="secondary" (click)="editing.set(null)">Cancel</button>
        </form>
      }
      <table>
        <thead><tr><th>Captured</th><th>Expedition</th><th>Location</th><th>Material</th><th>Depth</th><th>Indicator</th><th>Engineer</th><th>Status</th>@if (canEdit()) { <th></th> }</tr></thead>
        <tbody>
          @for (f of findings(); track f.id) {
            <tr data-testid="manage-row">
              <td>{{ f.capturedAt | date:'MMM d, HH:mm' }}</td>
              <td>{{ expeditionName(f.expeditionId) }}</td>
              <td>{{ f.latitude }}, {{ f.longitude }}</td>
              <td>{{ f.materialType }}</td><td>{{ f.depthM }} m</td><td>{{ f.hydrocarbonIndicator }}</td>
              <td>{{ f.engineerName }}</td>
              <td>
                <span class="badge {{ f.syncStatus }}">{{ f.syncStatus }}</span>
                @for (e of f.syncErrors ?? []; track e) { <div class="error small">{{ e }}</div> }
              </td>
              @if (canEdit()) {
                <td class="actions">
                  <button class="small-btn secondary" (click)="startEdit(f)" [disabled]="editing() !== null">Edit</button>
                  <button class="small-btn danger" (click)="remove(f)">Delete</button>
                </td>
              }
            </tr>
          } @empty {
            <tr><td colspan="9" class="muted">No findings yet.</td></tr>
          }
        </tbody>
      </table>
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
  private auth = inject(AuthService);
  readonly fields = FIELDS;
  readonly canEdit = computed(() => this.auth.user()?.role === 'Admin');   // the API enforces this too

  /** Newest first, deleted ones hidden. */
  readonly findings = toSignal(
    from(liveQuery(() => db.findings.orderBy('capturedAt').reverse().filter(f => !f.isDeleted).toArray())), { initialValue: [] as Finding[] });
  readonly expeditions = toSignal(from(liveQuery(() => db.expeditions.toArray())), { initialValue: [] });

  readonly conflicts = signal<Conflict[]>([]);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  readonly stats = computed(() => summarize(this.findings()));
  readonly byExpedition = computed(() =>
    this.expeditions().map(e => ({ ...e, ...summarize(this.findings().filter(f => f.expeditionId === e.id)) })));
  readonly flagged = computed(() =>
    this.findings().filter(f => f.qualityFlags?.length).slice(0, 20));
  readonly review = computed(() => {
    const byId = new Map(this.findings().map(f => [f.id, f]));
    return this.conflicts().map(c => ({ ...c, server: byId.get(c.findingId), device: JSON.parse(c.clientPayloadJson) as Partial<Finding> }));
  });

  readonly materials = MATERIAL_TYPES;
  readonly editing = signal<'new' | string | null>(null);   // 'new' or the id being edited
  draft = {} as FindingFields;

  ngOnInit() { this.load(); }

  expeditionName(id: number) { return this.expeditions().find(e => e.id === id)?.name ?? `#${id}`; }

  startAdd() {
    this.draft = { expeditionId: this.expeditions()[0]?.id, materialType: 'Sandstone', hydrocarbonIndicator: 'None', notes: '' } as FindingFields;
    this.editing.set('new');
  }

  startEdit(f: Finding) {
    const { expeditionId, latitude, longitude, materialType, depthM, hydrocarbonIndicator, notes } = f;
    this.draft = { expeditionId, latitude, longitude, materialType, depthM, hydrocarbonIndicator, notes };
    this.editing.set(f.id);
  }

  /** Same path as a field capture: write locally as 'pending', then sync. The server versions it and every device pulls it. */
  async save(id: string) {
    if (id === 'new') await addFinding(this.draft, this.auth.user()?.displayName ?? 'unknown');
    else await db.findings.update(id, { ...this.draft, notes: this.draft.notes.trim(), clientUpdatedAt: new Date().toISOString(), syncStatus: 'pending', syncErrors: [] });
    this.editing.set(null);
    this.sync.syncNow();
  }

  /** Soft delete: syncs as a tombstone so the finding disappears from every device too. */
  async remove(f: Finding) {
    if (!confirm(`Delete this ${f.materialType} finding at ${f.depthM} m? It is removed from every device on the next sync.`)) return;
    await db.findings.update(f.id, { isDeleted: true, clientUpdatedAt: new Date().toISOString(), syncStatus: 'pending' });
    this.sync.syncNow();
  }

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
