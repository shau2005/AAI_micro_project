from datetime import datetime, timezone
from types import SimpleNamespace

from fastapi.testclient import TestClient
from backend.app import main, retrieval
from backend.app.models import Chunk, ContractMeta
from backend.app.storage import LocalStore


def test_document_chat_persists_separate_history_and_uses_only_its_own_evidence(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    chunks = {}
    for cid, text in [('A', 'ALPHA_ONLY payment due in thirty days.'), ('B', 'BETA_ONLY payment due in sixty days.')]:
        meta = ContractMeta(contract_id=cid, workspace_id='owner', original_filename=f'{cid}.pdf', sha256=cid,
            upload_time=datetime.now(timezone.utc), processing_status='ready')
        storage.save_contract(meta, b'%PDF test')
        chunks[cid] = Chunk(chunk_id=f'{cid}_C0001', contract_id=cid, page_start=1, page_end=1, text=text)
        storage.save_chunks(cid, [chunks[cid]])
    storage.save_workspace_message('user', 'WORKSPACE_ONLY_SENTINEL', workspace_id='owner')
    monkeypatch.setattr(retrieval, 'HybridRetriever', lambda passages, *a, **k: SimpleNamespace(search=lambda *a, **k: passages))
    monkeypatch.setattr(main, 'standalone_retrieval_query', lambda question, *a: question)
    prompts = []
    def generate(prompt, schema, model):
        prompts.append(prompt)
        cid = 'A' if 'ALPHA_ONLY' in prompt else 'B'
        return {'answer': f'Answer for {cid}', 'cited_chunk_ids': [chunks[cid].chunk_id]}
    monkeypatch.setattr(main, 'generate', generate)
    client = TestClient(main.app)
    headers = {'X-Workspace-ID': 'owner'}
    for cid, question in [('A', 'ALPHA_QUESTION'), ('B', 'BETA_QUESTION'), ('A', 'ALPHA_FOLLOW_UP')]:
        response = client.post(f'/api/contracts/{cid}/chat', headers=headers, json={'message': question, 'model': 'gemini-test'})
        assert response.status_code == 200
        assert response.json()['citations'][0]['chunk_id'] == chunks[cid].chunk_id
    assert 'BETA_ONLY' not in prompts[0] and 'ALPHA_ONLY' not in prompts[1]
    assert 'ALPHA_QUESTION' in prompts[2] and 'BETA_QUESTION' not in prompts[2]
    assert all('WORKSPACE_ONLY_SENTINEL' not in prompt for prompt in prompts)
    # A new client reopens persisted document histories, rather than a shared conversation.
    reopened = TestClient(main.app)
    history_a = reopened.get('/api/contracts/A/messages', headers=headers).json()
    history_b = reopened.get('/api/contracts/B/messages', headers=headers).json()
    assert [m['content'] for m in history_a if m['role'] == 'user'] == ['ALPHA_QUESTION', 'ALPHA_FOLLOW_UP']
    assert [m['content'] for m in history_b if m['role'] == 'user'] == ['BETA_QUESTION']
    for suffix in ['messages', 'chat']:
        route = f'/api/contracts/A/{suffix}'
        denied = reopened.get(route, headers={'X-Workspace-ID': 'other'}) if suffix == 'messages' else reopened.post(route, headers={'X-Workspace-ID': 'other'}, json={'message': 'Forbidden', 'model': 'local'})
        assert denied.status_code == 404
    assert len(storage.messages('A')) == 4
    assert len(storage.workspace_messages('owner')) == 1
