import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  FileSpreadsheet,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Plus,
  Search,
  UserPlus,
  ShieldAlert,
  X,
} from 'lucide-react';
import { User } from 'firebase/auth';

export interface WorkspaceEstimateItem {
  id: string;
  referenceCode: string;
  timestamp: string;
  lastModifiedAt: string;
  nombre: string;
  empresa: string;
  email: string;
  telefono: string;
  servicioLabel: string;
  cantidad: number;
  materialLabel: string;
  complejidadLabel: string;
  plazoLabel: string;
  dimensionsSummary: string;
  observaciones: string;
  unitPrice: number;
  totalPrice: number;
}

interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromName: string;
  fromEmail: string;
  date: string;
  snippet: string;
}

interface DriveSpreadsheetFile {
  id: string;
  name: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface SheetTabInfo {
  sheetId: number;
  title: string;
}

interface PendingConfirmation {
  type: 'gmail_send' | 'sheets_create' | 'sheets_append';
  title: string;
  description: string;
  details: string[];
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

interface WorkspaceIntegrationPanelProps {
  currentUser: User | null;
  accessToken: string | null;
  onSignIn: () => Promise<void>;
  savedEstimates: WorkspaceEstimateItem[];
  activeDraftQuote: {
    nombre: string;
    empresa: string;
    email: string;
    telefono: string;
    servicioLabel: string;
    cantidad: number;
    materialLabel: string;
    complejidadLabel: string;
    plazoLabel: string;
    dimensionsSummary: string;
    observaciones: string;
    unitPrice: number;
    totalPrice: number;
  };
  onApplyContactFromEmail: (name: string, email: string, subjectNote: string) => void;
}

function encodeBase64Url(str: string): string {
  const utf8Bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < utf8Bytes.byteLength; i++) {
    binary += String.fromCharCode(utf8Bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function parseFromHeader(rawFrom: string): { name: string; email: string } {
  const match = rawFrom.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
  if (match) {
    const cleanName = (match[1] || '').trim() || match[2].split('@')[0];
    return { name: cleanName, email: match[2].trim() };
  }
  return { name: rawFrom.split('@')[0] || 'Cliente', email: rawFrom.trim() };
}

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}> = ({ onClick, label = 'Sign in with Google', disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="gsi-material-button inline-flex items-center gap-2.5 px-4 py-2 bg-white text-[#1f1f1f] border border-[#747775] rounded-md text-xs font-semibold hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
  >
    <div className="w-4 h-4 shrink-0">
      <svg
        version="1.1"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 48 48"
        className="w-full h-full block"
      >
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
        <path fill="none" d="M0 0h48v48H0z" />
      </svg>
    </div>
    <span className="gsi-material-button-contents">{label}</span>
  </button>
);

export default function WorkspaceIntegrationPanel({
  currentUser,
  accessToken,
  onSignIn,
  savedEstimates,
  activeDraftQuote,
  onApplyContactFromEmail,
}: WorkspaceIntegrationPanelProps) {
  const [activeTab, setActiveTab] = useState<'gmail' | 'sheets'>('gmail');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    linkUrl?: string;
    linkLabel?: string;
  } | null>(null);

  // Confirmation modal state for mutating operations (mandatory before sending email or writing to Sheets)
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [isConfirmExecuting, setIsConfirmExecuting] = useState<boolean>(false);

  // --- GMAIL STATE ---
  const [selectedQuoteIdForEmail, setSelectedQuoteIdForEmail] = useState<string>('current');
  const [emailTo, setEmailTo] = useState<string>('');
  const [emailSubject, setEmailSubject] = useState<string>('');
  const [emailBody, setEmailBody] = useState<string>('');
  const [gmailQuery, setGmailQuery] = useState<string>('in:inbox');
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [gmailLoading, setGmailLoading] = useState<boolean>(false);

  // --- GOOGLE SHEETS STATE ---
  const [spreadsheetsList, setSpreadsheetsList] = useState<DriveSpreadsheetFile[]>([]);
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState<string>('');
  const [sheetTabs, setSheetTabs] = useState<SheetTabInfo[]>([]);
  const [selectedSheetTab, setSelectedSheetTab] = useState<string>('');
  const [sheetPreviewRows, setSheetPreviewRows] = useState<string[][]>([]);
  const [newSheetTitle, setNewSheetTitle] = useState<string>('Project 3D - Registro de Presupuestos');
  const [sheetsLoading, setSheetsLoading] = useState<boolean>(false);

  // Build email draft whenever selectedQuoteIdForEmail or calculator quote changes
  useEffect(() => {
    const chosenSaved =
      selectedQuoteIdForEmail === 'current'
        ? null
        : savedEstimates.find((item) => item.id === selectedQuoteIdForEmail) || null;

    const target = chosenSaved || {
      referenceCode: 'BORRADOR-ACTUAL',
      nombre: activeDraftQuote.nombre || 'Cliente',
      empresa: activeDraftQuote.empresa || 'Particular / Sin especificar',
      email: activeDraftQuote.email || currentUser?.email || '',
      telefono: activeDraftQuote.telefono || '—',
      servicioLabel: activeDraftQuote.servicioLabel,
      cantidad: activeDraftQuote.cantidad,
      materialLabel: activeDraftQuote.materialLabel,
      complejidadLabel: activeDraftQuote.complejidadLabel,
      plazoLabel: activeDraftQuote.plazoLabel,
      dimensionsSummary: activeDraftQuote.dimensionsSummary,
      observaciones: activeDraftQuote.observaciones || 'Sin observaciones adicionales',
      unitPrice: activeDraftQuote.unitPrice,
      totalPrice: activeDraftQuote.totalPrice,
    };

    setEmailTo(target.email !== 'Pendiente de asignar' ? target.email : currentUser?.email || '');
    setEmailSubject(`Presupuesto Orientativo Project 3D (${target.referenceCode}) - ${target.servicioLabel}`);
    setEmailBody(
      `Hola ${target.nombre},\n\n` +
        `Te adjuntamos el resumen de la estimación orientativa calculada en Project 3D (Torrijos, Toledo):\n\n` +
        `• Referencia: ${target.referenceCode}\n` +
        `• Empresa / Entidad: ${target.empresa}\n` +
        `• Servicio solicitado: ${target.servicioLabel}\n` +
        `• Cantidad: ${target.cantidad} ud(s).\n` +
        `• Material: ${target.materialLabel}\n` +
        `• Complejidad: ${target.complejidadLabel}\n` +
        `• Plazo deseado: ${target.plazoLabel}\n` +
        `• Dimensiones pieza: ${target.dimensionsSummary}\n` +
        `• Observaciones: ${target.observaciones}\n\n` +
        `--------------------------------------------------\n` +
        `COSTE UNITARIO ORIENTATIVO: ${target.unitPrice.toFixed(2)} € / ud.\n` +
        `TOTAL ESTIMACIÓN ORIENTATIVA: ${target.totalPrice.toFixed(2)} €\n` +
        `--------------------------------------------------\n\n` +
        `Nota importante: Este importe es una estimación orientativa y debe ser verificado y confirmado por el equipo técnico de Project 3D tras estudiar los archivos y requerimientos de producción.\n\n` +
        `Atentamente,\n` +
        `Project 3D · Polígono Industrial La Atalaya, Torrijos (Toledo)\n` +
        `Tel: 925 76 38 42 · info@project3d.es · www.project3d.es`
    );
  }, [selectedQuoteIdForEmail, savedEstimates, activeDraftQuote, currentUser]);

  // Fetch recent Gmail messages
  const fetchGmailMessages = useCallback(async () => {
    if (!accessToken) return;
    setGmailLoading(true);
    setStatusBanner(null);
    try {
      const qParam = gmailQuery.trim() ? `&q=${encodeURIComponent(gmailQuery.trim())}` : '';
      const listRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=6${qParam}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );

      if (!listRes.ok) {
        throw new Error(`Error al consultar Gmail (${listRes.status})`);
      }

      const listData = (await listRes.json()) as { messages?: { id: string; threadId: string }[] };
      if (!listData.messages || listData.messages.length === 0) {
        setGmailMessages([]);
        return;
      }

      const details = await Promise.all(
        listData.messages.slice(0, 6).map(async (msg) => {
          const detailRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          if (!detailRes.ok) return null;
          const detailJson = (await detailRes.json()) as {
            id: string;
            threadId: string;
            snippet?: string;
            payload?: { headers?: { name: string; value: string }[] };
          };
          const headers = detailJson.payload?.headers || [];
          const getHeader = (name: string) =>
            headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

          const rawFrom = getHeader('From');
          const parsedFrom = parseFromHeader(rawFrom);
          return {
            id: detailJson.id,
            threadId: detailJson.threadId,
            subject: getHeader('Subject') || '(Sin asunto)',
            from: rawFrom || 'Desconocido',
            fromName: parsedFrom.name,
            fromEmail: parsedFrom.email,
            date: getHeader('Date') ? new Date(getHeader('Date')).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
            snippet: detailJson.snippet || '',
          };
        })
      );

      setGmailMessages(details.filter((d): d is GmailMessageSummary => d !== null));
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudieron cargar los mensajes de Gmail.',
      });
    } finally {
      setGmailLoading(false);
    }
  }, [accessToken, gmailQuery]);

  // Fetch user's Google Sheets files from Drive
  const fetchUserSpreadsheets = useCallback(async () => {
    if (!accessToken) return;
    setSheetsLoading(true);
    setStatusBanner(null);
    try {
      const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=12&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,webViewLink)`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!res.ok) {
        throw new Error(`Error al listar hojas de cálculo (${res.status})`);
      }
      const data = (await res.json()) as { files?: DriveSpreadsheetFile[] };
      const files = data.files || [];
      setSpreadsheetsList(files);
      if (files.length > 0 && !selectedSpreadsheetId) {
        setSelectedSpreadsheetId(files[0].id);
      }
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudieron listar tus hojas de Google Sheets.',
      });
    } finally {
      setSheetsLoading(false);
    }
  }, [accessToken, selectedSpreadsheetId]);

  // Fetch metadata (sheet tabs) whenever selectedSpreadsheetId changes (never hardcode "Sheet1")
  const fetchSpreadsheetMetadataAndPreview = useCallback(
    async (spreadsheetId: string, preferredTab?: string) => {
      if (!accessToken || !spreadsheetId) return;
      setSheetsLoading(true);
      try {
        const metaRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!metaRes.ok) {
          throw new Error(`No se pudo leer la estructura de la hoja (${metaRes.status})`);
        }
        const metaData = (await metaRes.json()) as {
          sheets?: { properties?: { sheetId?: number; title?: string } }[];
        };
        const tabs: SheetTabInfo[] = (metaData.sheets || []).map((s, idx) => ({
          sheetId: s.properties?.sheetId ?? idx,
          title: s.properties?.title || `Hoja ${idx + 1}`,
        }));
        setSheetTabs(tabs);

        const activeTabTitle = preferredTab || (tabs[0]?.title ?? '');
        setSelectedSheetTab(activeTabTitle);

        if (activeTabTitle) {
          const range = `${encodeURIComponent(activeTabTitle)}!A1:N15`;
          const valRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );
          if (valRes.ok) {
            const valData = (await valRes.json()) as { values?: string[][] };
            setSheetPreviewRows(valData.values || []);
          } else {
            setSheetPreviewRows([]);
          }
        }
      } catch (err) {
        setStatusBanner({
          type: 'error',
          text: err instanceof Error ? err.message : 'Error al leer datos de Google Sheets.',
        });
      } finally {
        setSheetsLoading(false);
      }
    },
    [accessToken]
  );

  useEffect(() => {
    if (accessToken) {
      void fetchGmailMessages();
      void fetchUserSpreadsheets();
    }
  }, [accessToken, fetchGmailMessages, fetchUserSpreadsheets]);

  useEffect(() => {
    if (accessToken && selectedSpreadsheetId) {
      void fetchSpreadsheetMetadataAndPreview(selectedSpreadsheetId);
    }
  }, [accessToken, selectedSpreadsheetId, fetchSpreadsheetMetadataAndPreview]);

  // Request confirmation before sending email via Gmail
  const handleRequestSendGmail = () => {
    if (!accessToken) return;
    const cleanTo = emailTo.trim();
    const cleanSubject = emailSubject.trim();
    if (!cleanTo || !cleanTo.includes('@')) {
      setStatusBanner({
        type: 'error',
        text: 'Introduce una dirección de correo de destinatario válida antes de enviar por Gmail.',
      });
      return;
    }

    setPendingConfirm({
      type: 'gmail_send',
      title: 'Confirmar envío de correo por Gmail',
      description: `Se enviará un correo electrónico desde tu cuenta de Gmail (${currentUser?.email || 'autenticada'}) con el desglose del presupuesto orientativo.`,
      details: [
        `Destinatario: ${cleanTo}`,
        `Asunto: ${cleanSubject}`,
        `Contenido: Desglose técnico de estimación Project 3D (${emailBody.length} caracteres)`,
      ],
      confirmLabel: 'Confirmar y enviar correo',
      onConfirm: async () => {
        const mimeMessage = [
          `To: ${cleanTo}`,
          `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(cleanSubject)))}?=`,
          'MIME-Version: 1.0',
          'Content-Type: text/plain; charset="UTF-8"',
          '',
          emailBody,
        ].join('\r\n');

        const raw = encodeBase64Url(mimeMessage);
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
        });

        if (!res.ok) {
          throw new Error(`Error al enviar el correo mediante Gmail (${res.status}).`);
        }

        setStatusBanner({
          type: 'success',
          text: `Presupuesto enviado correctamente por Gmail a ${cleanTo}.`,
        });
        void fetchGmailMessages();
      },
    });
  };

  // Build rows for Google Sheets export
  const buildEstimateRowsForSheets = (): (string | number)[][] => {
    return savedEstimates.map((item) => [
      item.referenceCode,
      item.timestamp,
      item.lastModifiedAt,
      item.nombre,
      item.empresa,
      item.email,
      item.telefono,
      item.servicioLabel,
      item.cantidad,
      item.materialLabel,
      item.complejidadLabel,
      item.plazoLabel,
      item.dimensionsSummary,
      Number(item.unitPrice.toFixed(2)),
      Number(item.totalPrice.toFixed(2)),
      item.observaciones,
    ]);
  };

  const SHEET_HEADERS = [
    'Referencia',
    'Creación',
    'Últ. Modificación',
    'Cliente',
    'Empresa',
    'Email',
    'Teléfono',
    'Servicio',
    'Unidades',
    'Material',
    'Complejidad',
    'Plazo',
    'Dimensiones',
    'Precio Unitario (€)',
    'Total Orientativo (€)',
    'Observaciones',
  ];

  // Request confirmation before creating a new Google Sheet and writing estimates
  const handleRequestCreateNewSpreadsheet = () => {
    if (!accessToken) return;
    const title = newSheetTitle.trim() || 'Project 3D - Presupuestos';

    setPendingConfirm({
      type: 'sheets_create',
      title: 'Confirmar creación de nueva Hoja de Cálculo en Google Sheets',
      description: `Se creará un nuevo archivo en tu cuenta de Google Sheets y se escribirán ${savedEstimates.length} presupuestos guardados.`,
      details: [
        `Título del archivo: "${title}"`,
        `Filas a insertar: 1 fila de cabeceras + ${savedEstimates.length} estimaciones (${savedEstimates
          .map((e) => e.referenceCode)
          .join(', ')})`,
      ],
      confirmLabel: 'Confirmar y crear hoja',
      onConfirm: async () => {
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: { title },
          }),
        });

        if (!createRes.ok) {
          throw new Error(`Error al crear la hoja de cálculo (${createRes.status}).`);
        }

        const created = (await createRes.json()) as {
          spreadsheetId: string;
          spreadsheetUrl?: string;
          sheets?: { properties?: { title?: string } }[];
        };

        const firstTabTitle = created.sheets?.[0]?.properties?.title || 'Hoja 1';
        const rows = [SHEET_HEADERS, ...buildEstimateRowsForSheets()];

        const appendRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${encodeURIComponent(
            firstTabTitle
          )}!A1:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: rows }),
          }
        );

        if (!appendRes.ok) {
          throw new Error(`La hoja se creó pero hubo un error al escribir las filas (${appendRes.status}).`);
        }

        setStatusBanner({
          type: 'success',
          text: `Hoja "${title}" creada y sincronizada con ${savedEstimates.length} presupuestos.`,
          linkUrl: created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}`,
          linkLabel: 'Abrir en Google Sheets',
        });

        await fetchUserSpreadsheets();
        setSelectedSpreadsheetId(created.spreadsheetId);
        await fetchSpreadsheetMetadataAndPreview(created.spreadsheetId, firstTabTitle);
      },
    });
  };

  // Request confirmation before appending estimates to existing selected sheet
  const handleRequestAppendToExistingSheet = () => {
    if (!accessToken || !selectedSpreadsheetId || !selectedSheetTab) return;
    const selectedFile = spreadsheetsList.find((f) => f.id === selectedSpreadsheetId);
    const fileName = selectedFile?.name || selectedSpreadsheetId;

    setPendingConfirm({
      type: 'sheets_append',
      title: 'Confirmar actualización de Hoja de Cálculo en Google Sheets',
      description: `Se añadirán ${savedEstimates.length} filas de presupuestos al final de tu hoja de cálculo seleccionada.`,
      details: [
        `Archivo destino: "${fileName}"`,
        `Pestaña (Hoja): "${selectedSheetTab}"`,
        `Presupuestos afectados (${savedEstimates.length}): ${savedEstimates
          .map((e) => `${e.referenceCode} (${e.totalPrice.toFixed(2)} €)`)
          .join(', ')}`,
      ],
      confirmLabel: 'Confirmar y añadir filas',
      onConfirm: async () => {
        const rowsToWrite =
          sheetPreviewRows.length === 0
            ? [SHEET_HEADERS, ...buildEstimateRowsForSheets()]
            : buildEstimateRowsForSheets();

        const appendRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${selectedSpreadsheetId}/values/${encodeURIComponent(
            selectedSheetTab
          )}!A1:append?valueInputOption=USER_ENTERED`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ values: rowsToWrite }),
          }
        );

        if (!appendRes.ok) {
          throw new Error(`Error al escribir en Google Sheets (${appendRes.status}).`);
        }

        setStatusBanner({
          type: 'success',
          text: `Se han añadido ${savedEstimates.length} presupuestos a "${fileName}" (${selectedSheetTab}).`,
          linkUrl: selectedFile?.webViewLink || `https://docs.google.com/spreadsheets/d/${selectedSpreadsheetId}`,
          linkLabel: 'Ver en Google Sheets',
        });

        await fetchSpreadsheetMetadataAndPreview(selectedSpreadsheetId, selectedSheetTab);
      },
    });
  };

  const executeConfirmedOperation = async () => {
    if (!pendingConfirm) return;
    setIsConfirmExecuting(true);
    try {
      await pendingConfirm.onConfirm();
      setPendingConfirm(null);
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : 'Error al ejecutar la operación en Google Workspace.',
      });
      setPendingConfirm(null);
    } finally {
      setIsConfirmExecuting(false);
    }
  };

  return (
    <div id="workspace-integration" className="mt-10 pt-8 border-t border-slate-200 no-print">
      <div className="bg-white border border-slate-200 border-t-4 border-t-[#0056b3] rounded-lg p-5 sm:p-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-[#0056b3]" />
              <FileSpreadsheet className="w-4 h-4 text-[#17a2b8]" />
              <h4 className="text-base font-bold text-[#003d80]">
                Integración con Google Workspace (Gmail y Google Sheets)
              </h4>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Envía presupuestos orientativos por Gmail, consulta correos de clientes y exporta o sincroniza las
              estimaciones guardadas en hojas de cálculo de Google Sheets.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('gmail')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-md border transition-colors cursor-pointer ${
                activeTab === 'gmail'
                  ? 'bg-[#0056b3] text-white border-[#0056b3]'
                  : 'bg-[#f8f9fa] text-slate-700 border-slate-300 hover:border-[#0056b3]'
              }`}
            >
              <Mail className="w-3.5 h-3.5" />
              Gmail (Envío y Bandeja)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sheets')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-md border transition-colors cursor-pointer ${
                activeTab === 'sheets'
                  ? 'bg-[#0056b3] text-white border-[#0056b3]'
                  : 'bg-[#f8f9fa] text-slate-700 border-slate-300 hover:border-[#0056b3]'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Google Sheets ({savedEstimates.length})
            </button>
          </div>
        </div>

        {/* Status Notification */}
        {statusBanner && (
          <div
            className={`mt-4 p-3 rounded-md border text-xs flex flex-wrap items-center justify-between gap-2 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : statusBanner.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              )}
              <span>{statusBanner.text}</span>
            </div>
            {statusBanner.linkUrl && (
              <a
                href={statusBanner.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-bold text-[#0056b3] hover:underline"
              >
                {statusBanner.linkLabel || 'Abrir enlace'}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        )}

        {/* Auth Gate if user has no active OAuth access token in memory */}
        {!currentUser || !accessToken ? (
          <div className="mt-5 bg-[#f8f9fa] border border-slate-200 rounded-lg p-6 text-center space-y-3">
            <p className="text-sm font-bold text-slate-900">
              {currentUser
                ? 'Autoriza el acceso a Gmail y Google Sheets para esta sesión'
                : 'Inicia sesión con tu cuenta de Google para conectar Gmail y Google Sheets'}
            </p>
            <p className="text-xs text-slate-600 max-w-xl mx-auto">
              Con tu permiso, la aplicación podrá redactar y enviar presupuestos por Gmail, consultar correos recientes
              y sincronizar las estimaciones del comparador en tus hojas de cálculo de Google Sheets.
            </p>
            <div className="pt-1 flex justify-center">
              <GoogleSignInButton
                onClick={onSignIn}
                label={currentUser ? 'Conectar Gmail y Google Sheets' : 'Sign in with Google'}
              />
            </div>
          </div>
        ) : activeTab === 'gmail' ? (
          /* GMAIL TAB */
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Send Quote via Gmail */}
            <div className="lg:col-span-6 bg-[#f8f9fa] border border-slate-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-xs font-bold uppercase tracking-wider text-[#003d80]">
                  Enviar Presupuesto por Gmail
                </h5>
                <span className="text-[11px] text-slate-500">Remitente: {currentUser.email}</span>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Seleccionar presupuesto a enviar:
                </label>
                <select
                  value={selectedQuoteIdForEmail}
                  onChange={(e) => setSelectedQuoteIdForEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                >
                  <option value="current">
                    Cálculo actual en pantalla ({activeDraftQuote.servicioLabel} ·{' '}
                    {activeDraftQuote.totalPrice.toFixed(2)} €)
                  </option>
                  {savedEstimates.map((est) => (
                    <option key={est.id} value={est.id}>
                      {est.referenceCode} — {est.nombre} ({est.servicioLabel} · {est.totalPrice.toFixed(2)} €)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Destinatario (Para):</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="cliente@empresa.es"
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Asunto:</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Mensaje del presupuesto:</label>
                <textarea
                  rows={6}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                />
              </div>

              <button
                type="button"
                onClick={handleRequestSendGmail}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-[#0056b3] hover:bg-[#003d80] rounded transition-colors cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Revisar y Enviar por Gmail
              </button>
            </div>

            {/* Right: Read Recent Gmail Inquiries */}
            <div className="lg:col-span-6 bg-[#f8f9fa] border border-slate-200 rounded-lg p-4 flex flex-col justify-between space-y-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-[#003d80]">
                    Bandeja de Consultas en Gmail
                  </h5>
                  <button
                    type="button"
                    onClick={() => void fetchGmailMessages()}
                    disabled={gmailLoading}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:border-[#0056b3] cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${gmailLoading ? 'animate-spin' : ''}`} />
                    Actualizar
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={gmailQuery}
                    onChange={(e) => setGmailQuery(e.target.value)}
                    placeholder="Filtrar en Gmail (ej. presupuesto OR STL)"
                    className="flex-1 px-3 py-1.5 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                  />
                  <button
                    type="button"
                    onClick={() => void fetchGmailMessages()}
                    disabled={gmailLoading}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[#17a2b8] hover:bg-[#138496] rounded cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Buscar
                  </button>
                </div>

                {gmailLoading ? (
                  <div className="py-8 text-center text-xs text-slate-500">Cargando mensajes de Gmail...</div>
                ) : gmailMessages.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 bg-white border border-slate-200 rounded p-4">
                    No se encontraron correos con el filtro actual.
                  </div>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {gmailMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className="bg-white border border-slate-200 rounded p-3 text-xs space-y-1.5 hover:border-slate-300 transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-slate-900 line-clamp-1">{msg.subject}</span>
                          <span className="text-[11px] font-mono text-slate-500 shrink-0">{msg.date}</span>
                        </div>
                        <div className="text-[11px] text-slate-600 truncate">De: {msg.from}</div>
                        <p className="text-[11px] text-slate-500 line-clamp-2">{msg.snippet}</p>
                        <div className="pt-1 flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              onApplyContactFromEmail(msg.fromName, msg.fromEmail, msg.subject);
                              setStatusBanner({
                                type: 'info',
                                text: `Datos de ${msg.fromName} (${msg.fromEmail}) cargados en el formulario de la calculadora.`,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#0056b3] bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded cursor-pointer"
                          >
                            <UserPlus className="w-3 h-3" />
                            Usar remitente en calculadora
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* GOOGLE SHEETS TAB */
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Create or Append to Spreadsheet */}
            <div className="lg:col-span-5 bg-[#f8f9fa] border border-slate-200 rounded-lg p-4 space-y-4">
              <div>
                <h5 className="text-xs font-bold uppercase tracking-wider text-[#003d80] mb-2">
                  1. Crear Nueva Hoja de Cálculo
                </h5>
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-slate-700">Título de la nueva hoja:</label>
                  <input
                    type="text"
                    value={newSheetTitle}
                    onChange={(e) => setNewSheetTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                  />
                  <button
                    type="button"
                    onClick={handleRequestCreateNewSpreadsheet}
                    disabled={sheetsLoading || savedEstimates.length === 0}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#0056b3] hover:bg-[#003d80] disabled:opacity-50 rounded transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Crear Hoja y Exportar {savedEstimates.length} Presupuestos
                  </button>
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-[#003d80]">
                    2. Usar Hoja de Cálculo Existente
                  </h5>
                  <button
                    type="button"
                    onClick={() => void fetchUserSpreadsheets()}
                    disabled={sheetsLoading}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-[#0056b3] cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${sheetsLoading ? 'animate-spin' : ''}`} />
                    Recargar lista
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Archivo de Google Sheets:</label>
                  <select
                    value={selectedSpreadsheetId}
                    onChange={(e) => setSelectedSpreadsheetId(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                  >
                    {spreadsheetsList.length === 0 ? (
                      <option value="">(No se encontraron hojas de cálculo en tu Drive)</option>
                    ) : (
                      spreadsheetsList.map((file) => (
                        <option key={file.id} value={file.id}>
                          {file.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                {sheetTabs.length > 0 && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Pestaña de la hoja (detectada dinámicamente):
                    </label>
                    <select
                      value={selectedSheetTab}
                      onChange={(e) => {
                        setSelectedSheetTab(e.target.value);
                        void fetchSpreadsheetMetadataAndPreview(selectedSpreadsheetId, e.target.value);
                      }}
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-[#0056b3]"
                    >
                      {sheetTabs.map((t) => (
                        <option key={t.sheetId} value={t.title}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleRequestAppendToExistingSheet}
                  disabled={sheetsLoading || !selectedSpreadsheetId || !selectedSheetTab || savedEstimates.length === 0}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-[#17a2b8] hover:bg-[#138496] disabled:opacity-50 rounded transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Añadir {savedEstimates.length} Presupuestos a la Pestaña Seleccionada
                </button>
              </div>
            </div>

            {/* Right: Live Preview of Selected Google Sheet */}
            <div className="lg:col-span-7 bg-[#f8f9fa] border border-slate-200 rounded-lg p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div>
                    <h5 className="text-xs font-bold uppercase tracking-wider text-[#003d80]">
                      Vista Previa de Datos en Google Sheets
                    </h5>
                    <p className="text-[11px] text-slate-500">
                      {selectedSpreadsheetId && selectedSheetTab
                        ? `Mostrando primeras filas de la pestaña "${selectedSheetTab}"`
                        : 'Selecciona o crea una hoja de cálculo para previsualizar su contenido.'}
                    </p>
                  </div>
                  {selectedSpreadsheetId && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${selectedSpreadsheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#0056b3] bg-white border border-slate-300 rounded hover:border-[#0056b3]"
                    >
                      Abrir en Sheets
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {sheetsLoading ? (
                  <div className="py-10 text-center text-xs text-slate-500">
                    Consultando Google Sheets...
                  </div>
                ) : sheetPreviewRows.length === 0 ? (
                  <div className="py-10 text-center text-xs text-slate-500 bg-white border border-slate-200 rounded p-4">
                    La pestaña seleccionada está vacía o aún no tiene filas registradas.
                  </div>
                ) : (
                  <div className="overflow-x-auto bg-white border border-slate-200 rounded max-h-64">
                    <table className="w-full text-left border-collapse text-[11px]">
                      <tbody>
                        {sheetPreviewRows.slice(0, 10).map((row, rIdx) => (
                          <tr
                            key={`row-${rIdx}`}
                            className={
                              rIdx === 0
                                ? 'bg-slate-100 font-bold text-slate-900 border-b border-slate-300'
                                : 'border-b border-slate-100 text-slate-700'
                            }
                          >
                            {row.slice(0, 8).map((cell, cIdx) => (
                              <td key={`cell-${rIdx}-${cIdx}`} className="px-2.5 py-1.5 whitespace-nowrap">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MANDATORY USER CONFIRMATION MODAL FOR MUTATING WORKSPACE OPERATIONS */}
      {pendingConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-300 rounded-lg max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldAlert className="w-5 h-5 text-[#0056b3] shrink-0" />
                <h4 className="text-base font-bold text-slate-900">{pendingConfirm.title}</h4>
              </div>
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={isConfirmExecuting}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-700 leading-relaxed">{pendingConfirm.description}</p>

            <div className="bg-[#f8f9fa] border border-slate-200 rounded p-3 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Resumen de elementos afectados:
              </div>
              <ul className="space-y-1 text-xs text-slate-800">
                {pendingConfirm.details.map((detail, idx) => (
                  <li key={idx} className="break-words">
                    • {detail}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                disabled={isConfirmExecuting}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void executeConfirmedOperation()}
                disabled={isConfirmExecuting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-[#0056b3] hover:bg-[#003d80] rounded cursor-pointer disabled:opacity-50"
              >
                {isConfirmExecuting ? 'Procesando...' : pendingConfirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
