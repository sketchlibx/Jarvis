import React from "react";
import type { ComponentType } from "../../design3d/types";

const CATEGORIES: Record<string, ComponentType[]> = {
  Armor: ["armor_plate", "panel", "bevelled_panel"],
  Mechanical: ["joint", "hinge", "connector", "handle", "mount"],
  Energy: ["core", "emitter", "lens"],
  Structural: ["box", "cylinder", "sphere", "cone", "capsule", "ring", "tube"],
  Utility: ["vent", "grille"],
};

export function ComponentLibraryPanel({ onAdd }: { onAdd: (type: ComponentType) => void }) {
  return (
    <div className="glass-panel studio-left">
      {Object.entries(CATEGORIES).map(([category, types]) => (
        <div key={category}>
          <div className="studio-panel-title">{category}</div>
          {types.map((t) => (
            <div key={t} className="studio-lib-item" onClick={() => onAdd(t)}>
              <ComponentIcon />
              {t.replace(/_/g, " ")}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ComponentIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6, flexShrink: 0 }}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  );
}
