/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  Calculator,
  CheckCircle2,
  Download,
  FileCode2,
  Printer,
  RotateCcw,
  Send,
  Trash2,
  AlertCircle,
  Plus,
  Minus,
  ArrowRight,
  Copy,
  Check,
  BarChart3,
  Clock,
  Building2,
  MessageSquare,
  X,
  MapPin,
  Phone,
  Mail,
  Globe,
  ChevronDown,
  Box,
  PieChart as PieChartIcon,
  History,
  RefreshCw,
  LogIn,
  LogOut,
  Cloud,
} from 'lucide-react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import {
  db,
  auth,
  initAuth,
  signInWithGoogle,
  signOutUser,
  handleFirestoreError,
  OperationType,
} from './firebase';
import WorkspaceIntegrationPanel, { GoogleSignInButton } from './components/WorkspaceIntegrationPanel';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import * as THREE from 'three';

import StlViewer, { StlDimensions } from './components/StlViewer';
import heroImg from './assets/images/hero_additive_manufacturing_1791193456567.jpg';
import prototypingImg from './assets/images/service_prototyping_cad_1791193473863.jpg';
import batchImg from './assets/images/service_batch_production_1791193485971.jpg';

interface ServiceOption {
  id: string;
  label: string;
  multiplier: number;
  leadTime: string;
  technology: string;
  description: string;
}

interface MaterialOption {
  id: string;
  label: string;
  shortName: string;
  multiplier: number;
  specs: string;
  tolerance: string;
}

interface ComplexityOption {
  id: string;
  label: string;
  multiplier: number;
  details: string;
}

interface PlazoOption {
  id: string;
  label: string;
  multiplier: number;
  details: string;
}

interface SavedEstimate {
  id: string;
  timestamp: string;
  lastModifiedAt: string;
  lastLoadedAt: string | null;
  modificationCount: number;
  loadCount: number;
  referenceCode: string;
  nombre: string;
  empresa: string;
  email: string;
  telefono: string;
  servicioLabel: string;
  servicioValue: number;
  cantidad: number;
  materialLabel: string;
  materialValue: number;
  complejidadLabel: string;
  complejidadValue: number;
  plazoLabel: string;
  plazoValue: number;
  volumeCm3: number;
  factorTamano: number;
  dimensionsSummary: string;
  observaciones: string;
  fileName?: string;
  unitPrice: number;
  totalPrice: number;
}

interface EstimateHistoryEvent {
  id: string;
  estimateId: string;
  referenceCode: string;
  action: 'created' | 'modified' | 'loaded' | 'deleted';
  actionLabel: string;
  timestamp: string;
  summary: string;
}

interface FormValidationError {
  fieldId: string;
  fieldLabel: string;
  message: string;
}

interface ChatMessage {
  id: string;
  sender: 'bot' | 'user';
  text: string;
}

const TARIFA_BASE = 20.0;

// Helper to create an in-memory binary STL buffer from any Three.js BufferGeometry
// so users can test STL parsing and bounding-box volume calculation with 1 click
function createBinaryStlFromGeometry(geometry: THREE.BufferGeometry): ArrayBuffer {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const posAttr = nonIndexed.getAttribute('position');
  const triCount = Math.floor(posAttr.count / 3);
  const bufferLength = 84 + triCount * 50;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  view.setUint32(80, triCount, true);

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    pA.fromBufferAttribute(posAttr, idx);
    pB.fromBufferAttribute(posAttr, idx + 1);
    pC.fromBufferAttribute(posAttr, idx + 2);

    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab).normalize();

    view.setFloat32(offset, cb.x, true);
    view.setFloat32(offset + 4, cb.y, true);
    view.setFloat32(offset + 8, cb.z, true);

    view.setFloat32(offset + 12, pA.x, true);
    view.setFloat32(offset + 16, pA.y, true);
    view.setFloat32(offset + 20, pA.z, true);

    view.setFloat32(offset + 24, pB.x, true);
    view.setFloat32(offset + 28, pB.y, true);
    view.setFloat32(offset + 32, pB.z, true);

    view.setFloat32(offset + 36, pC.x, true);
    view.setFloat32(offset + 40, pC.y, true);
    view.setFloat32(offset + 44, pC.z, true);

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  return arrayBuffer;
}

// Helper to create a defective STL buffer (missing 1 face -> open non-manifold edges, plus 2 faces with inverted winding/normals)
function createDefectiveBinaryStlSample(): ArrayBuffer {
  const box = new THREE.BoxGeometry(35, 25, 20);
  const nonIndexed = box.index ? box.toNonIndexed() : box;
  const posAttr = nonIndexed.getAttribute('position');
  const fullTriCount = Math.floor(posAttr.count / 3);
  // Omit the last triangle so the mesh is open (non-manifold / not watertight)
  const triCount = Math.max(1, fullTriCount - 1);
  const bufferLength = 84 + triCount * 50;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  view.setUint32(80, triCount, true);

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();
  const pC = new THREE.Vector3();
  const cb = new THREE.Vector3();
  const ab = new THREE.Vector3();

  let offset = 84;
  for (let i = 0; i < triCount; i++) {
    const idx = i * 3;
    pA.fromBufferAttribute(posAttr, idx);
    pB.fromBufferAttribute(posAttr, idx + 1);
    pC.fromBufferAttribute(posAttr, idx + 2);

    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab).normalize();

    // Intentionally invert winding and normal on triangles 0 and 2 to simulate inverted faces
    const invertFace = i === 0 || i === 2;
    const nX = invertFace ? -cb.x : cb.x;
    const nY = invertFace ? -cb.y : cb.y;
    const nZ = invertFace ? -cb.z : cb.z;

    view.setFloat32(offset, nX, true);
    view.setFloat32(offset + 4, nY, true);
    view.setFloat32(offset + 8, nZ, true);

    if (invertFace) {
      // Swap pB and pC so adjacent edge traversal conflicts with neighboring triangles
      view.setFloat32(offset + 12, pA.x, true);
      view.setFloat32(offset + 16, pA.y, true);
      view.setFloat32(offset + 20, pA.z, true);

      view.setFloat32(offset + 24, pC.x, true);
      view.setFloat32(offset + 28, pC.y, true);
      view.setFloat32(offset + 32, pC.z, true);

      view.setFloat32(offset + 36, pB.x, true);
      view.setFloat32(offset + 40, pB.y, true);
      view.setFloat32(offset + 44, pB.z, true);
    } else {
      view.setFloat32(offset + 12, pA.x, true);
      view.setFloat32(offset + 16, pA.y, true);
      view.setFloat32(offset + 20, pA.z, true);

      view.setFloat32(offset + 24, pB.x, true);
      view.setFloat32(offset + 28, pB.y, true);
      view.setFloat32(offset + 32, pB.z, true);

      view.setFloat32(offset + 36, pC.x, true);
      view.setFloat32(offset + 40, pC.y, true);
      view.setFloat32(offset + 44, pC.z, true);
    }

    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }

  box.dispose();
  return arrayBuffer;
}

// 6 Servicios oficiales de la sección #servicios
const SERVICIOS_CATALOGO = [
  {
    index: '01',
    title: 'Prototipado 3D',
    description:
      'Creación de prototipos físicos a partir de una idea o modelo digital para comprobar dimensiones, forma, funcionamiento o apariencia antes de la fabricación definitiva.',
    calcMultiplier: 1.0,
  },
  {
    index: '02',
    title: 'Diseño y Modelado 3D',
    description:
      'Desarrollo o adaptación de modelos tridimensionales optimizados para fabricación digital o representación visual.',
    calcMultiplier: 1.2,
  },
  {
    index: '03',
    title: 'Impresión 3D',
    description:
      'Fabricación directa de piezas mediante tecnología 3D adaptada a los requisitos dimensionales y mecánicos de tu proyecto.',
    calcMultiplier: 1.1,
  },
  {
    index: '04',
    title: 'Piezas Personalizadas',
    description:
      'Soluciones a medida para necesidades concretas de clientes particulares, profesionales e industria.',
    calcMultiplier: 1.3,
  },
  {
    index: '05',
    title: 'Maquetas y Modelos',
    description:
      'Desarrollo de modelos físicos para presentación, demostración comercial o validación de diseño.',
    calcMultiplier: 1.2,
  },
  {
    index: '06',
    title: 'Pequeñas Series',
    description:
      'Fabricación de varias unidades de una misma pieza, previa revisión técnica de viabilidad.',
    calcMultiplier: 0.9,
  },
];

// 7 Pasos del Proceso de Trabajo (#proceso)
const PROCESO_PASOS = [
  { step: 1, title: 'Consulta', desc: 'Exposición de la idea o proyecto.' },
  { step: 2, title: 'Recepción', desc: 'Aportación de planos, fotos o 3D.' },
  { step: 3, title: 'Análisis', desc: 'Revisión técnica de viabilidad.' },
  { step: 4, title: 'Presupuesto', desc: 'Estimación o valoración técnica.' },
  { step: 5, title: 'Confirmación', desc: 'Aprobación de condiciones.' },
  { step: 6, title: 'Fabricación', desc: 'Prototipado e impresión 3D.' },
  { step: 7, title: 'Entrega', desc: 'Coordinación de recogida o envío.' },
];

// 6. Galería de Trabajos Filtrable por Cliente (#galeria)
interface PortfolioItem {
  id: string;
  category: 'empresas' | 'emprendedores' | 'ingenieria' | 'particulares';
  badge: string;
  title: string;
  description: string;
  presetServicio: number;
  presetMaterial: number;
  presetComplejidad: number;
}

const PORTFOLIO_ITEMS: PortfolioItem[] = [
  {
    id: 'port-empresas',
    category: 'empresas',
    badge: 'EMPRESAS',
    title: 'Carcasa Electrónica Industrial',
    description: 'Fabricación de prototipo funcional para validación de montaje interno de componentes.',
    presetServicio: 1.0,
    presetMaterial: 1.5,
    presetComplejidad: 1.4,
  },
  {
    id: 'port-emprendedores',
    category: 'emprendedores',
    badge: 'EMPRENDEDORES',
    title: 'Modelo de Validación MVP',
    description: 'Transformación de boceto inicial en primer modelo físico para presentación comercial.',
    presetServicio: 1.2,
    presetMaterial: 1.0,
    presetComplejidad: 1.4,
  },
  {
    id: 'port-ingenieria',
    category: 'ingenieria',
    badge: 'DISEÑO E INGENIERÍA',
    title: 'Pieza Mecánica de Precisión',
    description: 'Modelado y producción de componente mecánico con tolerancias de acoplamiento ajustadas.',
    presetServicio: 1.3,
    presetMaterial: 1.5,
    presetComplejidad: 1.8,
  },
  {
    id: 'port-particulares',
    category: 'particulares',
    badge: 'PARTICULARES',
    title: 'Repuesto Descatalogado',
    description: 'Reconstrucción tridimensional y duplicado físico de pieza dañada sin sustituto comercial.',
    presetServicio: 1.3,
    presetMaterial: 1.0,
    presetComplejidad: 1.4,
  },
];

// 5 Preguntas Frecuentes oficiales (#faq)
const FAQ_ITEMS = [
  {
    question: '¿Dónde está ubicado Project 3D?',
    answer:
      'Nos encontramos en la Avenida de los Trabajadores, 20, en el Polígono Industrial La Atalaya de Torrijos (Toledo), justo frente al Vivero de Empresas Manuel Díaz Ruiz.',
  },
  {
    question: '¿Cómo puedo pedir un presupuesto?',
    answer:
      'Puedes utilizar la calculadora online con Visor 3D disponible en esta web. Si dispones de modelo STL, puedes cargarlo directamente para medir sus dimensiones y volumen aproximado.',
  },
  {
    question: '¿El precio indicado por la calculadora online es definitivo?',
    answer:
      'No. La calculadora proporciona una estimación orientativa. El precio definitivo siempre se confirma tras la revisión técnica del archivo y los requisitos del proyecto.',
  },
  {
    question: '¿Puedo llevar una idea si aún no la tengo diseñada en 3D?',
    answer:
      'Sí, podemos analizar tu idea. La disponibilidad de los servicios de diseño y modelado 3D se confirmará según las características específicas que requiera tu caso.',
  },
  {
    question: '¿Fabricáis pequeñas series de piezas?',
    answer:
      'Sí, es posible plantear la fabricación de varias unidades de una misma pieza mediante pequeñas series, sujetas siempre a verificación técnica de viabilidad.',
  },
];

// Opciones de la Calculadora con Visor 3D
const SERVICIOS_CALC: ServiceOption[] = [
  {
    id: 'prototipado',
    label: 'Prototipado 3D',
    multiplier: 1.0,
    leadTime: '24–48 horas laborables',
    technology: 'FDM Industrial / SLA Rápido',
    description: 'Validación geométrica, pruebas de encaje y verificación ergonómica.',
  },
  {
    id: 'diseno',
    label: 'Diseño y modelado 3D',
    multiplier: 1.2,
    leadTime: '3–5 días laborables',
    technology: 'CAD Paramétrico + Impresión Test',
    description: 'Desarrollo o adaptación de modelos 3D optimizados para fabricación.',
  },
  {
    id: 'impresion',
    label: 'Impresión 3D',
    multiplier: 1.1,
    leadTime: '24–72 horas laborables',
    technology: 'FDM / SLA / SLS',
    description: 'Fabricación directa a partir de tu archivo STL verificado.',
  },
  {
    id: 'personalizada',
    label: 'Pieza personalizada',
    multiplier: 1.3,
    leadTime: '3–5 días laborables',
    technology: 'Fabricación a Medida + Ajuste',
    description: 'Soluciones a medida para repuestos, utillajes o necesidades específicas.',
  },
  {
    id: 'serie',
    label: 'Pequeña serie',
    multiplier: 0.9,
    leadTime: '4–7 días laborables',
    technology: 'Producción por Lotes Cortos',
    description: 'Fabricación de varias unidades de una misma pieza con factor optimizado.',
  },
];

const MATERIALES: MaterialOption[] = [
  {
    id: 'estandar',
    label: 'Estándar (Pendiente de confirmar)',
    shortName: 'Estándar',
    multiplier: 1.0,
    specs: 'Polímero técnico estándar para prototipos y piezas funcionales',
    tolerance: '±0.20 mm',
  },
  {
    id: 'avanzado',
    label: 'Avanzado / Técnico (Pendiente de confirmar)',
    shortName: 'Avanzado / Técnico',
    multiplier: 1.5,
    specs: 'Resina o polímero técnico de mayor exigencia mecánica',
    tolerance: '±0.08 mm',
  },
];

const COMPLEJIDADES: ComplexityOption[] = [
  {
    id: 'baja',
    label: 'Baja',
    multiplier: 1.0,
    details: 'Geometría prismática simple y mínimo soporte.',
  },
  {
    id: 'media',
    label: 'Media',
    multiplier: 1.4,
    details: 'Voladizos moderados, alojamientos o encajes mecánicos.',
  },
  {
    id: 'alta',
    label: 'Alta',
    multiplier: 1.8,
    details: 'Geometría compleja, cavidades internas o tolerancias exigentes.',
  },
];

const PLAZOS: PlazoOption[] = [
  {
    id: 'normal',
    label: 'Normal',
    multiplier: 1.0,
    details: 'Planificación habitual según carga de trabajo.',
  },
  {
    id: 'urgente',
    label: 'Urgente',
    multiplier: 1.3,
    details: 'Prioridad inmediata tras validación técnica.',
  },
  {
    id: 'fecha_deseada',
    label: 'Fecha determinada',
    multiplier: 1.1,
    details: 'Entrega en fecha objetivo (indicar en observaciones).',
  },
];

function getBotResponse(rawInput: string): string {
  const input = rawInput
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Prohibición absoluta: horarios, apertura sábados, catálogo exacto de materiales, maquinaria, precios definitivos, plazos garantizados o empleados
  if (
    input.includes('horario') ||
    input.includes('sabado') ||
    input.includes('domingo') ||
    input.includes('abris') ||
    input.includes('abren') ||
    input.includes('abierto') ||
    input.includes('cerrado') ||
    input.includes('impresora') ||
    input.includes('maquinaria') ||
    input.includes('marca') ||
    input.includes('pla') ||
    input.includes('abs') ||
    input.includes('petg') ||
    input.includes('nylon') ||
    input.includes('tpu') ||
    input.includes('carbono') ||
    input.includes('metal') ||
    input.includes('material especifico') ||
    input.includes('catalogo') ||
    input.includes('precio exacto') ||
    input.includes('precio definitivo') ||
    input.includes('cuanto vale esta pieza') ||
    input.includes('empleado') ||
    input.includes('quien trabaja') ||
    input.includes('plazo garantizado') ||
    input.includes('cuantos dias tardais')
  ) {
    return 'Esa información requiere evaluación técnica y está pendiente de confirmar. Por favor, contacta con nosotros en info@project3d.es o en el 925 76 38 42 para que estudiemos tu caso particular';
  }

  if (
    input.includes('donde') ||
    input.includes('ubicacion') ||
    input.includes('direccion') ||
    input.includes('torrijos') ||
    input.includes('toledo') ||
    input.includes('donde estais') ||
    input.includes('poligono') ||
    input.includes('atalaya')
  ) {
    return 'Estamos ubicados en la Avenida de los Trabajadores, 20, en el Polígono Industrial La Atalaya, 45500 Torrijos, Toledo (justo frente al Vivero de Empresas Manuel Díaz Ruiz). Te animamos a solicitar presupuesto en la web o a contactar con nosotros si deseas visitarnos.';
  } else if (
    input.includes('presupuesto') ||
    input.includes('precio') ||
    input.includes('cuanto cuesta') ||
    input.includes('calculadora') ||
    input.includes('estimacion') ||
    input.includes('visor') ||
    input.includes('stl')
  ) {
    return 'En esta web ofrecemos estimaciones orientativas mediante nuestra calculadora con Visor 3D. Recuerda que el precio definitivo siempre se confirma tras revisar los archivos y requisitos del proyecto. Puedes solicitar presupuesto ahora mismo o contactar con nosotros en info@project3d.es o en el 925 76 38 42.';
  } else if (
    input.includes('servicio') ||
    input.includes('haceis') ||
    input.includes('que haceis') ||
    input.includes('prototipado') ||
    input.includes('modelado') ||
    input.includes('maqueta') ||
    input.includes('serie')
  ) {
    return 'Nuestros servicios incluyen prototipado 3D, diseño y modelado 3D, impresión 3D, piezas personalizadas, maquetas y pequeñas series. Si tienes un proyecto en mente, te invitamos a solicitar presupuesto o a contactar directamente con nuestro equipo.';
  } else if (
    input.includes('contacto') ||
    input.includes('telefono') ||
    input.includes('email') ||
    input.includes('llamar') ||
    input.includes('correo') ||
    input.includes('web')
  ) {
    return 'Puedes contactar con nosotros en el teléfono 925 76 38 42, en el email info@project3d.es o a través de nuestra web www.project3d.es. También puedes solicitar presupuesto orientativo desde el formulario de esta página.';
  } else if (input.includes('hola') || input.includes('buenos dias') || input.includes('buenas')) {
    return '¡Hola! Soy Project 3D Assistant. Puedo informarte sobre nuestra ubicación en Torrijos, nuestros servicios de prototipado, diseño e impresión 3D, o indicarte cómo solicitar presupuesto y contactar con nosotros. ¿En qué te puedo ayudar?';
  } else {
    return 'Esa información requiere evaluación técnica y está pendiente de confirmar. Por favor, contacta con nosotros en info@project3d.es o en el 925 76 38 42 para que estudiemos tu caso particular';
  }
}

export default function App() {
  // Calculator form state
  const [nombre, setNombre] = useState<string>('');
  const [empresa, setEmpresa] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [emailTouched, setEmailTouched] = useState<boolean>(false);
  const [submissionAttempted, setSubmissionAttempted] = useState<boolean>(false);
  const [telefono, setTelefono] = useState<string>('');
  const [servicio, setServicio] = useState<number>(1.0);
  const [cantidad, setCantidad] = useState<number>(1);
  const [material, setMaterial] = useState<number>(1.0);
  const [complejidad, setComplejidad] = useState<number>(1.0);
  const [plazo, setPlazo] = useState<number>(1.0);
  const [observaciones, setObservaciones] = useState<string>('');

  // STL 3D File & Viewer state
  const [stlBuffer, setStlBuffer] = useState<ArrayBuffer | null>(null);
  const [attachedFile, setAttachedFile] = useState<{ name: string; sizeKB: string; sizeMB: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stlDims, setStlDims] = useState<StlDimensions>({
    widthMm: 25,
    heightMm: 25,
    depthMm: 25,
    volumeCm3: 0,
    isCustomStl: false,
    label: 'Modelo geométrico de prueba. Carga tu archivo .STL para calcular dimensiones volumétricas.',
  });

  // Portfolio filter state (#galeria)
  const [portfolioFilter, setPortfolioFilter] = useState<'all' | 'empresas' | 'emprendedores' | 'ingenieria' | 'particulares'>('all');

  // Result & notification states
  const [resultadoVisible, setResultadoVisible] = useState<boolean>(true);
  const [lastCalculatedAt, setLastCalculatedAt] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<{ type: 'error' | 'success' | 'info'; message: string } | null>(null);
  const [submittedRefCode, setSubmittedRefCode] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // FAQ interactive accordion state
  const [openFaqIndices, setOpenFaqIndices] = useState<number[]>([0, 1, 2, 3, 4]);

  // Chatbot widget state ("Project 3D Assistant")
  const [chatOpen, setChatOpen] = useState<boolean>(false);
  const [chatInput, setChatInput] = useState<string>('');
  const [chatLoading, setChatLoading] = useState<boolean>(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-msg',
      sender: 'bot',
      text: '¡Hola! Soy Project 3D Assistant, el asistente de atención al cliente de Project 3D en Torrijos. ¿En qué puedo ayudarte hoy con tu proyecto 3D?',
    },
  ]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Image fallback states
  const [imgFailed, setImgFailed] = useState<Record<string, boolean>>({});

  // Firebase Auth & Firestore sync state
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [workspaceAccessToken, setWorkspaceAccessToken] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [cloudSynced, setCloudSynced] = useState<boolean>(false);

  // Dual Gmail notification state (User confirmation email + Project 3D team notice to info@project3d.es)
  const [pendingQuoteEmailEntry, setPendingQuoteEmailEntry] = useState<SavedEstimate | null>(null);
  const [sendingQuoteEmails, setSendingQuoteEmails] = useState<boolean>(false);
  const [quoteEmailsStatus, setQuoteEmailsStatus] = useState<{
    status: 'idle' | 'sent' | 'error';
    userEmail?: string;
    teamEmail?: string;
    referenceCode?: string;
    message?: string;
  }>({ status: 'idle' });

  // Saved comparative quotes for the Recharts Comparator
  const [savedEstimates, setSavedEstimates] = useState<SavedEstimate[]>([
    {
      id: 'sample-1',
      timestamp: 'Hoy, 09:15',
      lastModifiedAt: 'Hoy, 09:15:12',
      lastLoadedAt: 'Hoy, 09:40:05',
      modificationCount: 0,
      loadCount: 1,
      referenceCode: 'P3D-8041',
      nombre: 'Carlos Mendoza',
      empresa: 'Talleres Comarca Torrijos S.L.',
      email: 'cmendoza@talleres-ejemplo.es',
      telefono: '925 76 11 00',
      servicioLabel: 'Prototipado 3D',
      servicioValue: 1.0,
      cantidad: 2,
      materialLabel: 'Estándar (Pendiente de confirmar)',
      materialValue: 1.0,
      complejidadLabel: 'Media',
      complejidadValue: 1.4,
      plazoLabel: 'Normal',
      plazoValue: 1.0,
      volumeCm3: 27.0,
      factorTamano: 4.05,
      dimensionsSummary: '30.0 × 30.0 × 30.0 mm (27.0 cm³)',
      observaciones: 'Cubo de calibración y validación de encaje.',
      fileName: 'cubo_calibracion_30mm.stl',
      unitPrice: 85.05,
      totalPrice: 170.1,
    },
    {
      id: 'sample-2',
      timestamp: 'Hoy, 10:05',
      lastModifiedAt: 'Hoy, 10:22:40',
      lastLoadedAt: 'Hoy, 10:18:10',
      modificationCount: 1,
      loadCount: 1,
      referenceCode: 'P3D-8192',
      nombre: 'Elena Vargas',
      empresa: 'Automatismos La Atalaya',
      email: 'evargas@automatismos-toledo.es',
      telefono: '644 219 083',
      servicioLabel: 'Pieza personalizada',
      servicioValue: 1.3,
      cantidad: 2,
      materialLabel: 'Avanzado / Técnico (Pendiente de confirmar)',
      materialValue: 1.5,
      complejidadLabel: 'Alta',
      complejidadValue: 1.8,
      plazoLabel: 'Urgente',
      plazoValue: 1.3,
      volumeCm3: 18.4,
      factorTamano: 2.76,
      dimensionsSummary: '40.0 × 40.0 × 11.5 mm (18.4 cm³)',
      observaciones: 'Corona técnica personalizada de recambio.',
      fileName: 'corona_z24_industrial.stl',
      unitPrice: 188.91,
      totalPrice: 377.82,
    },
    {
      id: 'sample-3',
      timestamp: 'Hoy, 11:30',
      lastModifiedAt: 'Hoy, 11:30:00',
      lastLoadedAt: null,
      modificationCount: 0,
      loadCount: 0,
      referenceCode: 'P3D-8310',
      nombre: 'Miguel Ángel Soto',
      empresa: 'Ingeniería Agroindustrial Toledo',
      email: 'masoto@agro-toledo.es',
      telefono: '678 902 114',
      servicioLabel: 'Pequeña serie',
      servicioValue: 0.9,
      cantidad: 15,
      materialLabel: 'Estándar (Pendiente de confirmar)',
      materialValue: 1.0,
      complejidadLabel: 'Baja',
      complejidadValue: 1.0,
      plazoLabel: 'Normal',
      plazoValue: 1.0,
      volumeCm3: 8.0,
      factorTamano: 1.2,
      dimensionsSummary: '20.0 × 20.0 × 20.0 mm (8.0 cm³)',
      observaciones: 'Serie corta de 15 casquillos separadores.',
      fileName: 'casquillo_20mm.stl',
      unitPrice: 16.2,
      totalPrice: 243.0,
    },
  ]);

  // Currently loaded estimate ID (for modifying an existing saved configuration)
  const [activeLoadedEstimateId, setActiveLoadedEstimateId] = useState<string | null>(null);
  const [historyActionFilter, setHistoryActionFilter] = useState<'all' | 'modified' | 'loaded' | 'created'>('all');
  const [historyRefFilter, setHistoryRefFilter] = useState<string>('all');

  // Chronological log of when each configuration was created, loaded, or modified
  const [changeHistory, setChangeHistory] = useState<EstimateHistoryEvent[]>([
    {
      id: 'hist-4',
      estimateId: 'sample-3',
      referenceCode: 'P3D-8310',
      action: 'created',
      actionLabel: 'Configuración guardada',
      timestamp: 'Hoy, 11:30:00',
      summary: 'Pequeña serie (15 uds.) · Material Estándar · Total: 243.00 €',
    },
    {
      id: 'hist-3',
      estimateId: 'sample-2',
      referenceCode: 'P3D-8192',
      action: 'modified',
      actionLabel: 'Configuración modificada',
      timestamp: 'Hoy, 10:22:40',
      summary: 'Actualizado plazo a Urgente (×1.3) y 2 uds. · Total: 377.82 €',
    },
    {
      id: 'hist-2',
      estimateId: 'sample-2',
      referenceCode: 'P3D-8192',
      action: 'loaded',
      actionLabel: 'Cargada en calculadora',
      timestamp: 'Hoy, 10:18:10',
      summary: 'Parámetros de Elena Vargas cargados para revisión de plazo.',
    },
    {
      id: 'hist-1',
      estimateId: 'sample-1',
      referenceCode: 'P3D-8041',
      action: 'loaded',
      actionLabel: 'Cargada en calculadora',
      timestamp: 'Hoy, 09:40:05',
      summary: 'Parámetros de Carlos Mendoza (Prototipado 3D · 170.10 €) cargados en el visor.',
    },
  ]);

  const handleDimensionsCalculated = useCallback((dims: StlDimensions) => {
    setStlDims(dims);
  }, []);

  // Exact formula from the specification:
  // let base = 20.0;
  // let factorVolumen = volumeCm3 > 0 ? Math.max(1.0, volumeCm3 * 0.12) : 1.0;
  // let total = (base * servicio * material * complejidad * plazo * factorVolumen) * cantidad;
  const calculation = useMemo(() => {
    const safeQty = Number.isFinite(cantidad) && cantidad >= 1 ? Math.floor(cantidad) : 1;
    const volumeCalculated = stlDims.volumeCm3;
    const factorTamano = volumeCalculated > 0 ? Math.max(1.0, volumeCalculated * 0.12) : 1.0;

    const unitPrice = TARIFA_BASE * servicio * material * complejidad * plazo * factorTamano;
    const total = unitPrice * safeQty;

    const currentService = SERVICIOS_CALC.find((s) => s.multiplier === servicio) || SERVICIOS_CALC[0];
    const currentMaterial = MATERIALES.find((m) => m.multiplier === material) || MATERIALES[0];
    const currentComplexity = COMPLEJIDADES.find((c) => c.multiplier === complejidad) || COMPLEJIDADES[0];
    const currentPlazo = PLAZOS.find((p) => p.multiplier === plazo) || PLAZOS[0];

    return {
      unitPrice,
      total,
      safeQty,
      volumeCalculated,
      factorTamano,
      currentService,
      currentMaterial,
      currentComplexity,
      currentPlazo,
    };
  }, [servicio, cantidad, material, complejidad, plazo, stlDims]);

  // Material percentage distribution across savedEstimates for the Recharts PieChart
  const materialDistribution = useMemo(() => {
    const totalQuotes = savedEstimates.length;
    if (totalQuotes === 0) return [];

    const groups: Record<
      string,
      {
        key: string;
        name: string;
        fullLabel: string;
        multiplier: number;
        count: number;
        totalUnits: number;
        totalAmount: number;
        color: string;
      }
    > = {};

    savedEstimates.forEach((item) => {
      const isAdvanced = item.materialValue > 1.0;
      const key = isAdvanced ? 'avanzado' : 'estandar';
      if (!groups[key]) {
        groups[key] = {
          key,
          name: isAdvanced ? 'Avanzado / Técnico' : 'Material Estándar',
          fullLabel: item.materialLabel,
          multiplier: item.materialValue,
          count: 0,
          totalUnits: 0,
          totalAmount: 0,
          color: isAdvanced ? '#17a2b8' : '#0056b3',
        };
      }
      groups[key].count += 1;
      groups[key].totalUnits += item.cantidad;
      groups[key].totalAmount += item.totalPrice;
    });

    return Object.values(groups).map((g) => ({
      ...g,
      percentage: Number(((g.count / totalQuotes) * 100).toFixed(1)),
    }));
  }, [savedEstimates]);

  useEffect(() => {
    if (chatOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, chatOpen]);

  // Listen to Firebase Auth state and manage in-memory OAuth access token
  useEffect(() => {
    const unsubscribe = initAuth(
      (user, token) => {
        setCurrentUser(user);
        setWorkspaceAccessToken(token);
        setIsAuthReady(true);
        setAuthError(null);
        if (user.displayName) {
          setNombre((prev) => (prev.trim() ? prev : user.displayName || ''));
        }
        if (user.email) {
          setEmail((prev) => (prev.trim() ? prev : user.email || ''));
        }
      },
      () => {
        setCurrentUser(null);
        setWorkspaceAccessToken(null);
        setIsAuthReady(true);
        setCloudSynced(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Real-time Firestore listeners for /estimates and /estimateHistory when authenticated
  useEffect(() => {
    if (!isAuthReady || !currentUser) return;

    const estimatesQuery = query(
      collection(db, 'estimates'),
      where('ownerId', '==', currentUser.uid)
    );

    const unsubEstimates = onSnapshot(
      estimatesQuery,
      (snapshot) => {
        setCloudSynced(true);
        if (!snapshot.empty) {
          const loaded: SavedEstimate[] = snapshot.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              timestamp: String(d.timestamp || 'Hoy'),
              lastModifiedAt: String(d.lastModifiedAt || d.timestamp || 'Hoy'),
              lastLoadedAt: d.lastLoadedAt ? String(d.lastLoadedAt) : null,
              modificationCount: Number(d.modificationCount || 0),
              loadCount: Number(d.loadCount || 0),
              referenceCode: String(d.referenceCode || 'P3D-0000'),
              nombre: String(d.nombre || ''),
              empresa: String(d.empresa || ''),
              email: String(d.email || ''),
              telefono: String(d.telefono || ''),
              servicioLabel: String(d.servicioLabel || ''),
              servicioValue: Number(d.servicioValue || 1.0),
              cantidad: Number(d.cantidad || 1),
              materialLabel: String(d.materialLabel || ''),
              materialValue: Number(d.materialValue || 1.0),
              complejidadLabel: String(d.complejidadLabel || ''),
              complejidadValue: Number(d.complejidadValue || 1.0),
              plazoLabel: String(d.plazoLabel || ''),
              plazoValue: Number(d.plazoValue || 1.0),
              volumeCm3: Number(d.volumeCm3 || 0),
              factorTamano: Number(d.factorTamano || 1.0),
              dimensionsSummary: String(d.dimensionsSummary || ''),
              observaciones: String(d.observaciones || ''),
              fileName: String(d.fileName || 'Modelo 3D'),
              unitPrice: Number(d.unitPrice || 0),
              totalPrice: Number(d.totalPrice || 0),
            };
          });
          setSavedEstimates(loaded);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'estimates');
      }
    );

    const historyQuery = query(
      collection(db, 'estimateHistory'),
      where('ownerId', '==', currentUser.uid)
    );

    const unsubHistory = onSnapshot(
      historyQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loadedHistory: EstimateHistoryEvent[] = snapshot.docs.map((docSnap) => {
            const d = docSnap.data();
            return {
              id: docSnap.id,
              estimateId: String(d.estimateId || ''),
              referenceCode: String(d.referenceCode || 'P3D-0000'),
              action: (d.action as EstimateHistoryEvent['action']) || 'created',
              actionLabel: String(d.actionLabel || 'Evento'),
              timestamp: String(d.timestamp || 'Hoy'),
              summary: String(d.summary || ''),
            };
          });
          setChangeHistory(loadedHistory);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'estimateHistory');
      }
    );

    return () => {
      unsubEstimates();
      unsubHistory();
    };
  }, [isAuthReady, currentUser]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      const res = await signInWithGoogle();
      setCurrentUser(res.user);
      setWorkspaceAccessToken(res.accessToken);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'No se pudo iniciar sesión con Google.');
    }
  };

  const handleGoogleSignOut = async () => {
    setAuthError(null);
    try {
      await signOutUser();
      setWorkspaceAccessToken(null);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Error al cerrar sesión.');
    }
  };

  // Encode RFC 2822 string to base64url for Gmail API
  const encodeGmailBase64Url = (str: string): string => {
    const utf8Bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < utf8Bytes.byteLength; i++) {
      binary += String.fromCharCode(utf8Bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const sendGmailRawMessage = async (token: string, to: string, subject: string, bodyText: string) => {
    const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
    const mimeMessage = [
      `To: ${to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      bodyText,
    ].join('\r\n');

    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encodeGmailBase64Url(mimeMessage) }),
    });

    if (!response.ok) {
      throw new Error(`Error de Gmail API (${response.status}) al enviar correo a ${to}`);
    }
  };

  // Sends both: (1) confirmation email to the user and (2) internal alert email to info@project3d.es
  const enviarEmailsConfirmacionYAvisoGmail = async (entry: SavedEstimate) => {
    setSendingQuoteEmails(true);
    try {
      let activeToken = workspaceAccessToken;
      if (!activeToken) {
        const signInRes = await signInWithGoogle();
        setCurrentUser(signInRes.user);
        setWorkspaceAccessToken(signInRes.accessToken);
        activeToken = signInRes.accessToken;
      }

      if (!activeToken) {
        throw new Error('Se requiere autorización de Google (Gmail) para enviar los correos de confirmación y aviso.');
      }

      const teamRecipient = 'info@project3d.es';
      const userRecipient = entry.email.trim();

      const userSubject = `Confirmación de solicitud de presupuesto ${entry.referenceCode} - Project 3D`;
      const userBody = [
        `Hola ${entry.nombre},`,
        '',
        `Hemos recibido correctamente tu solicitud de presupuesto en Project 3D (Torrijos, Toledo) con la referencia ${entry.referenceCode}.`,
        '',
        'RESUMEN DE TU SOLICITUD:',
        `• Referencia: ${entry.referenceCode}`,
        `• Fecha de registro: ${entry.lastModifiedAt}`,
        `• Solicitante: ${entry.nombre} (${entry.empresa})`,
        `• Teléfono de contacto: ${entry.telefono}`,
        `• Servicio solicitado: ${entry.servicioLabel}`,
        `• Cantidad: ${entry.cantidad} ud(s).`,
        `• Material: ${entry.materialLabel}`,
        `• Complejidad: ${entry.complejidadLabel}`,
        `• Plazo deseado: ${entry.plazoLabel}`,
        `• Archivo / Dimensiones 3D: ${entry.fileName || 'Modelo 3D'} — ${entry.dimensionsSummary}`,
        `• Observaciones: ${entry.observaciones}`,
        '',
        'ESTIMACIÓN ORIENTATIVA CALCULADA:',
        `• Coste unitario orientativo: ${entry.unitPrice.toFixed(2)} € / ud.`,
        `• Total estimación orientativa: ${entry.totalPrice.toFixed(2)} €`,
        '',
        'Importante: El importe calculado es una estimación orientativa. Nuestro equipo técnico en Torrijos revisará tu proyecto y archivos para confirmarte el presupuesto definitivo.',
        '',
        'Atentamente,',
        'Project 3D · Polígono Industrial La Atalaya, Torrijos (Toledo)',
        'Tel: 925 76 38 42 · info@project3d.es · www.project3d.es',
      ].join('\n');

      const teamSubject = `[Aviso Solicitud ${entry.referenceCode}] ${entry.servicioLabel} - ${entry.nombre} (${entry.totalPrice.toFixed(2)} €)`;
      const teamBody = [
        'Nueva solicitud de presupuesto registrada en la calculadora web de Project 3D:',
        '',
        '1. DATOS DE CONTACTO DEL CLIENTE:',
        `• Referencia: ${entry.referenceCode}`,
        `• Fecha / Hora: ${entry.lastModifiedAt}`,
        `• Nombre: ${entry.nombre}`,
        `• Empresa: ${entry.empresa}`,
        `• Email del cliente: ${userRecipient}`,
        `• Teléfono: ${entry.telefono}`,
        '',
        '2. ESPECIFICACIONES TÉCNICAS Y ARCHIVO STL:',
        `• Servicio: ${entry.servicioLabel} (×${entry.servicioValue})`,
        `• Cantidad: ${entry.cantidad} ud(s).`,
        `• Material: ${entry.materialLabel} (×${entry.materialValue})`,
        `• Complejidad: ${entry.complejidadLabel} (×${entry.complejidadValue})`,
        `• Plazo deseado: ${entry.plazoLabel} (×${entry.plazoValue})`,
        `• Archivo STL: ${entry.fileName || 'Modelo de prueba'}`,
        `• Dimensiones y volumen: ${entry.dimensionsSummary} (Factor tamaño ×${entry.factorTamano.toFixed(2)})`,
        `• Observaciones: ${entry.observaciones}`,
        '',
        '3. ESTIMACIÓN ORIENTATIVA:',
        `• Precio unitario: ${entry.unitPrice.toFixed(2)} € / ud.`,
        `• Total orientativo: ${entry.totalPrice.toFixed(2)} €`,
      ].join('\n');

      await Promise.all([
        sendGmailRawMessage(activeToken, userRecipient, userSubject, userBody),
        sendGmailRawMessage(activeToken, teamRecipient, teamSubject, teamBody),
      ]);

      setQuoteEmailsStatus({
        status: 'sent',
        userEmail: userRecipient,
        teamEmail: teamRecipient,
        referenceCode: entry.referenceCode,
        message: `Emails enviados con éxito vía Gmail API: confirmación enviada a ${userRecipient} y aviso técnico enviado a ${teamRecipient}.`,
      });
      setFormNotice({
        type: 'success',
        message: `Solicitud ${entry.referenceCode} registrada y correos enviados por Gmail a ${userRecipient} y a ${teamRecipient}.`,
      });
      setPendingQuoteEmailEntry(null);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'No se pudieron enviar los correos mediante Gmail API.';
      setQuoteEmailsStatus({
        status: 'error',
        userEmail: entry.email.trim(),
        teamEmail: 'info@project3d.es',
        referenceCode: entry.referenceCode,
        message: errMsg,
      });
      setFormNotice({
        type: 'error',
        message: `La solicitud ${entry.referenceCode} quedó registrada, pero hubo un error al enviar los emails por Gmail: ${errMsg}`,
      });
      setPendingQuoteEmailEntry(null);
    } finally {
      setSendingQuoteEmails(false);
    }
  };

  const persistEstimateToFirestore = async (entry: SavedEstimate, historyEvent: EstimateHistoryEvent) => {
    if (!currentUser) return;
    const estimatePath = `estimates/${entry.id}`;
    try {
      await setDoc(doc(db, 'estimates', entry.id), {
        ownerId: currentUser.uid,
        referenceCode: entry.referenceCode.slice(0, 20),
        timestamp: entry.timestamp.slice(0, 40),
        lastModifiedAt: entry.lastModifiedAt.slice(0, 40),
        lastLoadedAt: (entry.lastLoadedAt || '').slice(0, 40),
        modificationCount: Math.max(0, Math.min(10000, Math.floor(entry.modificationCount || 0))),
        loadCount: Math.max(0, Math.min(10000, Math.floor(entry.loadCount || 0))),
        nombre: (entry.nombre || 'Cliente').slice(0, 100),
        empresa: (entry.empresa || 'Particular').slice(0, 120),
        email: (entry.email && entry.email.length >= 3 ? entry.email : currentUser.email || 'info@project3d.es').slice(0, 150),
        telefono: (entry.telefono || '925763842').slice(0, 30),
        servicioLabel: entry.servicioLabel.slice(0, 60),
        servicioValue: Number(entry.servicioValue),
        cantidad: Math.max(1, Math.min(10000, Math.floor(entry.cantidad))),
        materialLabel: entry.materialLabel.slice(0, 80),
        materialValue: Number(entry.materialValue),
        complejidadLabel: entry.complejidadLabel.slice(0, 30),
        complejidadValue: Number(entry.complejidadValue),
        plazoLabel: entry.plazoLabel.slice(0, 40),
        plazoValue: Number(entry.plazoValue),
        volumeCm3: Math.max(0, Math.min(1000000, Number(entry.volumeCm3 || 0))),
        factorTamano: Math.max(1.0, Math.min(200000, Number(entry.factorTamano || 1.0))),
        dimensionsSummary: (entry.dimensionsSummary || '25.0 × 25.0 × 25.0 mm').slice(0, 120),
        observaciones: (entry.observaciones || 'Sin observaciones adicionales').slice(0, 1000),
        fileName: (entry.fileName || 'Modelo de prueba').slice(0, 150),
        unitPrice: Math.max(0, Math.min(10000000, Number(entry.unitPrice))),
        totalPrice: Math.max(0, Math.min(100000000, Number(entry.totalPrice))),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, estimatePath);
    }

    const historyPath = `estimateHistory/${historyEvent.id}`;
    try {
      await setDoc(doc(db, 'estimateHistory', historyEvent.id), {
        ownerId: currentUser.uid,
        estimateId: historyEvent.estimateId.slice(0, 128),
        referenceCode: historyEvent.referenceCode.slice(0, 20),
        action: historyEvent.action,
        actionLabel: historyEvent.actionLabel.slice(0, 60),
        timestamp: historyEvent.timestamp.slice(0, 40),
        summary: historyEvent.summary.slice(0, 300),
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, historyPath);
    }
  };

  const calcularPresupuesto = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setResultadoVisible(true);
    const now = new Date();
    const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLastCalculatedAt(timeStr);
    setFormNotice({
      type: 'info',
      message: `Estimación Orientativa calculada: ${calculation.total.toFixed(2)} € (${calculation.safeQty} ${
        calculation.safeQty === 1 ? 'unidad' : 'unidades'
      } · Factor tamaño ×${calculation.factorTamano.toFixed(2)}).`,
    });
  };

  // Load a generated sample STL geometry so the user can test STL measurement & manifold validation in 1 click
  const handleLoadSampleStl = (preset: 'engranaje' | 'soporte' | 'carcasa' | 'defectuoso') => {
    if (preset === 'defectuoso') {
      const buffer = createDefectiveBinaryStlSample();
      const fileName = 'pieza_abierta_caras_invertidas_35x25x20mm.stl';
      setFileError(null);
      const sizeKB = Math.max(1, Math.round(buffer.byteLength / 1024)).toLocaleString('es-ES');
      const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
      setAttachedFile({ name: fileName, sizeKB, sizeMB });
      setStlBuffer(buffer);
      setResultadoVisible(true);
      return;
    }

    let geom: THREE.BufferGeometry;
    let fileName: string;

    if (preset === 'engranaje') {
      // Cylinder / ring-like gear geometry (40 x 12 x 40 mm)
      geom = new THREE.CylinderGeometry(20, 20, 12, 24);
      fileName = 'corona_tecnica_40x12mm.stl';
      setServicio(1.3);
      setMaterial(1.5);
      setComplejidad(1.8);
    } else if (preset === 'soporte') {
      // Compact bracket geometry (35 x 25 x 20 mm)
      geom = new THREE.BoxGeometry(35, 25, 20);
      fileName = 'soporte_sensor_35x25x20mm.stl';
      setServicio(0.9);
      setMaterial(1.0);
      setComplejidad(1.0);
    } else {
      // Medium enclosure geometry (50 x 30 x 40 mm)
      geom = new THREE.BoxGeometry(50, 30, 40);
      fileName = 'carcasa_prototipo_50x30x40mm.stl';
      setServicio(1.0);
      setMaterial(1.0);
      setComplejidad(1.4);
    }

    const buffer = createBinaryStlFromGeometry(geom);
    geom.dispose();

    setFileError(null);
    const sizeKB = Math.max(1, Math.round(buffer.byteLength / 1024)).toLocaleString('es-ES');
    const sizeMB = (buffer.byteLength / (1024 * 1024)).toFixed(2);
    setAttachedFile({ name: fileName, sizeKB, sizeMB });
    setStlBuffer(buffer);
    setResultadoVisible(true);
  };

  // Repair the currently loaded STL mesh by rebuilding a closed manifold geometry of its bounding dimensions with outward normals
  const handleAutoRepairCurrentStl = () => {
    const w = Math.max(5, stlDims.widthMm);
    const h = Math.max(5, stlDims.heightMm);
    const d = Math.max(5, stlDims.depthMm);
    const repairedGeom = new THREE.BoxGeometry(w, h, d);
    const repairedBuffer = createBinaryStlFromGeometry(repairedGeom);
    repairedGeom.dispose();

    const baseName = attachedFile?.name ? attachedFile.name.replace(/\.stl$/i, '') : 'pieza_3d';
    const repairedName = `${baseName}_reparada_manifold.stl`;
    const sizeKB = Math.max(1, Math.round(repairedBuffer.byteLength / 1024)).toLocaleString('es-ES');
    const sizeMB = (repairedBuffer.byteLength / (1024 * 1024)).toFixed(2);
    setAttachedFile({ name: repairedName, sizeKB, sizeMB });
    setStlBuffer(repairedBuffer);
    setFormNotice({
      type: 'success',
      message: `Malla STL reparada (${repairedName}): bordes cerrados (estanca / manifold) y normales orientadas hacia el exterior.`,
    });
  };

  // Generates and downloads a valid PDF 1.4 technical report detailing the STL manifold & orientation warnings
  const handleExportStlDiagnosticsPdf = () => {
    const diag = stlDims.diagnostics;
    if (!diag) return;

    const toWinAnsiEscaped = (input: string): string => {
      const normalized = input
        .replace(/€/g, 'EUR')
        .replace(/•/g, '-')
        .replace(/—/g, '-')
        .replace(/–/g, '-')
        .replace(/³/g, '3');
      let out = '';
      for (let i = 0; i < normalized.length; i++) {
        const code = normalized.charCodeAt(i);
        const ch = normalized[i];
        if (ch === '\\' || ch === '(' || ch === ')') {
          out += '\\' + ch;
        } else if (code >= 32 && code <= 126) {
          out += ch;
        } else if (code >= 160 && code <= 255) {
          out += '\\' + code.toString(8).padStart(3, '0');
        } else {
          out += '?';
        }
      }
      return out;
    };

    const wrapLine = (text: string, maxChars = 82): string[] => {
      const words = text.split(/\s+/);
      const lines: string[] = [];
      let current = '';
      for (const word of words) {
        if (!current) {
          current = word;
        } else if ((current + ' ' + word).length <= maxChars) {
          current += ' ' + word;
        } else {
          lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
      return lines.length ? lines : [''];
    };

    const nowStr = new Date().toLocaleString('es-ES');
    const modelName = attachedFile?.name || 'Modelo_STL.stl';

    interface PdfLine {
      text: string;
      bold?: boolean;
      size?: number;
      gapBefore?: number;
    }

    const reportLines: PdfLine[] = [
      { text: 'PROJECT 3D - INFORME TECNICO DE VALIDACION GEOMETRICA STL', bold: true, size: 13 },
      { text: 'Poligono Industrial La Atalaya - Torrijos (Toledo) | Tel: 925 76 38 42 | info@project3d.es', size: 9 },
      { text: '----------------------------------------------------------------------------------------', size: 9 },
      { text: '1. IDENTIFICACION DEL MODELO Y DIMENSIONES', bold: true, size: 11, gapBefore: 6 },
      { text: `Fecha de emision del informe: ${nowStr}`, size: 9.5 },
      { text: `Archivo STL analizado: ${modelName}`, size: 9.5 },
      {
        text: `Solicitante / Empresa: ${nombre.trim() || 'No especificado'} (${empresa.trim() || 'Particular'})`,
        size: 9.5,
      },
      {
        text: `Dimensiones envolventes (X x Y x Z): ${stlDims.widthMm.toFixed(1)} x ${stlDims.heightMm.toFixed(
          1
        )} x ${stlDims.depthMm.toFixed(1)} mm`,
        size: 9.5,
      },
      {
        text: `Volumen envolvente estimado: ${stlDims.volumeCm3.toFixed(2)} cm3 | Volumen de malla: ${diag.exactMeshVolumeCm3.toFixed(
          2
        )} cm3`,
        size: 9.5,
      },
      { text: '2. DIAGNOSTICO TOPOLOGICO Y DE ESTANQUEIDAD (MANIFOLD)', bold: true, size: 11, gapBefore: 8 },
      {
        text: `Estado general: ${
          diag.needsRepair
            ? 'REQUIERE REPARACION PREVIA A LA FABRICACION'
            : 'APTO PARA FABRICACION (MALLA ESTANCA MANIFOLD OK)'
        }`,
        bold: true,
        size: 10,
      },
      {
        text: `Condicion de estanqueidad (Watertight / Manifold): ${
          diag.isManifold ? 'Estanca (Cerrada)' : 'No estanca (Superficie abierta o no-manifold)'
        }`,
        size: 9.5,
      },
      { text: `Triangulos totales analizados: ${diag.triangleCount}`, size: 9.5 },
      { text: `Vertices unicos soldados: ${diag.vertexCount}`, size: 9.5 },
      { text: `Bordes abiertos (huecos / discontinuidades): ${diag.openEdges}`, size: 9.5 },
      { text: `Aristas no-manifold (>2 caras por arista): ${diag.nonManifoldEdges}`, size: 9.5 },
      {
        text: `Aristas con caras adyacentes invertidas (winding opuesto): ${diag.invertedNormalEdges}`,
        size: 9.5,
      },
      { text: `Caras con vector normal invertido en archivo: ${diag.invertedFileNormals}`, size: 9.5 },
      { text: `Triangulos degenerados (area nula): ${diag.degenerateTriangles}`, size: 9.5 },
      {
        text: '3. ADVERTENCIAS DE ESTANQUEIDAD Y ORIENTACION DETECTADAS',
        bold: true,
        size: 11,
        gapBefore: 8,
      },
    ];

    if (diag.issues.length === 0) {
      reportLines.push({
        text: '- No se han detectado advertencias de estanqueidad ni caras invertidas en el modelo STL.',
        size: 9.5,
      });
    } else {
      diag.issues.forEach((issue, idx) => {
        const wrapped = wrapLine(`${idx + 1}. ${issue}`, 84);
        wrapped.forEach((lineStr, wIdx) => {
          reportLines.push({
            text: wIdx === 0 ? lineStr : `   ${lineStr}`,
            size: 9.5,
          });
        });
      });
    }

    reportLines.push({
      text: '4. RECOMENDACIONES TECNICAS ANTES DE LA FABRICACION',
      bold: true,
      size: 11,
      gapBefore: 8,
    });

    const summaryWrapped = wrapLine(diag.summaryMessage, 84);
    summaryWrapped.forEach((lineStr) => {
      reportLines.push({ text: lineStr, size: 9.5 });
    });

    if (diag.needsRepair) {
      reportLines.push(
        {
          text: '- Cerrar todos los bordes abiertos (open edges) para garantizar un volumen solido cerrado.',
          size: 9.5,
        },
        {
          text: '- Recalcular y unificar los vectores normales de todas las caras hacia el exterior.',
          size: 9.5,
        },
        {
          text: '- Eliminar caras duplicadas, paredes internas o triangulos degenerados en el software CAD.',
          size: 9.5,
        }
      );
    }

    let cursorY = 790;
    const ops: string[] = ['BT'];
    for (const item of reportLines) {
      const fontSize = item.size || 9.5;
      const gap = item.gapBefore || 0;
      cursorY -= gap;
      if (cursorY < 50) break;
      const fontRef = item.bold ? '/F2' : '/F1';
      ops.push(`${fontRef} ${fontSize} Tf`);
      ops.push(`1 0 0 1 48 ${cursorY.toFixed(1)} Tm`);
      ops.push(`(${toWinAnsiEscaped(item.text)}) Tj`);
      cursorY -= fontSize + 5;
    }
    ops.push('ET');

    const contentStream = ops.join('\n');
    const objects: string[] = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
      '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n',
      `6 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    ];

    let pdfBody = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (const obj of objects) {
      offsets.push(pdfBody.length);
      pdfBody += obj;
    }
    const xrefOffset = pdfBody.length;
    pdfBody += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdfBody += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }
    pdfBody += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const blob = new Blob([pdfBody], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const cleanFileName = modelName.replace(/\.stl$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    const link = document.createElement('a');
    link.href = url;
    link.download = `informe_estanqueidad_stl_${cleanFileName}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleResetToDefaultCube = () => {
    setStlBuffer(null);
    setAttachedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const emailValidation = useMemo(() => {
    const trimmed = email.trim();
    if (trimmed.length === 0) {
      return {
        status: emailTouched ? ('invalid' as const) : ('idle' as const),
        message: emailTouched ? 'El campo de email es obligatorio.' : '',
      };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(trimmed)) {
      return {
        status: 'invalid' as const,
        message: 'Introduce un email válido (ej. usuario@empresa.es)',
      };
    }
    return {
      status: 'valid' as const,
      message: 'Dirección de correo verificada',
    };
  }, [email, emailTouched]);

  // Extra security & data integrity validation across all form fields
  const formSecurityErrors = useMemo<FormValidationError[]>(() => {
    const errors: FormValidationError[] = [];
    const unsafePattern = /[<>]|javascript:|data:text\/html|on\w+\s*=/i;

    // 1. Nombre validation (required, min 2 chars, letters required, no injection characters)
    const cleanNombre = nombre.trim();
    if (!cleanNombre) {
      errors.push({
        fieldId: 'nombre',
        fieldLabel: 'Nombre',
        message: 'El campo Nombre está vacío y es obligatorio.',
      });
    } else if (unsafePattern.test(cleanNombre)) {
      errors.push({
        fieldId: 'nombre',
        fieldLabel: 'Nombre',
        message: 'Contiene caracteres no permitidos por seguridad (<, > o scripts).',
      });
    } else if (cleanNombre.length < 2 || cleanNombre.length > 100 || !/[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ]/.test(cleanNombre)) {
      errors.push({
        fieldId: 'nombre',
        fieldLabel: 'Nombre',
        message: 'Introduce un nombre válido (entre 2 y 100 caracteres con letras).',
      });
    }

    // 2. Empresa validation (optional, but must not contain injection tags or exceed 120 chars)
    const cleanEmpresa = empresa.trim();
    if (cleanEmpresa) {
      if (unsafePattern.test(cleanEmpresa)) {
        errors.push({
          fieldId: 'empresa',
          fieldLabel: 'Empresa',
          message: 'El nombre de empresa contiene caracteres no permitidos por seguridad.',
        });
      } else if (cleanEmpresa.length > 120) {
        errors.push({
          fieldId: 'empresa',
          fieldLabel: 'Empresa',
          message: 'El nombre de empresa no puede superar los 120 caracteres.',
        });
      }
    }

    // 3. Email validation (required, strict format, no unsafe chars)
    const cleanEmail = email.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!cleanEmail) {
      errors.push({
        fieldId: 'email',
        fieldLabel: 'Email',
        message: 'El campo Email está vacío y es obligatorio.',
      });
    } else if (unsafePattern.test(cleanEmail) || !emailRegex.test(cleanEmail) || cleanEmail.length > 150) {
      errors.push({
        fieldId: 'email',
        fieldLabel: 'Email',
        message: 'El formato del correo electrónico está mal formado (ej. usuario@dominio.es).',
      });
    }

    // 4. Teléfono validation (required, allowed phone chars, 9 to 15 digits)
    const cleanTelefono = telefono.trim();
    const digitsOnly = cleanTelefono.replace(/\D/g, '');
    const phoneFormatRegex = /^[+\d\s().-]+$/;
    if (!cleanTelefono) {
      errors.push({
        fieldId: 'telefono',
        fieldLabel: 'Teléfono',
        message: 'El campo Teléfono está vacío y es obligatorio.',
      });
    } else if (
      unsafePattern.test(cleanTelefono) ||
      !phoneFormatRegex.test(cleanTelefono) ||
      digitsOnly.length < 9 ||
      digitsOnly.length > 15
    ) {
      errors.push({
        fieldId: 'telefono',
        fieldLabel: 'Teléfono',
        message: 'Introduce un teléfono válido de entre 9 y 15 dígitos numéricos (ej. 925 76 38 42).',
      });
    }

    // 5. Cantidad validation (integer between 1 and 10000)
    if (!Number.isFinite(cantidad) || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10000) {
      errors.push({
        fieldId: 'cantidad',
        fieldLabel: 'Cantidad (Uds)',
        message: 'La cantidad debe ser un número entero válido entre 1 y 10.000 unidades.',
      });
    }

    // 6. Whitelist check on select multipliers
    const allowedServicios = [1.0, 1.2, 1.1, 1.3, 0.9];
    if (!allowedServicios.includes(servicio)) {
      errors.push({
        fieldId: 'servicio',
        fieldLabel: 'Servicio',
        message: 'El servicio seleccionado no es válido.',
      });
    }

    const allowedMateriales = [1.0, 1.5];
    if (!allowedMateriales.includes(material)) {
      errors.push({
        fieldId: 'material',
        fieldLabel: 'Material',
        message: 'El material seleccionado no es válido.',
      });
    }

    const allowedComplejidades = [1.0, 1.4, 1.8];
    if (!allowedComplejidades.includes(complejidad)) {
      errors.push({
        fieldId: 'complejidad',
        fieldLabel: 'Complejidad',
        message: 'El nivel de complejidad seleccionado no es válido.',
      });
    }

    const allowedPlazos = [1.0, 1.3, 1.1];
    if (!allowedPlazos.includes(plazo)) {
      errors.push({
        fieldId: 'plazo',
        fieldLabel: 'Plazo deseado',
        message: 'El plazo deseado seleccionado no es válido.',
      });
    }

    // 7. Observaciones security check (max 1000 chars, no script/HTML tags)
    const cleanObs = observaciones.trim();
    if (cleanObs) {
      if (unsafePattern.test(cleanObs)) {
        errors.push({
          fieldId: 'observaciones',
          fieldLabel: 'Observaciones',
          message: 'El campo de observaciones contiene etiquetas HTML o scripts no permitidos.',
        });
      } else if (cleanObs.length > 1000) {
        errors.push({
          fieldId: 'observaciones',
          fieldLabel: 'Observaciones',
          message: 'Las observaciones no pueden exceder los 1.000 caracteres.',
        });
      }
    }

    // 8. STL File validation if an error is active
    if (fileError) {
      errors.push({
        fieldId: 'archivoStl',
        fieldLabel: 'Archivo STL',
        message: fileError,
      });
    }

    return errors;
  }, [nombre, empresa, email, telefono, cantidad, servicio, material, complejidad, plazo, observaciones, fileError]);

  const hasFieldError = useCallback(
    (fieldId: string) => submissionAttempted && formSecurityErrors.some((err) => err.fieldId === fieldId),
    [submissionAttempted, formSecurityErrors]
  );

  const validateContactFields = (): boolean => {
    setSubmissionAttempted(true);
    setEmailTouched(true);

    if (formSecurityErrors.length > 0) {
      setFormNotice({
        type: 'error',
        message: `Envío bloqueado por seguridad: corrige los ${formSecurityErrors.length} ${
          formSecurityErrors.length === 1 ? 'error indicado' : 'errores indicados'
        } en el resumen superior del formulario.`,
      });
      document.getElementById('resumen-errores-formulario')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  };

  const handleSaveToComparator = () => {
    const refCode = `P3D-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const fullTimeLabel = `Hoy, ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    const dimsText = stlDims.isCustomStl
      ? `${stlDims.widthMm.toFixed(1)} × ${stlDims.heightMm.toFixed(1)} × ${stlDims.depthMm.toFixed(1)} mm (${stlDims.volumeCm3.toFixed(1)} cm³)`
      : '30.0 × 30.0 × 30.0 mm (Pieza por defecto)';

    const entryId = `est-${Date.now()}`;
    const newEntry: SavedEstimate = {
      id: entryId,
      timestamp: `Hoy, ${timeLabel}`,
      lastModifiedAt: fullTimeLabel,
      lastLoadedAt: null,
      modificationCount: 0,
      loadCount: 0,
      referenceCode: refCode,
      nombre: nombre.trim() || 'Configuración en borrador',
      empresa: empresa.trim() || 'Particular / Sin especificar',
      email: email.trim() || 'Pendiente de asignar',
      telefono: telefono.trim() || '—',
      servicioLabel: calculation.currentService.label,
      servicioValue: servicio,
      cantidad: calculation.safeQty,
      materialLabel: calculation.currentMaterial.label,
      materialValue: material,
      complejidadLabel: calculation.currentComplexity.label,
      complejidadValue: complejidad,
      plazoLabel: calculation.currentPlazo.label,
      plazoValue: plazo,
      volumeCm3: calculation.volumeCalculated,
      factorTamano: calculation.factorTamano,
      dimensionsSummary: dimsText,
      observaciones: observaciones.trim() || 'Sin observaciones adicionales',
      fileName: attachedFile ? attachedFile.name : 'Modelo de prueba (30×30×30 mm)',
      unitPrice: calculation.unitPrice,
      totalPrice: calculation.total,
    };

    const historyEvent: EstimateHistoryEvent = {
      id: `hist-${Date.now()}`,
      estimateId: entryId,
      referenceCode: refCode,
      action: 'created',
      actionLabel: 'Configuración guardada',
      timestamp: fullTimeLabel,
      summary: `${newEntry.servicioLabel} (${newEntry.cantidad} uds.) · ${newEntry.materialLabel} · Total: ${newEntry.totalPrice.toFixed(2)} €`,
    };

    setSavedEstimates((prev) => [newEntry, ...prev]);
    setChangeHistory((prev) => [historyEvent, ...prev]);
    if (currentUser) {
      void persistEstimateToFirestore(newEntry, historyEvent);
    }
    setResultadoVisible(true);
    setFormNotice({
      type: 'success',
      message: `Configuración ${refCode} añadida al comparador de presupuestos (${calculation.total.toFixed(2)} €).`,
    });
  };

  const handleUpdateSavedEstimate = (targetId?: string) => {
    const idToUpdate = targetId ?? activeLoadedEstimateId;
    if (!idToUpdate) return;
    const existing = savedEstimates.find((e) => e.id === idToUpdate);
    if (!existing) return;

    const now = new Date();
    const fullTimeLabel = `Hoy, ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    const dimsText = stlDims.isCustomStl
      ? `${stlDims.widthMm.toFixed(1)} × ${stlDims.heightMm.toFixed(1)} × ${stlDims.depthMm.toFixed(1)} mm (${stlDims.volumeCm3.toFixed(1)} cm³)`
      : existing.dimensionsSummary;

    const updatedEntry: SavedEstimate = {
      ...existing,
      lastModifiedAt: fullTimeLabel,
      modificationCount: (existing.modificationCount || 0) + 1,
      nombre: nombre.trim() || existing.nombre,
      empresa: empresa.trim() || existing.empresa,
      email: email.trim() || existing.email,
      telefono: telefono.trim() || existing.telefono,
      servicioLabel: calculation.currentService.label,
      servicioValue: servicio,
      cantidad: calculation.safeQty,
      materialLabel: calculation.currentMaterial.label,
      materialValue: material,
      complejidadLabel: calculation.currentComplexity.label,
      complejidadValue: complejidad,
      plazoLabel: calculation.currentPlazo.label,
      plazoValue: plazo,
      volumeCm3: calculation.volumeCalculated,
      factorTamano: calculation.factorTamano,
      dimensionsSummary: dimsText,
      observaciones: observaciones.trim() || existing.observaciones,
      fileName: attachedFile ? attachedFile.name : existing.fileName,
      unitPrice: calculation.unitPrice,
      totalPrice: calculation.total,
    };

    const historyEvent: EstimateHistoryEvent = {
      id: `hist-${Date.now()}`,
      estimateId: existing.id,
      referenceCode: existing.referenceCode,
      action: 'modified',
      actionLabel: 'Configuración modificada',
      timestamp: fullTimeLabel,
      summary: `Parámetros actualizados: ${updatedEntry.servicioLabel}, ${updatedEntry.cantidad} uds., Plazo ${updatedEntry.plazoLabel} · Nuevo total: ${updatedEntry.totalPrice.toFixed(2)} € (antes ${existing.totalPrice.toFixed(2)} €)`,
    };

    setSavedEstimates((prev) => prev.map((item) => (item.id === idToUpdate ? updatedEntry : item)));
    setChangeHistory((prev) => [historyEvent, ...prev]);

    if (currentUser) {
      void (async () => {
        try {
          await updateDoc(doc(db, 'estimates', existing.id), {
            lastModifiedAt: updatedEntry.lastModifiedAt.slice(0, 40),
            modificationCount: Math.max(0, Math.min(10000, Math.floor(updatedEntry.modificationCount))),
            nombre: (updatedEntry.nombre || 'Cliente').slice(0, 100),
            empresa: (updatedEntry.empresa || 'Particular').slice(0, 120),
            email: (updatedEntry.email && updatedEntry.email.length >= 3 ? updatedEntry.email : currentUser.email || 'info@project3d.es').slice(0, 150),
            telefono: (updatedEntry.telefono || '925763842').slice(0, 30),
            servicioLabel: updatedEntry.servicioLabel.slice(0, 60),
            servicioValue: Number(updatedEntry.servicioValue),
            cantidad: Math.max(1, Math.min(10000, Math.floor(updatedEntry.cantidad))),
            materialLabel: updatedEntry.materialLabel.slice(0, 80),
            materialValue: Number(updatedEntry.materialValue),
            complejidadLabel: updatedEntry.complejidadLabel.slice(0, 30),
            complejidadValue: Number(updatedEntry.complejidadValue),
            plazoLabel: updatedEntry.plazoLabel.slice(0, 40),
            plazoValue: Number(updatedEntry.plazoValue),
            volumeCm3: Math.max(0, Math.min(1000000, Number(updatedEntry.volumeCm3 || 0))),
            factorTamano: Math.max(1.0, Math.min(200000, Number(updatedEntry.factorTamano || 1.0))),
            dimensionsSummary: (updatedEntry.dimensionsSummary || '25.0 × 25.0 × 25.0 mm').slice(0, 120),
            observaciones: (updatedEntry.observaciones || 'Sin observaciones adicionales').slice(0, 1000),
            fileName: (updatedEntry.fileName || 'Modelo de prueba').slice(0, 150),
            unitPrice: Math.max(0, Math.min(10000000, Number(updatedEntry.unitPrice))),
            totalPrice: Math.max(0, Math.min(100000000, Number(updatedEntry.totalPrice))),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `estimates/${existing.id}`);
        }
        try {
          await setDoc(doc(db, 'estimateHistory', historyEvent.id), {
            ownerId: currentUser.uid,
            estimateId: historyEvent.estimateId.slice(0, 128),
            referenceCode: historyEvent.referenceCode.slice(0, 20),
            action: historyEvent.action,
            actionLabel: historyEvent.actionLabel.slice(0, 60),
            timestamp: historyEvent.timestamp.slice(0, 40),
            summary: historyEvent.summary.slice(0, 300),
            createdAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `estimateHistory/${historyEvent.id}`);
        }
      })();
    }

    setResultadoVisible(true);
    setFormNotice({
      type: 'success',
      message: `Configuración ${existing.referenceCode} modificada y actualizada (${updatedEntry.totalPrice.toFixed(2)} €).`,
    });
  };

  const handleFormalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResultadoVisible(true);
    if (!validateContactFields()) return;

    const refCode = `P3D-${Math.floor(1000 + Math.random() * 9000)}`;
    const now = new Date();
    const timeLabel = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const fullTimeLabel = `Hoy, ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    const dimsText = stlDims.isCustomStl
      ? `${stlDims.widthMm.toFixed(1)} × ${stlDims.heightMm.toFixed(1)} × ${stlDims.depthMm.toFixed(1)} mm (${stlDims.volumeCm3.toFixed(1)} cm³)`
      : '30.0 × 30.0 × 30.0 mm (Pieza por defecto)';

    const entryId = `est-${Date.now()}`;
    const newEntry: SavedEstimate = {
      id: entryId,
      timestamp: `Hoy, ${timeLabel}`,
      lastModifiedAt: fullTimeLabel,
      lastLoadedAt: null,
      modificationCount: 0,
      loadCount: 0,
      referenceCode: refCode,
      nombre: nombre.trim(),
      empresa: empresa.trim() || 'Particular / Sin especificar',
      email: email.trim(),
      telefono: telefono.trim(),
      servicioLabel: calculation.currentService.label,
      servicioValue: servicio,
      cantidad: calculation.safeQty,
      materialLabel: calculation.currentMaterial.label,
      materialValue: material,
      complejidadLabel: calculation.currentComplexity.label,
      complejidadValue: complejidad,
      plazoLabel: calculation.currentPlazo.label,
      plazoValue: plazo,
      volumeCm3: calculation.volumeCalculated,
      factorTamano: calculation.factorTamano,
      dimensionsSummary: dimsText,
      observaciones: observaciones.trim() || 'Sin observaciones adicionales',
      fileName: attachedFile ? attachedFile.name : 'Modelo de prueba (30×30×30 mm)',
      unitPrice: calculation.unitPrice,
      totalPrice: calculation.total,
    };

    const historyEvent: EstimateHistoryEvent = {
      id: `hist-${Date.now()}`,
      estimateId: entryId,
      referenceCode: refCode,
      action: 'created',
      actionLabel: 'Solicitud registrada',
      timestamp: fullTimeLabel,
      summary: `Registrada por ${newEntry.nombre} (${newEntry.servicioLabel} · ${newEntry.totalPrice.toFixed(2)} €)`,
    };

    setSavedEstimates((prev) => [newEntry, ...prev]);
    setChangeHistory((prev) => [historyEvent, ...prev]);
    if (currentUser) {
      void persistEstimateToFirestore(newEntry, historyEvent);
    }
    setSubmissionAttempted(false);
    setSubmittedRefCode(refCode);
    setQuoteEmailsStatus({ status: 'idle' });
    setPendingQuoteEmailEntry(newEntry);
    setFormNotice({
      type: 'success',
      message: `Solicitud registrada con referencia ${refCode}. Confirma en la ventana emergente el envío automático por Gmail del correo de confirmación a ${email.trim()} y del aviso técnico a info@project3d.es.`,
    });
  };

  const handleResetForm = () => {
    setNombre('');
    setEmpresa('');
    setEmail('');
    setTelefono('');
    setServicio(1.0);
    setCantidad(1);
    setMaterial(1.0);
    setComplejidad(1.0);
    setPlazo(1.0);
    setObservaciones('');
    setEmailTouched(false);
    setSubmissionAttempted(false);
    setActiveLoadedEstimateId(null);
    setStlBuffer(null);
    setAttachedFile(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setSubmittedRefCode(null);
    setFormNotice({ type: 'info', message: 'Parámetros y visor 3D restablecidos a los valores iniciales.' });
  };

  const handleLoadFromSaved = (item: SavedEstimate) => {
    const now = new Date();
    const fullTimeLabel = `Hoy, ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

    if (item.nombre !== 'Configuración en borrador') setNombre(item.nombre);
    if (item.empresa !== 'Particular / Sin especificar') setEmpresa(item.empresa);
    if (item.email !== 'Pendiente de asignar') setEmail(item.email);
    if (item.telefono !== '—') setTelefono(item.telefono);
    setServicio(item.servicioValue);
    setCantidad(item.cantidad);
    setMaterial(item.materialValue);
    setComplejidad(item.complejidadValue);
    setPlazo(item.plazoValue);
    setObservaciones(item.observaciones === 'Sin observaciones adicionales' ? '' : item.observaciones);
    setStlDims((prev) => ({
      ...prev,
      volumeCm3: item.volumeCm3,
      isCustomStl: item.volumeCm3 > 0,
      label: `Dimensiones cargadas de ${item.referenceCode}: ${item.dimensionsSummary}`,
    }));

    const historyEvent: EstimateHistoryEvent = {
      id: `hist-${Date.now()}`,
      estimateId: item.id,
      referenceCode: item.referenceCode,
      action: 'loaded',
      actionLabel: 'Cargada en calculadora',
      timestamp: fullTimeLabel,
      summary: `Configuración de ${item.nombre} (${item.servicioLabel} · ${item.totalPrice.toFixed(2)} €) cargada en el formulario.`,
    };

    setActiveLoadedEstimateId(item.id);
    setSavedEstimates((prev) =>
      prev.map((est) =>
        est.id === item.id
          ? { ...est, lastLoadedAt: fullTimeLabel, loadCount: (est.loadCount || 0) + 1 }
          : est
      )
    );
    setChangeHistory((prev) => [historyEvent, ...prev]);

    if (currentUser) {
      void (async () => {
        try {
          await updateDoc(doc(db, 'estimates', item.id), {
            lastLoadedAt: fullTimeLabel.slice(0, 40),
            loadCount: Math.max(0, Math.min(10000, Math.floor((item.loadCount || 0) + 1))),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.UPDATE, `estimates/${item.id}`);
        }
        try {
          await setDoc(doc(db, 'estimateHistory', historyEvent.id), {
            ownerId: currentUser.uid,
            estimateId: historyEvent.estimateId.slice(0, 128),
            referenceCode: historyEvent.referenceCode.slice(0, 20),
            action: historyEvent.action,
            actionLabel: historyEvent.actionLabel.slice(0, 60),
            timestamp: historyEvent.timestamp.slice(0, 40),
            summary: historyEvent.summary.slice(0, 300),
            createdAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `estimateHistory/${historyEvent.id}`);
        }
      })();
    }

    setResultadoVisible(true);
    setFormNotice({
      type: 'info',
      message: `Configuración ${item.referenceCode} cargada en la calculadora (${fullTimeLabel}). Puedes modificar sus parámetros y actualizarla.`,
    });
    document.getElementById('presupuesto')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleDeleteSavedEstimate = (item: SavedEstimate) => {
    const now = new Date();
    const fullTimeLabel = `Hoy, ${now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    const historyEvent: EstimateHistoryEvent = {
      id: `hist-${Date.now()}`,
      estimateId: item.id,
      referenceCode: item.referenceCode,
      action: 'deleted',
      actionLabel: 'Eliminada del comparador',
      timestamp: fullTimeLabel,
      summary: `Presupuesto ${item.referenceCode} (${item.nombre} · ${item.totalPrice.toFixed(2)} €) eliminado de la lista.`,
    };

    setSavedEstimates((prev) => prev.filter((e) => e.id !== item.id));
    if (activeLoadedEstimateId === item.id) {
      setActiveLoadedEstimateId(null);
    }
    setChangeHistory((prev) => [historyEvent, ...prev]);

    if (currentUser) {
      void (async () => {
        try {
          await deleteDoc(doc(db, 'estimates', item.id));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `estimates/${item.id}`);
        }
        try {
          await setDoc(doc(db, 'estimateHistory', historyEvent.id), {
            ownerId: currentUser.uid,
            estimateId: historyEvent.estimateId.slice(0, 128),
            referenceCode: historyEvent.referenceCode.slice(0, 20),
            action: historyEvent.action,
            actionLabel: historyEvent.actionLabel.slice(0, 60),
            timestamp: historyEvent.timestamp.slice(0, 40),
            summary: historyEvent.summary.slice(0, 300),
            createdAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, `estimateHistory/${historyEvent.id}`);
        }
      })();
    }
  };

  // STL File handler with 50MB limit validation + FileReader ArrayBuffer for Three.js STLLoader
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setAttachedFile(null);
      setStlBuffer(null);
      setFileError(null);
      return;
    }

    const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setAttachedFile(null);
      setStlBuffer(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      const errorMsg = `El archivo "${file.name}" (${fileSizeMB} MB) supera el límite máximo permitido de 50 MB. Por favor, sube un archivo STL inferior a 50 MB o envíanoslo a info@project3d.es.`;
      setFileError(errorMsg);
      setFormNotice({
        type: 'error',
        message: errorMsg,
      });
      return;
    }

    setFileError(null);
    const sizeKB = Math.max(1, Math.round(file.size / 1024)).toLocaleString('es-ES');
    setAttachedFile({ name: file.name, sizeKB, sizeMB: fileSizeMB });

    const reader = new FileReader();
    reader.onload = (event) => {
      if (event.target?.result instanceof ArrayBuffer) {
        setStlBuffer(event.target.result);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleExportCSV = () => {
    if (savedEstimates.length === 0) return;
    const headers = [
      'Referencia',
      'Fecha',
      'Nombre',
      'Empresa',
      'Email',
      'Telefono',
      'Servicio',
      'Cantidad',
      'Material',
      'Complejidad',
      'Plazo Deseado',
      'Dimensiones y Volumen',
      'Factor Tamano',
      'Precio Unitario (EUR)',
      'Total Estimado (EUR)',
      'Observaciones',
    ];
    const rows = savedEstimates.map((item) => [
      item.referenceCode,
      `"${item.timestamp}"`,
      `"${item.nombre.replace(/"/g, '""')}"`,
      `"${item.empresa.replace(/"/g, '""')}"`,
      `"${item.email}"`,
      `"${item.telefono}"`,
      `"${item.servicioLabel}"`,
      item.cantidad,
      `"${item.materialLabel}"`,
      `"${item.complejidadLabel}"`,
      `"${item.plazoLabel}"`,
      `"${item.dimensionsSummary}"`,
      item.factorTamano.toFixed(2),
      item.unitPrice.toFixed(2),
      item.totalPrice.toFixed(2),
      `"${item.observaciones.replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `presupuestos_project3d_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCopySummary = (item: SavedEstimate) => {
    const summaryText = `Presupuesto Orientativo Project 3D (${item.referenceCode})
Contacto: ${item.nombre} · ${item.empresa} (${item.email} / ${item.telefono})
Servicio: ${item.servicioLabel} (x${item.servicioValue})
Cantidad: ${item.cantidad} uds.
Material: ${item.materialLabel} (x${item.materialValue})
Complejidad: ${item.complejidadLabel} (x${item.complejidadValue})
Plazo deseado: ${item.plazoLabel} (x${item.plazoValue})
Dimensiones STL: ${item.dimensionsSummary} (Factor tamaño x${item.factorTamano.toFixed(2)})
Estimación orientativa: ${item.totalPrice.toFixed(2)} € (${item.unitPrice.toFixed(2)} € / ud.)`;

    navigator.clipboard?.writeText(summaryText);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const toggleFaq = (idx: number) => {
    setOpenFaqIndices((prev) => (prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]));
  };

  const sendMessage = async (customText?: string) => {
    const textToSend = (customText ?? chatInput).trim();
    if (!textToSend || chatLoading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: textToSend,
    };

    const updatedHistory = [...chatMessages, userMsg];
    setChatMessages(updatedHistory);
    if (!customText) {
      setChatInput('');
    }
    setChatLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          history: updatedHistory,
        }),
      });

      if (!response.ok) {
        throw new Error('Error en la respuesta del servidor');
      }

      const data = (await response.json()) as { reply?: string };
      const reply = data.reply?.trim() || getBotResponse(textToSend);

      setChatMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: reply,
        },
      ]);
    } catch {
      const reply = getBotResponse(textToSend);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `b-${Date.now()}`,
          sender: 'bot',
          text: reply,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fa] text-[#1a1a1a]">
      {/* CABECERA DE NAVEGACIÓN (3-Zone Top Bar Contract) */}
      <header className="sticky top-0 z-40 bg-[#1a1a1a] text-white border-b border-neutral-800 px-6 py-4 no-print">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between gap-4">
          {/* Zone 1: Single text element wordmark */}
          <a href="#inicio" className="text-xl font-bold tracking-tight text-white whitespace-nowrap">
            PROJECT <span className="text-[#17a2b8]">3D</span>
          </a>

          {/* Zone 2: Clean text navigation links */}
          <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-neutral-300">
            <a href="#inicio" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Inicio
            </a>
            <a href="#quienes-somos" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Quiénes Somos
            </a>
            <a href="#servicios" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Servicios
            </a>
            <a href="#proceso" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Proceso
            </a>
            <a href="#galeria" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Galería
            </a>
            <a href="#presupuesto" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Presupuesto
            </a>
            <a href="#faq" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              FAQ
            </a>
            <a href="#contacto" className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap">
              Contacto
            </a>
          </nav>

          {/* Zone 3: Primary action + Firebase Auth */}
          <div className="flex items-center gap-2.5">
            {currentUser ? (
              <div className="flex items-center gap-2">
                <span
                  className="hidden sm:inline-flex items-center gap-1.5 text-xs text-neutral-300 font-medium truncate max-w-[160px]"
                  title={currentUser.email || currentUser.displayName || 'Usuario autenticado'}
                >
                  <Cloud className="w-3.5 h-3.5 text-[#17a2b8] shrink-0" />
                  {currentUser.displayName || currentUser.email}
                </span>
                <button
                  type="button"
                  onClick={handleGoogleSignOut}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-neutral-200 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Salir
                </button>
              </div>
            ) : (
              <GoogleSignInButton onClick={handleGoogleSignIn} label="Sign in with Google" />
            )}
            <a
              href="#presupuesto"
              className="px-4 py-2 text-xs font-bold text-white bg-[#0056b3] rounded-md hover:bg-[#003d80] transition-colors whitespace-nowrap shrink-0"
            >
              Solicita tu presupuesto
            </a>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* SECCIÓN HERO / INICIO (#inicio) */}
        <section id="inicio" className="relative bg-[#1a1a1a] text-white overflow-hidden no-print">
          <div className="absolute inset-0">
            {!imgFailed.hero && (
              <img
                src={heroImg}
                alt="Instalaciones de prototipado, diseño e impresión 3D de Project 3D en Torrijos"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed((prev) => ({ ...prev, hero: true }))}
                className="w-full h-full object-cover opacity-35"
              />
            )}
            <div
              className="absolute inset-0"
              style={{
                background: 'linear-gradient(135deg, rgba(26,26,26,0.92) 0%, rgba(0,86,179,0.82) 100%)',
              }}
            />
          </div>

          <div className="relative max-w-[1200px] mx-auto px-6 py-20 lg:py-24 text-center">
            <div className="inline-flex flex-wrap items-center justify-center gap-2 text-xs text-neutral-300 mb-4">
              <span>Polígono Industrial La Atalaya · Torrijos (Toledo)</span>
              <span aria-hidden="true">·</span>
              <span>Prototipado, Diseño e Impresión 3D</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-white max-w-3xl mx-auto leading-[1.15]">
              Materializamos tus ideas con Tecnología 3D
            </h1>

            <p className="text-base sm:text-lg text-neutral-200 max-w-2xl mx-auto mt-5 leading-relaxed">
              Soluciones de prototipado, diseño e impresión 3D orientadas a convertir ideas, diseños y necesidades
              concretas en piezas físicas de máxima precisión.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="#presupuesto"
                className="px-6 py-3.5 text-sm font-bold text-white bg-[#0056b3] hover:bg-[#003d80] rounded-md transition-colors whitespace-nowrap"
              >
                Solicita tu presupuesto
              </a>
              <a
                href="#contacto"
                className="px-6 py-3.5 text-sm font-bold text-white border-2 border-white hover:bg-white hover:text-[#1a1a1a] rounded-md transition-colors whitespace-nowrap"
              >
                Habla con nosotros
              </a>
            </div>
          </div>
        </section>

        {/* QUIÉNES SOMOS (#quienes-somos) */}
        <section id="quienes-somos" className="py-16 px-6 max-w-[1200px] mx-auto no-print">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">Quiénes Somos</h2>
            <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
            <div className="lg:col-span-7 bg-white border border-slate-200 border-t-4 border-t-[#0056b3] rounded-lg p-7 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="text-xs text-slate-500">
                  Comarca de Torrijos (Toledo) · Fabricación Digital y Aditiva
                </div>
                <h3 className="text-xl font-bold text-[#003d80]">
                  Soluciones de Fabricación Digital en Torrijos
                </h3>
                <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                  <strong className="text-slate-900">Project 3D</strong> es una empresa especializada en prototipado,
                  diseño y modelado 3D, impresión 3D y creación de piezas personalizadas situada en la comarca de
                  Torrijos (Toledo).
                </p>
                <p className="text-sm sm:text-base text-slate-700 leading-relaxed">
                  Nuestra misión es acercar las tecnologías de fabricación 3D a empresas, emprendedores, ingenieros,
                  profesionales y particulares mediante soluciones de diseño y producción adaptadas a cada necesidad.
                </p>
              </div>

              <div className="mt-6 pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 block">Sede física</span>
                  <span className="font-bold text-slate-900">Pol. Ind. La Atalaya, Torrijos</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Atención técnica</span>
                  <span className="font-mono-tabular font-bold text-slate-900">925 76 38 42</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Correo directo</span>
                  <span className="font-bold text-[#0056b3]">info@project3d.es</span>
                </div>
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#e9ecef] border border-slate-200 border-t-4 border-t-[#17a2b8] rounded-lg p-7 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-bold text-[#003d80] mb-4">Valores que nos definen</h3>
                <ul className="space-y-3.5 text-sm text-slate-800">
                  <li className="pb-3 border-b border-slate-300/70">
                    <strong className="text-slate-900">01. Innovación:</strong> Uso de técnicas avanzadas de fabricación
                    digital.
                  </li>
                  <li className="pb-3 border-b border-slate-300/70">
                    <strong className="text-slate-900">02. Precisión:</strong> Rigor técnico en dimensiones y ajuste.
                  </li>
                  <li className="pb-3 border-b border-slate-300/70">
                    <strong className="text-slate-900">03. Profesionalidad:</strong> Asesoramiento experto en cada fase.
                  </li>
                  <li>
                    <strong className="text-slate-900">04. Cercanía:</strong> Atención personalizada y directa al
                    cliente.
                  </li>
                </ul>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-300/80 text-xs text-slate-600">
                Frente al Vivero de Empresas Manuel Díaz Ruiz · Avenida de los Trabajadores, 20.
              </div>
            </div>
          </div>
        </section>

        {/* NUESTROS SERVICIOS (#servicios) */}
        <section id="servicios" className="py-16 px-6 bg-white border-y border-slate-200 no-print">
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">Nuestros Servicios</h2>
              <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
              <p className="text-sm text-slate-600 mt-3 max-w-xl mx-auto">
                Selecciona cualquier servicio para precargarlo directamente en la calculadora con Visor 3D.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {SERVICIOS_CATALOGO.map((srv) => (
                <div
                  key={srv.index}
                  className="bg-[#f8f9fa] border border-slate-200 border-t-4 border-t-[#0056b3] rounded-lg p-6 flex flex-col justify-between hover:border-slate-300 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                      <span className="font-mono-tabular font-bold text-[#0056b3]">{srv.index}. Servicio Project 3D</span>
                      <span className="font-mono-tabular">Coeficiente ×{srv.calcMultiplier.toFixed(1)}</span>
                    </div>
                    <h3 className="text-lg font-bold text-[#003d80] mb-2">{srv.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{srv.description}</p>
                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-200 flex items-center justify-between">
                    <a
                      href="#presupuesto"
                      onClick={() => setServicio(srv.calcMultiplier)}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0056b3] hover:text-[#003d80] transition-colors"
                    >
                      Calcular este servicio
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-[#f8f9fa] grid grid-cols-1 sm:grid-cols-12">
                <div className="sm:col-span-5 bg-slate-900 aspect-4/3 sm:aspect-auto">
                  {!imgFailed.proto && (
                    <img
                      src={prototypingImg}
                      alt="Prototipado y verificación dimensional con calibre digital"
                      referrerPolicy="no-referrer"
                      onError={() => setImgFailed((prev) => ({ ...prev, proto: true }))}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="sm:col-span-7 p-5 flex flex-col justify-center">
                  <div className="text-xs text-slate-500">Verificación Dimensional · Prototipado y CAD</div>
                  <h4 className="text-sm font-bold text-[#003d80] mt-1">
                    Comprobación de forma, encaje y funcionamiento
                  </h4>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Validamos tu diseño tridimensional antes de pasar a la fabricación definitiva o de utillaje.
                  </p>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden bg-[#f8f9fa] grid grid-cols-1 sm:grid-cols-12">
                <div className="sm:col-span-5 bg-slate-900 aspect-4/3 sm:aspect-auto">
                  {!imgFailed.batch && (
                    <img
                      src={batchImg}
                      alt="Fabricación de pequeñas series de piezas en bandeja 3D"
                      referrerPolicy="no-referrer"
                      onError={() => setImgFailed((prev) => ({ ...prev, batch: true }))}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
                <div className="sm:col-span-7 p-5 flex flex-col justify-center">
                  <div className="text-xs text-slate-500">Producción Flexible · Pequeñas Series</div>
                  <h4 className="text-sm font-bold text-[#003d80] mt-1">
                    Lotes cortos sujetos a revisión de viabilidad
                  </h4>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    Fabricación repetible de múltiples unidades de una misma pieza con coeficiente reducido (×0.9).
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PROCESO DE TRABAJO (7 PASOS) (#proceso) */}
        <section id="proceso" className="py-16 px-6 max-w-[1200px] mx-auto no-print">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">Proceso de Trabajo</h2>
            <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
            <p className="text-sm text-slate-600 mt-3">
              Metodología estructurada en 7 etapas desde la consulta inicial hasta la entrega final en Torrijos o envío.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {PROCESO_PASOS.map((item) => (
              <div
                key={item.step}
                className="bg-white border border-slate-200 border-b-[3px] border-b-[#17a2b8] rounded-lg p-4 text-center flex flex-col items-center shadow-2xs"
              >
                <div className="w-8 h-8 rounded-full bg-[#0056b3] text-white font-mono-tabular font-bold text-sm flex items-center justify-center mb-3">
                  {item.step}
                </div>
                <strong className="text-sm font-bold text-[#003d80] mb-1">{item.title}</strong>
                <p className="text-xs text-slate-600 leading-snug">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 6. GALERÍA DE TRABAJOS FILTRABLE POR CLIENTE (#galeria) */}
        <section id="galeria" className="py-16 px-6 bg-white border-t border-slate-200 no-print">
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">Galería de Trabajos</h2>
              <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
              <p className="text-sm text-slate-600 mt-3">
                Filtra casos de aplicación reales según el perfil de cliente y precárgalos en la calculadora 3D.
              </p>
            </div>

            {/* Barra de filtros (.filter-bar) */}
            <div className="filter-bar flex flex-wrap items-center justify-center gap-2.5 mb-8">
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'empresas', label: 'Empresas' },
                  { id: 'emprendedores', label: 'Emprendedores' },
                  { id: 'ingenieria', label: 'Diseñadores e Ingenieros' },
                  { id: 'particulares', label: 'Particulares' },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  onClick={() => setPortfolioFilter(btn.id)}
                  className={`filter-btn px-4 py-2 text-xs sm:text-sm font-bold rounded-md transition-colors cursor-pointer ${
                    portfolioFilter === btn.id
                      ? 'active bg-[#0056b3] text-white'
                      : 'bg-[#e9ecef] text-[#2b2b2b] hover:bg-slate-300'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Contenedor de proyectos (#portfolio-container) */}
            <div id="portfolio-container" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {PORTFOLIO_ITEMS.filter(
                (item) => portfolioFilter === 'all' || item.category === portfolioFilter
              ).map((item) => (
                <div
                  key={item.id}
                  className={`card portfolio-item ${item.category} bg-[#f8f9fa] border border-slate-200 border-t-4 border-t-[#0056b3] rounded-lg p-6 flex flex-col justify-between shadow-2xs transition-all`}
                >
                  <div>
                    <span className="text-xs font-bold text-[#17a2b8] tracking-wide block mb-1.5">
                      {item.badge}
                    </span>
                    <h3 className="text-base font-bold text-[#003d80] mb-2">{item.title}</h3>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{item.description}</p>
                  </div>

                  <div className="mt-5 pt-3.5 border-t border-slate-200/80">
                    <a
                      href="#presupuesto"
                      onClick={() => {
                        setServicio(item.presetServicio);
                        setMaterial(item.presetMaterial);
                        setComplejidad(item.presetComplejidad);
                      }}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0056b3] hover:text-[#003d80] transition-colors"
                    >
                      Presupuestar proyecto similar
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CALCULADORA DE PRESUPUESTOS CON VISOR 3D (#presupuesto) */}
        <section id="presupuesto" className="py-16 px-6 bg-white border-t border-slate-200">
          <div className="max-w-[1140px] mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">
                Project 3D - Calculadora de Presupuestos con Visor 3D
              </h2>
              <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
              <p className="text-sm text-slate-600 mt-3 max-w-2xl mx-auto">
                Sube tu archivo <span className="font-mono-tabular font-semibold">.STL</span> (máx. 50 MB) o utiliza
                una pieza de prueba para inspeccionar su geometría en 3D y calcular el volumen envolvente automáticamente.
              </p>
            </div>

            {/* Selector rápido de modelos STL de demostración */}
            <div className="mb-6 p-3.5 bg-[#f8f9fa] border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
              <div className="flex items-center gap-2 text-xs text-slate-700">
                <Box className="w-4 h-4 text-[#0056b3] shrink-0" />
                <span>
                  <strong>¿No tienes un archivo .STL a mano?</strong> Prueba el medidor 3D con una geometría de ejemplo:
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetToDefaultCube}
                  className={`px-3 py-1.5 text-xs font-semibold rounded border transition-colors cursor-pointer ${
                    !stlDims.isCustomStl
                      ? 'bg-[#0056b3] text-white border-[#0056b3]'
                      : 'bg-white text-slate-700 border-slate-300 hover:border-[#0056b3]'
                  }`}
                >
                  Cubo por defecto (30×30×30 mm)
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSampleStl('engranaje')}
                  className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-700 border border-slate-300 rounded hover:border-[#0056b3] hover:text-[#0056b3] transition-colors cursor-pointer"
                >
                  Corona cilíndrica (40×12×40 mm)
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSampleStl('soporte')}
                  className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-700 border border-slate-300 rounded hover:border-[#0056b3] hover:text-[#0056b3] transition-colors cursor-pointer"
                >
                  Soporte sensor (35×25×20 mm)
                </button>
                <button
                  type="button"
                  onClick={() => handleLoadSampleStl('carcasa')}
                  className="px-3 py-1.5 text-xs font-semibold bg-white text-slate-700 border border-slate-300 rounded hover:border-[#0056b3] hover:text-[#0056b3] transition-colors cursor-pointer"
                >
                  Carcasa (50×30×40 mm)
                </button>
              </div>
            </div>

            {/* Layout Grid: Columna Izquierda (Formulario) + Columna Derecha (Visor 3D + Resultado) */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
              <form id="presupuestoForm" onSubmit={handleFormalSubmit} noValidate>
                {/* RESUMEN DE ERRORES DE SEGURIDAD Y VALIDACIÓN EN LA PARTE SUPERIOR DEL FORMULARIO */}
                {submissionAttempted && formSecurityErrors.length > 0 && (
                  <div
                    id="resumen-errores-formulario"
                    role="alert"
                    aria-live="assertive"
                    className="mb-6 p-4 rounded-lg bg-red-50 border-l-4 border-l-red-600 border border-red-200 text-red-950 no-print"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-sm font-bold text-red-900">
                            Validación de seguridad: Se {formSecurityErrors.length === 1 ? 'ha detectado 1 error' : `han detectado ${formSecurityErrors.length} errores`} antes del envío
                          </h4>
                          <p className="text-xs text-red-800 mt-0.5">
                            Por seguridad e integridad de los datos técnicos, revisa y corrige los siguientes campos para poder registrar tu solicitud:
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSubmissionAttempted(false)}
                        className="text-red-500 hover:text-red-800 p-1 rounded cursor-pointer"
                        title="Ocultar aviso"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <ul className="mt-3 pt-2.5 border-t border-red-200/80 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                      {formSecurityErrors.map((err) => (
                        <li key={err.fieldId} className="flex items-start gap-2">
                          <span className="text-red-600 font-bold">•</span>
                          <button
                            type="button"
                            onClick={() => {
                              const el = document.getElementById(err.fieldId);
                              el?.focus();
                              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }}
                            className="text-left hover:underline cursor-pointer"
                          >
                            <strong className="font-bold text-red-950">{err.fieldLabel}:</strong>{' '}
                            <span className="text-red-800">{err.message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                  {/* COLUMNA IZQUIERDA: FORMULARIO DE PRESUPUESTO */}
                  <div className="space-y-5">
                    <div className="flex items-center justify-between border-b-2 border-[#17a2b8] pb-2">
                      <h3 className="text-base font-bold text-[#0056b3]">1. Datos de contacto</h3>
                      <button
                        type="button"
                        onClick={handleResetForm}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer no-print"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Reiniciar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div className="form-group">
                        <label htmlFor="nombre" className="block text-xs font-bold text-slate-800 mb-1">
                          Nombre:*
                        </label>
                        <input
                          type="text"
                          id="nombre"
                          value={nombre}
                          onChange={(e) => setNombre(e.target.value)}
                          required
                          aria-invalid={hasFieldError('nombre')}
                          placeholder="Tu nombre"
                          className={`w-full px-3 py-2 text-sm rounded focus:outline-none transition-colors ${
                            hasFieldError('nombre')
                              ? 'bg-red-50/40 border border-red-500 focus:border-red-600'
                              : 'bg-white border border-[#cccccc] focus:border-[#0056b3]'
                          }`}
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="empresa" className="block text-xs font-bold text-slate-800 mb-1">
                          Empresa (Opcional):
                        </label>
                        <input
                          type="text"
                          id="empresa"
                          value={empresa}
                          onChange={(e) => setEmpresa(e.target.value)}
                          aria-invalid={hasFieldError('empresa')}
                          placeholder="Nombre empresa"
                          className={`w-full px-3 py-2 text-sm rounded focus:outline-none transition-colors ${
                            hasFieldError('empresa')
                              ? 'bg-red-50/40 border border-red-500 focus:border-red-600'
                              : 'bg-white border border-[#cccccc] focus:border-[#0056b3]'
                          }`}
                        />
                      </div>

                      <div className="form-group">
                        <label htmlFor="email" className="block text-xs font-bold text-slate-800 mb-1">
                          Email:*
                        </label>
                        <div className="relative">
                          <input
                            type="email"
                            id="email"
                            value={email}
                            onChange={(e) => {
                              setEmail(e.target.value);
                              if (!emailTouched && e.target.value.length > 0) {
                                setEmailTouched(true);
                              }
                            }}
                            onBlur={() => {
                              if (email.length > 0) {
                                setEmailTouched(true);
                              }
                            }}
                            required
                            aria-invalid={emailValidation.status === 'invalid'}
                            aria-describedby="email-validation-feedback"
                            placeholder="correo@ejemplo.com"
                            className={`w-full pl-3 pr-9 py-2 text-sm rounded focus:outline-none transition-colors ${
                              emailValidation.status === 'valid'
                                ? 'bg-emerald-50/30 border border-emerald-500 text-slate-900 focus:border-emerald-600'
                                : emailValidation.status === 'invalid'
                                ? 'bg-red-50/40 border border-red-500 text-slate-900 focus:border-red-600'
                                : 'bg-white border border-[#cccccc] focus:border-[#0056b3]'
                            }`}
                          />
                          {emailValidation.status === 'valid' && (
                            <span
                              className=" inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none absolute text-emerald-600"
                              title="Email válido"
                            >
                              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            </span>
                          )}
                          {emailValidation.status === 'invalid' && (
                            <span
                              className=" inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none absolute text-red-600"
                              title="Email no válido"
                            >
                              <AlertCircle className="w-4 h-4" aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        {emailValidation.status !== 'idle' && (
                          <p
                            id="email-validation-feedback"
                            aria-live="polite"
                            className={`mt-1 text-[11px] font-medium flex items-center gap-1 ${
                              emailValidation.status === 'valid' ? 'text-emerald-700' : 'text-red-600'
                            }`}
                          >
                            {emailValidation.message}
                          </p>
                        )}
                      </div>

                      <div className="form-group">
                        <label htmlFor="telefono" className="block text-xs font-bold text-slate-800 mb-1">
                          Teléfono:*
                        </label>
                        <input
                          type="tel"
                          id="telefono"
                          value={telefono}
                          onChange={(e) => setTelefono(e.target.value)}
                          required
                          aria-invalid={hasFieldError('telefono')}
                          placeholder="925XX XX XX"
                          className={`w-full px-3 py-2 text-sm rounded focus:outline-none transition-colors ${
                            hasFieldError('telefono')
                              ? 'bg-red-50/40 border border-red-500 focus:border-red-600'
                              : 'bg-white border border-[#cccccc] focus:border-[#0056b3]'
                          }`}
                        />
                      </div>
                    </div>

                    <div className="border-b-2 border-[#17a2b8] pb-2 pt-2">
                      <h3 className="text-base font-bold text-[#0056b3]">2. Especificaciones del proyecto</h3>
                    </div>

                    {/* Servicio + Cantidad */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                      <div className="form-group">
                        <label htmlFor="servicio" className="block text-xs font-bold text-slate-800 mb-1">
                          Servicio:*
                        </label>
                        <select
                          id="servicio"
                          value={servicio}
                          onChange={(e) => setServicio(parseFloat(e.target.value))}
                          required
                          className="w-full px-3 py-2 text-sm bg-white border border-[#cccccc] rounded focus:outline-none focus:border-[#0056b3]"
                        >
                          <option value={1.0}>Prototipado 3D</option>
                          <option value={1.2}>Diseño y modelado 3D</option>
                          <option value={1.1}>Impresión 3D</option>
                          <option value={1.3}>Pieza personalizada</option>
                          <option value={0.9}>Pequeña serie</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="cantidad" className="block text-xs font-bold text-slate-800 mb-1">
                          Cantidad (Uds):*
                        </label>
                        <div className="flex items-center">
                          <button
                            type="button"
                            onClick={() => setCantidad((prev) => Math.max(1, prev - 1))}
                            aria-label="Reducir cantidad"
                            className="px-2.5 py-2 bg-[#e9ecef] border border-r-0 border-[#cccccc] rounded-l hover:bg-slate-300 text-slate-700 cursor-pointer"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="number"
                            id="cantidad"
                            min={1}
                            value={cantidad}
                            onChange={(e) => {
                              const parsed = parseInt(e.target.value, 10);
                              setCantidad(Number.isNaN(parsed) ? 1 : Math.max(1, parsed));
                            }}
                            required
                            className="w-full px-3 py-1.5 text-sm text-center font-mono-tabular bg-white border-y border-[#cccccc] focus:outline-none focus:border-[#0056b3]"
                          />
                          <button
                            type="button"
                            onClick={() => setCantidad((prev) => prev + 1)}
                            aria-label="Aumentar cantidad"
                            className="px-2.5 py-2 bg-[#e9ecef] border border-l-0 border-[#cccccc] rounded-r hover:bg-slate-300 text-slate-700 cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Material + Complejidad */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                      <div className="form-group">
                        <label htmlFor="material" className="block text-xs font-bold text-slate-800 mb-1">
                          Material:
                        </label>
                        <select
                          id="material"
                          value={material}
                          onChange={(e) => setMaterial(parseFloat(e.target.value))}
                          className="w-full px-3 py-2 text-sm bg-white border border-[#cccccc] rounded focus:outline-none focus:border-[#0056b3]"
                        >
                          <option value={1.0}>Estándar (Pendiente de confirmar)</option>
                          <option value={1.5}>Avanzado / Técnico (Pendiente de confirmar)</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="complejidad" className="block text-xs font-bold text-slate-800 mb-1">
                          Complejidad:*
                        </label>
                        <select
                          id="complejidad"
                          value={complejidad}
                          onChange={(e) => setComplejidad(parseFloat(e.target.value))}
                          required
                          className="w-full px-3 py-2 text-sm bg-white border border-[#cccccc] rounded focus:outline-none focus:border-[#0056b3]"
                        >
                          <option value={1.0}>Baja</option>
                          <option value={1.4}>Media</option>
                          <option value={1.8}>Alta</option>
                        </select>
                      </div>
                    </div>

                    {/* Plazo deseado + Cargar Archivo STL */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                      <div className="form-group">
                        <label htmlFor="plazo" className="block text-xs font-bold text-slate-800 mb-1">
                          Plazo Deseado:*
                        </label>
                        <select
                          id="plazo"
                          value={plazo}
                          onChange={(e) => setPlazo(parseFloat(e.target.value))}
                          required
                          className="w-full px-3 py-2 text-sm bg-white border border-[#cccccc] rounded focus:outline-none focus:border-[#0056b3]"
                        >
                          <option value={1.0}>Normal</option>
                          <option value={1.3}>Urgente</option>
                          <option value={1.1}>Fecha determinada</option>
                        </select>
                      </div>

                      <div className="form-group no-print">
                        <div className="flex items-center justify-between mb-1">
                          <label htmlFor="archivoStl" className="block text-xs font-bold text-slate-800">
                            Cargar Archivo STL:
                          </label>
                          <span className="text-[11px] font-mono-tabular text-slate-500">Máx. 50 MB</span>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          id="archivoStl"
                          accept=".stl"
                          onChange={handleFileChange}
                          className={`w-full text-xs p-1.5 rounded border cursor-pointer transition-colors file:mr-2 file:py-1 file:px-2.5 file:rounded file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-white file:text-slate-800 hover:file:border-[#0056b3] ${
                            fileError
                              ? 'border-red-500 bg-red-50'
                              : attachedFile
                              ? 'border-emerald-400 bg-emerald-50/40'
                              : 'border-[#cccccc] bg-[#e9ecef]'
                          }`}
                        />
                        {attachedFile && (
                          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-600">
                            <span className="font-mono-tabular truncate max-w-[160px]">
                              <FileCode2 className="w-3 h-3 inline mr-1 text-[#0056b3]" />
                              {attachedFile.sizeKB} KB ({attachedFile.sizeMB} MB)
                            </span>
                            <button
                              type="button"
                              onClick={handleResetToDefaultCube}
                              className="text-red-600 hover:underline font-semibold cursor-pointer"
                            >
                              Quitar STL
                            </button>
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="text-slate-500">Muestras STL:</span>
                          <button
                            type="button"
                            onClick={() => handleLoadSampleStl('soporte')}
                            className="px-2 py-0.5 bg-white border border-slate-300 hover:border-[#0056b3] text-slate-700 rounded font-medium cursor-pointer"
                          >
                            STL Estanco (OK)
                          </button>
                          <button
                            type="button"
                            onClick={() => handleLoadSampleStl('defectuoso')}
                            className="px-2 py-0.5 bg-amber-50 border border-amber-300 hover:border-amber-500 text-amber-900 rounded font-medium cursor-pointer"
                          >
                            STL con Errores (No estanco / Caras invertidas)
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Alerta visual de exceso de límite 50MB */}
                    {fileError && (
                      <div
                        role="alert"
                        className="p-3 rounded-md bg-red-50 border border-red-300 text-red-800 text-xs flex items-start justify-between gap-3"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          <div>
                            <strong className="font-bold block text-red-900">
                              Límite de tamaño superado (Máximo 50 MB)
                            </strong>
                            <span className="mt-0.5 block leading-relaxed">{fileError}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setFileError(null)}
                          aria-label="Cerrar alerta de tamaño"
                          className="text-red-500 hover:text-red-800 cursor-pointer shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Observaciones */}
                    <div className="form-group">
                      <label htmlFor="observaciones" className="block text-xs font-bold text-slate-800 mb-1">
                        Observaciones:
                      </label>
                      <textarea
                        id="observaciones"
                        rows={2}
                        value={observaciones}
                        onChange={(e) => setObservaciones(e.target.value)}
                        placeholder="Detalles o especificaciones adicionales..."
                        className="w-full px-3 py-2 text-sm bg-white border border-[#cccccc] rounded focus:outline-none focus:border-[#0056b3]"
                      />
                    </div>

                    <div className="pt-2 flex flex-wrap items-center gap-3 no-print">
                      <button
                        type="submit"
                        className="w-full inline-flex items-center justify-center gap-2 bg-[#1a1a1a] hover:bg-neutral-800 text-white font-bold py-3 px-4 rounded text-xs sm:text-sm transition-colors cursor-pointer"
                      >
                        <Send className="w-4 h-4" />
                        Registrar Solicitud Técnica con este Modelo
                      </button>
                    </div>

                    {formNotice && (
                      <div
                        role="status"
                        className={`p-3 rounded border text-xs flex items-start gap-2 ${
                          formNotice.type === 'error'
                            ? 'bg-red-50 border-red-200 text-red-800'
                            : formNotice.type === 'success'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                            : 'bg-sky-50 border-sky-200 text-slate-800'
                        }`}
                      >
                        {formNotice.type === 'error' ? (
                          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-[#0056b3] shrink-0 mt-0.5" />
                        )}
                        <span>{formNotice.message}</span>
                      </div>
                    )}
                  </div>

                  {/* COLUMNA DERECHA: VISOR 3D INTERACTIVO Y RESULTADO */}
                  <div className="viewer-section flex flex-col">
                    <StlViewer
                      stlBuffer={stlBuffer}
                      fileName={attachedFile?.name || null}
                      onDimensionsCalculated={handleDimensionsCalculated}
                      onResetToDefault={handleResetToDefaultCube}
                    />

                    {/* Cuadro de dimensiones estimadas (#dim-info) */}
                    <div
                      id="dim-info"
                      className="dim-box mt-2.5 bg-[#eef7f9] border border-[#17a2b8] p-3 rounded text-xs text-[#004085]"
                    >
                      <span id="dim-text" className="font-mono-tabular">
                        {stlDims.label}
                      </span>
                    </div>

                    {/* Validación técnica de estanqueidad (Manifold) y orientación de caras del archivo STL */}
                    {stlDims.isCustomStl && stlDims.diagnostics && (
                      <div
                        id="diagnostico-geometria-stl"
                        role="status"
                        aria-live="polite"
                        className={`mt-2.5 p-3.5 rounded border text-xs space-y-2 ${
                          stlDims.diagnostics.needsRepair
                            ? 'bg-amber-50 border-amber-300 text-amber-950'
                            : 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2">
                            {stlDims.diagnostics.needsRepair ? (
                              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            ) : (
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            )}
                            <div>
                              <strong className="font-bold block">
                                {stlDims.diagnostics.statusTitle}
                              </strong>
                              <p className="text-[11px] mt-0.5 leading-relaxed opacity-90">
                                {stlDims.diagnostics.summaryMessage}
                              </p>
                            </div>
                          </div>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                              stlDims.diagnostics.needsRepair
                                ? 'bg-amber-200 text-amber-900'
                                : 'bg-emerald-200 text-emerald-900'
                            }`}
                          >
                            {stlDims.diagnostics.needsRepair ? 'Requiere reparación' : 'Manifold OK'}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-black/10 font-mono-tabular text-[11px]">
                          <div>
                            <span className="opacity-75 block">Estanqueidad:</span>
                            <span className="font-bold">
                              {stlDims.diagnostics.isManifold ? 'Estanca (Cerrada)' : 'No estanca'}
                            </span>
                          </div>
                          <div>
                            <span className="opacity-75 block">Bordes abiertos:</span>
                            <span className="font-bold">{stlDims.diagnostics.openEdges}</span>
                          </div>
                          <div>
                            <span className="opacity-75 block">Caras invertidas:</span>
                            <span className="font-bold">
                              {stlDims.diagnostics.invertedNormalEdges + stlDims.diagnostics.invertedFileNormals}
                            </span>
                          </div>
                          <div>
                            <span className="opacity-75 block">Triángulos / Vértices:</span>
                            <span className="font-bold">
                              {stlDims.diagnostics.triangleCount} / {stlDims.diagnostics.vertexCount}
                            </span>
                          </div>
                        </div>

                        {stlDims.diagnostics.issues.length > 0 && (
                          <ul className="space-y-1 pt-1 text-[11px] list-disc list-inside">
                            {stlDims.diagnostics.issues.map((issue, idx) => (
                              <li key={idx} className="leading-snug">
                                {issue}
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="pt-2 border-t border-black/10 flex flex-wrap items-center gap-2 no-print">
                          <button
                            type="button"
                            onClick={handleExportStlDiagnosticsPdf}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold text-white bg-[#0056b3] hover:bg-[#003d80] rounded transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Exportar Informe Técnico PDF
                          </button>

                          {stlDims.diagnostics.needsRepair && (
                            <>
                              <button
                                type="button"
                                onClick={handleAutoRepairCurrentStl}
                                className="px-2.5 py-1.5 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors cursor-pointer"
                              >
                                Reparar malla y orientar normales ahora
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const note =
                                    '[Aviso técnico STL: El archivo requiere revisión/reparación de estanqueidad (manifold) o caras invertidas antes de la fabricación]';
                                  setObservaciones((prev) =>
                                    prev.includes('Aviso técnico STL')
                                      ? prev
                                      : prev.trim()
                                      ? `${prev.trim()} ${note}`
                                      : note
                                  );
                                }}
                                className="px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 bg-white border border-amber-300 hover:bg-amber-100 rounded transition-colors cursor-pointer"
                              >
                                Incluir solicitud de reparación en Observaciones
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Botón de cálculo (.btn-calc) */}
                    <button
                      type="button"
                      onClick={() => calcularPresupuesto()}
                      className="btn btn-primary btn-calc mt-3.5 w-full bg-[#0056b3] hover:bg-[#003d80] text-white font-bold py-3.5 px-5 rounded text-sm sm:text-base transition-colors cursor-pointer inline-flex items-center justify-center gap-2 no-print"
                    >
                      <Calculator className="w-4 h-4" />
                      Calcula tu presupuesto
                    </button>

                    {/* Resultado (#resultadoCalc y #precioEstimado) */}
                    <div
                      id="resultadoCalc"
                      className={`result-box mt-4 p-4 sm:p-5 bg-[#e9ecef] border-l-[5px] border-l-[#0056b3] rounded-r transition-opacity ${
                        resultadoVisible ? 'block opacity-100' : 'opacity-95'
                      }`}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h4 className="text-lg sm:text-xl font-bold text-[#003d80]">
                          Estimación orientativa:{' '}
                          <span id="precioEstimado" className="font-mono-tabular text-2xl text-[#0056b3]">
                            {calculation.total.toFixed(2)}
                          </span>{' '}
                          €
                        </h4>
                        <span className="text-xs font-mono-tabular text-slate-600">
                          {calculation.unitPrice.toFixed(2)} € / ud. ({calculation.safeQty}{' '}
                          {calculation.safeQty === 1 ? 'ud.' : 'uds.'})
                        </span>
                      </div>

                      {/* Desglose compacto de la fórmula con volumen STL */}
                      <div className="mt-3 pt-3 border-t border-slate-300 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] text-slate-700 font-mono-tabular">
                        <div>Base: {TARIFA_BASE.toFixed(2)} €</div>
                        <div>Servicio: ×{servicio.toFixed(1)}</div>
                        <div>Material: ×{material.toFixed(1)}</div>
                        <div>Complejidad: ×{complejidad.toFixed(1)}</div>
                        <div>Plazo: ×{plazo.toFixed(1)}</div>
                        <div className="font-bold text-[#0056b3]">
                          Factor Volumen: ×{calculation.factorTamano.toFixed(2)}
                        </div>
                      </div>

                      <p className="nota text-xs text-[#555555] mt-3 leading-relaxed">
                        <strong className="text-slate-900">Importante:</strong> El resultado es una estimación
                        orientativa. El precio definitivo debe ser confirmado por Project 3D después de revisar el
                        proyecto y los archivos correspondientes.
                      </p>

                      {submittedRefCode && (
                        <div className="mt-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-950 space-y-1.5">
                          <div className="font-semibold">
                            Referencia registrada: <span className="font-mono-tabular">{submittedRefCode}</span>
                          </div>
                          {quoteEmailsStatus.status === 'sent' && (
                            <div className="text-[11px] text-emerald-800 flex items-start gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span>{quoteEmailsStatus.message}</span>
                            </div>
                          )}
                          {quoteEmailsStatus.status === 'error' && (
                            <div className="text-[11px] text-red-700 flex items-start justify-between gap-2">
                              <span>{quoteEmailsStatus.message}</span>
                              {savedEstimates[0] && (
                                <button
                                  type="button"
                                  onClick={() => setPendingQuoteEmailEntry(savedEstimates[0])}
                                  className="underline font-bold shrink-0 cursor-pointer"
                                >
                                  Reintentar envío Gmail
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="mt-3.5 pt-3 border-t border-slate-300 flex flex-wrap items-center gap-2 no-print">
                        <button
                          type="button"
                          onClick={handleSaveToComparator}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-[#0056b3] hover:bg-[#003d80] rounded transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Guardar Nueva en Comparador
                        </button>
                        {activeLoadedEstimateId && savedEstimates.some((e) => e.id === activeLoadedEstimateId) && (
                          <button
                            type="button"
                            onClick={() => handleUpdateSavedEstimate()}
                            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-[#17a2b8] hover:bg-[#138496] rounded transition-colors cursor-pointer whitespace-nowrap"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            Actualizar{' '}
                            {savedEstimates.find((e) => e.id === activeLoadedEstimateId)?.referenceCode}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => window.print()}
                          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:border-slate-400 rounded transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Imprimir
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </form>
            </div>

            {/* SUBSECCIÓN COMPARADOR CON GRÁFICO DE BARRAS RECHARTS */}
            <div id="comparador" className="mt-14 pt-12 border-t border-slate-200 no-print">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-xl font-bold text-[#003d80]">
                    Comparador Visual de Estimaciones Guardadas
                  </h3>
                  <p className="text-xs text-slate-600">
                    Compara el Total Orientativo (€) entre distintos modelos STL, materiales, plazos y cantidades.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  {currentUser ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md">
                      <Cloud className="w-3.5 h-3.5 text-emerald-600" />
                      Sincronizado en Firebase ({currentUser.email || currentUser.displayName})
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0056b3] bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <LogIn className="w-3.5 h-3.5" />
                      Iniciar sesión con Google para guardar en la nube
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleExportCSV}
                    disabled={savedEstimates.length === 0}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md hover:border-slate-400 disabled:opacity-40 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exportar CSV
                  </button>
                </div>
              </div>

              {savedEstimates.length === 0 ? (
                <div className="border border-slate-200 rounded-lg p-8 text-center bg-[#f8f9fa]">
                  <p className="text-sm font-semibold text-slate-800">
                    No hay estimaciones guardadas en el comparador
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Pulsa en «Guardar en Comparador» bajo el visor 3D para analizar varias opciones en el gráfico.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Gráficos Recharts en paralelo: BarChart (Total Orientativo) + PieChart (Distribución de Materiales) */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                    {/* Recharts BarChart */}
                    <div className="lg:col-span-7 border border-slate-200 rounded-lg p-5 sm:p-6 bg-[#f8f9fa] flex flex-col justify-between">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                        <div className="flex items-center gap-2.5">
                          <BarChart3 className="w-4 h-4 text-[#0056b3] shrink-0" />
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">
                              Gráfico Comparativo de Total Orientativo (€)
                            </h4>
                            <p className="text-xs text-slate-500">
                              Haz clic sobre cualquier barra para cargar sus parámetros en la calculadora.
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs font-mono-tabular">
                          <div>
                            <span className="text-slate-500">Mínimo: </span>
                            <span className="font-semibold text-slate-900">
                              {Math.min(...savedEstimates.map((e) => e.totalPrice)).toFixed(2)} €
                            </span>
                          </div>
                          <span aria-hidden="true" className="text-slate-300">·</span>
                          <div>
                            <span className="text-slate-500">Máximo: </span>
                            <span className="font-semibold text-[#0056b3]">
                              {Math.max(...savedEstimates.map((e) => e.totalPrice)).toFixed(2)} €
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="h-72 w-full bg-white border border-slate-200 rounded-md p-4">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={[...savedEstimates].reverse()}
                            margin={{ top: 12, right: 20, left: 8, bottom: 8 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis
                              dataKey="referenceCode"
                              tick={{ fontSize: 12, fill: '#334155', fontFamily: 'JetBrains Mono, monospace' }}
                              axisLine={{ stroke: '#CBD5E1' }}
                              tickLine={false}
                            />
                            <YAxis
                              tickFormatter={(val: number) => `${val} €`}
                              tick={{ fontSize: 11, fill: '#475569', fontFamily: 'JetBrains Mono, monospace' }}
                              axisLine={false}
                              tickLine={false}
                              width={68}
                            />
                            <Tooltip
                              cursor={{ fill: '#F1F5F9' }}
                              content={({ active, payload }) => {
                                if (!active || !payload || !payload.length) return null;
                                const data = payload[0].payload as SavedEstimate;
                                return (
                                  <div className="bg-[#1a1a1a] text-white p-3 rounded-md shadow-md border border-neutral-700 text-xs space-y-1">
                                    <div className="font-mono-tabular font-bold text-[#17a2b8]">
                                      {data.referenceCode} · {data.servicioLabel}
                                    </div>
                                    <div className="text-neutral-200 font-semibold">{data.nombre}</div>
                                    <div className="text-neutral-400 text-[11px]">{data.dimensionsSummary}</div>
                                    <div className="text-neutral-400 text-[11px]">
                                      {data.cantidad} uds. · Complejidad {data.complejidadLabel} · Plazo {data.plazoLabel}
                                    </div>
                                    <div className="pt-1.5 mt-1.5 border-t border-neutral-700 flex items-center justify-between gap-4 font-mono-tabular">
                                      <span className="text-neutral-300">Total Orientativo:</span>
                                      <span className="font-bold text-white text-sm">{data.totalPrice.toFixed(2)} €</span>
                                    </div>
                                    <div className="flex items-center justify-between gap-4 font-mono-tabular text-[11px] text-neutral-400">
                                      <span>Coste unitario:</span>
                                      <span>{data.unitPrice.toFixed(2)} € / ud.</span>
                                    </div>
                                  </div>
                                );
                              }}
                            />
                            <Bar
                              dataKey="totalPrice"
                              name="Total Orientativo (€)"
                              radius={[4, 4, 0, 0]}
                              maxBarSize={64}
                              onClick={(barData) => {
                                if (barData && barData.payload) {
                                  handleLoadFromSaved(barData.payload as SavedEstimate);
                                }
                              }}
                              className="cursor-pointer"
                            >
                              {[...savedEstimates].reverse().map((entry, index) => (
                                <Cell
                                  key={`cell-${entry.id}`}
                                  fill={index === savedEstimates.length - 1 ? '#0056b3' : '#17a2b8'}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Recharts PieChart: Distribución Porcentual de Materiales */}
                    <div className="lg:col-span-5 border border-slate-200 rounded-lg p-5 sm:p-6 bg-[#f8f9fa] flex flex-col justify-between">
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="flex items-center gap-2.5">
                          <PieChartIcon className="w-4 h-4 text-[#17a2b8] shrink-0" />
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">
                              Distribución de Materiales (%)
                            </h4>
                            <p className="text-xs text-slate-500">
                              Reparto porcentual en las {savedEstimates.length} estimaciones guardadas.
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="bg-white border border-slate-200 rounded-md p-4 flex flex-col justify-between flex-1">
                        <div className="h-48 w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={materialDistribution}
                                dataKey="count"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={42}
                                outerRadius={72}
                                paddingAngle={3}
                                stroke="#ffffff"
                                strokeWidth={2}
                                label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                                labelLine={true}
                              >
                                {materialDistribution.map((entry) => (
                                  <Cell key={`pie-cell-${entry.key}`} fill={entry.color} />
                                ))}
                              </Pie>
                              <Tooltip
                                content={({ active, payload }) => {
                                  if (!active || !payload || !payload.length) return null;
                                  const data = payload[0].payload as (typeof materialDistribution)[number];
                                  return (
                                    <div className="bg-[#1a1a1a] text-white p-3 rounded-md shadow-md border border-neutral-700 text-xs space-y-1">
                                      <div className="font-bold text-[#17a2b8] flex items-center gap-1.5">
                                        <span
                                          className="w-2.5 h-2.5 rounded-xs inline-block"
                                          style={{ backgroundColor: data.color }}
                                        />
                                        <span>{data.name} (×{data.multiplier.toFixed(1)})</span>
                                      </div>
                                      <div className="text-neutral-300 text-[11px]">{data.fullLabel}</div>
                                      <div className="pt-1.5 mt-1 border-t border-neutral-700 flex items-center justify-between gap-4 font-mono-tabular">
                                        <span className="text-neutral-300">Porcentaje:</span>
                                        <span className="font-bold text-white text-sm">{data.percentage.toFixed(1)}%</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-4 font-mono-tabular text-[11px] text-neutral-400">
                                        <span>Presupuestos:</span>
                                        <span>
                                          {data.count} de {savedEstimates.length} ({data.totalUnits} uds.)
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between gap-4 font-mono-tabular text-[11px] text-neutral-400">
                                        <span>Importe acumulado:</span>
                                        <span>{data.totalAmount.toFixed(2)} €</span>
                                      </div>
                                    </div>
                                  );
                                }}
                              />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>

                        {/* Leyenda detallada con porcentajes y conteo */}
                        <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
                          {materialDistribution.map((item) => (
                            <div
                              key={item.key}
                              className="flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="w-3 h-3 rounded-xs shrink-0"
                                  style={{ backgroundColor: item.color }}
                                />
                                <span className="font-semibold text-slate-800 truncate">{item.name}</span>
                                <span className="text-[11px] text-slate-500 font-mono-tabular">
                                  (×{item.multiplier.toFixed(1)})
                                </span>
                              </div>
                              <div className="flex items-center gap-2 font-mono-tabular shrink-0">
                                <span className="text-slate-500 text-[11px]">
                                  {item.count} {item.count === 1 ? 'est.' : 'ests.'}
                                </span>
                                <span className="font-bold text-slate-900 min-w-[46px] text-right">
                                  {item.percentage.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Tabla de Estimaciones Guardadas */}
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-200 bg-[#f8f9fa] text-[11px] font-semibold text-slate-600">
                          <th className="py-3 px-4">Ref. / Creación</th>
                          <th className="py-3 px-4">Última Modificación / Carga</th>
                          <th className="py-3 px-4">Contacto / Empresa</th>
                          <th className="py-3 px-4">Servicio y Modelo STL</th>
                          <th className="py-3 px-4">Dimensiones y Parámetros</th>
                          <th className="py-3 px-4 text-right">Cantidad</th>
                          <th className="py-3 px-4 text-right">Unitario</th>
                          <th className="py-3 px-4 text-right">Total Orientativo</th>
                          <th className="py-3 px-4 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs bg-white">
                        {savedEstimates.map((item) => (
                          <tr
                            key={item.id}
                            className={`hover:bg-slate-50/80 transition-colors ${
                              activeLoadedEstimateId === item.id ? 'bg-sky-50/60' : ''
                            }`}
                          >
                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono-tabular font-semibold text-slate-900">
                                  {item.referenceCode}
                                </span>
                                {activeLoadedEstimateId === item.id && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#0056b3] text-white rounded">
                                    En edición
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500">Creado: {item.timestamp}</div>
                            </td>
                            <td className="py-3.5 px-4 align-top whitespace-nowrap">
                              <div className="text-[11px] font-mono-tabular text-slate-700">
                                <span className="text-slate-500">Modif.:</span>{' '}
                                <span className="font-semibold text-slate-900">{item.lastModifiedAt}</span>
                                {item.modificationCount > 0 && (
                                  <span className="ml-1 text-[10px] text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                                    {item.modificationCount}×
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono-tabular text-slate-600 mt-1">
                                <span className="text-slate-500">Carga:</span>{' '}
                                <span
                                  className={`font-semibold ${
                                    item.lastLoadedAt ? 'text-[#0056b3]' : 'text-slate-400'
                                  }`}
                                >
                                  {item.lastLoadedAt ?? 'Sin cargar'}
                                </span>
                                {item.loadCount > 0 && (
                                  <span className="ml-1 text-[10px] text-[#0056b3] bg-sky-100 px-1.5 py-0.5 rounded">
                                    {item.loadCount}×
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-semibold text-slate-900">{item.nombre}</div>
                              <div className="text-[11px] text-slate-600 flex items-center gap-1">
                                <Building2 className="w-3 h-3 text-slate-400 shrink-0" />
                                <span>{item.empresa}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-semibold text-slate-800">{item.servicioLabel}</div>
                              {item.fileName && (
                                <div className="text-[11px] text-[#0056b3] font-mono-tabular mt-0.5">
                                  {item.fileName}
                                </div>
                              )}
                            </td>
                            <td className="py-3.5 px-4 align-top">
                              <div className="font-mono-tabular text-slate-800 text-[11px]">
                                {item.dimensionsSummary} (×{item.factorTamano.toFixed(2)})
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {item.materialLabel} · Complejidad {item.complejidadLabel}
                              </div>
                              <div className="text-[11px] text-slate-600 flex items-center gap-1 mt-0.5">
                                <Clock className="w-3 h-3 text-[#0056b3] shrink-0" />
                                <span>Plazo: {item.plazoLabel}</span>
                              </div>
                            </td>
                            <td className="py-3.5 px-4 align-top text-right font-mono-tabular font-semibold text-slate-800 whitespace-nowrap">
                              {item.cantidad} uds.
                            </td>
                            <td className="py-3.5 px-4 align-top text-right font-mono-tabular text-slate-600 whitespace-nowrap">
                              {item.unitPrice.toFixed(2)} €
                            </td>
                            <td className="py-3.5 px-4 align-top text-right font-mono-tabular font-bold text-[#0056b3] whitespace-nowrap">
                              {item.totalPrice.toFixed(2)} €
                            </td>
                            <td className="py-3.5 px-4 align-top text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleLoadFromSaved(item)}
                                  className="px-2.5 py-1 text-[11px] font-semibold text-[#0056b3] hover:bg-sky-50 rounded border border-slate-200 transition-colors cursor-pointer"
                                  title="Cargar en calculadora"
                                >
                                  Cargar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSavedEstimate(item.id)}
                                  className="px-2 py-1 text-[11px] font-semibold text-slate-700 hover:text-[#0056b3] hover:bg-slate-100 rounded border border-slate-200 transition-colors cursor-pointer inline-flex items-center gap-1"
                                  title="Sobrescribir esta estimación con los parámetros actuales de la calculadora"
                                >
                                  <RefreshCw className="w-3 h-3" />
                                  Actualizar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleCopySummary(item)}
                                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded border border-slate-200 transition-colors cursor-pointer"
                                  title="Copiar resumen"
                                >
                                  {copiedId === item.id ? (
                                    <Check className="w-3.5 h-3.5 text-emerald-600" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSavedEstimate(item)}
                                  className="p-1.5 text-slate-400 hover:text-red-600 rounded border border-slate-200 transition-colors cursor-pointer"
                                  title="Eliminar"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* SECCIÓN DE HISTORIAL DE CAMBIOS Y CARGAS DE ESTIMACIONES */}
                  <div
                    id="historial-cambios"
                    className="border border-slate-200 rounded-lg p-5 sm:p-6 bg-[#f8f9fa]"
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
                      <div className="flex items-center gap-2.5">
                        <History className="w-4 h-4 text-[#0056b3] shrink-0" />
                        <div>
                          <h4 className="text-sm font-bold text-slate-900">
                            Historial de Cambios de Estimaciones Guardadas
                          </h4>
                          <p className="text-xs text-slate-500">
                            Consulta cuándo se modificó o cargó por última vez cada configuración y revisa el registro cronológico de actividad.
                          </p>
                        </div>
                      </div>

                      {/* Filtros de historial por tipo de acción y por referencia */}
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <select
                          aria-label="Filtrar por configuración"
                          value={historyRefFilter}
                          onChange={(e) => setHistoryRefFilter(e.target.value)}
                          className="px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded font-mono-tabular text-slate-800 focus:outline-none focus:border-[#0056b3]"
                        >
                          <option value="all">Todas las referencias ({savedEstimates.length})</option>
                          {savedEstimates.map((est) => (
                            <option key={est.id} value={est.referenceCode}>
                              {est.referenceCode} — {est.nombre}
                            </option>
                          ))}
                        </select>

                        <div className="inline-flex rounded border border-slate-300 bg-white overflow-hidden">
                          {(
                            [
                              { id: 'all', label: 'Todos' },
                              { id: 'modified', label: 'Modificados' },
                              { id: 'loaded', label: 'Cargados' },
                              { id: 'created', label: 'Creados' },
                            ] as const
                          ).map((tab) => (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setHistoryActionFilter(tab.id)}
                              className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                                historyActionFilter === tab.id
                                  ? 'bg-[#0056b3] text-white'
                                  : 'text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Resumen de última modificación y última carga por cada configuración guardada */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-5">
                      {savedEstimates.map((est) => (
                        <div
                          key={`status-${est.id}`}
                          className={`bg-white border rounded-md p-4 text-xs flex flex-col justify-between gap-2.5 transition-colors ${
                            activeLoadedEstimateId === est.id
                              ? 'border-[#0056b3] ring-1 ring-[#0056b3]/20'
                              : 'border-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono-tabular font-bold text-[#003d80] text-sm">
                                  {est.referenceCode}
                                </span>
                                {activeLoadedEstimateId === est.id && (
                                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#0056b3] text-white rounded">
                                    Cargada ahora
                                  </span>
                                )}
                              </div>
                              <span className="font-mono-tabular font-bold text-[#0056b3]">
                                {est.totalPrice.toFixed(2)} €
                              </span>
                            </div>
                            <div className="text-slate-800 font-semibold truncate mt-1">
                              {est.nombre}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate">
                              {est.servicioLabel} · {est.cantidad} uds. · Plazo {est.plazoLabel}
                            </div>
                          </div>

                          <div className="pt-2.5 border-t border-slate-100 space-y-1.5 font-mono-tabular text-[11px]">
                            <div className="flex items-center justify-between text-slate-600">
                              <span>Última modificación:</span>
                              <span className="font-semibold text-slate-900">{est.lastModifiedAt}</span>
                            </div>
                            <div className="flex items-center justify-between text-slate-600">
                              <span>Última carga:</span>
                              <span
                                className={`font-semibold ${
                                  est.lastLoadedAt ? 'text-[#0056b3]' : 'text-slate-400'
                                }`}
                              >
                                {est.lastLoadedAt ?? 'Nunca cargada'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                              <span>Modificaciones: {est.modificationCount}</span>
                              <span>Veces cargada: {est.loadCount}</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handleLoadFromSaved(est)}
                              className="flex-1 py-1.5 px-2 text-[11px] font-semibold text-[#0056b3] bg-sky-50 hover:bg-sky-100 border border-sky-200 rounded transition-colors cursor-pointer text-center"
                            >
                              Cargar configuración
                            </button>
                            <button
                              type="button"
                              onClick={() => handleUpdateSavedEstimate(est.id)}
                              className="py-1.5 px-2.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded transition-colors cursor-pointer inline-flex items-center gap-1"
                              title="Actualizar con los valores actuales de la calculadora"
                            >
                              <RefreshCw className="w-3 h-3" />
                              Modificar
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Registro cronológico detallado de eventos */}
                    <div className="bg-white border border-slate-200 rounded-md divide-y divide-slate-200 max-h-64 overflow-y-auto">
                      {changeHistory
                        .filter(
                          (ev) =>
                            (historyActionFilter === 'all' || ev.action === historyActionFilter) &&
                            (historyRefFilter === 'all' || ev.referenceCode === historyRefFilter)
                        )
                        .map((event) => (
                          <div
                            key={event.id}
                            className="p-3 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-slate-50/70 transition-colors"
                          >
                            <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0 ${
                                  event.action === 'modified'
                                    ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                    : event.action === 'loaded'
                                    ? 'bg-sky-100 text-[#0056b3] border border-sky-200'
                                    : event.action === 'deleted'
                                    ? 'bg-red-100 text-red-800 border border-red-200'
                                    : 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                                }`}
                              >
                                {event.actionLabel}
                              </span>
                              <span className="font-mono-tabular font-bold text-slate-900 shrink-0">
                                {event.referenceCode}
                              </span>
                              <span className="text-slate-600 truncate">{event.summary}</span>
                            </div>
                            <div className="font-mono-tabular text-[11px] text-slate-500 shrink-0">
                              {event.timestamp}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* INTEGRACIÓN GOOGLE WORKSPACE: GMAIL + GOOGLE SHEETS */}
              <WorkspaceIntegrationPanel
                currentUser={currentUser}
                accessToken={workspaceAccessToken}
                onSignIn={handleGoogleSignIn}
                savedEstimates={savedEstimates}
                activeDraftQuote={{
                  nombre: nombre.trim() || 'Cliente',
                  empresa: empresa.trim() || 'Particular / Sin especificar',
                  email: email.trim(),
                  telefono: telefono.trim(),
                  servicioLabel: calculation.currentService.label,
                  cantidad: calculation.safeQty,
                  materialLabel: calculation.currentMaterial.label,
                  complejidadLabel: calculation.currentComplexity.label,
                  plazoLabel: calculation.currentPlazo.label,
                  dimensionsSummary: stlDims.isCustomStl
                    ? `${stlDims.widthMm.toFixed(1)} × ${stlDims.heightMm.toFixed(1)} × ${stlDims.depthMm.toFixed(1)} mm (${stlDims.volumeCm3.toFixed(1)} cm³)`
                    : '25.0 × 25.0 × 25.0 mm (Cubo de prueba)',
                  observaciones: observaciones.trim(),
                  unitPrice: calculation.unitPrice,
                  totalPrice: calculation.total,
                }}
                onApplyContactFromEmail={(senderName, senderEmail, subjectNote) => {
                  setNombre(senderName);
                  setEmail(senderEmail);
                  setEmailTouched(true);
                  setObservaciones((prev) =>
                    prev.trim() ? `${prev.trim()} | Consulta Gmail: ${subjectNote}` : `Consulta Gmail: ${subjectNote}`
                  );
                  document.getElementById('presupuestoForm')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            </div>
          </div>

          {/* MODAL DE CONFIRMACIÓN PARA ENVÍO AUTOMÁTICO DE EMAILS DE SOLICITUD (GMAIL API) */}
          {pendingQuoteEmailEntry && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="gmail-confirm-modal-title"
              className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 no-print"
            >
              <div className="bg-white border border-slate-300 rounded-lg max-w-lg w-full p-6 shadow-xl space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Mail className="w-5 h-5 text-[#0056b3] shrink-0" />
                    <h4 id="gmail-confirm-modal-title" className="text-base font-bold text-slate-900">
                      Confirmar envío de correos de solicitud por Gmail
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPendingQuoteEmailEntry(null)}
                    disabled={sendingQuoteEmails}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-700 leading-relaxed">
                  Tu solicitud con referencia{' '}
                  <strong className="font-mono-tabular text-slate-900">{pendingQuoteEmailEntry.referenceCode}</strong>{' '}
                  ha sido registrada. Confirma a continuación para enviar mediante la API de Gmail los{' '}
                  <strong>2 correos electrónicos</strong> correspondientes:
                </p>

                <div className="bg-[#f8f9fa] border border-slate-200 rounded p-3.5 space-y-2.5 text-xs">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#0056b3] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900">1. Email de confirmación al solicitante</div>
                      <div className="text-slate-600">
                        Para: <span className="font-mono-tabular font-semibold">{pendingQuoteEmailEntry.email}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Asunto: Confirmación de solicitud de presupuesto {pendingQuoteEmailEntry.referenceCode} - Project 3D
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#17a2b8] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900">2. Email de aviso técnico al equipo de Project 3D</div>
                      <div className="text-slate-600">
                        Para: <span className="font-mono-tabular font-semibold">info@project3d.es</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Asunto: [Aviso Solicitud {pendingQuoteEmailEntry.referenceCode}] {pendingQuoteEmailEntry.servicioLabel} -{' '}
                        {pendingQuoteEmailEntry.nombre} ({pendingQuoteEmailEntry.totalPrice.toFixed(2)} €)
                      </div>
                    </div>
                  </div>
                </div>

                {!workspaceAccessToken && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2.5">
                    Nota: Al confirmar se solicitará permiso de tu cuenta de Google si aún no has iniciado sesión en esta ventana.
                  </p>
                )}

                <div className="flex items-center justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setPendingQuoteEmailEntry(null)}
                    disabled={sendingQuoteEmails}
                    className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => void enviarEmailsConfirmacionYAvisoGmail(pendingQuoteEmailEntry)}
                    disabled={sendingQuoteEmails}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0056b3] hover:bg-[#003d80] rounded cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {sendingQuoteEmails ? 'Enviando correos por Gmail...' : 'Confirmar y Enviar 2 Emails'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* PREGUNTAS FRECUENTES (FAQ) (#faq) */}
        <section id="faq" className="py-16 px-6 max-w-[1200px] mx-auto no-print">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">Preguntas Frecuentes</h2>
            <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
          </div>

          <div className="max-w-3xl mx-auto space-y-4">
            {FAQ_ITEMS.map((faq, idx) => {
              const isOpen = openFaqIndices.includes(idx);
              return (
                <div
                  key={faq.question}
                  className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-2xs"
                >
                  <button
                    type="button"
                    onClick={() => toggleFaq(idx)}
                    className="w-full px-6 py-4 text-left flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <h4 className="text-base font-bold text-[#0056b3]">{faq.question}</h4>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-500 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-6 pb-5 pt-1 text-sm text-slate-700 leading-relaxed border-t border-slate-100">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* CONTACTO Y UBICACIÓN (#contacto) */}
        <section id="contacto" className="py-16 px-6 bg-white border-t border-slate-200 no-print">
          <div className="max-w-[1200px] mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-bold text-[#003d80]">Contacto y Ubicación</h2>
              <div className="w-16 h-1 bg-[#17a2b8] mx-auto mt-3" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="bg-[#f8f9fa] border border-slate-200 border-t-4 border-t-[#0056b3] rounded-lg p-7 space-y-4">
                <h3 className="text-xl font-bold text-[#003d80]">Información de Contacto</h3>

                <div className="flex items-start gap-3 text-sm text-slate-700">
                  <MapPin className="w-5 h-5 text-[#0056b3] shrink-0 mt-0.5" />
                  <div>
                    <strong className="text-slate-900 block">Dirección:</strong>
                    Avenida de los Trabajadores, 20
                    <br />
                    Polígono Industrial La Atalaya
                    <br />
                    45500 Torrijos, Toledo
                    <br />
                    <em className="text-slate-600">(Frente al Vivero de Empresas Manuel Díaz Ruiz)</em>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-700 pt-2">
                  <Phone className="w-4 h-4 text-[#0056b3] shrink-0" />
                  <div>
                    <strong className="text-slate-900">Teléfono:</strong>{' '}
                    <a href="tel:925763842" className="font-mono-tabular hover:text-[#0056b3] font-semibold">
                      925 76 38 42
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <Mail className="w-4 h-4 text-[#0056b3] shrink-0" />
                  <div>
                    <strong className="text-slate-900">Email:</strong>{' '}
                    <a href="mailto:info@project3d.es" className="text-[#0056b3] hover:underline font-semibold">
                      info@project3d.es
                    </a>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-700">
                  <Globe className="w-4 h-4 text-[#0056b3] shrink-0" />
                  <div>
                    <strong className="text-slate-900">Web:</strong> www.project3d.es
                  </div>
                </div>
              </div>

              <div className="bg-[#f8f9fa] border border-slate-200 border-t-4 border-t-[#003d80] rounded-lg p-7 flex flex-col justify-between">
                <div>
                  <h3 className="text-xl font-bold text-[#003d80] mb-4">Horarios y Especificaciones Técnicas</h3>
                  <div className="space-y-3.5 text-sm text-slate-700">
                    <div className="pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-slate-900">Horarios de apertura:</strong>
                      <span className="badge-pending bg-[#fff3cd] text-[#856404] text-xs px-2 py-0.5 rounded font-medium">
                        Pendiente de confirmar
                      </span>
                    </div>
                    <div className="pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-slate-900">Modelos de impresoras / Maquinaria:</strong>
                      <span className="badge-pending bg-[#fff3cd] text-[#856404] text-xs px-2 py-0.5 rounded font-medium">
                        Pendiente de confirmar
                      </span>
                    </div>
                    <div className="pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-slate-900">Catálogo detallado de materiales:</strong>
                      <span className="badge-pending bg-[#fff3cd] text-[#856404] text-xs px-2 py-0.5 rounded font-medium">
                        Pendiente de confirmar
                      </span>
                    </div>
                    <div className="pb-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-slate-900">Plazos garantizados de entrega:</strong>
                      <span className="badge-pending bg-[#fff3cd] text-[#856404] text-xs px-2 py-0.5 rounded font-medium">
                        Pendiente de confirmar
                      </span>
                    </div>
                  </div>
                </div>

                <p className="mt-6 text-xs text-slate-600 leading-relaxed">
                  Para consultas específicas sobre estos puntos, contacta directamente con nuestro equipo técnico en{' '}
                  <strong className="text-slate-800">info@project3d.es</strong> o utiliza el asistente interactivo.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* PIE DE PÁGINA (footer) */}
      <footer className="bg-[#1a1a1a] text-white pt-12 pb-6 px-6 no-print">
        <div className="max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 pb-8 border-b border-neutral-800">
          <div>
            <h3 className="text-lg font-bold text-white">
              PROJECT <span className="text-[#17a2b8]">3D</span>
            </h3>
            <p className="text-sm text-neutral-400 mt-2.5">
              Especialistas en prototipado, diseño y fabricación 3D en Torrijos (Toledo).
            </p>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white mb-2.5">Enlaces Rápidos</h4>
            <div className="flex flex-col space-y-1.5 text-sm text-neutral-300">
              <a href="#quienes-somos" className="hover:text-white transition-colors">
                Quiénes Somos
              </a>
              <a href="#servicios" className="hover:text-white transition-colors">
                Servicios
              </a>
              <a href="#proceso" className="hover:text-white transition-colors">
                Proceso de Trabajo
              </a>
              <a href="#presupuesto" className="hover:text-white transition-colors">
                Calculadora con Visor 3D
              </a>
              <a href="#faq" className="hover:text-white transition-colors">
                Preguntas Frecuentes
              </a>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-white mb-2.5">Ubicación Confirmada</h4>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Pol. Ind. La Atalaya, Avda. Trabajadores 20
              <br />
              45500 Torrijos (Toledo)
              <br />
              Tel: 925 76 38 42 · info@project3d.es
            </p>
          </div>
        </div>

        <div className="max-w-[1200px] mx-auto pt-5 text-center text-xs text-neutral-500">
          <p>&copy; 2026 Project 3D - Proyecto Digital Académico</p>
        </div>
      </footer>

      {/* WIDGET CHATBOT FLOTANTE "PROJECT 3D ASSISTANT" */}
      <div className="no-print">
        <button
          id="chat-widget-button"
          type="button"
          onClick={() => setChatOpen((prev) => !prev)}
          className="fixed bottom-5 right-5 z-50 bg-[#0056b3] hover:bg-[#003d80] text-white font-bold text-sm px-5 py-3.5 rounded-full shadow-lg flex items-center gap-2.5 cursor-pointer transition-transform active:scale-95 whitespace-nowrap"
        >
          <MessageSquare className="w-4 h-4" />
          <span>Chat Assistant</span>
        </button>

        {chatOpen && (
          <div
            id="chat-box"
            className="fixed bottom-20 right-5 z-50 w-[340px] sm:w-[370px] h-[460px] bg-white rounded-lg shadow-xl border border-slate-200 flex flex-col overflow-hidden"
          >
            <div className="bg-[#1a1a1a] text-white px-4 py-3.5 font-bold text-sm flex items-center justify-between">
              <span>Project 3D Assistant</span>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Cerrar asistente"
                className="text-neutral-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div id="chat-messages" className="flex-1 p-4 overflow-y-auto bg-[#f9f9f9] flex flex-col gap-3">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`px-3.5 py-2.5 rounded-lg text-xs leading-relaxed max-w-[85%] ${
                    msg.sender === 'bot'
                      ? 'bg-[#e9ecef] text-[#333333] self-start'
                      : 'bg-[#0056b3] text-white self-end'
                  }`}
                >
                  {msg.text}
                </div>
              ))}
              {chatLoading && (
                <div className="px-3.5 py-2 rounded-lg text-xs bg-[#e9ecef] text-slate-600 self-start">
                  Escribiendo respuesta...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Acciones directas promovidas por el asistente */}
            <div className="px-3 py-1.5 bg-white border-t border-slate-200 flex items-center justify-between gap-2 text-[11px]">
              <a
                href="#presupuesto"
                onClick={() => setChatOpen(false)}
                className="flex-1 text-center py-1 px-2 font-bold text-[#0056b3] bg-sky-50 hover:bg-sky-100 rounded transition-colors whitespace-nowrap"
              >
                Solicitar presupuesto
              </a>
              <a
                href="#contacto"
                onClick={() => setChatOpen(false)}
                className="flex-1 text-center py-1 px-2 font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded transition-colors whitespace-nowrap"
              >
                Contactar (925 76 38 42)
              </a>
            </div>

            {/* Sugerencias rápidas */}
            <div className="px-3 py-2 bg-slate-100 border-t border-slate-200 flex items-center gap-1.5 overflow-x-auto">
              {[
                { label: 'Ubicación', query: '¿Dónde está ubicado Project 3D?' },
                { label: 'Servicios', query: '¿Qué servicios ofrecéis?' },
                { label: 'Presupuesto', query: '¿Cómo funcionan los presupuestos?' },
                { label: 'Contacto', query: '¿Cuál es vuestro teléfono y email?' },
                { label: '¿Abrís sábados?', query: '¿Abrís los sábados o qué horario tenéis?' },
              ].map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={chatLoading}
                  onClick={() => sendMessage(q.query)}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-white text-slate-700 border border-slate-300 rounded hover:border-[#0056b3] hover:text-[#0056b3] disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {q.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="p-2.5 border-t border-slate-200 bg-white flex items-center gap-2"
            >
              <input
                type="text"
                id="chat-input"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Escribe tu pregunta..."
                className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
              />
              <button
                type="submit"
                disabled={chatLoading}
                className="bg-[#0056b3] hover:bg-[#003d80] disabled:opacity-50 text-white text-xs font-bold px-3.5 py-2 rounded transition-colors cursor-pointer whitespace-nowrap"
              >
                Enviar
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
