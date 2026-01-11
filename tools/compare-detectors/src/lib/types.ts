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
