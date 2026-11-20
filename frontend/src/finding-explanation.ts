export type FindingSource = {page: number; clause?: string; quote: string; chunk_id: string};
export type ExplainableFinding = {
  severity: string; claim: string; recommendation?: string; reasoning?: string;
  simple_explanation?: string; severity_reason?: string; practical_example?: string;
  source_explanation?: string; perspective_note?: string; evidence?: FindingSource[];
};

const priorityMeaning: Record<string, string> = {
  CRITICAL: 'Urgent review priority. The reviewer considers this a potentially serious issue to resolve before relying on the agreement.',
  HIGH: 'High review priority. The reviewer considers the possible consequences significant enough to check early.',
  MEDIUM: 'Medium review priority. Clarify this concern and check the surrounding clauses before deciding whether a change is needed.',
  LOW: 'Lower review priority. Check this detail, even though the reviewer has placed other concerns ahead of it.',
};

export function explainFinding(finding: ExplainableFinding, perspective: string, documentType = '') {
  const quote = (finding.evidence || []).map(source => source.quote).join(' ');
  const allText = [finding.claim, finding.reasoning, quote].join(' ');
  // A narrowly matched explanation of the quoted wording, rather than a new legal finding.
  const limitedSellerPromise = /indemnif|indemnity/i.test(quote) && /vendor|seller/i.test(quote)
    && /act(?:s)?\s+or\s+omission/i.test(quote) && /title/i.test(quote)
    && /limit|omit|historical|prior|previous/i.test([finding.claim, finding.reasoning].join(' '));
  const severity = finding.severity.toUpperCase();
  const simple = finding.simple_explanation?.trim() || (limitedSellerPromise
    ? 'The seller promises to cover certain losses suffered by the buyer because of something the seller did or failed to do. The reviewer is asking whether that promise also covers ownership problems caused by earlier owners.'
    : 'The reviewer is asking you to check the concern stated above against the exact contract wording below. A separate plain-language explanation was not saved for this finding.');
  const severityReason = finding.severity_reason?.trim()
    || `The saved review assigns ${severity} priority but does not record why it chose that level. This label alone does not establish how likely a problem is or how much loss it could cause.`;
  const example = finding.practical_example?.trim() || (limitedSellerPromise
    ? 'Imagine someone later claims a right over the property because of an event before the current seller owned it. The question is whether the seller’s promise would cover the buyer’s resulting loss. This is an illustration, not a claim that such a problem exists.' : '');
  const sourceExplanation = finding.source_explanation?.trim() || (limitedSellerPromise
    ? 'The words about an “act or omission of the Vendor” connect the promise to the seller’s own actions or failures to act. That raises a question about earlier ownership problems. Read the other ownership promises in the deed too; this quotation alone does not show what the entire agreement covers.'
    : 'This is the contract passage attached to the finding. It is the source wording to check, rather than proof that every possible consequence described by the reviewer will happen. Read it with the surrounding clauses.');
  const sellerPerspective = perspective === 'contract_giver' && (limitedSellerPromise || /sale\s*deed/i.test(documentType));
  const perspectiveNote = limitedSellerPromise && sellerPerspective
    ? 'You are viewing the seller’s side. This concern mainly relates to the buyer’s protection. Expanding the seller’s promise could increase the seller’s responsibility. Check whether the suggested change suits the party you represent before applying it.'
    : finding.perspective_note?.trim() || '';
  const terms: {term: string; meaning: string}[] = [];
  if (limitedSellerPromise || /sale\s*deed/i.test(documentType)) {
    if (/\bvendor\b/i.test(allText)) terms.push({term: 'Vendor', meaning: 'The seller.'});
    if (/\bvendee\b/i.test(allText)) terms.push({term: 'Vendee', meaning: 'The buyer.'});
  }
  if (/indemnif|indemnity/i.test(allText)) terms.push({term: 'Indemnity', meaning: 'A promise to cover specified losses, under the conditions stated in the contract.'});
  if (/act(?:s)?\s+or\s+omission/i.test(allText)) terms.push({term: 'Acts or omissions', meaning: 'Things a person did, or failed to do.'});
  if (/title defect|defect(?:s)? in title/i.test(allText)) terms.push({term: 'Title defect', meaning: 'A problem or dispute concerning ownership of the property.'});
  if (/historical/i.test(allText)) terms.push({term: 'Historical', meaning: 'Connected with events in the past.'});
  return {simple, severity, priorityMeaning: priorityMeaning[severity] || 'The review does not provide a recognised priority level.', severityReason, example, sourceExplanation, perspectiveNote, terms};
}
