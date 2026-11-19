import React, {createContext, useContext, useEffect, useMemo, useState} from 'react';
import {createPdfStore} from './pdf-store';

const PdfContext = createContext<ReturnType<typeof createPdfStore> | null>(null);

export function PdfProvider({apiBase, workspaceId, children}: {
  apiBase: string; workspaceId: string; children: React.ReactNode;
}) {
  const store = useMemo(() => createPdfStore({apiBase, workspaceId}), [apiBase, workspaceId]);
  useEffect(() => () => store.dispose(), [store]);
  return <PdfContext.Provider value={store}>{children}</PdfContext.Provider>;
}

export function PdfLink({contractId, page, className, children}: {
  contractId: string; page?: number; className?: string; children: React.ReactNode;
}) {
  const store = useContext(PdfContext);
  const [result, setResult] = useState<{store: typeof store; contractId: string; url?: string; error?: string}>();
  const [retry, setRetry] = useState(0);
  const current = result?.store === store && result.contractId === contractId ? result : undefined;
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store.load(contractId).then(url => {
      if (!cancelled) setResult({store, contractId, url});
    }).catch(error => {
      if (!cancelled) setResult({store, contractId, error: error.message});
    });
    return () => { cancelled = true; };
  }, [store, contractId, retry]);
  return <><a className={className} href={current?.url ? `${current.url}${page ? `#page=${page}` : ''}` : undefined}
    target="_blank" rel="noreferrer" aria-busy={!current} aria-disabled={!current?.url}
    title={current?.error || (!current?.url ? 'Preparing PDF…' : undefined)}
    onClick={event => {
      if (!current?.url) {
        event.preventDefault();
        if (current?.error) { setResult(undefined); setRetry(value => value + 1); }
      }
    }}>{children}</a>{current?.error && <small className="pdf-error" role="alert">{current.error}</small>}</>;
}
