export interface CapacitacionAgenteRow {
  id: string;
  titulo: string;
  descripcion: string | null;
  fecha_vencimiento: string | null;
  porcentaje_minimo_visto: number;
  nota_minima: number;
  created_at: string;
  porcentaje_visto: number;
  video_completo: boolean;
  completada: boolean;
  ultima_nota: number | null;
  intentos: number;
}

export interface ExamenPregunta {
  id: string;
  enunciado: string;
  opciones: { id: string; texto: string }[];
}
export interface ExamenIniciado { preguntas: ExamenPregunta[] }
export interface ExamenResultado {
  intento_id: string; puntaje: number; total: number; nota_minima: number; aprobado: boolean; numero_intento: number;
}

export interface ReporteAgenteFila {
  agente_personal_id: string;
  nombre: string;
  codigo_personal: string;
  porcentaje_visto: number;
  video_completo: boolean;
  intentos: number;
  mejor_nota: number | null;
  aprobado: boolean | null;
}

export interface CapacitacionRow {
  id: string;
  titulo: string;
  descripcion: string | null;
  capacitador_id: string;
  video_path: string | null;
  video_nombre: string | null;
  video_youtube_id: string | null;
  material_pdf_path: string | null;
  material_pdf_nombre: string | null;
  porcentaje_minimo_visto: number;
  nota_minima: number;
  fecha_vencimiento: string | null;
  estado: "BORRADOR" | "PUBLICADA" | "ARCHIVADA";
  created_at: string;
  updated_at: string;
}

export interface ExamenPreguntaAdmin {
  id: string;
  enunciado: string;
  orden: number;
  examen_opciones: { id: string; texto: string; es_correcta: boolean; orden: number }[];
}
