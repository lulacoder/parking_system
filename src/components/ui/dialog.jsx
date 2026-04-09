import React from "react";
import { cn } from "../../lib/utils";

export function Dialog({ open, onClose, title, children, className }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={cn("w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-soft", className)}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-lg font-semibold">{title}</h3>
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
