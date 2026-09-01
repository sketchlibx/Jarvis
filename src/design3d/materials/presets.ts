import type { MaterialPresetName, MaterialSpec } from "../types";

/**
 * Original style presets inspired by futuristic engineering aesthetics —
 * explicitly NOT real-world manufacturing specifications (spec section 17
 * requires this framing be kept honest; these numbers are art-directed,
 * not measured from real titanium/carbon/etc).
 */
export const MATERIAL_PRESETS: Record<MaterialPresetName, MaterialSpec> = {
  titanium: { kind: "metal", baseColor: "#8e9aa8", metallic: 0.85, roughness: 0.35 },
  graphite: { kind: "matte_metal", baseColor: "#2b2f33", metallic: 0.3, roughness: 0.75 },
  carbon: { kind: "carbon_fiber", baseColor: "#15171a", metallic: 0.1, roughness: 0.4 },
  ceramic: { kind: "matte_metal", baseColor: "#e8e6e1", metallic: 0.05, roughness: 0.55 },
  chrome: { kind: "glossy_metal", baseColor: "#c9ced4", metallic: 1.0, roughness: 0.06 },
  dark_alloy: { kind: "metal", baseColor: "#1c1f24", metallic: 0.7, roughness: 0.3 },
  neon_polymer: { kind: "plastic", baseColor: "#12151a", metallic: 0.0, roughness: 0.4, emissiveColor: "#4ee1ff", emissiveIntensity: 1.5 },
  energy_core: { kind: "emissive", baseColor: "#0a0f14", metallic: 0.0, roughness: 0.2, emissiveColor: "#4ee1ff", emissiveIntensity: 4, opacity: 1 },
  holographic_glass: { kind: "holographic", baseColor: "#4ee1ff", metallic: 0.0, roughness: 0.05, opacity: 0.35, transmission: 0.8 },
};

export function getMaterialPreset(name: MaterialPresetName): MaterialSpec {
  return { ...MATERIAL_PRESETS[name] };
}

export function listMaterialPresets(): MaterialPresetName[] {
  return Object.keys(MATERIAL_PRESETS) as MaterialPresetName[];
}
