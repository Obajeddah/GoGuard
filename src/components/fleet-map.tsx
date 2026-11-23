// Browser-only: load with React.lazy behind <ClientOnly>. Leaflet touches `window` on import.
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapBus {
  id: string;
  label: string;
  lat: number;
  lng: number;
  stale: boolean;
  trail: [number, number][];
}

const LAGOS: [number, number] = [6.5244, 3.3792];

export default function FleetMap({ buses, focusId }: { buses: MapBus[]; focusId?: string | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true }).setView(LAGOS, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];
    for (const b of buses) {
      if (b.trail.length > 1) {
        L.polyline(b.trail, { color: "var(--primary)", weight: 4, opacity: 0.55 }).addTo(layer);
      }
      const icon = L.divIcon({
        className: "",
        iconSize: [0, 0],
        html: `<div class="fleet-pin ${b.stale ? "fleet-pin--stale" : ""}"><span>${escapeHtml(b.label)}</span></div>`,
      });
      L.marker([b.lat, b.lng], { icon })
        .bindPopup(`<strong>${escapeHtml(b.label)}</strong><br /><a href="${escapeHtml(`https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}&travelmode=driving`)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>`)
        .addTo(layer);
      bounds.push([b.lat, b.lng]);
    }
    const focus = buses.find((b) => b.id === focusId);
    if (focus) {
      map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 14));
    } else if (bounds.length && !fittedRef.current) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
      fittedRef.current = true;
    }
  }, [buses, focusId]);

  return <div ref={elRef} className="size-full" />;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
