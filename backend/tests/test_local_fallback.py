from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app import agents, main
from backend.app.gemini import ModelTimeoutError
from backend.app.models import Chunk, ContractMeta, ReviewRequest
from backend.app.storage import LocalStore


@pytest.fixture
def local_contract(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    monkeypatch.setattr(agents, 'store', storage)
    meta = ContractMeta(contract_id='fallback-test', original_filename='sample.pdf', sha256='test',
        upload_time=datetime.now(timezone.utc), selected_model='gemini-test', processing_status='ready', page_count=1)
    c = Chunk(chunk_id='fallback-test_C0001', contract_id=meta.contract_id, page_start=1, page_end=1,
        text='The Licensee shall pay the monthly fee. Either party may terminate with sixty days notice. This agreement is signed by both parties.')
    storage.save_contract(meta, b'%PDF test')
    storage.save_chunks(meta.contract_id, [c])
    return storage, meta, c


@pytest.mark.parametrize('empty_response', [False, True])
def test_review_finishes_with_local_rules_if_model_unavailable(monkeypatch, local_contract, empty_response):
    from backend.app import internet_search
    storage, meta, c = local_contract
    monkeypatch.setattr(agents, 'classify_contract', lambda *a, **k: {'document_type': 'lease', 'jurisdiction': 'unknown'})
    monkeypatch.setattr(internet_search, 'research_contract_rules', lambda *a, **k: {'status': 'not_configured', 'sources': []})
    def unavailable(*a, **k):
        if empty_response:
            return None
        raise ModelTimeoutError('model timed out')
    monkeypatch.setattr(main, 'full_contract_dual_review', unavailable)
    main.run_review(meta.contract_id, [c], meta, ReviewRequest(model='gemini-test'))
    saved = storage.get_meta(meta.contract_id)
    assert saved.analysis_status == 'complete'
    assert saved.selected_model == ''
    graph = storage.load_graph(meta.contract_id)
    assert graph['graph']['extraction']['method'] == 'local-rules'
    assert set(graph['perspective_reviews']) == {'contract_giver', 'contract_acceptor'}
    for review in graph['perspective_reviews'].values():
        assert review['findings']
        assert all('offline rule-based' in finding['reasoning'] for finding in review['findings'])


@pytest.mark.parametrize('workspace', [False, True])
def test_chat_returns_cited_excerpts_instead_of_model_error(monkeypatch, local_contract, workspace):
    from backend.app import retrieval
    storage, meta, c = local_contract
    monkeypatch.setattr(retrieval, 'HybridRetriever', lambda *a, **k: SimpleNamespace(search=lambda *a, **k: [c]))
    def unavailable(*a, **k):
        raise ModelTimeoutError('model timed out')
    monkeypatch.setattr(main, 'generate', unavailable)
    body = {'message': 'What is the notice period?', 'model': 'gemini-test'}
    if workspace:
        body['contract_ids'] = [meta.contract_id]
    route = '/api/workspace/chat' if workspace else f'/api/contracts/{meta.contract_id}/chat'
    response = TestClient(main.app).post(route, json=body)
    assert response.status_code == 200
    result = response.json()
    assert result['citations'][0]['chunk_id'] == c.chunk_id
    assert 'Relevant retrieved excerpts' in result['content']
    assert 'Model API error' not in result['content']
    assert result['model'] is None


def test_retrieval_uses_original_question_if_rewrite_unavailable(monkeypatch):
    def unavailable(*a, **k):
        raise ModelTimeoutError('model timed out')
    monkeypatch.setattr(main, 'generate', unavailable)
    history = [SimpleNamespace(role='user', content='Who pays the rent?')]
    assert main.standalone_retrieval_query('When is it due?', history, 'gemini-test') == 'When is it due?'


@pytest.mark.parametrize('workspace', [False, True])
@pytest.mark.parametrize('requested_model,expected_model', [(None, 'gemini-default'), ('local', None), ('gemini-chosen', 'gemini-chosen')])
def test_chat_model_defaults_preserve_explicit_selection(monkeypatch, local_contract, workspace, requested_model, expected_model):
    from backend.app import retrieval
    _, meta, chunk = local_contract
    calls = []
    catalog_calls = []
    monkeypatch.setattr(retrieval, 'HybridRetriever', lambda *a, **k: SimpleNamespace(search=lambda *a, **k: [chunk]))
    def available():
        catalog_calls.append(True)
        return ['catalog']
    monkeypatch.setattr(main, 'available_models', available)
    monkeypatch.setattr(main, 'default_model', lambda models: 'gemini-default')
    def generate(prompt, schema, model):
        calls.append(model)
        if model is None:
            return None
        return {'answer': 'The notice period is sixty days.', 'cited_chunk_ids': [chunk.chunk_id]}
    monkeypatch.setattr(main, 'generate', generate)
    body = {'message': 'What is the notice period?'}
    if requested_model is not None:
        body['model'] = requested_model
    if workspace:
        body['contract_ids'] = [meta.contract_id]
    route = '/api/workspace/chat' if workspace else f'/api/contracts/{meta.contract_id}/chat'
    response = TestClient(main.app).post(route, json=body)
    assert response.status_code == 200
    assert calls == [expected_model]
    assert bool(catalog_calls) == (requested_model is None)
    result = response.json()
    assert result['model'] == expected_model
    assert result['citations'][0]['chunk_id'] == chunk.chunk_id
    if requested_model == 'local':
        assert 'Relevant retrieved excerpts' in result['content']
