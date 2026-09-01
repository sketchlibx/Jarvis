import React from "react";
import type { DesignController } from "../../design3d/commands/DesignController";
import { MATERIAL_PRESETS, listMaterialPresets } from "../../design3d/materials/presets";
import type { MaterialPresetName } from "../../design3d/types";

interface Props {
  controller: DesignController;
  selectedId: string | null;
  onChange: () => void; // bumps the parent's syncToken after a mutation
}

/**
 * Every field here calls `controller.apply(...)` — the SAME DesignCommand
 * pathway the AI translation layer uses. This is what spec section 19
 * means by "do not create a separate mutation pathway that bypasses
 * history": dragging a number in this panel produces a real, undoable
 * MOVE_OBJECT/UPDATE_OBJECT/SET_MATERIAL command, not a direct graph write.
 */
export function InspectorPanel({ controller, selectedId, onChange }: Props) {
  const obj = selectedId ? controller.graph.get(selectedId) : undefined;

  if (!obj) {
    return (
      <div className="glass-panel studio-right">
        <div className="studio-empty">Select an object to inspect it.</div>
      </div>
    );
  }

  const setPosition = (axis: "x" | "y" | "z", value: number) => {
    if (!Number.isFinite(value)) return;
    const next = { ...obj.transform.position, [axis]: value };
    controller.apply({ type: "MOVE_OBJECT", objectId: obj.id, position: next });
    onChange();
  };
  const setRotation = (axis: "x" | "y" | "z", value: number) => {
    if (!Number.isFinite(value)) return;
    const next = { ...obj.transform.rotation, [axis]: value };
    controller.apply({ type: "ROTATE_OBJECT", objectId: obj.id, rotation: next });
    onChange();
  };
  const setScale = (axis: "x" | "y" | "z", value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const next = { ...obj.transform.scale, [axis]: value };
    controller.apply({ type: "SCALE_OBJECT", objectId: obj.id, scale: next });
    onChange();
  };
  const setColor = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    controller.apply({ type: "SET_COLOR", objectId: obj.id, color: hex });
    onChange();
  };
  const applyPreset = (preset: MaterialPresetName) => {
    controller.apply({ type: "SET_MATERIAL", objectId: obj.id, material: MATERIAL_PRESETS[preset] });
    onChange();
  };
  const setParameter = (key: string, value: number) => {
    if (!Number.isFinite(value)) return;
    controller.apply({ type: "UPDATE_OBJECT", objectId: obj.id, parameters: { ...obj.parameters, [key]: value } });
    onChange();
  };

  return (
    <div className="glass-panel studio-right">
      <div className="studio-panel-title">Object</div>
      <div className="inspector-field"><label>Name</label><input value={obj.name} readOnly /></div>
      <div className="inspector-field"><label>Type</label><input value={obj.type} readOnly /></div>

      <div className="studio-panel-title">Position</div>
      <div className="inspector-row">
        {(["x", "y", "z"] as const).map((axis) => (
          <div className="inspector-field" key={axis}>
            <label>{axis.toUpperCase()}</label>
            <input type="number" step="0.01" value={obj.transform.position[axis]} onChange={(e) => setPosition(axis, parseFloat(e.target.value))} />
          </div>
        ))}
      </div>

      <div className="studio-panel-title">Rotation (deg)</div>
      <div className="inspector-row">
        {(["x", "y", "z"] as const).map((axis) => (
          <div className="inspector-field" key={axis}>
            <label>{axis.toUpperCase()}</label>
            <input type="number" step="1" value={obj.transform.rotation[axis]} onChange={(e) => setRotation(axis, parseFloat(e.target.value))} />
          </div>
        ))}
      </div>

      <div className="studio-panel-title">Scale</div>
      <div className="inspector-row">
        {(["x", "y", "z"] as const).map((axis) => (
          <div className="inspector-field" key={axis}>
            <label>{axis.toUpperCase()}</label>
            <input type="number" step="0.1" min="0.001" value={obj.transform.scale[axis]} onChange={(e) => setScale(axis, parseFloat(e.target.value))} />
          </div>
        ))}
      </div>

      <div className="studio-panel-title">Material</div>
      <div className="inspector-field">
        <label>Base Color</label>
        <input type="color" value={obj.material.baseColor} onChange={(e) => setColor(e.target.value)} />
      </div>
      <div className="inspector-field">
        <label>Preset</label>
        <select
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid var(--border-glass)", borderRadius: 5, color: "var(--text-primary)", padding: "5px 8px", fontSize: 12.5 }}
          onChange={(e) => applyPreset(e.target.value as MaterialPresetName)}
          value=""
        >
          <option value="" disabled>Apply preset…</option>
          {listMaterialPresets().map((p) => <option key={p} value={p}>{p.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      <div className="studio-panel-title">Parameters</div>
      {Object.entries(obj.parameters).map(([key, value]) => (
        typeof value === "number" ? (
          <div className="inspector-field" key={key}>
            <label>{key}</label>
            <input type="number" step="0.005" value={value} onChange={(e) => setParameter(key, parseFloat(e.target.value))} />
          </div>
        ) : null
      ))}
    </div>
  );
}
