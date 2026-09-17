import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GraphData, GraphNode } from '../engine/knowledgeGraph';
import { graphCategories } from '../engine/knowledgeGraph';

interface Props {
  data: GraphData;
}

interface LaidNode {
  node: GraphNode;
  position: THREE.Vector3;
  phase: number;
}

const RELATION_COLORS: Record<string, string> = {
  子类: '#fbbf24',
  相关: '#67e8f9',
  因果: '#f87171',
  引用: '#a3e635',
};

function makeLabelTexture(text: string, lightTheme: boolean): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 38px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = lightTheme ? 'rgba(51, 56, 66, 0.96)' : 'rgba(226, 236, 248, 0.96)';
  ctx.fillText(text.length > 24 ? `${text.slice(0, 24)}...` : text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function makeStars(lightTheme: boolean): THREE.Points {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const starColor = new THREE.Color(lightTheme ? '#64748b' : '#dbeafe');
  for (let i = 0; i < count; i += 1) {
    const radius = 22 + Math.random() * 34;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.72;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    const strength = 0.35 + Math.random() * 0.65;
    colors[i * 3] = starColor.r * strength;
    colors[i * 3 + 1] = starColor.g * strength;
    colors[i * 3 + 2] = starColor.b * strength;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.085,
    vertexColors: true,
    transparent: true,
    opacity: lightTheme ? 0.35 : 0.55,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

function layoutGraph(data: GraphData): Map<string, THREE.Vector3> {
  const nodes = data.nodes;
  const positions = new Map<string, THREE.Vector3>();
  if (!nodes.length) return positions;

  const maxRadius = Math.min(34, 10 + Math.cbrt(nodes.length) * 4.4);
  const categoryAnchors = new Map<string, THREE.Vector3>();
  const categories = [...new Set(nodes.map((n) => n.category))];
  categories.forEach((category, index) => {
    const goldenAngle = index * 2.399963;
    const anchor = new THREE.Vector3(
      Math.cos(goldenAngle) * maxRadius * 0.52,
      Math.sin(index * 0.9) * maxRadius * 0.34,
      Math.sin(goldenAngle) * maxRadius * 0.52,
    );
    categoryAnchors.set(category, anchor);
  });

  nodes.forEach((node, index) => {
    const anchor = categoryAnchors.get(node.category) ?? new THREE.Vector3();
    const jitter = 4.5 + (index % 5) * 0.4;
    const target = anchor
      .clone()
      .add(new THREE.Vector3(
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter,
        (Math.random() - 0.5) * jitter,
      ));
    target.clampLength(4, maxRadius);
    positions.set(node.id, target);
  });

  const iterations = Math.max(38, Math.min(82, Math.ceil(9000 / Math.max(1, nodes.length))));
  for (let step = 0; step < iterations; step += 1) {
    const cooling = 1 - step / (iterations + 4);

    // 节点间排斥，维持三向悬浮感。
    for (let i = 0; i < nodes.length; i += 1) {
      const a = positions.get(nodes[i].id)!;
      for (let j = i + 1; j < nodes.length; j += 1) {
        const bv = positions.get(nodes[j].id)!;
        const distance = Math.max(0.25, a.distanceTo(bv));
        const force = Math.min(1.8, 7.5 / (distance * distance + 0.45));
        const dir = a.clone().sub(bv).normalize().multiplyScalar(force * 0.014);
        a.add(dir);
        bv.sub(dir);
      }
    }

    // 关系弹簧，让“子类 / 相关 / 因果 / 引用”形成可读的结构。
    for (const link of data.links) {
      const a = positions.get(link.source);
      const bv = positions.get(link.target);
      if (!a || !bv) continue;
      const desired = link.relationType === '子类' ? 3.4 : 5.8;
      const dir = bv.clone().sub(a);
      const distance = Math.max(0.2, dir.length());
      const force = (distance - desired) * (link.relationType === '子类' ? 0.075 : 0.042);
      dir.normalize().multiplyScalar(force * cooling);
      a.add(dir);
      bv.sub(dir);
    }

    // 中心牵引，防止图谱散出雾景范围。
    for (const node of nodes) {
      const position = positions.get(node.id)!;
      position.multiplyScalar(1 - 0.018 * cooling);
      const limit = maxRadius + 5;
      if (position.length() > limit) position.setLength(limit);
    }
  }
  return positions;
}

export default function KnowledgeGraph3D({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const meshesRef = useRef(new Map<string, THREE.Mesh>());
  const labelsRef = useRef(new Map<string, THREE.Sprite>());
  const selectedRef = useRef<string | null>(null);
  const highlightRef = useRef<() => void>(() => {});
  const layoutPositionsRef = useRef(new Map<string, THREE.Vector3>());
  const hoverRef = useRef<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  const [keyword, setKeyword] = useState('');
  const categories = useMemo(() => graphCategories(data), [data]);
  const selected = data.nodes.find((n) => n.id === selectedId) ?? null;
  const relatedLinks = useMemo(
    () => (selectedId ? data.links.filter((l) => l.source === selectedId || l.target === selectedId) : []),
    [data.links, selectedId],
  );
  const nodeName = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const lightTheme = document.documentElement.dataset.theme === 'daylight';
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = 'absolute inset-0 h-full w-full touch-none outline-none';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(lightTheme ? 0xf1f5f9 : 0x070a14, 20, 72);
    const camera = new THREE.PerspectiveCamera(52, container.clientWidth / Math.max(1, container.clientHeight), 0.1, 200);
    camera.position.set(11, 7, 23);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.72;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.22;
    controls.minDistance = 5;
    controls.maxDistance = 72;
    controlsRef.current = controls;

    scene.add(new THREE.HemisphereLight(0xbfe9ff, lightTheme ? 0xdbe4ef : 0x0a1020, 1.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
    keyLight.position.set(8, 14, 10);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(lightTheme ? 0x2563eb : 0x22d3ee, 80, 80);
    rimLight.position.set(-18, 8, -14);
    scene.add(rimLight);
    scene.add(makeStars(lightTheme));
    const stars = makeStars(lightTheme);
    scene.add(stars);

    const world = new THREE.Group();
    scene.add(world);
    const positions = layoutGraph(data);
    layoutPositionsRef.current = positions;
    const layout = new Map<string, LaidNode>();
    const nodeGeometry = new THREE.SphereGeometry(1, 36, 24);

    data.nodes.forEach((node) => {
      const position = positions.get(node.id) ?? new THREE.Vector3();
      const color = new THREE.Color(node.color);
      const material = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.12,
        roughness: 0.24,
        metalness: 0.08,
        transparent: true,
        opacity: 0.96,
      });
      const mesh = new THREE.Mesh(nodeGeometry, material);
      const radius = 0.09 + node.size * 0.095;
      mesh.scale.setScalar(radius);
      mesh.position.copy(position);
      mesh.userData.id = node.id;
      mesh.userData.radius = radius;
      world.add(mesh);
      meshesRef.current.set(node.id, mesh);
      layout.set(node.id, { node, position: position.clone(), phase: Math.random() * Math.PI * 2 });

      const showLabel = data.nodes.length <= 190 || node.size >= 0.85;
      if (showLabel) {
        const texture = makeLabelTexture(node.name, lightTheme);
        if (texture) {
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: node.size >= 0.9 ? 0.56 : 0.3,
            depthWrite: false,
          }));
          sprite.position.copy(position).add(new THREE.Vector3(0, radius + 0.36, 0));
          sprite.scale.set(2.9, 0.54, 1);
          world.add(sprite);
          labelsRef.current.set(node.id, sprite);
        }
      }
    });

    // 关系线使用顶点色：从源节点色渐入，向目标节点淡出。
    const linePositions = new Float32Array(data.links.length * 6);
    const lineColors = new Float32Array(data.links.length * 6);
    data.links.forEach((link, index) => {
      const a = positions.get(link.source);
      const bv = positions.get(link.target);
      if (!a || !bv) return;
      const sourceColor = new THREE.Color(nodeName.get(link.source)?.color ?? '#67e8f9');
      const targetColor = new THREE.Color(nodeName.get(link.target)?.color ?? '#67e8f9').multiplyScalar(0.35);
      linePositions.set([a.x, a.y, a.z, bv.x, bv.y, bv.z], index * 6);
      lineColors.set([sourceColor.r, sourceColor.g, sourceColor.b, targetColor.r, targetColor.g, targetColor.b], index * 6);
    });
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: lightTheme ? 0.24 : 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    world.add(new THREE.LineSegments(lineGeometry, lineMaterial));

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const clock = new THREE.Clock();
    let frame = 0;

    const updateHighlight = () => {
      for (const [id, mesh] of meshesRef.current.entries()) {
        const material = mesh.material as THREE.MeshStandardMaterial;
        const active = id === selectedRef.current;
        const hovered = id === hoverRef.current;
        material.emissiveIntensity = active ? 1.1 : hovered ? 0.72 : 0.12;
        mesh.scale.setScalar(Number(mesh.userData.radius) * (active ? 1.24 : hovered ? 1.12 : 1));
      }
      for (const [id, sprite] of labelsRef.current.entries()) {
        const material = sprite.material as THREE.SpriteMaterial;
        material.opacity = id === selectedRef.current ? 1 : id === hoverRef.current ? 0.9 : material.userData.base ?? 0.32;
      }
    };
    highlightRef.current = updateHighlight;

    for (const sprite of labelsRef.current.values()) {
      sprite.material.userData.base = (sprite.material as THREE.SpriteMaterial).opacity;
    }

    const intersect = (event: PointerEvent | MouseEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([...meshesRef.current.values()], false)[0];
      return hit ? (hit.object.userData.id as string) : null;
    };

    const onPointerMove = (event: PointerEvent) => {
      const id = intersect(event);
      if (id !== hoverRef.current) {
        hoverRef.current = id;
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
        updateHighlight();
      }
    };

    let downAt = 0;
    let downPoint = { x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => {
      downAt = performance.now();
      downPoint = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event: PointerEvent) => {
      const moved = Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y);
      if (moved > 6 || performance.now() - downAt > 550) return;
      const id = intersect(event);
      setSelectedId(id);
      selectedRef.current = id;
      controls.autoRotate = false;
      updateHighlight();
      if (id) {
        const target = positions.get(id);
        if (target) {
          controls.target.lerp(target, 0.45);
          camera.position.lerp(target.clone().add(new THREE.Vector3(4.4, 3.2, 7.5)), 0.4);
        }
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    const animate = () => {
      frame = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      if (!pausedRef.current) {
        world.position.y = Math.sin(t * 0.24) * 0.55;
        world.rotation.y += 0.00038;
      }
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      nodeGeometry.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      for (const mesh of meshesRef.current.values()) (mesh.material as THREE.Material).dispose();
      for (const sprite of labelsRef.current.values()) {
        const material = sprite.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
      }
      renderer.dispose();
      container.removeChild(renderer.domElement);
      meshesRef.current.clear();
      layoutPositionsRef.current.clear();
      labelsRef.current.clear();
      controlsRef.current = null;
    };
  }, [data, nodeName]);

  useEffect(() => {
    selectedRef.current = selectedId;
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    const target = selectedId ? layoutPositionsRef.current.get(selectedId) : null;
    if (controls && target) {
      controls.autoRotate = false;
      controls.target.lerp(target, 0.5);
      camera?.position.lerp(target.clone().add(new THREE.Vector3(4.4, 3.2, 7.5)), 0.42);
    } else if (controls) {
      controls.autoRotate = !paused;
    }
    highlightRef.current();
  }, [paused, selectedId]);

  const resetView = () => {
    setSelectedId(null);
    const controls = controlsRef.current;
    const camera = cameraRef.current;
    if (controls && camera) {
      controls.target.set(0, 0, 0);
      camera.position.set(11, 7, 23);
      controls.autoRotate = true;
    }
  };

  const search = (value: string) => {
    setKeyword(value);
    const query = value.trim().toLowerCase();
    if (!query) return;
    const hit = data.nodes.find(
      (n) => n.name.toLowerCase().includes(query) || n.tags.some((tag) => tag.toLowerCase().includes(query)),
    );
    if (hit) {
      setSelectedId(hit.id);
    }
  };

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-2xl bg-ink-900/25">
      <div ref={containerRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute left-4 top-4 z-10">
        <div className="pointer-events-auto max-w-[min(88vw,360px)] rounded-xl border border-white/10 bg-black/35 px-3 py-2 backdrop-blur">
          <div className="text-sm font-semibold text-slate-100">三维悬浮知识图谱</div>
          <div className="mt-0.5 text-[11px] text-slate-400">
            {data.nodes.length} 个知识节点 · {data.links.length} 条关系 · 数据增加自动展开
          </div>
        </div>
      </div>

      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <input
          className="w-40 rounded-lg border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-slate-100 outline-none backdrop-blur placeholder:text-slate-500 focus:border-royal-500/60"
          placeholder="搜索知识节点"
          value={keyword}
          onChange={(e) => search(e.target.value)}
        />
        <button
          className="rounded-lg border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-slate-200 backdrop-blur transition hover:bg-white/10"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? '继续浮动' : '暂停浮动'}
        </button>
        <button
          className="rounded-lg border border-white/10 bg-black/45 px-3 py-1.5 text-xs text-slate-200 backdrop-blur transition hover:bg-white/10"
          onClick={resetView}
        >
          重置视角
        </button>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[min(92vw,560px)]">
        <div className="pointer-events-auto flex flex-wrap gap-1.5">
          {categories.slice(0, 10).map((c) => (
            <span
              key={c.name}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-slate-300 backdrop-blur"
            >
              <i className="h-2 w-2 rounded-full" style={{ background: c.color }} />
              {c.name} {c.count}
            </span>
          ))}
          {Object.entries(RELATION_COLORS).map(([name, color]) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-slate-400 backdrop-blur"
            >
              <i className="h-0.5 w-4" style={{ background: color }} />
              {name}
            </span>
          ))}
        </div>
      </div>

      {selected && (
        <aside className="absolute bottom-4 right-4 z-20 max-h-[min(74vh,560px)] w-[min(92vw,340px)] overflow-y-auto rounded-2xl border border-white/10 bg-ink-800/85 p-4 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-royal-400">{selected.category}</div>
              <h3 className="mt-1 truncate text-base font-semibold text-slate-100">{selected.name}</h3>
            </div>
            <button className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200" onClick={() => setSelectedId(null)}>
              关闭
            </button>
          </div>

          {selected.image && (
            <img src={selected.image} alt={selected.name} className="mt-3 max-h-44 w-full rounded-xl object-cover" />
          )}

          <p className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{selected.detail}</p>

          {selected.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selected.tags.map((tag) => (
                <span key={tag} className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-white/10 pt-3">
            <div className="mb-2 text-xs font-medium text-slate-300">关系 {relatedLinks.length}</div>
            <div className="space-y-2">
              {relatedLinks.slice(0, 18).map((link, index) => {
                const other = link.source === selected.id ? nodeName.get(link.target) : nodeName.get(link.source);
                return (
                  <div key={`${link.source}-${link.target}-${link.relationType}-${index}`} className="rounded-lg bg-white/5 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-slate-200">{other?.name ?? link.source}</span>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                        style={{ color: RELATION_COLORS[link.relationType], background: `${RELATION_COLORS[link.relationType]}1a` }}
                      >
                        {link.relationType}
                      </span>
                    </div>
                    {link.description && <div className="mt-1 text-[11px] text-slate-400">{link.description}</div>}
                  </div>
                );
              })}
              {relatedLinks.length > 18 && <div className="text-[11px] text-slate-500">其余 {relatedLinks.length - 18} 条关系已折叠。</div>}
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
