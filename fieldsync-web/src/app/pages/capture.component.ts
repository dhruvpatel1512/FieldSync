import { Component, inject, signal } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { addFinding, db } from '../core/db';
import { HydrocarbonIndicator, MATERIAL_TYPES } from '../core/models';
import { AuthService } from '../core/auth.service';
import { SyncService } from '../core/sync.service';

@Component({
  selector: 'app-capture',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>New field finding</h2>
      <form #f="ngForm" (ngSubmit)="save(f)">
        <label>Expedition
          <select name="exp" [(ngModel)]="expeditionId" required>
            <option [ngValue]="null" disabled>Choose expedition…</option>
            @for (e of expeditions(); track e.id) { <option [ngValue]="e.id">{{ e.name }} ({{ e.region }})</option> }
          </select>
          @if (expeditions().length === 0) { <span class="error small">Sync once online to download expeditions.</span> }
        </label>

        <div class="row">
          <label>Latitude <input name="lat" type="number" step="0.000001" min="-90" max="90" [(ngModel)]="latitude" required></label>
          <label>Longitude <input name="lon" type="number" step="0.000001" min="-180" max="180" [(ngModel)]="longitude" required></label>
        </div>
        <button type="button" class="secondary" (click)="useGps()" [disabled]="locating()">
          {{ locating() ? 'Getting GPS fix…' : '📍 Use device GPS (works offline)' }}
        </button>
        @if (accuracy() !== null) { <span class="muted small"> ±{{ accuracy() }} m</span> }
        @if (gpsError()) { <p class="error small">{{ gpsError() }}</p> }

        <div class="row">
          <label>Material type
            <select name="mat" [(ngModel)]="materialType" required>
              @for (m of materials; track m) { <option [value]="m">{{ m }}</option> }
            </select>
          </label>
          <label>Depth (m) <input name="depth" type="number" min="0" max="10000" step="0.1" [(ngModel)]="depthM" required></label>
        </div>

        <label>Hydrocarbon indicator
          <select name="hc" [(ngModel)]="hydrocarbon">
            <option value="None">None</option>
            <option value="OilShow">Oil show</option>
            <option value="GasShow">Gas show</option>
          </select>
        </label>

        <label>Field notes <textarea name="notes" rows="3" maxlength="2000" [(ngModel)]="notes"
          placeholder="e.g. fine-grained grey shale, faint petroleum odour at 42 m"></textarea></label>

        <button type="submit" [disabled]="f.invalid || saving()">Save finding</button>
        @if (saved()) { <p class="ok">Saved on device ✓ {{ sync.online() ? 'Syncing…' : 'Will sync when network returns.' }}</p> }
      </form>
    </section>
  `,
})
export class CaptureComponent {
  readonly sync = inject(SyncService);
  private auth = inject(AuthService);
  readonly materials = MATERIAL_TYPES;
  readonly expeditions = toSignal(from(liveQuery(() => db.expeditions.toArray())), { initialValue: [] });

  expeditionId: number | null = null;
  latitude: number | null = null;
  longitude: number | null = null;
  materialType = 'Sandstone';
  depthM: number | null = null;
  hydrocarbon: HydrocarbonIndicator = 'None';
  notes = '';

  accuracy = signal<number | null>(null);
  locating = signal(false);
  gpsError = signal<string | null>(null);
  saving = signal(false);
  saved = signal(false);

  useGps() {
    if (!('geolocation' in navigator)) { this.gpsError.set('GPS not available on this device'); return; }
    this.locating.set(true);
    this.gpsError.set(null);
    navigator.geolocation.getCurrentPosition(
      pos => {
        this.latitude = +pos.coords.latitude.toFixed(6);
        this.longitude = +pos.coords.longitude.toFixed(6);
        this.accuracy.set(Math.round(pos.coords.accuracy));
        this.locating.set(false);
      },
      err => { this.gpsError.set(err.message); this.locating.set(false); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  async save(form: NgForm) {
    this.saving.set(true);
    await addFinding({                          // 1) saved locally: never lost, even with no network
      expeditionId: this.expeditionId!, latitude: this.latitude!, longitude: this.longitude!, materialType: this.materialType,
      depthM: this.depthM!, hydrocarbonIndicator: this.hydrocarbon, notes: this.notes,
    }, this.auth.user()?.displayName ?? 'unknown', this.accuracy());
    // Clear the form for the next sample but keep the expedition selected
    form.resetForm({ exp: this.expeditionId, mat: 'Sandstone', hc: 'None', notes: '' });
    this.saving.set(false);
    this.saved.set(true);
    this.accuracy.set(null);
    setTimeout(() => this.saved.set(false), 3000);
    this.sync.syncNow();                       // 2) try to sync now (no-op if offline)
  }
}
