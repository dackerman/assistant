export const SUPPORTED_MODELS = {
  SONNET_4: "claude-sonnet-4-20250514",
  OPUS_4_1: "claude-opus-4-1-20250805",
} as const;

export type SupportedModel =
  (typeof SUPPORTED_MODELS)[keyof typeof SUPPORTED_MODELS];

export const DEFAULT_MODEL = SUPPORTED_MODELS.SONNET_4;

export const MODEL_DISPLAY_NAMES: Record<SupportedModel, string> = {
  [SUPPORTED_MODELS.SONNET_4]: "Claude Sonnet 4",
  [SUPPORTED_MODELS.OPUS_4_1]: "Claude Opus 4.1",
};

export const MODEL_DESCRIPTIONS: Record<SupportedModel, string> = {
  [SUPPORTED_MODELS.SONNET_4]:
    "High-performance model with exceptional reasoning capabilities",
  [SUPPORTED_MODELS.OPUS_4_1]: "Our most capable and intelligent model yet",
};
