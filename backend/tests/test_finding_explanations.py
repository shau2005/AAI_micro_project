import pytest
from backend.app import main
from backend.app.models import Chunk, Finding
from backend.app.storage import LocalStore


@pytest.mark.parametrize('dual', [False, True])
def test_generation_requests_and_preserves_plain_explanations(monkeypatch, tmp_path, dual):
    chunk = Chunk(chunk_id='sample_C0001', contract_id='sample', page_start=1, page_end=1,
        text='The Vendor shall indemnify the Vendee against loss caused by the Vendor.')
    explanations = {
        'simple_explanation': 'The seller promises to cover the buyer’s losses under this condition.',
        'severity_reason': 'The concern depends on which losses the promise covers and other ownership clauses.',
        'practical_example': 'For example, a buyer might ask who covers an earlier ownership claim.',
        'source_explanation': 'The words “caused by the Vendor” state a condition on the seller’s promise.',
        'perspective_note': 'Widening this promise would increase the seller’s responsibility.',
    }
    item = dict(category='LIABILITY', severity='MEDIUM', claim='Clarify which losses the seller promises to cover.',
        page=1, clause='', quote=chunk.text, reasoning='The quoted condition limits the promise.',
        recommendation='Check the other ownership clauses.', proposed_language='', confidence=.8, **explanations)
    def generate(prompt, schema, *args, **kwargs):
        assert 'everyday sentences' in prompt
        assert 'do not present that alone as a seller-protective fix' in prompt
        assert 'MEDIUM for a concern needing clarification' in prompt
        items = schema['properties']['contract_giver' if dual else 'findings']['items']
        assert set(explanations).issubset(items['properties'])
        assert set(explanations).issubset(items['required'])
        return {'contract_giver': [item], 'contract_acceptor': [item]} if dual else {'findings': [item]}
    monkeypatch.setattr(main, 'generate', generate)
    result = main.full_contract_dual_review([chunk], 'Review', 'gemini-test') if dual else main.full_contract_review([chunk], 'Review', 'gemini-test')
    findings = result['contract_giver'] if dual else result
    finding = findings[0]
    for name, value in explanations.items(): assert getattr(finding, name) == value
    assert finding.evidence[0].quote == chunk.text
    assert finding.severity == 'MEDIUM'
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    storage.save_findings('sample', findings)
    saved = storage.findings('sample')[0][0]
    assert saved.severity_reason == explanations['severity_reason']
    assert saved.simple_explanation == explanations['simple_explanation']


def test_old_findings_remain_readable_without_inventing_priority_reasons():
    finding = Finding(finding_id='old', category='LIABILITY', severity='MEDIUM', claim='Old claim.')
    assert finding.severity_reason == ''
    assert finding.simple_explanation == ''


def test_local_rule_priority_explains_that_it_is_a_preset():
    chunk = Chunk(chunk_id='local_C0001', contract_id='local', page_start=1, page_end=1,
        text='Either party may terminate by giving sixty days notice.')
    finding = main.local_rule_review([chunk])[0]
    assert finding.severity == 'MEDIUM'
    assert 'automatically' in finding.severity_reason
    assert 'not assessed' in finding.severity_reason
    assert 'not confirmation' in finding.simple_explanation
