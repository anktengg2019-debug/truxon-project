import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Inline SVG truck icon, rotated to match the driver's heading.
function truckIcon(heading = 0, color = '#1f6feb') {
  const html = `
    <div class="truck-marker" style="transform: rotate(${heading}deg);">
      <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true">
        <path fill="${color}" stroke="#fff" stroke-width="1"
          d="M12 2 L18 9 L14 9 L14 21 L10 21 L10 9 L6 9 Z" />
      </svg>
    </div>`;
  return L.divIcon({
    className: 'truck-div-icon',
    html,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

const STALE_MS = 30000;

export class TruckMap {
  constructor(elementId, { center = [12.9716, 77.5946], zoom = 13 } = {}) {
    this.map = L.map(elementId, { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    // id -> { marker, anim, lastSeen }
    this.trucks = new Map();
    this._raf = null;
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
    this._followId = null;
  }

  setFollow(id) {
    this._followId = id;
  }

  /** Apply the latest snapshot of drivers, animating each to its new position. */
  update(drivers) {
    const now = Date.now();
    const seen = new Set();

    for (const d of drivers) {
      if (typeof d.lat !== 'number' || typeof d.lng !== 'number') continue;
      seen.add(d.id);
      const target = L.latLng(d.lat, d.lng);
      let entry = this.trucks.get(d.id);

      if (!entry) {
        const marker = L.marker(target, { icon: truckIcon(d.heading, d.color) }).addTo(this.map);
        marker.bindPopup(this._popupHtml(d));
        entry = { marker, anim: null, data: d, lastSeen: now };
        this.trucks.set(d.id, entry);
      } else {
        const from = entry.marker.getLatLng();
        entry.anim = { from, to: target, start: performance.now(), dur: 4500 };
        entry.marker.setIcon(truckIcon(d.heading, d.color));
        entry.marker.setPopupContent(this._popupHtml(d));
        entry.data = d;
        entry.lastSeen = now;
      }

      if (this._followId === d.id) {
        this.map.panTo(target, { animate: true });
      }
    }

    // Remove trucks no longer present in the snapshot.
    for (const [id, entry] of this.trucks.entries()) {
      if (!seen.has(id)) {
        this.map.removeLayer(entry.marker);
        this.trucks.delete(id);
      }
    }
  }

  _popupHtml(d) {
    const speed = d.speed != null ? `${Math.round(d.speed)} km/h` : '—';
    return `<strong>${d.name || d.id}</strong><br/>
      Speed: ${speed}<br/>
      Lat: ${d.lat.toFixed(5)}, Lng: ${d.lng.toFixed(5)}`;
  }

  _tick(t) {
    const now = Date.now();
    for (const entry of this.trucks.values()) {
      const a = entry.anim;
      if (a) {
        const p = Math.min(1, (t - a.start) / a.dur);
        const lat = a.from.lat + (a.to.lat - a.from.lat) * p;
        const lng = a.from.lng + (a.to.lng - a.from.lng) * p;
        entry.marker.setLatLng([lat, lng]);
        if (p >= 1) entry.anim = null;
      }
      const stale = now - entry.lastSeen > STALE_MS;
      const el = entry.marker.getElement();
      if (el) el.style.opacity = stale ? '0.4' : '1';
    }
    this._raf = requestAnimationFrame(this._tick);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.map.remove();
  }
}
