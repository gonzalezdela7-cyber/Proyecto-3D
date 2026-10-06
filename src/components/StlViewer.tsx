import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { RotateCcw, Box, Grid, Eye } from 'lucide-react';

export interface StlMeshDiagnostics {
  analyzed: boolean;
  triangleCount: number;
  vertexCount: number;
  isManifold: boolean;
  hasInvertedFaces: boolean;
  needsRepair: boolean;
  openEdges: number;
  nonManifoldEdges: number;
  invertedNormalEdges: number;
  invertedFileNormals: number;
  degenerateTriangles: number;
  globallyInvertedNormals: boolean;
  exactMeshVolumeCm3: number;
  statusTitle: string;
  summaryMessage: string;
  issues: string[];
}

export interface StlDimensions {
  widthMm: number;
  heightMm: number;
  depthMm: number;
  volumeCm3: number;
  isCustomStl: boolean;
  label: string;
  diagnostics?: StlMeshDiagnostics;
}

interface StlViewerProps {
  stlBuffer: ArrayBuffer | null;
  fileName: string | null;
  onDimensionsCalculated: (dims: StlDimensions) => void;
  onResetToDefault: () => void;
}

/**
 * Performs topological and geometric validation on a parsed STL BufferGeometry:
 * 1. Checks if the mesh is watertight / manifold (0 open boundary edges, 0 non-manifold edges).
 * 2. Detects inverted faces/normals (adjacent faces with conflicting winding order on shared edges,
 *    stored normals pointing opposite to right-hand rule winding, or negative signed volume).
 * 3. Detects degenerate (zero-area) triangles.
 */
export function analyzeStlGeometry(geometry: THREE.BufferGeometry): StlMeshDiagnostics {
  const posAttr = geometry.getAttribute('position');
  const normAttr = geometry.getAttribute('normal');

  if (!posAttr || posAttr.count < 3) {
    return {
      analyzed: true,
      triangleCount: 0,
      vertexCount: 0,
      isManifold: false,
      hasInvertedFaces: false,
      needsRepair: true,
      openEdges: 0,
      nonManifoldEdges: 0,
      invertedNormalEdges: 0,
      invertedFileNormals: 0,
      degenerateTriangles: 0,
      globallyInvertedNormals: false,
      exactMeshVolumeCm3: 0,
      statusTitle: 'Geometría STL vacía o incompleta',
      summaryMessage: 'El archivo STL no contiene suficientes triángulos válidos y requiere reparación antes de la fabricación.',
      issues: ['El modelo contiene menos de 4 caras triangulares.'],
    };
  }

  const triCount = Math.floor(posAttr.count / 3);
  const vertexMap = new Map<string, number>();
  let nextVertexId = 0;

  // Map undirected edge key ("minId_maxId") -> { forward: count (min->max), backward: count (max->min) }
  const edgeMap = new Map<string, { forward: number; backward: number }>();

  let degenerateTriangles = 0;
  let invertedFileNormals = 0;
  let signedVolumeMm3 = 0;

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edgeAB = new THREE.Vector3();
  const edgeAC = new THREE.Vector3();
  const crossVec = new THREE.Vector3();
  const fileNorm = new THREE.Vector3();
  const crossBC = new THREE.Vector3();

  const getVertexId = (vec: THREE.Vector3): number => {
    const qx = Math.round(vec.x * 10000);
    const qy = Math.round(vec.y * 10000);
    const qz = Math.round(vec.z * 10000);
    const key = `${qx}_${qy}_${qz}`;
    const existing = vertexMap.get(key);
    if (existing !== undefined) return existing;
    const id = nextVertexId++;
    vertexMap.set(key, id);
    return id;
  };

  const addDirectedEdge = (u: number, v: number) => {
    const minId = u < v ? u : v;
    const maxId = u < v ? v : u;
    const key = `${minId}_${maxId}`;
    let entry = edgeMap.get(key);
    if (!entry) {
      entry = { forward: 0, backward: 0 };
      edgeMap.set(key, entry);
    }
    if (u < v) {
      entry.forward += 1;
    } else {
      entry.backward += 1;
    }
  };

  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    vA.fromBufferAttribute(posAttr, idx);
    vB.fromBufferAttribute(posAttr, idx + 1);
    vC.fromBufferAttribute(posAttr, idx + 2);

    const idA = getVertexId(vA);
    const idB = getVertexId(vB);
    const idC = getVertexId(vC);

    edgeAB.subVectors(vB, vA);
    edgeAC.subVectors(vC, vA);
    crossVec.crossVectors(edgeAB, edgeAC);
    const doubleArea = crossVec.length();

    if (idA === idB || idB === idC || idC === idA || doubleArea < 1e-7) {
      degenerateTriangles += 1;
      continue;
    }

    // Check if the STL file's stored face normal opposes the right-hand rule vertex winding normal
    if (normAttr && normAttr.count > idx) {
      fileNorm.fromBufferAttribute(normAttr, idx);
      if (fileNorm.lengthSq() > 1e-6) {
        const dot = crossVec.clone().normalize().dot(fileNorm.normalize());
        if (dot < -0.15) {
          invertedFileNormals += 1;
        }
      }
    }

    // Signed tetrahedral volume contribution
    crossBC.crossVectors(vB, vC);
    signedVolumeMm3 += vA.dot(crossBC) / 6.0;

    // Register the 3 directed half-edges
    addDirectedEdge(idA, idB);
    addDirectedEdge(idB, idC);
    addDirectedEdge(idC, idA);
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;
  let invertedNormalEdges = 0;

  edgeMap.forEach(({ forward, backward }) => {
    const total = forward + backward;
    if (total === 1) {
      openEdges += 1;
    } else if (total > 2) {
      nonManifoldEdges += 1;
    } else if (total === 2 && (forward === 2 || backward === 2)) {
      // Two triangles share this edge in the exact same direction -> opposite normal orientation!
      invertedNormalEdges += 1;
    }
  });

  const globallyInvertedNormals = openEdges === 0 && nonManifoldEdges === 0 && signedVolumeMm3 < -1e-3;
  const isManifold = openEdges === 0 && nonManifoldEdges === 0 && triCount >= 4;
  const hasInvertedFaces = invertedNormalEdges > 0 || invertedFileNormals > 0 || globallyInvertedNormals;
  const needsRepair = !isManifold || hasInvertedFaces || degenerateTriangles > 0;

  const issues: string[] = [];
  if (openEdges > 0) {
    issues.push(
      `Malla no estanca (abierta): se detectaron ${openEdges} ${
        openEdges === 1 ? 'borde abierto (hueco en la superficie)' : 'bordes abiertos (huecos o superficies sin cerrar)'
      }.`
    );
  }
  if (nonManifoldEdges > 0) {
    issues.push(
      `Topología no-manifold: ${nonManifoldEdges} ${
        nonManifoldEdges === 1 ? 'arista compartida' : 'aristas compartidas'
      } por más de 2 caras (paredes internas o autointersecciones).`
    );
  }
  if (invertedNormalEdges > 0) {
    issues.push(
      `Caras invertidas detectadas: ${invertedNormalEdges} ${
        invertedNormalEdges === 1
          ? 'arista presenta orientación opuesta entre caras adyacentes'
          : 'aristas presentan orientación opuesta (winding invertido) entre caras adyacentes'
      }.`
    );
  }
  if (invertedFileNormals > 0) {
    issues.push(
      `Normales invertidas en archivo: ${invertedFileNormals} ${
        invertedFileNormals === 1 ? 'cara tiene su vector normal invertido' : 'caras tienen vectores normales invertidos'
      } respecto al orden de sus vértices.`
    );
  }
  if (globallyInvertedNormals) {
    issues.push(
      'Volumen con signo negativo: todas las caras del sólido apuntan hacia el interior (normales globalmente invertidas).'
    );
  }
  if (degenerateTriangles > 0) {
    issues.push(
      `Triángulos degenerados: ${degenerateTriangles} ${
        degenerateTriangles === 1 ? 'cara con área nula' : 'caras con área nula o vértices colapsados'
      }.`
    );
  }

  const exactMeshVolumeCm3 = Math.abs(signedVolumeMm3) / 1000;

  const statusTitle = needsRepair
    ? 'Aviso Técnico: El archivo STL requiere reparación antes de la fabricación'
    : 'Validación Geométrica Superada: Malla Estanca (Manifold) y Normales Correctas';

  const summaryMessage = needsRepair
    ? 'El análisis topológico ha detectado errores de estanqueidad (no-manifold) o caras invertidas. Nuestro equipo técnico puede reparar la malla o puedes corregirla en tu software CAD antes del laminado.'
    : `Malla cerrada 100% estanca (${triCount.toLocaleString('es-ES')} triángulos y ${nextVertexId.toLocaleString(
        'es-ES'
      )} vértices soldados) sin bordes abiertos ni caras invertidas. Lista para fabricación.`;

  return {
    analyzed: true,
    triangleCount: triCount,
    vertexCount: nextVertexId,
    isManifold,
    hasInvertedFaces,
    needsRepair,
    openEdges,
    nonManifoldEdges,
    invertedNormalEdges,
    invertedFileNormals,
    degenerateTriangles,
    globallyInvertedNormals,
    exactMeshVolumeCm3,
    statusTitle,
    summaryMessage,
    issues,
  };
}

export default function StlViewer({
  stlBuffer,
  fileName,
  onDimensionsCalculated,
  onResetToDefault,
}: StlViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);

  const [wireframe, setWireframe] = useState<boolean>(false);
  const [webglLost, setWebglLost] = useState<boolean>(false);

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 380;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111118);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(50, 50, 70);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
    } catch {
      setWebglLost(true);
      return;
    }

    const canvas = renderer.domElement;
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const handleContextRestored = () => {
      setWebglLost(false);
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // GridHelper (80, 16, 0x17a2b8, 0x333333)
    const gridHelper = new THREE.GridHelper(80, 16, 0x17a2b8, 0x333333);
    scene.add(gridHelper);

    // Three-point studio lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight1.position.set(1, 1, 1).normalize();
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x0056b3, 0.4);
    dirLight2.position.set(-1, -1, -1).normalize();
    scene.add(dirLight2);

    // Default 25x25x25mm Cube
    const geometry = new THREE.BoxGeometry(25, 25, 25);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0056b3,
      roughness: 0.3,
      metalness: 0.2,
    });
    const defaultMesh = new THREE.Mesh(geometry, material);
    defaultMesh.position.y = 12.5;
    scene.add(defaultMesh);
    meshRef.current = defaultMesh;
    controls.target.set(0, 12.5, 0);
    controls.update();

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const newW = container.clientWidth;
      const newH = container.clientHeight;
      if (newW > 0 && newH > 0) {
        cameraRef.current.aspect = newW / newH;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(newW, newH);
      }
    });
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Load STL geometry when stlBuffer changes, or restore default 25x25x25 cube
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (meshRef.current) {
      scene.remove(meshRef.current);
      meshRef.current.geometry.dispose();
      if (Array.isArray(meshRef.current.material)) {
        meshRef.current.material.forEach((m) => m.dispose());
      } else {
        meshRef.current.material.dispose();
      }
      meshRef.current = null;
    }

    if (!stlBuffer) {
      const geometry = new THREE.BoxGeometry(25, 25, 25);
      const material = new THREE.MeshStandardMaterial({
        color: 0x0056b3,
        roughness: 0.3,
        metalness: 0.2,
        wireframe,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = 12.5;
      scene.add(mesh);
      meshRef.current = mesh;

      camera.position.set(50, 50, 70);
      camera.lookAt(0, 12.5, 0);
      controls.target.set(0, 12.5, 0);
      controls.update();

      onDimensionsCalculated({
        widthMm: 25,
        heightMm: 25,
        depthMm: 25,
        volumeCm3: 0,
        isCustomStl: false,
        label: 'Modelo geométrico de prueba. Carga tu archivo .STL para calcular dimensiones volumétricas.',
        diagnostics: undefined,
      });
      return;
    }

    try {
      const loader = new STLLoader();
      const geometry = loader.parse(stlBuffer);

      // Run manifold & inverted-face diagnostics BEFORE computeVertexNormals overwrites raw STL normals
      const diagnostics = analyzeStlGeometry(geometry);

      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: diagnostics.needsRepair ? 0xd97706 : 0x17a2b8,
        roughness: 0.3,
        metalness: 0.2,
        side: THREE.DoubleSide,
        wireframe,
      });
      const mesh = new THREE.Mesh(geometry, material);

      geometry.computeBoundingBox();
      const bbox = geometry.boundingBox;
      const size = new THREE.Vector3(25, 25, 25);
      if (bbox) {
        bbox.getSize(size);
      }

      geometry.center();
      mesh.position.y = size.y / 2;
      scene.add(mesh);
      meshRef.current = mesh;

      const maxDim = Math.max(size.x, size.y, size.z, 10);
      camera.position.set(maxDim * 1.5, maxDim * 1.5, maxDim * 2);
      camera.lookAt(0, size.y / 2, 0);
      controls.target.set(0, size.y / 2, 0);
      controls.update();

      const volumeCm3 = (size.x * size.y * size.z) / 1000;
      const dimLabel = `Pieza STL cargada: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(
        1
      )} mm (Volumen aprox: ${volumeCm3.toFixed(1)} cm³)`;

      onDimensionsCalculated({
        widthMm: size.x,
        heightMm: size.y,
        depthMm: size.z,
        volumeCm3,
        isCustomStl: true,
        label: dimLabel,
        diagnostics,
      });
    } catch (err) {
      console.error('Error al procesar el archivo STL:', err);
    }
  }, [stlBuffer]);

  // Toggle wireframe on active mesh
  useEffect(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    if (mat) {
      mat.wireframe = wireframe;
      mat.needsUpdate = true;
    }
  }, [wireframe]);

  const handleResetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const mesh = meshRef.current;
    if (!camera || !controls || !mesh) return;

    mesh.geometry.computeBoundingBox();
    const bbox = mesh.geometry.boundingBox;
    const size = new THREE.Vector3(30, 30, 30);
    if (bbox) bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 10);

    camera.position.set(maxDim * 1.5, maxDim * 1.5, maxDim * 2);
    camera.lookAt(0, size.y / 2, 0);
    controls.target.set(0, size.y / 2, 0);
    controls.update();
  };

  return (
    <div className="flex flex-col">
      {/* Cabecera del Visor 3D */}
      <div className="bg-[#1a1a1a] text-white px-4 py-2.5 rounded-t-md flex items-center justify-between gap-2 text-xs sm:text-sm font-bold">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-[#17a2b8] shrink-0" />
          <span>Visor 3D Interactivo</span>
        </div>
        <span id="viewer-status" className="text-xs font-mono-tabular text-[#17a2b8] truncate max-w-[220px]">
          {fileName || 'Modelo de prueba'}
        </span>
      </div>

      {/* Contenedor Canvas Three.js (#canvas-container) */}
      <div className="relative w-full h-[380px] bg-[#111118] rounded-b-md overflow-hidden border-x border-b border-slate-300">
        <div id="canvas-container" ref={containerRef} className="w-full h-full" />

        {webglLost && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#111118] text-slate-300 text-xs">
            <Box className="w-8 h-8 text-[#17a2b8] mb-2" />
            <p className="font-semibold">Vista previa 3D en espera</p>
            <p className="text-slate-400 mt-1">
              El contexto WebGL no está disponible en este dispositivo, pero el cálculo de presupuesto sigue activo.
            </p>
          </div>
        )}

        {/* Controles HUD flotantes sobre el lienzo 3D */}
        <div className="absolute bottom-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="px-2.5 py-1 rounded bg-black/55 backdrop-blur-xs border border-white/10 text-[11px] text-neutral-300">
            Rotación: Clic + Arrastrar · Zoom: Rueda
          </div>

          <div className="flex items-center gap-1.5 pointer-events-auto">
            <button
              type="button"
              onClick={() => setWireframe((prev) => !prev)}
              className="px-2.5 py-1 rounded bg-black/65 hover:bg-black/85 border border-white/15 text-[11px] font-semibold text-white flex items-center gap-1 cursor-pointer transition-colors"
              title="Alternar vista de malla (Wireframe)"
            >
              <Grid className="w-3 h-3 text-[#17a2b8]" />
              <span>{wireframe ? 'Sólido' : 'Malla'}</span>
            </button>

            <button
              type="button"
              onClick={handleResetCamera}
              className="px-2.5 py-1 rounded bg-black/65 hover:bg-black/85 border border-white/15 text-[11px] font-semibold text-white flex items-center gap-1 cursor-pointer transition-colors"
              title="Centrar cámara"
            >
              <Eye className="w-3 h-3 text-[#17a2b8]" />
              <span>Centrar</span>
            </button>

            {stlBuffer && (
              <button
                type="button"
                onClick={onResetToDefault}
                className="px-2.5 py-1 rounded bg-black/65 hover:bg-black/85 border border-white/15 text-[11px] font-semibold text-amber-300 flex items-center gap-1 cursor-pointer transition-colors"
                title="Volver al cubo de prueba 25x25x25 mm"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Cubo 25mm</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
