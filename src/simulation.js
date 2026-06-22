// Lightweight movement simulation used when real GPS is unavailable
// (e.g. demos, desktops without geolocation, or offline previews).

const EARTH_RADIUS_M = 6371000;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/** Bearing in degrees from point A to point B. */
export function bearing(a, b) {
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle distance in metres between two points. */
export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * A truck that drives back and forth along a fixed multi-point route.
 * Call `step(seconds)` to advance and read its current position.
 */
export class SimulatedTruck {
  /**
   * @param {object} opts
   * @param {{lat:number,lng:number}[]} opts.route - waypoints to follow
   * @param {number} [opts.speedKmh] - cruising speed
   */
  constructor({ route, speedKmh = 45 }) {
    this.route = route;
    this.speedKmh = speedKmh;
    this.segment = 0;
    this.progress = 0; // 0..1 along the current segment
    this.direction = 1; // 1 forward, -1 backward
    this.lat = route[0].lat;
    this.lng = route[0].lng;
    this.heading = 0;
    this.speed = speedKmh;
  }

  step(seconds) {
    const speedMs = (this.speedKmh * 1000) / 3600;
    let remaining = speedMs * seconds;

    while (remaining > 0) {
      const from = this.route[this.segment];
      const to = this.route[this.segment + this.direction];
      if (!to) {
        // hit an end of the route; reverse
        this.direction *= -1;
        continue;
      }
      const segLen = distanceMeters(from, to);
      const distLeft = segLen * (1 - this.progress);

      if (remaining < distLeft) {
        this.progress += remaining / segLen;
        remaining = 0;
      } else {
        remaining -= distLeft;
        this.segment += this.direction;
        this.progress = 0;
        if (this.segment <= 0 || this.segment >= this.route.length - 1) {
          this.direction *= -1;
        }
      }
    }

    const from = this.route[this.segment];
    const to = this.route[this.segment + this.direction] || from;
    this.lat = from.lat + (to.lat - from.lat) * this.progress;
    this.lng = from.lng + (to.lng - from.lng) * this.progress;
    this.heading = bearing(from, to);
    return { lat: this.lat, lng: this.lng, heading: this.heading, speed: this.speed };
  }
}

// A small demo route through central Bengaluru.
export const DEMO_ROUTE = [
  { lat: 12.9716, lng: 77.5946 },
  { lat: 12.9758, lng: 77.6012 },
  { lat: 12.9810, lng: 77.6090 },
  { lat: 12.9890, lng: 77.6150 },
  { lat: 12.9950, lng: 77.6050 },
  { lat: 12.9880, lng: 77.5950 },
  { lat: 12.9790, lng: 77.5890 },
];
