import React, { useCallback, useRef, useState } from "react";
import { DesignController } from "../../design3d/commands/DesignController";
import { generateComponentParameters } from "../../design3d/generators/componentDefaults";
import type { ComponentType } from "../../design3d/types";
import { Viewport, type ViewportHandle } from "./Viewport";
import { ComponentLibraryPanel } from "./ComponentLibraryPanel";
import { InspectorPanel } from "./InspectorPanel";
import { StudioTopBar } from "./StudioTopBar";
import { HistoryBar } from "./HistoryBar";
import { ARView } from "../ar/ARView";
import type { VisionPipeline } from "../../vision/VisionPipeline";

interface Props {
  onExit: () => void;
  onSaveProject: (name: string, controller: DesignController) => Promise<void>;
  /** Reused from the main Assistant view's Phase 3 camera pipeline — see
   * ARView's doc comment. Both may be null if the camera was never
   * started; the AR toggle only appears once a stream is available,
   * rather than implying AR works with no camera at all. */
  visionPipeline: VisionPipeline | null;
  cameraStream: MediaStream | null;
}

let objectCounter = 0;
function nextObjectId(type: ComponentType): string {
  objectCounter += 1;
  return `${type}_${objectCounter}`;
}

export function DesignStudio({ onExit, onSaveProject, visionPipeline, cameraStream }: Props) {
  // One controller per studio session — created once, lives for the
  // studio's lifetime, disposed implicitly when the component unmounts
  // (the controller itself holds no browser resources; only Viewport's
  // SceneManager/GraphRenderer do, and those clean up in their own effect).
  const controllerRef = useRef(new DesignController());
  const viewportRef = useRef<ViewportHandle>(null);
  const [projectName, setProjectName] = useState("Untitled Design");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [syncToken, setSyncToken] = useState(0);
  const [arMode, setArMode] = useState(false);
  const bump = useCallback(() => setSyncToken((t) => t + 1), []);

  const handleAddComponent = useCallback((type: ComponentType) => {
    const { parameters, errors } = generateComponentParameters(type);
    if (errors.length > 0) {
      console.warn("Generated parameters failed validation (should not happen for defaults):", errors);
      return;
    }
    const id = nextObjectId(type);
    const result = controllerRef.current.apply({
      type: "CREATE_OBJECT", objectId: id, componentType: type, parameters,
      parentId: selectedId ?? null, // new components nest under the current selection, if any — matches "add three energy emitters" to the currently-selected gauntlet
    });
    if (result.success) {
      setSelectedId(id);
      bump();
    }
  }, [selectedId, bump]);

  const handleUndo = useCallback(() => { controllerRef.current.undo(); bump(); }, [bump]);
  const handleRedo = useCallback(() => { controllerRef.current.redo(); bump(); }, [bump]);
  const handleReset = useCallback(() => {
    if (!window.confirm("Reset the design? This clears all objects and history.")) return;
    controllerRef.current.reset();
    setSelectedId(null);
    bump();
  }, [bump]);
  const handleSave = useCallback(async () => {
    await onSaveProject(projectName, controllerRef.current);
  }, [projectName, onSaveProject]);

  // Keyboard shortcuts — Ctrl+Z / Ctrl+Y per spec section 14.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); handleUndo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); handleRedo(); }
  }, [handleUndo, handleRedo]);

  return (
    <div className="studio-shell" tabIndex={0} onKeyDown={handleKeyDown}>
      <StudioTopBar
        projectName={projectName}
        onProjectNameChange={setProjectName}
        onSave={handleSave}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={controllerRef.current.history.canUndo()}
        canRedo={controllerRef.current.history.canRedo()}
        onReset={handleReset}
        onResetCamera={() => viewportRef.current?.resetCamera()}
        wireframe={wireframe}
        onToggleWireframe={() => setWireframe((w) => !w)}
        onExit={onExit}
        arAvailable={!!(visionPipeline && cameraStream)}
        onToggleAR={() => setArMode((a) => !a)}
      />
      <ComponentLibraryPanel onAdd={handleAddComponent} />
      {arMode && visionPipeline && cameraStream ? (
        <ARView
          designController={controllerRef.current}
          visionPipeline={visionPipeline}
          cameraStream={cameraStream}
          selectedDesignObjectId={selectedId}
          onExit={() => setArMode(false)}
        />
      ) : (
        <Viewport
          ref={viewportRef}
          controller={controllerRef.current}
          selectedId={selectedId}
          onSelect={setSelectedId}
          wireframe={wireframe}
          syncToken={syncToken}
        />
      )}
      <InspectorPanel controller={controllerRef.current} selectedId={selectedId} onChange={bump} />
      <HistoryBar controller={controllerRef.current} syncToken={syncToken} viewportRef={viewportRef} />
    </div>
  );
}
