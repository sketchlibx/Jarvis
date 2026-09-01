import { describe, it, expect } from "vitest";
import { normalizeHandResult, normalizeFaceResult, normalizePoseResult, isValidLandmark, normalizeLandmarkArray, eulerFromMatrix } from "../normalizeMediaPipeResults";

function goodLandmarks(count: number) {
  return Array.from({ length: count }, (_, i) => ({ x: i / count, y: i / count, z: 0 }));
}

describe("isValidLandmark / normalizeLandmarkArray", () => {
  it("accepts a well-formed landmark", () => {
    expect(isValidLandmark({ x: 0.5, y: 0.5, z: 0.1 })).toBe(true);
  });
  it("rejects landmarks with missing or non-numeric fields", () => {
    expect(isValidLandmark({ x: 0.5, y: 0.5 })).toBe(false);
    expect(isValidLandmark({ x: "0.5", y: 0.5, z: 0 })).toBe(false);
    expect(isValidLandmark({ x: NaN, y: 0.5, z: 0 })).toBe(false);
    expect(isValidLandmark(null)).toBe(false);
    expect(isValidLandmark(undefined)).toBe(false);
    expect(isValidLandmark("not an object")).toBe(false);
  });
  it("filters out invalid entries while keeping valid ones", () => {
    const raw = [{ x: 0, y: 0, z: 0 }, { x: "bad", y: 0, z: 0 }, { x: 1, y: 1, z: 1 }];
    expect(normalizeLandmarkArray(raw)).toEqual([{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }]);
  });
  it("returns an empty array for non-array input", () => {
    expect(normalizeLandmarkArray(null)).toEqual([]);
    expect(normalizeLandmarkArray({})).toEqual([]);
    expect(normalizeLandmarkArray("garbage")).toEqual([]);
  });
});

describe("normalizeHandResult", () => {
  it("converts a well-formed two-hand result", () => {
    const raw = {
      landmarks: [goodLandmarks(21), goodLandmarks(21)],
      handedness: [[{ categoryName: "Left", score: 0.95 }], [{ categoryName: "Right", score: 0.91 }]],
    };
    const result = normalizeHandResult(raw, "t");
    expect(result).toHaveLength(2);
    expect(result[0].handedness).toBe("Left");
    expect(result[0].confidence).toBe(0.95);
    expect(result[0].landmarks).toHaveLength(21);
    expect(result[1].handedness).toBe("Right");
  });

  it("drops a hand with fewer than 21 valid landmarks instead of padding it", () => {
    const raw = {
      landmarks: [goodLandmarks(10)], // incomplete
      handedness: [[{ categoryName: "Left", score: 0.9 }]],
    };
    expect(normalizeHandResult(raw, "t")).toHaveLength(0);
  });

  it("defaults to 'Unknown' handedness and 0 confidence when handedness data is missing", () => {
    const raw = { landmarks: [goodLandmarks(21)], handedness: [] };
    const result = normalizeHandResult(raw, "t");
    expect(result).toHaveLength(1);
    expect(result[0].handedness).toBe("Unknown");
    expect(result[0].confidence).toBe(0);
  });

  it("returns an empty array for completely malformed input without throwing", () => {
    expect(normalizeHandResult(null, "t")).toEqual([]);
    expect(normalizeHandResult(undefined, "t")).toEqual([]);
    expect(normalizeHandResult("garbage", "t")).toEqual([]);
    expect(normalizeHandResult({}, "t")).toEqual([]);
    expect(normalizeHandResult({ landmarks: "not an array" }, "t")).toEqual([]);
  });

  it("rejects an invalid handedness category name rather than trusting it", () => {
    const raw = {
      landmarks: [goodLandmarks(21)],
      handedness: [[{ categoryName: "Tentacle", score: 0.9 }]],
    };
    expect(normalizeHandResult(raw, "t")[0].handedness).toBe("Unknown");
  });
});

describe("normalizeFaceResult", () => {
  it("returns detected:false for a frame with no face, not an error", () => {
    const result = normalizeFaceResult({ faceLandmarks: [] }, "t");
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("returns detected:false for malformed input without throwing", () => {
    expect(normalizeFaceResult(null, "t").detected).toBe(false);
    expect(normalizeFaceResult("garbage", "t").detected).toBe(false);
  });

  it("extracts expression features from a well-formed 468-point mesh", () => {
    const mesh = goodLandmarks(468);
    // Force mouthOpen ratio to something non-zero and computable.
    mesh[13] = { x: 0.5, y: 0.4, z: 0 };
    mesh[14] = { x: 0.5, y: 0.5, z: 0 };
    mesh[10] = { x: 0.5, y: 0.0, z: 0 };
    mesh[152] = { x: 0.5, y: 1.0, z: 0 };
    const result = normalizeFaceResult({ faceLandmarks: [mesh] }, "t");
    expect(result.detected).toBe(true);
    expect(result.expressionFeatures.mouthOpen).toBeGreaterThan(0);
  });

  it("computes a browFurrow proxy when brow/eye landmarks are present", () => {
    const mesh = goodLandmarks(468);
    mesh[10] = { x: 0.5, y: 0.0, z: 0 };
    mesh[152] = { x: 0.5, y: 1.0, z: 0 }; // faceHeight = 1
    mesh[65] = { x: 0.4, y: 0.3, z: 0 };  // inner brow
    mesh[133] = { x: 0.4, y: 0.32, z: 0 }; // eye, very close = furrowed
    const result = normalizeFaceResult({ faceLandmarks: [mesh] }, "t");
    expect(result.expressionFeatures.browFurrow).toBeGreaterThan(0.5);
  });

  it("sets headPose to null (not fabricated) when the transformation matrix is absent", () => {
    const result = normalizeFaceResult({ faceLandmarks: [goodLandmarks(468)] }, "t");
    expect(result.headPose).toBeNull();
  });
});

describe("normalizePoseResult", () => {
  it("returns detected:false when no pose landmarks are present", () => {
    expect(normalizePoseResult({ landmarks: [] }, "t").detected).toBe(false);
  });

  it("extracts only the six upper-body points, leaving others undefined", () => {
    const pose = goodLandmarks(33); // MediaPipe pose has 33 landmarks
    const result = normalizePoseResult({ landmarks: [pose] }, "t");
    expect(result.detected).toBe(true);
    expect(result.landmarks.leftShoulder).toBeDefined();
    expect(result.landmarks.rightWrist).toBeDefined();
  });

  it("does not throw on malformed input", () => {
    expect(() => normalizePoseResult(null, "t")).not.toThrow();
    expect(() => normalizePoseResult("garbage", "t")).not.toThrow();
  });
});

describe("eulerFromMatrix", () => {
  it("returns all-zero angles for an identity matrix", () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const result = eulerFromMatrix(identity);
    expect(result.yaw).toBeCloseTo(0);
    expect(result.pitch).toBeCloseTo(0);
    expect(result.roll).toBeCloseTo(0);
  });
});
