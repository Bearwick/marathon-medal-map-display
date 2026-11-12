import 'maplibre-gl/dist/maplibre-gl.css';
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { GeoJSONSource, MapMouseEvent, MapTouchEvent } from 'maplibre-gl';
import { MAP_TILE_HEIGHT, MAP_TILE_WIDTH } from '../dimensions';
import { FrameProjection, inverseMercator, mercator } from '../projection';
import type { Frame, LonLat } from '../projection';

export const PICKER_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

// MapLibre looks for its worker next to its own module, which the bundler does not copy; point it at the asset.
setWorkerUrl(workerUrl);

/** Interactive 2D map that shows the route and lets the user drag the print frame. */
export class AreaPicker {
  readonly element: HTMLDivElement;
  private map: MapLibreMap;
  private frame: Frame;
  private route: LonLat[][] = [];
  private loaded = false;
  private dragging?: { start: [number, number]; center: [number, number] };
  private onChange: (frame: Frame) => void;

  constructor(frame: Frame, onChange: (frame: Frame) => void) {
    this.frame = frame;
    this.onChange = onChange;
    this.element = document.createElement('div');
    this.element.className = 'area-picker';
    this.element.setAttribute('role', 'application');
    this.element.setAttribute('aria-label', 'Map area picker. Drag the frame to move it; use the sliders below to resize or rotate it.');
    this.map = new MapLibreMap({
      container: this.element, style: PICKER_STYLE, center: frame.center, zoom: 11,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    this.map.addControl(new AttributionControl({ compact: true }), 'bottom-right');
    this.map.on('load', () => {
      this.loaded = true;
      this.map.addSource('route', { type: 'geojson', data: this.routeData() });
      this.map.addSource('frame', { type: 'geojson', data: this.frameData() });
      this.map.addLayer({ id: 'frame-rim', type: 'line', source: 'frame', filter: ['==', ['get', 'kind'], 'tile'], paint: { 'line-color': '#283b37', 'line-width': 1, 'line-dasharray': [2, 2], 'line-opacity': 0.6 } });
      this.map.addLayer({ id: 'frame-fill', type: 'fill', source: 'frame', filter: ['==', ['get', 'kind'], 'window'], paint: { 'fill-color': '#d7e5a5', 'fill-opacity': 0.18 } });
      this.map.addLayer({ id: 'frame-line', type: 'line', source: 'frame', filter: ['==', ['get', 'kind'], 'window'], paint: { 'line-color': '#283b37', 'line-width': 2.5 } });
      this.map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#e97845', 'line-width': 3.5 } });
      this.fit(false);
      // Start with the compact attribution collapsed so it does not cover the small map; the (i) button opens it.
      this.element.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    });
    this.map.on('mouseenter', 'frame-fill', () => { this.map.getCanvas().style.cursor = 'move'; });
    this.map.on('mouseleave', 'frame-fill', () => { if (!this.dragging) this.map.getCanvas().style.cursor = ''; });
    const start = (event: MapMouseEvent | MapTouchEvent) => {
      if ('points' in event && event.points.length !== 1) return;
      event.preventDefault();
      this.map.dragPan.disable();
      this.dragging = { start: mercator([event.lngLat.lng, event.lngLat.lat]), center: mercator(this.frame.center) };
    };
    const move = (event: MapMouseEvent | MapTouchEvent) => {
      if (!this.dragging) return;
      const [x, y] = mercator([event.lngLat.lng, event.lngLat.lat]);
      const center = inverseMercator([this.dragging.center[0] + x - this.dragging.start[0], this.dragging.center[1] + y - this.dragging.start[1]]);
      this.frame = { ...this.frame, center };
      this.update();
    };
    const end = () => {
      if (!this.dragging) return;
      this.dragging = undefined;
      this.map.dragPan.enable();
      this.map.getCanvas().style.cursor = '';
      this.onChange(this.frame);
    };
    this.map.on('mousedown', 'frame-fill', start);
    this.map.on('touchstart', 'frame-fill', start);
    this.map.on('mousemove', move);
    this.map.on('touchmove', move);
    this.map.on('mouseup', end);
    this.map.on('touchend', end);
  }

  private frameData(): GeoJSON.FeatureCollection {
    const projection = new FrameProjection(this.frame);
    const ring = (corners: LonLat[]) => [[...corners, corners[0]]];
    return {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'tile' }, geometry: { type: 'Polygon', coordinates: ring(projection.corners(MAP_TILE_WIDTH, MAP_TILE_HEIGHT)) } },
        { type: 'Feature', properties: { kind: 'window' }, geometry: { type: 'Polygon', coordinates: ring(projection.corners()) } },
      ],
    };
  }

  private routeData(): GeoJSON.FeatureCollection {
    return { type: 'FeatureCollection', features: this.route.map((segment) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: segment } })) };
  }

  private update(): void {
    if (!this.loaded) return;
    (this.map.getSource('frame') as GeoJSONSource).setData(this.frameData());
  }

  setFrame(frame: Frame, fit = false): void {
    this.frame = frame;
    this.update();
    if (fit) this.fit(true);
  }

  setRoute(route: LonLat[][]): void {
    this.route = route;
    if (this.loaded) (this.map.getSource('route') as GeoJSONSource).setData(this.routeData());
  }

  /** Zooms the map so the whole frame is visible. */
  fit(animate = true): void {
    const corners = new FrameProjection(this.frame).corners(MAP_TILE_WIDTH, MAP_TILE_HEIGHT);
    const lons = corners.map((c) => c[0]), lats = corners.map((c) => c[1]);
    this.map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 28, animate, duration: animate ? 500 : 0 });
  }

  /** Call after the element is re-attached to the document. */
  resize(): void {
    this.map.resize();
  }

  destroy(): void {
    this.map.remove();
  }
}
