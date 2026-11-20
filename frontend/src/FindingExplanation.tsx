import {FileText} from 'lucide-react';
import {PdfLink} from './PdfLinks';
import {explainFinding, type ExplainableFinding} from './finding-explanation';

export function FindingExplanation({finding, perspective, documentType}: {
  finding: ExplainableFinding; perspective: string; documentType?: string;
}) {
  const explanation = explainFinding(finding, perspective, documentType);
  return <details className="finding-explanation">
    <summary>Why this was flagged & source</summary>
    <div className="finding-explanation-content">
      <section><h4>What this means in simple words</h4><p>{explanation.simple}</p></section>
      <section className="finding-priority-reason"><h4>Why {explanation.severity} priority?</h4><p>{explanation.priorityMeaning}</p><p>{explanation.severityReason}</p></section>
      {explanation.perspectiveNote&&<section className="finding-perspective-note"><h4>What this means for your side</h4><p>{explanation.perspectiveNote}</p></section>}
      {explanation.example&&<section><h4>A possible example</h4><p>{explanation.example}</p></section>}
      {explanation.terms.length>0&&<section><h4>Legal words explained</h4><dl className="finding-glossary">{explanation.terms.map(item=><div key={item.term}><dt>{item.term}</dt><dd>{item.meaning}</dd></div>)}</dl></section>}
      <section><h4>How the source supports this concern</h4><p>{explanation.sourceExplanation}</p>
        {finding.evidence?.length?finding.evidence.map((proof,index)=><blockquote key={`${proof.chunk_id}-${index}`}><strong className="source-caption">Exact contract wording · page {proof.page}</strong><p>“{proof.quote}”</p><PdfLink contractId={proof.chunk_id.split('_C')[0]} page={proof.page}><FileText size={16}/>Open source · page {proof.page}</PdfLink></blockquote>):<p>No source passage was saved for this finding. Check the original document before relying on it.</p>}
      </section>
      {finding.reasoning&&<details className="original-finding-reasoning"><summary>Original reviewer explanation</summary><p>{finding.reasoning}</p></details>}
    </div>
  </details>;
}
