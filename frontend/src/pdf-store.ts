type PdfStoreOptions = {
  apiBase: string;
  workspaceId: string;
  fetchDocument?: (url: string, init: RequestInit) => Promise<Response>;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
};

export function createPdfStore({apiBase, workspaceId, fetchDocument = fetch,
  createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url)}: PdfStoreOptions) {
  const requests = new Map<string, Promise<string>>();
  const urls = new Set<string>();
  let disposed = false;

  function load(contractId: string): Promise<string> {
    if (disposed) return Promise.reject(new Error('This workspace has been closed.'));
    const cached = requests.get(contractId);
    if (cached) return cached;
    const request = (async () => {
      const response = await fetchDocument(`${apiBase}/contracts/${encodeURIComponent(contractId)}/document`, {
        headers: {'X-Workspace-ID': workspaceId},
      });
      if (!response.ok) throw new Error('Could not open this PDF in the current workspace. Click the link to retry.');
      const blob = await response.blob();
      if (!blob.type.toLowerCase().startsWith('application/pdf')) {
        throw new Error('The server did not return a PDF. Click the link to retry.');
      }
      if (disposed) throw new Error('This workspace has been closed.');
      const url = createUrl(blob);
      urls.add(url);
      return url;
    })();
    requests.set(contractId, request);
    request.catch(() => {
      if (requests.get(contractId) === request) requests.delete(contractId);
    });
    return request;
  }

  function dispose() {
    disposed = true;
    urls.forEach(revokeUrl);
    urls.clear();
    requests.clear();
  }

  return {load, dispose};
}
