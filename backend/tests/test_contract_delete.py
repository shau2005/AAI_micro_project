from datetime import datetime, timezone
import sqlite3

import pytest
from fastapi.testclient import TestClient
from backend.app import main, vector_store
from backend.app.models import Chunk, ContractMeta
from backend.app.retrieval import HybridRetriever
from backend.app.storage import LocalStore


@pytest.fixture
def documents(monkeypatch, tmp_path):
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    monkeypatch.setattr(main.settings, 'enable_local_embeddings', False)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    deleted_vectors = []
    monkeypatch.setattr(vector_store, 'delete_contract', deleted_vectors.append)
    content = b'%PDF-1.7 synthetic contract for deletion tests'
    metas = []
    for workspace in ['owner', 'other']:
        cid, digest = storage.contract_id(content, workspace)
        meta = ContractMeta(contract_id=cid, workspace_id=workspace, original_filename='sample.pdf', sha256=digest,
            upload_time=datetime.now(timezone.utc), processing_status='ready', analysis_status='complete')
        storage.save_contract(meta, content)
        storage.save_chunks(cid, [Chunk(chunk_id=f'{cid}_C0001', contract_id=cid, page_start=1, page_end=1, text='Synthetic contract.')])
        storage.save_message(cid, 'user', f'Question for {workspace}')
        storage.save_graph(cid, {'perspective_reviews': {'contract_giver': {'findings': [], 'summary': {'score': 70}}}})
        (tmp_path / 'indexes' / f'{cid}.graph.json').write_text('{}')
        (tmp_path / 'embeddings' / f'{cid}.npy').write_bytes(b'placeholder')
        (tmp_path / 'reports' / f'{cid}.json').write_text('{}')
        with sqlite3.connect(storage.db) as db:
            db.execute('insert into findings(id,contract_id,data) values (?,?,?)', (cid + '_F1', cid, '{}'))
        metas.append(meta)
    HybridRetriever._cache[metas[0].contract_id] = ([], 'cached-index')
    yield storage, metas, content, deleted_vectors
    HybridRetriever._cache.pop(metas[0].contract_id, None)


def test_delete_removes_only_owned_document_and_all_reusable_artifacts(documents):
    storage, (owned, other), _, removed = documents
    client = TestClient(main.app)
    response = client.delete(f'/api/contracts/{owned.contract_id}', headers={'X-Workspace-ID': 'owner'})
    assert response.status_code == 200
    assert removed == [owned.contract_id]
    with pytest.raises(KeyError): storage.get_meta(owned.contract_id)
    assert storage.messages(owned.contract_id) == []
    with sqlite3.connect(storage.db) as db:
        assert db.execute('select count(*) from findings where contract_id=?', (owned.contract_id,)).fetchone()[0] == 0
        assert db.execute('select count(*) from findings where contract_id=?', (other.contract_id,)).fetchone()[0] == 1
    assert owned.contract_id not in HybridRetriever._cache
    assert not any(p.is_file() and p.name.startswith(owned.contract_id + '.') for p in storage.root.rglob('*'))
    assert storage.get_meta(other.contract_id).contract_id == other.contract_id
    assert storage.messages(other.contract_id)
    assert (storage.root / 'contracts' / f'{other.contract_id}.pdf').exists()
    assert client.delete(f'/api/contracts/{owned.contract_id}', headers={'X-Workspace-ID': 'owner'}).status_code == 404


def test_other_workspace_cannot_delete_contract(documents):
    storage, (owned, _), _, removed = documents
    assert TestClient(main.app).delete(f'/api/contracts/{owned.contract_id}', headers={'X-Workspace-ID': 'other'}).status_code == 404
    assert storage.get_meta(owned.contract_id)
    assert removed == []


@pytest.mark.parametrize('processing,analysis', [('indexing','queued'), ('ready','queued'), ('ready','running')])
def test_deleting_document_waits_for_background_processing(documents, processing, analysis):
    storage, (owned, _), _, removed = documents
    owned.processing_status = processing; owned.analysis_status = analysis
    storage.update_meta(owned)
    response = TestClient(main.app).delete(f'/api/contracts/{owned.contract_id}', headers={'X-Workspace-ID': 'owner'})
    assert response.status_code == 409
    assert storage.messages(owned.contract_id)
    assert removed == []


def test_failed_upload_can_be_deleted_even_when_its_review_was_queued(documents):
    storage, (owned, _), _, _ = documents
    owned.processing_status = 'failed'; owned.analysis_status = 'queued'
    storage.update_meta(owned)
    assert TestClient(main.app).delete(f'/api/contracts/{owned.contract_id}', headers={'X-Workspace-ID': 'owner'}).status_code == 200


def test_same_pdf_upload_after_delete_is_indexed_afresh(monkeypatch, documents):
    storage, (owned, _), content, _ = documents
    monkeypatch.setattr(main, 'available_models', lambda: [])
    indexed = []
    def index(cid, data, workspace, model, perspective):
        indexed.append(cid)
        assert storage.messages(cid) == []
        assert storage.load_graph(cid) is None
        assert not (storage.root / 'embeddings' / f'{cid}.npy').exists()
    monkeypatch.setattr(main, 'index_contract', index)
    client = TestClient(main.app)
    headers = {'X-Workspace-ID': 'owner'}
    assert client.delete(f'/api/contracts/{owned.contract_id}', headers=headers).status_code == 200
    response = client.post('/api/contracts', headers=headers, data={'model': 'local'}, files={'file': ('sample.pdf', content, 'application/pdf')})
    assert response.status_code == 200
    assert response.json()['contract_id'] == owned.contract_id
    assert response.json()['processing_status'] == 'indexing'
    assert indexed == [owned.contract_id]


def test_vector_delete_does_not_create_a_collection(monkeypatch, tmp_path):
    monkeypatch.setattr(vector_store.settings, 'data_dir', tmp_path)
    calls = []
    class Client:
        def delete_collection(self, *, name): calls.append(name)
    monkeypatch.setattr(vector_store, '_client', lambda: Client())
    # No vector directory means there is nothing to delete or initialize.
    vector_store.delete_contract('sample-document')
    assert calls == []
    (tmp_path / 'chroma').mkdir()
    vector_store.delete_contract('sample-document')
    assert calls == ['contract_sample_document']
