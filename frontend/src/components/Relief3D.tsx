// The kraj as terrain: the same choropleth as the flat map, draped over the
// real elevation from ČÚZK DMR 5G.
//
// The map stays our own drawing. The elevation grid is sampled once at ingest
// (`backend/kam/ingest/relief.py`) into the projection the SVG paths already
// use, so a grid vertex and an obec outline land on the same spot and the
// colours can simply be painted into a canvas and used as a texture. That is
// also why there is no per-vertex lookup of "which obec is this point in":
// the texture answers it, and a second, hidden canvas painted with index
// colours answers it again for hit testing in O(1).
//
// three.js is loaded only when this view is opened (React.lazy at the call
// site) — it is bigger than the rest of the app put together.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useApi } from "../lib/api";
import { num } from "../lib/format";
import { resolvedTheme, usePrefs } from "../lib/prefs";
import { binOf, ramp, type GeoKhk } from "./maps";

export interface Relief {
  w: number; h: number; bbox: [number, number, number, number];
  min: number; max: number; mean: number; unit: string;
  encoding: string; data: string; source: string; source_name: string; license: string;
}

/** Kraj is ~119 km across and 1.3 km tall; at 1:1 the terrain would be a sheet
 *  of paper. Relief maps usually exaggerate two to five times — past about
 *  eight the 300 m grid turns a 30° hillside into a spike and the landscape
 *  stops being recognisable, so the slider stops before it gets silly. */
const EXAGGERATION = { min: 1, max: 12, step: 0.5, default: 4 };
const TEX_W = 1400;

type Shape = { code: number; name: string; d: string; cx: number; cy: number };

interface Gl {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera;
  controls: OrbitControls; mesh: THREE.Mesh; material: THREE.MeshStandardMaterial;
  base: Float32Array; unitPerM: number; raycaster: THREE.Raycaster; stop: () => void;
}

function decode(b64: string): Uint16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Uint16Array(bytes.buffer, 0, bytes.length >> 1);
}

/** Paint the choropleth (and, on a second canvas, an index map for hit tests). */
function paint(geo: GeoKhk, level: "obec" | "orp", values: Record<string, number>, breaks: number[],
               colors: string[], theme: "light" | "dark", selected: string | null) {
  const [, , vbW, vbH] = geo.viewBox.split(" ").map(Number);
  const scale = TEX_W / vbW;
  const w = TEX_W, h = Math.round(vbH * scale);
  const shapes: Shape[] = level === "orp" ? geo.orp : geo.obce;

  const tex = document.createElement("canvas");
  tex.width = w; tex.height = h;
  const c = tex.getContext("2d")!;
  // Everything outside the kraj is still terrain — it just is not ours.
  c.fillStyle = theme === "dark" ? "#141a16" : "#dfe3de";
  c.fillRect(0, 0, w, h);
  c.scale(scale, scale);

  const hit = document.createElement("canvas");
  hit.width = w; hit.height = h;
  const hc = hit.getContext("2d", { willReadFrequently: true })!;
  hc.fillStyle = "#000000";
  hc.fillRect(0, 0, w, h);
  hc.scale(scale, scale);

  const noData = theme === "dark" ? "#2a3230" : "#c9cfc8";
  shapes.forEach((s, i) => {
    const p = new Path2D(s.d);
    const v = values[String(s.code)];
    c.fillStyle = v === undefined ? noData : colors[binOf(v, breaks)];
    c.fill(p, "evenodd");
    // Index 0 is reserved for "nothing", so shapes start at 1.
    const id = i + 1;
    hc.fillStyle = `rgb(${(id >> 8) & 255},${id & 255},1)`;
    hc.fill(p, "evenodd");
  });

  c.lineJoin = "round";
  c.strokeStyle = theme === "dark" ? "rgba(0,0,0,.55)" : "rgba(255,255,255,.65)";
  c.lineWidth = level === "obec" ? 0.7 : 1.2;
  for (const s of shapes) c.stroke(new Path2D(s.d));
  if (selected) {
    const code = selected.split(":")[1];
    const s = shapes.find((x) => String(x.code) === code);
    if (s) {
      c.strokeStyle = "#7fd957";
      c.lineWidth = 3;
      c.stroke(new Path2D(s.d));
    }
  }
  c.strokeStyle = theme === "dark" ? "rgba(226,240,228,.85)" : "rgba(20,32,24,.8)";
  c.lineWidth = 2.2;
  c.stroke(new Path2D(geo.outline));

  return { tex, hit, w, h, shapes };
}

export function Relief3D({ level, values, breaks, polarity = 1, selected, onSelect, format }: {
  level: "obec" | "orp"; values: Record<string, number>; breaks: number[]; polarity?: number;
  selected: string | null; onSelect: (id: string, name: string) => void; format: (v: number | null) => string;
}) {
  const geo = useApi<GeoKhk>("/geo/khk");
  const rel = useApi<Relief>("/geo/khk_relief");
  const prefs = usePrefs();
  const theme = resolvedTheme(prefs);
  const host = useRef<HTMLDivElement>(null);
  const [vScale, setVScale] = useState(EXAGGERATION.default);
  // On a touch screen the terrain would otherwise swallow every swipe and the
  // page could not be scrolled past it; it stays inert until it is tapped.
  const touch = useMemo(() => matchMedia("(pointer: coarse)").matches, []);
  const [locked, setLocked] = useState(touch);
  const [tip, setTip] = useState<{ x: number; y: number; name: string; line: string; alt: number } | null>(null);

  // Everything three.js owns lives here so React re-renders never rebuild it.
  const gl = useRef<Gl | null>(null);

  const painted = useMemo(() => {
    if (!geo.data) return null;
    return paint(geo.data, level, values, breaks, ramp(polarity, theme), theme, selected);
  }, [geo.data, level, values, breaks, polarity, theme, selected]);

  // Build the scene once both the boundaries and the elevation are in.
  useEffect(() => {
    const el = host.current;
    if (!el || !geo.data || !rel.data || !painted) return;
    const relief = rel.data;
    const grid = decode(relief.data);
    const coarse = matchMedia("(pointer: coarse)").matches;
    const step = coarse ? 2 : 1;               // a phone does not need 96 000 vertices
    const gw = Math.floor((relief.w - 1) / step) + 1;
    const gh = Math.floor((relief.h - 1) / step) + 1;

    // World units: 100 across the wider side, height in the same scale as the
    // ground so the exaggeration slider is the only thing that stretches it.
    const [west, south, east, north] = relief.bbox;
    const midLat = ((south + north) / 2) * (Math.PI / 180);
    const kmX = (east - west) * 111.32 * Math.cos(midLat);
    const kmY = (north - south) * 111.32;
    const W = 100, D = (W * kmY) / kmX;
    const unitPerM = W / (kmX * 1000);

    const pos = new Float32Array(gw * gh * 3);
    const uv = new Float32Array(gw * gh * 2);
    const base = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        const h = grid[j * step * relief.w + i * step];
        base[k] = h;
        pos[k * 3] = (i / (gw - 1) - 0.5) * W;
        pos[k * 3 + 1] = 0;
        pos[k * 3 + 2] = (j / (gh - 1) - 0.5) * D;
        uv[k * 2] = i / (gw - 1);
        uv[k * 2 + 1] = 1 - j / (gh - 1);
      }
    }
    // A cell is drawn only if all four corners have a reading; outside the
    // country the service returns nothing and a flat apron at zero would read
    // as a cliff.
    const idx: number[] = [];
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const a = j * gw + i, b = a + 1, cc = a + gw, d = cc + 1;
        if (!base[a] || !base[b] || !base[cc] || !base[d]) continue;
        idx.push(a, cc, b, b, cc, d);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geom.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geom.setIndex(idx);

    const texture = new THREE.CanvasTexture(painted.tex);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 });
    const mesh = new THREE.Mesh(geom, material);

    const scene = new THREE.Scene();
    scene.add(mesh);
    scene.add(new THREE.HemisphereLight(theme === "dark" ? 0x39506a : 0xbfd6ff, theme === "dark" ? 0x0b0f0c : 0x6b6a5c, theme === "dark" ? 1.5 : 2.0));
    // Light from the north-west, the convention every shaded relief map uses;
    // lit from the south the valleys turn into ridges.
    const sun = new THREE.DirectionalLight(0xfff2dd, theme === "dark" ? 2.1 : 2.6);
    sun.position.set(-60, 70, -45);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2000);
    // Low enough that the Krkonoše ridge reads as a ridge, not a colour patch.
    camera.position.set(0, 52, 96);

    const renderer = new THREE.WebGLRenderer({ antialias: !coarse, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.6 : 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:none;border-radius:inherit";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.55;
    controls.minDistance = 35;
    controls.maxDistance = 260;
    controls.maxPolarAngle = Math.PI * 0.47;   // never let the camera under the terrain
    controls.target.set(0, 4, 2);

    let alive = true;
    const tick = () => {
      if (!alive) return;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    };
    const resize = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      camera.aspect = r.width / r.height;
      camera.updateProjectionMatrix();
      renderer.setSize(r.width, r.height, false);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    requestAnimationFrame(tick);

    gl.current = {
      renderer, scene, camera, controls, mesh, material, base, unitPerM,
      raycaster: new THREE.Raycaster(),
      stop: () => {
        alive = false;
        ro.disconnect();
        controls.dispose();
        geom.dispose();
        material.dispose();
        texture.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      },
    };
    return () => { gl.current?.stop(); gl.current = null; };
    // Rebuilt only when the terrain itself or the theme changes; the colours
    // are swapped through the texture, not by rebuilding the mesh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geo.data, rel.data, theme]);

  // Repaint the texture when the indicator, level or selection changes.
  useEffect(() => {
    const g = gl.current;
    if (!g || !painted) return;
    const map = g.material.map as THREE.CanvasTexture | null;
    if (map && map.image === painted.tex) { map.needsUpdate = true; return; }
    const texture = new THREE.CanvasTexture(painted.tex);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    map?.dispose();
    g.material.map = texture;
    g.material.needsUpdate = true;
  }, [painted]);

  // Height is a cheap attribute update, so the slider stays smooth.
  useEffect(() => {
    const g = gl.current;
    if (!g) return;
    const attr = g.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const u = g.unitPerM * vScale;
    for (let k = 0; k < g.base.length; k++) arr[k * 3 + 1] = g.base[k] * u;
    attr.needsUpdate = true;
    g.mesh.geometry.computeVertexNormals();
    g.mesh.geometry.computeBoundingSphere();
  }, [vScale, geo.data, rel.data, theme]);

  // OrbitControls claims every touch, so the lock has to reach both it and the
  // element's touch-action — otherwise the browser still refuses to scroll.
  useEffect(() => {
    const g = gl.current;
    if (!g) return;
    g.controls.enabled = !locked;
    g.renderer.domElement.style.touchAction = locked ? "pan-y" : "none";
  }, [locked, geo.data, rel.data, theme]);

  // Hover and click both come down to one texture lookup.
  const pick = (e: React.PointerEvent) => {
    const g = gl.current;
    if (!g || !painted) return null;
    const r = g.renderer.domElement.getBoundingClientRect();
    const p = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    g.raycaster.setFromCamera(p, g.camera);
    const hit = g.raycaster.intersectObject(g.mesh, false)[0];
    if (!hit?.uv) return null;
    const x = Math.floor(hit.uv.x * painted.w);
    const y = Math.floor((1 - hit.uv.y) * painted.h);
    const px = painted.hit.getContext("2d")!.getImageData(x, y, 1, 1).data;
    if (!px[2]) return null;                       // blue channel marks "a shape"
    const shape = painted.shapes[((px[0] << 8) | px[1]) - 1];
    if (!shape) return null;
    const u = g.unitPerM * vScale;
    return { shape, alt: Math.round(hit.point.y / (u || 1)), sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  const ready = geo.data && rel.data;
  return (
    <div className="relief-wrap">
      <div className={`relief-canvas${locked ? " is-locked" : ""}`} ref={host}
        onPointerMove={(e) => {
          if (locked) return;
          const p = pick(e);
          if (!p) { setTip(null); return; }
          const v = values[String(p.shape.code)];
          setTip({ x: p.sx, y: p.sy, name: p.shape.name, line: format(v ?? null), alt: p.alt });
        }}
        onPointerLeave={() => setTip(null)}
        onClick={(e) => {
          if (locked) return;
          const p = pick(e as unknown as React.PointerEvent);
          if (p) onSelect(`${level}:${p.shape.code}`, p.shape.name);
        }} />
      {ready && locked && (
        <button className="relief-unlock glass" onClick={() => setLocked(false)}>
          Klepnutím zapnete otáčení
        </button>
      )}
      {!ready && <div className="skeleton relief-skeleton" />}
      {tip && (
        <div className="map-tip glass" style={{ left: Math.min(Math.max(tip.x, 90), 9999), top: tip.y }}>
          <strong>{tip.name}</strong>
          <span className="muted small" style={{ display: "block" }}>{tip.line}</span>
          <span className="mute xsmall" style={{ display: "block" }}>{num(tip.alt)} m n. m.</span>
        </div>
      )}
      <div className="relief-bar glass">
        <label className="xsmall mute" htmlFor="relief-vscale">Převýšení</label>
        <input id="relief-vscale" type="range" min={EXAGGERATION.min} max={EXAGGERATION.max} step={EXAGGERATION.step}
          value={vScale} onChange={(e) => setVScale(Number(e.target.value))} />
        <span className="num xsmall">{vScale}×</span>
        {touch && !locked && <button className="relief-lock" onClick={() => setLocked(true)} title="Vrátit posouvání stránky">Uvolnit</button>}
      </div>
      <p className="xsmall mute relief-note">
        Výšky {rel.data ? `${num(rel.data.min)}–${num(rel.data.max)} m n. m.` : ""} · {rel.data?.source_name ?? "ČÚZK DMR 5G"} · tažením otáčíte, kolečkem přibližujete
      </p>
    </div>
  );
}
