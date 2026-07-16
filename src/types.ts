export type ShellRunner = (command: string) => Promise<string>;

export type DiffLimits = {
  maxDiffBytes: number;
  maxDiffLines: number;
  maxFiles: number;
};

export type BaseResolution =
  | {
      ok: true;
      baseRef: string;
      mergeBase: string;
    }
  | {
      ok: false;
      message: string;
    };

export type DiffContext = {
  baseRef: string;
  mergeBase: string;
  stat: string;
  nameStatus: string;
  diff: string;
  truncated: boolean;
  truncationReason?: string;
};

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingConfidence = "high" | "medium" | "low";
export type FindingCategory =
  | "bug"
  | "security"
  | "performance"
  | "maintainability"
  | "test"
  | "docs"
  | "other";

export type ReviewerFinding = {
  title: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  file: string;
  line?: number;
  category: FindingCategory;
  evidence: string;
  recommendation: string;
  falsePositiveRisk: string;
};

export type ReviewerOutput = {
  summary: string;
  findings: ReviewerFinding[];
};

export type ReviewerResult = {
  model: string;
  output: ReviewerOutput;
};

export type ReviewAction = "address" | "investigate" | "likely false positive";

export type FindingGroup = {
  title: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  category: FindingCategory;
  file: string;
  line?: number;
  models: string[];
  findings: ReviewerFinding[];
  action: ReviewAction;
};

export type ReviewerFailure = {
  model: string;
  reason: string;
};

export type ReportInput = {
  groups: FindingGroup[];
  failures: ReviewerFailure[];
  partial: boolean;
  truncationReason?: string;
};

export type RunReviewInput = {
  runAgent: AgentRunner;
  shell: ShellRunner;
  models: string[];
  baseRef?: string;
  instructions?: string;
  limits: DiffLimits;
  saveRawOutput?: (model: string, text: string) => Promise<string | undefined>;
};

export type ReviewStateStore = {
  readLastModels(): Promise<string[]>;
  writeLastModels(models: string[]): Promise<void>;
};

export type ThinkingLevel = "low" | "medium" | "high";

// Cursor bakes reasoning effort into the model id, so an invocation carries a
// fully-resolved concrete model id (e.g. claude-opus-4-8-high) and no thinking flag.
export type AgentInvocation = {
  model: string;
  prompt: string;
};

export type AgentResult =
  | { model: string; ok: true; stdout: string }
  | { model: string; ok: false; reason: string };

export type AgentRunner = (invocation: AgentInvocation) => Promise<AgentResult>;
