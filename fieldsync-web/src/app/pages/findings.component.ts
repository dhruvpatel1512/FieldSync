import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, effect } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import * as L from 'leaflet';
import { db } from '../core/db';

const COLORS: Record<string, string> = { None: '#64748b', OilShow: '#b45309', GasShow: '#0e7490' };

@Component({
  selector: 'app-findings',
  standalone: true,
  imports: [DatePipe, DecimalPipe],
  template: `
    <section class="card">
      <h2>Findings <span class="muted small">({{ findings().length }} on this device)</span></h2>
      <div #map class="map"></div>
      <p class="muted small">Map tiles need network; your data does not. Grey = no show · Amber = oil show · Teal = gas show</p>
    </section>

    <section class="card">
      <table>
        <thead><tr><th>Captured</th><th>Location</th><th>Material</th><th>Depth</th><th>Indicator</th><th>Status</th></tr></thead>
        <tbody>
          @for (f of findings(); track f.id) {
            <tr>
              <td>{{ f.capturedAt | date:'MMM d, HH:mm' }}</td>
              <td>{{ f.latitude | number:'1.4-4' }}, {{ f.longitude | number:'1.4-4' }}</td>
              <td>{{ f.materialType }}</td>
              <td>{{ f.depthM }} m</td>
              <td>{{ f.hydrocarbonIndicator }}</td>
              <td>
                <span class="badge {{ f.syncStatus }}">{{ f.syncStatus }}</span>
                @for (q of f.qualityFlags ?? []; track q) { <div class="warn small">⚠ {{ q }}</div> }
                @for (e of f.syncErrors ?? []; track e) { <div class="error small">{{ e }}</div> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="muted">No findings yet.</td></tr>
          }
        </tbody>
      </table>
    </section>
  `,
})
export class FindingsComponent implements AfterViewInit, OnDestroy {
  @ViewChild('map') mapEl!: ElementRef<HTMLDivElement>;
  readonly findings = toSignal(
    from(liveQuery(() => db.findings.orderBy('capturedAt').reverse().filter(f => !f.isDeleted).toArray())), { initialValue: [] });

  private map?: L.Map;
  private layer = L.layerGroup();

  constructor() {
    effect(() => this.draw(this.findings()));
  }

  ngAfterViewInit() {
    this.map = L.map(this.mapEl.nativeElement).setView([22.8, 72.5], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);
    this.layer.addTo(this.map);
    this.draw(this.findings());
  }

  ngOnDestroy() { this.map?.remove(); }

  private draw(list: ReturnType<typeof this.findings>) {
    if (!this.map) return;
    this.layer.clearLayers();
    for (const f of list) {
      L.circleMarker([f.latitude, f.longitude], {
        radius: 7, color: COLORS[f.hydrocarbonIndicator], fillOpacity: 0.8,
        dashArray: f.syncStatus === 'pending' ? '3' : undefined,
      }).bindPopup(`<b>${f.materialType}</b> at ${f.depthM} m<br>${f.hydrocarbonIndicator}<br>${f.syncStatus}`)
        .addTo(this.layer);
    }
    if (list.length) this.map.fitBounds(L.latLngBounds(list.map(f => [f.latitude, f.longitude] as [number, number])), { maxZoom: 12, padding: [20, 20] });
  }
}
