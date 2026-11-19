from datetime import datetime, timezone
from types import SimpleNamespace
import json

import pytest
from fastapi.testclient import TestClient

from backend.app import agents, main
from backend.app.models import Chunk, ContractMeta
from backend.app.storage import LocalStore


@pytest.fixture
def saved_contract(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    monkeypatch.setattr(agents, 'store', storage)
    meta = ContractMeta(contract_id='baseline-test', workspace_id='owner', original_filename='sample.pdf',
        sha256='test', upload_time=datetime.now(timezone.utc), processing_status='ready', analysis_status='complete')
    chunk = Chunk(chunk_id='baseline-test_C0001', contract_id=meta.contract_id, page_start=1, page_end=1,
        text='The Licensee shall pay the monthly licence fee on the fifth day of each month.')
    storage.save_contract(meta, b'%PDF test')
    storage.save_chunks(meta.contract_id, [chunk])
    old = {'classification': {'document_type': 'leave and licence agreement'},
        'graph': {'nodes': [{'id': 'secret-node', 'label': 'GRAPH_ONLY_SENTINEL'}], 'edges': []},
        'graph_review': {'node_count': 1},
        'perspective_reviews': {'contract_giver': {'findings': [], 'summary': {'score': 73}},
                                'contract_acceptor': {'findings': [], 'summary': {'score': 78}}}}
    path = storage.root / 'indexes' / f'{meta.contract_id}.graph.json'
    path.write_text(json.dumps(old))
    return storage, meta, chunk, path


def test_baseline_agent_registry_excludes_graph_agents():
    assert not {'GraphBuilder', 'GraphValidator', 'GraphReviewerAgent', 'GraphRetriever'} & agents.AGENT_CONTRIBUTIONS.keys()
    assert 'RetrieverAgent' in agents.AGENT_CONTRIBUTIONS
    assert 'ContractScorer' in agents.AGENT_CONTRIBUTIONS


def test_legacy_reviews_remain_readable_without_exposing_graph(saved_contract):
    storage, meta, _, path = saved_contract
    before = path.read_bytes()
    data = storage.load_artifacts(meta.contract_id)
    assert 'graph' not in data and 'graph_review' not in data
    assert data['perspective_reviews']['contract_acceptor']['summary']['score'] == 78
    assert path.read_bytes() == before


def test_baseline_api_preserves_scores_and_workspace_boundaries(saved_contract):
    _, meta, _, _ = saved_contract
    client = TestClient(main.app)
    route = f'/api/contracts/{meta.contract_id}'
    allowed = {'X-Workspace-ID': 'owner'}
    assert client.get(route + '/graph', headers=allowed).status_code == 404
    response = client.get(route + '/artifacts', headers=allowed)
    assert response.status_code == 200 and 'graph' not in response.json()
    assert client.get(route + '/artifacts', headers={'X-Workspace-ID': 'other'}).status_code == 404
    review = client.get(route + '/review', headers=allowed).json()
    assert review['perspective_reviews']['contract_giver']['summary']['score'] == 73


@pytest.mark.parametrize('workspace', [False, True])
def test_chat_uses_passages_and_does_not_inject_historical_graph(monkeypatch, saved_contract, workspace):
    from backend.app import retrieval
    storage, meta, chunk, _ = saved_contract
    prompts = []
    monkeypatch.setattr(retrieval, 'HybridRetriever', lambda *a, **k: SimpleNamespace(search=lambda *a, **k: [chunk]))
    def generate(prompt, *args, **kwargs):
        prompts.append(prompt)
        return {'answer': 'The licence fee is due on the fifth day of each month.', 'cited_chunk_ids': [chunk.chunk_id]}
    monkeypatch.setattr(main, 'generate', generate)
    request = {'message': 'When is the licence fee due?', 'model': 'gemini-test'}
    if workspace:
        request['contract_ids'] = [meta.contract_id]
    route = '/api/workspace/chat' if workspace else f'/api/contracts/{meta.contract_id}/chat'
    response = TestClient(main.app).post(route, json=request, headers={'X-Workspace-ID': 'owner'})
    assert response.status_code == 200
    assert chunk.text in prompts[-1]
    assert all('GRAPH_ONLY_SENTINEL' not in prompt for prompt in prompts)
    assert response.json()['citations'][0]['chunk_id'] == chunk.chunk_id
    assert 'graph_facts' not in response.json()['retrieval_trace']
