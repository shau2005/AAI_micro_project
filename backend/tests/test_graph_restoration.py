from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from backend.app import agents, main, retrieval
from backend.app.models import Chunk, ContractMeta
from backend.app.storage import LocalStore


@pytest.fixture
def graph_document(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    meta = ContractMeta(contract_id='restored', workspace_id='owner', original_filename='sale.pdf', sha256='test',
        upload_time=datetime.now(timezone.utc), processing_status='ready', analysis_status='complete', selected_model='gemini-test')
    chunk = Chunk(chunk_id='restored_C0001', contract_id='restored', page_start=1, page_end=1,
        text='The Vendor transfers the property to the Vendee.')
    storage.save_contract(meta, b'%PDF test')
    storage.save_chunks(meta.contract_id, [chunk])
    saved = {
        'graph': {'version': 3, 'nodes': [{'id': 'vendor', 'label': 'Vendor'}, {'id': 'vendee', 'label': 'Vendee'}],
            'edges': [{'source': 'vendor', 'target': 'vendee', 'relation': 'TRANSFERS_TO', 'evidence_sources': [
                {'chunk_id': chunk.chunk_id, 'page': 1, 'quote': chunk.text}]}]},
        'metadata': {'document': {'title': 'SALE_DEED_METADATA_SENTINEL'}},
        'perspective_reviews': {'contract_giver': {'findings': [], 'summary': {'score': 73}},
            'contract_acceptor': {'findings': [], 'summary': {'score': 78}}},
    }
    storage.save_graph(meta.contract_id, saved)
    return storage, meta, chunk, saved


@pytest.mark.parametrize('workspace', [False, True])
def test_chat_receives_graph_facts_alongside_metadata_and_returns_real_citations(monkeypatch, graph_document, workspace):
    _, meta, chunk, _ = graph_document
    monkeypatch.setattr(retrieval, 'HybridRetriever', lambda *a, **k: SimpleNamespace(search=lambda *a, **k: [chunk]))
    prompts = []
    def generate(prompt, *args, **kwargs):
        prompts.append(prompt)
        return {'answer': 'The Vendor transfers the property to the Vendee.', 'cited_chunk_ids': [chunk.chunk_id]}
    monkeypatch.setattr(main, 'generate', generate)
    body = {'message': 'Who transfers the property to whom?', 'model': 'gemini-test'}
    if workspace: body['contract_ids'] = [meta.contract_id]
    route = '/api/workspace/chat' if workspace else f'/api/contracts/{meta.contract_id}/chat'
    response = TestClient(main.app).post(route, json=body, headers={'X-Workspace-ID': 'owner'})
    assert response.status_code == 200
    assert 'Vendor --TRANSFERS_TO--> Vendee' in prompts[-1]
    assert 'SALE_DEED_METADATA_SENTINEL' in prompts[-1]
    assert response.json()['citations'][0]['chunk_id'] == chunk.chunk_id
    assert 'TRANSFERS_TO' in str(response.json()['retrieval_trace']['graph_facts'])


def test_graph_facts_are_limited_to_retrieved_evidence(graph_document):
    _, _, chunk, saved = graph_document
    saved['graph']['edges'].append({'source': 'vendor', 'target': 'vendee', 'relation': 'UNRELATED_SENTINEL',
        'evidence_sources': [{'chunk_id': 'other_C0001', 'page': 8, 'quote': 'Unrelated evidence'}]})
    context = agents.graph_context(saved, [chunk])
    assert 'TRANSFERS_TO' in context
    assert 'UNRELATED_SENTINEL' not in context


def test_saved_graph_routes_preserve_scores_metadata_and_workspace_isolation(graph_document):
    storage, meta, _, saved = graph_document
    client = TestClient(main.app); headers = {'X-Workspace-ID': 'owner'}
    route = f'/api/contracts/{meta.contract_id}'
    assert client.get(route + '/graph', headers=headers).json()['graph'] == saved['graph']
    assert client.get(route + '/metadata', headers=headers).json() == saved['metadata']
    assert client.get(route + '/artifacts', headers=headers).json()['graph'] == saved['graph']
    review = client.get(route + '/review', headers=headers).json()
    assert review['perspective_reviews']['contract_giver']['summary']['score'] == 73
    assert review['perspective_reviews']['contract_acceptor']['summary']['score'] == 78
    for suffix in ['graph', 'metadata', 'artifacts']:
        assert client.get(route + '/' + suffix, headers={'X-Workspace-ID': 'other'}).status_code == 404
    assert storage.load_graph(meta.contract_id) == saved


def test_viewing_old_results_does_not_generate_a_graph_or_call_a_model(monkeypatch, graph_document):
    storage, meta, _, saved = graph_document
    saved.pop('graph')
    storage.save_graph(meta.contract_id, saved)
    def fail(*args, **kwargs): pytest.fail('Viewing saved results must not generate graph/model output')
    monkeypatch.setattr(main, 'build_graph', fail)
    monkeypatch.setattr(main, 'generate', fail)
    response = TestClient(main.app).get(f'/api/contracts/{meta.contract_id}/graph', headers={'X-Workspace-ID': 'owner'})
    assert response.status_code == 200
    assert response.json()['metadata'] == saved['metadata']
    assert storage.load_graph(meta.contract_id) == saved
