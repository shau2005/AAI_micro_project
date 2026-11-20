export type ChatEntry = {role: string; content: string};
type Session<T> = {messages: T[]; draft: string; loaded: boolean; loading: boolean; busy: boolean; error: string};

// Keep asynchronous history loads and replies attached to their originating document.
export class DocumentChatSessions<T extends ChatEntry> {
  private sessions = new Map<string, Session<T>>();
  private generations = new Map<string, number>();
  private listeners = new Set<() => void>();
  private empty: Session<T> = {messages: [], draft: '', loaded: false, loading: false, busy: false, error: ''};
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  get = (id?: string): Session<T> => id ? this.sessions.get(id) || this.empty : this.empty;
  private update(id: string, patch: Partial<Session<T>>) {
    this.sessions.set(id, {...this.get(id), ...patch});
    this.listeners.forEach(listener => listener());
  }
  forget(id: string) {
    this.generations.set(id, (this.generations.get(id) || 0) + 1);
    this.sessions.delete(id);
    this.listeners.forEach(listener => listener());
  }
  setDraft(id: string, draft: string) { this.update(id, {draft}); }
  async load(id: string, fetchHistory: () => Promise<T[]>) {
    const session = this.get(id);
    if (session.loaded || session.loading || session.busy) return;
    const generation = this.generations.get(id) || 0;
    this.update(id, {loading: true, error: ''});
    try {
      const messages = await fetchHistory();
      if ((this.generations.get(id) || 0) === generation) this.update(id, {messages, loaded: true});
    } catch {
      if ((this.generations.get(id) || 0) === generation) this.update(id, {error: 'Could not load this document’s conversation. Please retry.'});
    } finally { if ((this.generations.get(id) || 0) === generation) this.update(id, {loading: false}); }
  }
  async send(id: string, sendMessage: (text: string) => Promise<T>) {
    const session = this.get(id);
    const text = session.draft.trim();
    if (!text || !session.loaded || session.loading || session.busy) return;
    const generation = this.generations.get(id) || 0;
    this.update(id, {draft: '', busy: true, error: '', messages: [...session.messages, {role: 'user', content: text} as T]});
    try {
      const reply = await sendMessage(text);
      if ((this.generations.get(id) || 0) === generation) this.update(id, {messages: [...this.get(id).messages, reply]});
    } catch {
      if ((this.generations.get(id) || 0) === generation) this.update(id, {error: 'Could not send your question. Please try again.', draft: this.get(id).draft || text});
    } finally { if ((this.generations.get(id) || 0) === generation) this.update(id, {busy: false}); }
  }
}
