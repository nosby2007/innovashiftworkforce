import { Component, ElementRef, Input, OnChanges, PLATFORM_ID, SimpleChanges, ViewChild, inject, signal, computed, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import type * as Leaflet from 'leaflet';
import { haversineMeters } from '../../utils/geo.util';

export interface GeofenceSite {
  name: string;
  latitude: number;
  longitude: number;
  radiusM: number;
}

/**
 * Read-only geofence visualization: shows a site's allowed radius plus the
 * user's live GPS position ("ping"), so staff can see whether they're in
 * range before attempting a GPS clock-in/out. Purely informational — the
 * actual clock-in/out payload is captured separately and the geofence is
 * enforced server-side regardless of what this renders.
 *
 * Leaflet touches `window` at module-evaluation time, so it's loaded via a
 * dynamic import gated on `isPlatformBrowser` rather than a static import —
 * this component is reachable from the app-wide server bundle used for
 * prerendering the public marketing pages, and a static import would crash
 * that Node process even though this component never actually renders there.
 */
@Component({
  selector: 'app-geofence-map',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="geo-wrap">
      <div #mapEl class="geo-map"></div>
      <div class="geo-status" [class.geo-status--in]="isInRange() === true" [class.geo-status--out]="isInRange() === false">
        <ng-container [ngSwitch]="true">
          <span *ngSwitchCase="!!geoError()">{{ geoError() }}</span>
          <span *ngSwitchCase="userLat() === null">Locating you…</span>
          <span *ngSwitchCase="!site">Waiting for a site to check your position against.</span>
          <span *ngSwitchCase="isInRange() === true">In range — {{ distanceM() }}m from {{ site?.name }}.</span>
          <span *ngSwitchCase="isInRange() === false">Out of range — {{ distanceM() }}m from {{ site?.name }} (allowed radius {{ site?.radiusM }}m).</span>
        </ng-container>
      </div>
    </div>
  `,
  styles: [`
    .geo-wrap { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
    .geo-map { width:100%; height:220px; border-radius:12px; overflow:hidden; border:1px solid var(--border, #d9e0e7); }
    .geo-status { font-size:12px; padding:8px 12px; border-radius:8px; background:#f1f5f9; color:#334155; }
    .geo-status--in { background:#ecfdf5; color:#047857; }
    .geo-status--out { background:#fef2f2; color:#b91c1c; }
    ::ng-deep .geo-ping { position:relative; width:20px; height:20px; }
    ::ng-deep .geo-ping-dot { position:absolute; inset:5px; border-radius:50%; background:#2563eb; border:2px solid #fff; box-shadow:0 0 0 1px rgba(37,99,235,.5); }
    ::ng-deep .geo-ping-pulse { position:absolute; inset:0; border-radius:50%; background:rgba(37,99,235,.35); animation:geo-pulse 1.8s ease-out infinite; }
    @keyframes geo-pulse { 0% { transform:scale(.35); opacity:.8; } 100% { transform:scale(1.9); opacity:0; } }
  `],
})
export class GeofenceMapComponent implements AfterViewInit, OnChanges, OnDestroy {
  private platformId = inject(PLATFORM_ID);

  @Input() site: GeofenceSite | null = null;

  @ViewChild('mapEl') mapEl?: ElementRef<HTMLDivElement>;

  userLat = signal<number | null>(null);
  userLng = signal<number | null>(null);
  userAccuracyM = signal<number | null>(null);
  geoError = signal<string | null>(null);

  distanceM = computed<number | null>(() => {
    const lat = this.userLat();
    const lng = this.userLng();
    if (lat == null || lng == null || !this.site) return null;
    return Math.round(haversineMeters(lat, lng, this.site.latitude, this.site.longitude));
  });

  isInRange = computed<boolean | null>(() => {
    const d = this.distanceM();
    const accuracy = this.userAccuracyM() ?? 0;
    if (d == null || !this.site) return null;
    return d <= this.site.radiusM + Math.max(0, accuracy);
  });

  private L: typeof Leaflet | null = null;
  private map: Leaflet.Map | null = null;
  private siteCircle: Leaflet.Circle | null = null;
  private siteCenterDot: Leaflet.CircleMarker | null = null;
  private userAccuracyCircle: Leaflet.Circle | null = null;
  private userMarker: Leaflet.Marker | null = null;
  private userPingIcon: Leaflet.DivIcon | null = null;
  private watchId: number | null = null;
  private hasFitBounds = false;

  async ngAfterViewInit() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.L = await import('leaflet');
    this.initMap();
    this.startWatch();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['site'] && this.map) {
      this.hasFitBounds = false;
      this.refreshSiteLayer();
      this.fitBoundsIfReady();
    }
  }

  ngOnDestroy() {
    this.stopWatch();
    this.map?.remove();
    this.map = null;
  }

  private initMap() {
    const L = this.L;
    if (!L || !this.mapEl?.nativeElement || this.map) return;
    this.userPingIcon = L.divIcon({
      className: 'geo-ping-icon',
      html: '<div class="geo-ping"><div class="geo-ping-pulse"></div><div class="geo-ping-dot"></div></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });
    this.map = L.map(this.mapEl.nativeElement, {
      center: [this.site?.latitude ?? 33.749, this.site?.longitude ?? -84.388],
      zoom: 16,
      zoomControl: true,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.refreshSiteLayer();
  }

  private startWatch() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      this.geoError.set('This device does not support GPS.');
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.geoError.set(null);
        this.userLat.set(pos.coords.latitude);
        this.userLng.set(pos.coords.longitude);
        this.userAccuracyM.set(pos.coords.accuracy);
        this.refreshUserLayer();
      },
      (err) => {
        this.geoError.set(err.message || 'Unable to get your location. Check location permission for this app.');
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  private stopWatch() {
    if (this.watchId != null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(this.watchId);
    }
    this.watchId = null;
  }

  private refreshSiteLayer() {
    const L = this.L;
    if (!L || !this.map) return;
    if (!this.site) {
      if (this.siteCircle) { this.map.removeLayer(this.siteCircle); this.siteCircle = null; }
      if (this.siteCenterDot) { this.map.removeLayer(this.siteCenterDot); this.siteCenterDot = null; }
      return;
    }

    const center: Leaflet.LatLngExpression = [this.site.latitude, this.site.longitude];
    if (!this.siteCircle) {
      this.siteCircle = L.circle(center, {
        radius: this.site.radiusM,
        color: '#22c55e',
        fillColor: '#22c55e',
        fillOpacity: 0.15,
        weight: 2,
      }).addTo(this.map);
    } else {
      this.siteCircle.setLatLng(center);
      this.siteCircle.setRadius(this.site.radiusM);
    }

    if (!this.siteCenterDot) {
      this.siteCenterDot = L.circleMarker(center, {
        radius: 5,
        color: '#166534',
        fillColor: '#22c55e',
        fillOpacity: 1,
        weight: 2,
      }).addTo(this.map).bindTooltip(this.site.name, { permanent: false });
    } else {
      this.siteCenterDot.setLatLng(center);
    }
  }

  private refreshUserLayer() {
    const L = this.L;
    if (!L || !this.map) return;
    const lat = this.userLat();
    const lng = this.userLng();
    if (lat == null || lng == null) return;
    const center: Leaflet.LatLngExpression = [lat, lng];
    const accuracyM = Math.max(5, this.userAccuracyM() ?? 15);

    if (!this.userMarker) {
      this.userMarker = L.marker(center, { icon: this.userPingIcon!, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      this.userMarker.setLatLng(center);
    }

    if (!this.userAccuracyCircle) {
      this.userAccuracyCircle = L.circle(center, {
        radius: accuracyM,
        color: '#2563eb',
        fillColor: '#2563eb',
        fillOpacity: 0.08,
        weight: 1,
      }).addTo(this.map);
    } else {
      this.userAccuracyCircle.setLatLng(center);
      this.userAccuracyCircle.setRadius(accuracyM);
    }

    this.fitBoundsIfReady();
  }

  private fitBoundsIfReady() {
    const L = this.L;
    if (!L || !this.map || this.hasFitBounds) return;
    const lat = this.userLat();
    const lng = this.userLng();

    if (lat != null && lng != null && this.site) {
      const bounds = L.latLngBounds(
        [lat, lng],
        [this.site.latitude, this.site.longitude]
      ).pad(0.4);
      this.map.fitBounds(bounds, { maxZoom: 18 });
      this.hasFitBounds = true;
    } else if (lat != null && lng != null) {
      this.map.setView([lat, lng], 17);
      this.hasFitBounds = true;
    } else if (this.site) {
      this.map.setView([this.site.latitude, this.site.longitude], 16);
    }
  }
}
