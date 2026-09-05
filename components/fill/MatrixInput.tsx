"use client";

import { useState } from "react";
import type { TemplateField } from "@/lib/types";
import MatrixGrid from "../editor/MatrixGrid";

export type MatrixSelection = Record<string, boolean>;

/** Toggleable matrix input: click cells to mark them. */
export default function MatrixInput({
  field,
  value,
  onChange,
}: {
  field: TemplateField;
  value: MatrixSelection;
  onChange: (selection: MatrixSelection) => void;
}) {
  const toggle = (row: number, col: number) => {
    const key = `${row}:${col}`;
    onChange({ ...value, [key]: !value[key] });
  };

  return (
    <div>
      <MatrixGrid field={field} selection={value} onCellClick={toggle} />
      <p className="mt-1 text-xs text-ink-dim">Klicke eine Zelle an, um sie zu markieren.</p>
    </div>
  );
}
