// The single source of truth for the domain model.

export type FieldKind =
  | "text"
  | "multiline"
  | "date"
  | "checkbox"
  | "signature"
  | "matrix";

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

export interface Settings {
  general: { appName: string; appIcon: string };
  smtp: { host: string; port: number; secure: boolean; user: string; pass: string; from: string };
  pdf: { defaultFontSize: number; emailEnabled: boolean; emailTo: string };
}

export interface Store {
  users: User[];
  /** legacy field: still counts as admin */
  adminUserId?: string;
  templates: StoredTemplate[];
  settings: Settings;
  requests: AccessRequest[];
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
