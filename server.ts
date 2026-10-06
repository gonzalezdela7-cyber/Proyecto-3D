import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_3D_SYSTEM_INSTRUCTION = `Rol: Eres "Project 3D Assistant", el chatbot de atención al cliente de Project 3D, empresa especializada en prototipado, diseño y modelado 3D, e impresión 3D.

Tono y Estilo: Responde siempre en español de España. Tu tono debe ser profesional, cercano, claro y directo.

Base de Conocimientos:
- Ubicación: Avenida de los Trabajadores, 20. Polígono Industrial La Atalaya, 45500 Torrijos, Toledo (Frente al Vivero de Empresas Manuel Díaz Ruiz).
- Contacto: Teléfono 925 76 38 42, Email info@project3d.es, Web www.project3d.es.
- Servicios: Prototipado 3D, diseño y modelado 3D, impresión 3D, piezas personalizadas, maquetas y pequeñas series.
- Presupuestos: Se ofrecen estimaciones orientativas en la web. El precio definitivo siempre se confirma tras revisar los archivos y requisitos del proyecto.

Reglas Estrictas de Comportamiento:
- Promueve de forma natural las acciones de "Solicitar presupuesto" y "Contactar".
- PROHIBICIÓN ABSOLUTA: No inventes precios definitivos, catálogos exactos de materiales, tecnologías específicas, plazos garantizados, nombres de empleados ni horarios de apertura.
- Si un usuario te pregunta por algo que no está en tu base de conocimientos (como el precio exacto de una pieza concreta, si abren los sábados, o si imprimen en un material muy específico), debes decir exactamente: "Esa información requiere evaluación técnica y está pendiente de confirmar. Por favor, contacta con nosotros en info@project3d.es o en el 925 76 38 42 para que estudiemos tu caso particular".`;

function getFallbackBotResponse(rawInput: string): string {
  const input = rawInput
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Cualquier pregunta fuera de la base de conocimientos estricta (horarios, sábados, materiales específicos, maquinaria, precios exactos, plazos garantizados, empleados)
  if (
    input.includes('horario') ||
    input.includes('sabado') ||
    input.includes('domingo') ||
    input.includes('abris') ||
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
    input.includes('poligono') ||
    input.includes('atalaya')
  ) {
    return 'Nos encontramos en la Avenida de los Trabajadores, 20, en el Polígono Industrial La Atalaya, 45500 Torrijos, Toledo (justo frente al Vivero de Empresas Manuel Díaz Ruiz). Si quieres visitarnos o enviarnos tu proyecto, puedes solicitar presupuesto en la web o contactarnos en el 925 76 38 42.';
  }

  if (
    input.includes('contacto') ||
    input.includes('telefono') ||
    input.includes('email') ||
    input.includes('correo') ||
    input.includes('web') ||
    input.includes('llamar')
  ) {
    return 'Puedes contactar con nosotros en el teléfono 925 76 38 42, por email en info@project3d.es o a través de nuestra web www.project3d.es. También te animamos a solicitar presupuesto orientativo desde nuestra calculadora.';
  }

  if (
    input.includes('servicio') ||
    input.includes('que haceis') ||
    input.includes('dedicais') ||
    input.includes('prototipado') ||
    input.includes('modelado') ||
    input.includes('maqueta') ||
    input.includes('pequenas series') ||
    input.includes('personalizada')
  ) {
    return 'En Project 3D estamos especializados en prototipado 3D, diseño y modelado 3D, impresión 3D, piezas personalizadas, maquetas y pequeñas series. Puedes solicitar presupuesto orientativo aquí mismo en la web o contactar con nosotros para contarnos tu idea.';
  }

  if (
    input.includes('presupuesto') ||
    input.includes('estimacion') ||
    input.includes('calculadora') ||
    input.includes('precio') ||
    input.includes('coste')
  ) {
    return 'En nuestra web ofrecemos estimaciones orientativas mediante la calculadora de presupuestos. Recuerda que el precio definitivo siempre se confirma tras revisar los archivos y requisitos del proyecto. Te invitamos a solicitar presupuesto o a contactar con nosotros en info@project3d.es o en el 925 76 38 42.';
  }

  if (input.includes('hola') || input.includes('buenos dias') || input.includes('buenas')) {
    return '¡Hola! Soy Project 3D Assistant. Puedo informarte sobre nuestra ubicación en Torrijos, nuestros servicios de prototipado, diseño e impresión 3D, o cómo solicitar presupuesto y contactar con nuestro equipo. ¿En qué puedo ayudarte?';
  }

  return 'Esa información requiere evaluación técnica y está pendiente de confirmar. Por favor, contacta con nosotros en info@project3d.es o en el 925 76 38 42 para que estudiemos tu caso particular';
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post('/api/chat', async (req, res) => {
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ sender: 'user' | 'bot'; text: string }>;
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'El mensaje es obligatorio.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.json({ reply: getFallbackBotResponse(message) });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const contents = [
        ...(Array.isArray(history)
          ? history.slice(-8).map((msg) => ({
              role: msg.sender === 'user' ? 'user' : 'model',
              parts: [{ text: msg.text }],
            }))
          : []),
        {
          role: 'user',
          parts: [{ text: message }],
        },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents,
        config: {
          systemInstruction: PROJECT_3D_SYSTEM_INSTRUCTION,
          temperature: 0.2,
        },
      });

      const replyText = response.text?.trim() || getFallbackBotResponse(message);
      res.json({ reply: replyText });
    } catch (error) {
      console.error('Error calling Gemini API:', error);
      res.json({ reply: getFallbackBotResponse(message) });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
