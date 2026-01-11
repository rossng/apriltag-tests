export interface Corner {
  x: number;
  y: number;
}

export interface Detection {
  tag_id: number;
  tag_family: string;
  corners: Corner[];
}

export interface FamilyTiming {
  family: string;
  initialization_ms: number;
  detection_ms: number;
}

export interface Timings {
  image_load_ms: number;
  total_detection_ms: number;
  family_timings: FamilyTiming[];
}

export interface DetectionFile {
  image: string;
  detections: Detection[];
  timings?: Timings;
}

export interface Manifest {
  supported_families: string[];
}

export class DetectionKey {
  constructor(
    public readonly tagId: number,
    public readonly tagFamily: string
  ) {}

  equals(other: DetectionKey): boolean {
    return this.tagId === other.tagId && this.tagFamily === other.tagFamily;
  }

  toString(): string {
    return `${this.tagFamily}:${this.tagId}`;
  }
}

export interface ImageResult {
  imageName: string;
  groundTruth: DetectionKey[];
  detectorResults: Map<string, DetectionKey[]>;
  missed: Map<string, Set<DetectionKey>>;
  falsePositives: Map<string, Set<DetectionKey>>;
  timings: Map<string, Timings | null>;
}

export interface TimingSummary {
  avgImageLoadMs: number;
  avgTotalDetectionMs: number;
  totalImageLoadMs: number;
  totalDetectionMs: number;
  imageCount: number;
  familyTimings: Map<string, { avgInit: number; avgDetect: number; count: number }>;
}

export interface Summary {
  totalGroundTruth: number;
  totalDetected: number;
  truePositives: number;
  missed: number;
  falsePositives: number;
  precision: number;
  recall: number;
  f1Score: number;
  missedByFamily: Map<string, number>;
  fpByFamily: Map<string, number>;
  supportedFamilies: string[];
  timing: TimingSummary;
}

// Serializable versions for passing to client-side JS
export interface SerializableDetection {
  tag_id: number;
  tag_family: string;
  corners: Corner[];
}

export interface SerializableImageResult {
  imageName: string;
  imagePath: string;
  groundTruth: SerializableDetection[];
  detectorResults: Record<string, SerializableDetection[]>;
  missed: Record<string, string[]>;
  falsePositives: Record<string, string[]>;
  stats: Record<string, { detected: number; missed: number; falsePositives: number }>;
  timings: Record<string, Timings | null>;
}

export interface SerializableFamilyTiming {
  family: string;
  avgInit: number;
  avgDetect: number;
  count: number;
}

export interface SerializableTimingSummary {
  avgImageLoadMs: number;
  avgTotalDetectionMs: number;
  totalImageLoadMs: number;
  totalDetectionMs: number;
  imageCount: number;
  familyTimings: SerializableFamilyTiming[];
}

export interface SerializableSummary {
  totalGroundTruth: number;
  totalDetected: number;
  truePositives: number;
  missed: number;
  falsePositives: number;
  precision: number;
  recall: number;
  f1Score: number;
  missedByFamily: Record<string, number>;
  fpByFamily: Record<string, number>;
  supportedFamilies: string[];
  timing: SerializableTimingSummary;
}

// Parsed detector info for display
export interface DetectorInfo {
  fullName: string;      // e.g., "kornia-rs-apriltag@aarch64-darwin"
  baseName: string;      // e.g., "kornia-rs-apriltag"
  arch: string | null;   // e.g., "aarch64-darwin" or null if no arch
}

// Parse a detector name that may include @arch suffix
export function parseDetectorName(name: string): DetectorInfo {
  const atIndex = name.indexOf('@');
  if (atIndex === -1) {
    return { fullName: name, baseName: name, arch: null };
  }
  return {
    fullName: name,
    baseName: name.substring(0, atIndex),
    arch: name.substring(atIndex + 1)
  };
}

// Format architecture for display
export function formatArch(arch: string): string {
  const archMap: Record<string, string> = {
    'x86_64-linux': 'x86 Linux',
    'aarch64-darwin': 'ARM64 macOS',
    'aarch64-linux': 'ARM64 Linux',
    'x86_64-darwin': 'x86 macOS',
  };
  return archMap[arch] || arch;
}
