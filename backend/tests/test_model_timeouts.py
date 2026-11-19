from types import SimpleNamespace
from datetime import datetime, timezone

import httpx
import pytest
from requests.exceptions import Timeout as RequestsTimeout

from backend.app import agents, gemini


@pytest.mark.parametrize('error', [RequestsTimeout('slow request'), httpx.ReadTimeout('slow response')])
def test_gemini_timeout_stops_without_repeated_attempts(monkeypatch, error):
    calls = []
    def generate_content(**kwargs):
        calls.append(kwargs)
        raise error
    client = gemini.GeminiClient.__new__(gemini.GeminiClient)
    client.client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    monkeypatch.setattr(gemini.settings, 'max_retries', 2)
    with pytest.raises(gemini.ModelTimeoutError, match='Retry the review'):
        client.generate_structured('test', {'type': 'object'})
    assert len(calls) == 1


def test_generation_client_configures_timeout_in_milliseconds(monkeypatch):
    from google import genai
    options = []
    monkeypatch.setattr(gemini.settings, 'gemini_api_key', 'test-key')
    monkeypatch.setattr(gemini.settings, 'gemini_timeout_seconds', 60)
    monkeypatch.setattr(genai, 'Client', lambda **kwargs: options.append(kwargs) or SimpleNamespace())
    gemini.GeminiClient()
    assert options[0]['http_options']['timeout'] == 60000


def test_orchestrator_does_not_retry_a_model_timeout(monkeypatch):
    events, calls = [], []
    monkeypatch.setattr(agents, 'store', SimpleNamespace(audit=events.append))
    def fail():
        calls.append(True)
        raise gemini.ModelTimeoutError('Gemini timeout; retry the review')
    with pytest.raises(agents.AgentFailure, match='1 attempt'):
        agents.MasterAgent(max_retries=2).execute('InitialScan', agents.AgentContext(contract_id='test'), fail)
    assert len(calls) == 1
    assert events[-1]['action'] == 'failed'


def test_orchestrator_keeps_retries_for_other_failures_and_reports_stage(monkeypatch):
    events, calls, stages = [], [], []
    monkeypatch.setattr(agents, 'store', SimpleNamespace(audit=events.append))
    def recover():
        calls.append(True)
        if len(calls) == 1:
            raise RuntimeError('temporary failure')
        return {}
    agents.MasterAgent(max_retries=2, on_progress=stages.append).execute('InitialScan', agents.AgentContext(contract_id='test'), recover)
    assert len(calls) == 2
    assert stages == ['InitialScan']
    assert [e['action'] for e in events] == ['retry', 'completed']


def test_review_timeout_produces_failed_state_instead_of_running(monkeypatch, tmp_path):
    from backend.app import main
    from backend.app.models import ContractMeta, ReviewRequest
    from backend.app.storage import LocalStore
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    def fail(*args, **kwargs):
        raise agents.AgentFailure('Gemini timeout. Retry the review.')
    monkeypatch.setattr(main, 'MasterAgent', lambda **kwargs: SimpleNamespace(run_review=fail))
    meta = ContractMeta(contract_id='test', original_filename='sample.pdf', sha256='test', upload_time=datetime.now(timezone.utc), processing_status='ready')
    storage.save_contract(meta, b'%PDF test')
    main.run_review('test', [], meta, ReviewRequest(model='gemini-test'))
    saved = storage.get_meta('test')
    assert saved.analysis_status == 'failed'
    assert 'timeout' in saved.analysis_stage


def test_unavailable_model_fails_once_with_actionable_status(monkeypatch):
    class Unavailable(Exception):
        code = 404
    calls = []
    def fail(**kwargs):
        calls.append(True)
        raise Unavailable('model retired')
    client = gemini.GeminiClient.__new__(gemini.GeminiClient)
    client.client = SimpleNamespace(models=SimpleNamespace(generate_content=fail))
    with pytest.raises(gemini.ModelGenerationError, match='HTTP 404.*unavailable'):
        client.generate_structured('test', {'type': 'object'})
    assert len(calls) == 1


def test_retry_records_selected_local_model(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from backend.app import main
    from backend.app.models import ContractMeta, Chunk
    from backend.app.storage import LocalStore
    monkeypatch.setattr(main.settings, 'data_dir', tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, 'store', storage)
    meta = ContractMeta(contract_id='test-local', original_filename='sample.pdf', sha256='test', upload_time=datetime.now(timezone.utc), processing_status='ready', analysis_status='failed', selected_model='gemini-test')
    storage.save_contract(meta, b'%PDF test')
    storage.save_chunks(meta.contract_id, [Chunk(chunk_id='c', contract_id=meta.contract_id, page_start=1, page_end=1, text='Licence fee is due monthly.')])
    monkeypatch.setattr(main, 'run_review', lambda *a, **k: None)
    r = TestClient(main.app).post('/api/contracts/test-local/review', json={'model': 'local'})
    assert r.status_code == 202
    assert storage.get_meta(meta.contract_id).selected_model == ''
