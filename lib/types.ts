// The single source of truth for the domain model.

export type FieldKind =
  | "text"
  | "multiline"
  | "date"
  | "checkbox"
  | "signature"
  | "matrix";

export type TextAlign = "left" | "center" | "right";
export type VerticalAlign = "top" | "middle" | "bottom";
export type OverflowMode = "shrink" | "visible";

export type FontFamily = "Helvetica" | "Times-Roman" | "Courier";
export type FontWeight = "normal" | "bold";
export type FontStyle = "normal" | "italic";
export type PageRotation = 0 | 90 | 180 | 270;

export interface TemplateField {
  id: string;
  label: string;
  kind: FieldKind;
  /** 0-based page index */
  page: number;
  /** PDF points, top-left origin */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  required: boolean;
  /** Include this field's value in the output filename */
  inFileName?: boolean;
  /** Horizontal text alignment within the field box. */
  align?: TextAlign;
  /** Vertical text alignment within the field box. */
  valign?: VerticalAlign;
  /** How to handle text that exceeds the field box. "shrink" scales down; "visible" allows overflow. */
  overflow?: OverflowMode;
  /** Typography overrides (default: Helvetica, normal weight/style, black). */
  fontFamily?: FontFamily;
  fontWeight?: FontWeight;
  fontStyle?: FontStyle;
  /** HEX color, e.g. "#000000". */
  textColor?: string;
  /** Fields sharing a linkKey are filled from a single input in the fill form. */
  linkKey?: string;
  /**
   * Excel-like formula: computed automatically from other fields' values,
   * e.g. "{Stunden Montag} + {Stunden Dienstag}" or "ROUND(SUM({A},{B}) / 2, 1)".
   * Reference other fields by label in curly braces. Read-only in the fill form.
   */
  formula?: string;
  // Matrix/grid specific
  matrixRows?: string[];
  matrixCols?: string[];
  /** pitch between cell centers in pt */
  matrixCellWidth?: number;
  matrixCellHeight?: number;
  /** linear skew compensation per row/column (rotated scans) */
  matrixDriftX?: number;
  matrixDriftY?: number;
  /** non-linear scan correction per row/column, pt */
  matrixRowDx?: number[];
  matrixRowDy?: number[];
  matrixColDx?: number[];
  matrixColDy?: number[];
}

export interface StoredTemplate {
  id: string;
  name: string;
  /** uuid.pdf stored in $DATA_DIR/templates/ */
  fileName: string;
  pageCount: number;
  pageSizes: { width: number; height: number }[];
  /** Per-page display rotation (indexed by 0-based page). */
  pageRotations?: PageRotation[];
  fields: TemplateField[];
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  isAdmin: boolean;
  email?: string;
  defaultSignature?: string; // PNG data URL
  createdAt: string;
}

export interface AccessRequest {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
}

export type AIProvider = "gemini" | "openai" | "anthropic";

export interface AIProviderConfig {
  apiKey: string;
  model: string;
}

export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  providers: Record<AIProvider, AIProviderConfig>;
}

export interface Settings {
  general: { appName: string; appIcon: string };
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  pdf: { defaultFontSize: number; emailEnabled: boolean; emailTo: string };
  ai: AISettings;
}

export interface Store {
  users: User[];
  /** legacy field: still counts as admin */
  adminUserId?: string;
  templates: StoredTemplate[];
  settings: Settings;
  requests: AccessRequest[];
  savedFills: SavedFill[];
}

export interface PublicUser {
  id: string;
  username: string;
  isAdmin: boolean;
  email?: string;
  hasDefaultSignature: boolean;
}

export type FieldValue = string | boolean | Record<string, boolean> | undefined;

export interface FillValues {
  [fieldId: string]: FieldValue;
}

/** A named snapshot of filled-in values for a template, saved by a user. */
export interface SavedFill {
  id: string;
  templateId: string;
  userId: string;
  name: string;
  values: FillValues;
  /** Auto-draft: continuously updated as the user types (one per user+template). */
  auto?: boolean;
  createdAt: string;
  updatedAt: string;
}
