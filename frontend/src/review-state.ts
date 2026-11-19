export type ReviewResult = {
  findings: unknown[];
  summary?: {score?: number | null; rationale?: string};
};

export function selectPerspective<T extends ReviewResult>(
  review: (T & {perspective_reviews?: Record<string, T>}) | undefined,
  perspective: string,
): T | undefined {
  // Older/cached reports can have an empty perspectives object but a valid
  // top-level giver summary. Do not discard that saved result.
  return review?.perspective_reviews?.[perspective]
    ?? (perspective === 'contract_giver' ? review : undefined);
}
